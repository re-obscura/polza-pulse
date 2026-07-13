/* ============================================================================
   polzaClient.ts — обёртка над fetch к 4 эндпоинтам Polza.ai.
   Параметризована API-ключом + baseUrl.
   Авторизация API-ключом: каждый ключ видит ТОЛЬКО свои генерации (ТЗ §3).

   Обработка ошибок (ТЗ §5):
     401 → PolzaAuthError (ключ невалиден)
     429 → PolzaRateLimitError (вызывающий делает backoff)
     сеть → тихий retry ×3
     прочие 4xx/5xx → PolzaHttpError
   Rate-limit: не чаще 1 запроса/60с на ключ (минимальный throttle в клиенте).
   ========================================================================== */

import type {
  Balance,
  GenerationDetail,
  GenerationsParams,
  GenerationsResult,
  GenerationRaw,
} from "../../types";

/* ---- Ошибки ---- */

export class PolzaError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | "auth"
      | "rate-limit"
      | "network"
      | "http"
      | "parse",
    public readonly status?: number
  ) {
    super(message);
    this.name = "PolzaError";
  }
}

export const isAuthError = (e: unknown): boolean =>
  e instanceof PolzaError && e.kind === "auth";
export const isRateLimitError = (e: unknown): boolean =>
  e instanceof PolzaError && e.kind === "rate-limit";

/* ---- Клиент ---- */

export interface PolzaClientOptions {
  key: string;
  baseUrl: string;
  /** Минимальный интервал между запросами, мс (default 1000). */
  minIntervalMs?: number;
  /** Сетевой timeout, мс. */
  timeoutMs?: number;
}

/** Нормализуем baseUrl: убираем завершающий слэш. */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** Sleep-помощник. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class PolzaClient {
  private readonly key: string;
  private readonly baseUrl: string;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  /** Время последнего запроса — для throttle. */
  private lastReq = 0;

  constructor(opts: PolzaClientOptions) {
    this.key = opts.key.trim();
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.minIntervalMs = opts.minIntervalMs ?? 1000;
    this.timeoutMs = opts.timeoutMs ?? 15000;
  }

  /* ---- Низкоуровневый запрос с retry/backoff ---- */

  private async request<T>(path: string, search?: URLSearchParams): Promise<T> {
    // Throttle: не чаще minIntervalMs.
    const wait = this.lastReq + this.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);

    const url = search
      ? `${this.baseUrl}${path}?${search.toString()}`
      : `${this.baseUrl}${path}`;

    const doFetch = async (attempt: number): Promise<Response> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.key}`,
            Accept: "application/json",
          },
          signal: controller.signal,
        });
        this.lastReq = Date.now();
        return res;
      } catch (e) {
        // Сеть/abort — тихий retry ×3 с экспоненциальным backoff.
        if (attempt < 3) {
          await sleep(400 * Math.pow(2, attempt));
          return doFetch(attempt + 1);
        }
        throw new PolzaError(
          e instanceof Error ? e.message : "Сетевая ошибка",
          "network"
        );
      } finally {
        clearTimeout(timer);
      }
    };

    const res = await doFetch(0);

    if (res.status === 401) {
      throw new PolzaError("Неверный API-ключ (401)", "auth", 401);
    }
    if (res.status === 429) {
      throw new PolzaError("Превышен лимит запросов (429)", "rate-limit", 429);
    }
    if (!res.ok) {
      let body = "";
      try {
        body = await res.text();
      } catch {
        /* ignore */
      }
      throw new PolzaError(
        `Ошибка API (${res.status})${body ? ": " + body.slice(0, 200) : ""}`,
        "http",
        res.status
      );
    }

    try {
      return (await res.json()) as T;
    } catch {
      throw new PolzaError("Не удалось разобрать ответ API", "parse");
    }
  }

  /* ---- Публичные методы эндпоинтов ---- */

  /** GET /v1/balance → нормализованный Balance. */
  async getBalance(): Promise<Balance> {
    const raw = await this.request<Record<string, unknown>>("/balance");
    // Поле может называться по-разному; нормализуем.
    const amount = numberOr(
      raw.balance ?? raw.amount ?? raw.value ?? raw.total,
      NaN
    );
    if (Number.isNaN(amount)) {
      throw new PolzaError("Неожиданный формат ответа /balance", "parse");
    }
    return {
      amount,
      currency: typeof raw.currency === "string" ? raw.currency : "RUB",
    };
  }

  /** GET /v1/history/generations → нормализованный результат. */
  async getGenerations(params: GenerationsParams = {}): Promise<GenerationsResult> {
    const search = new URLSearchParams();
    const page = params.page ?? 1;
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 100);
    search.set("page", String(page));
    search.set("limit", String(limit));
    if (params.dateFrom) search.set("dateFrom", params.dateFrom);
    if (params.dateTo) search.set("dateTo", params.dateTo);
    if (params.requestType) search.set("requestType", params.requestType);
    if (params.status) search.set("status", params.status);
    if (params.sortBy) search.set("sortBy", params.sortBy);
    if (params.sortOrder) search.set("sortOrder", params.sortOrder);

    const raw = await this.request<GenerationsResponse>("/history/generations", search);

    // Ответ может быть обёрнут в { data, meta } или прийти массивом с метой.
    const items: GenerationRaw[] = extractItems(raw);
    const meta = extractMeta(raw, page, limit, items.length);

    return { items, ...meta };
  }

  /** GET /v1/history/generations/{id} → детальный ответ. */
  async getGenerationDetail(id: string | number): Promise<GenerationDetail> {
    const raw = await this.request<GenerationDetail | { data: GenerationDetail }>(
      `/history/generations/${id}`
    );
    // unwrap { data: ... }
    if (raw && typeof raw === "object" && "data" in raw && raw.data) {
      return raw.data as GenerationDetail;
    }
    return raw as GenerationDetail;
  }

  /**
   * Загрузить всю историю за период (пагинация с уважением к rate-limit).
   * Используется фоном для агрегации и страницей истории.
   */
  async getAllGenerations(
    dateFrom: string,
    dateTo: string,
    opts: { maxPages?: number; onPage?: (page: number) => void } = {}
  ): Promise<GenerationRaw[]> {
    const maxPages = opts.maxPages ?? 30;
    const all: GenerationRaw[] = [];
    let page = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await this.getGenerations({
        page,
        limit: 100,
        dateFrom,
        dateTo,
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      all.push(...res.items);
      opts.onPage?.(page);
      if (page >= res.pages || page >= maxPages) break;
      page++;
    }
    return all;
  }
}

/* ---- Нормализация ответов (API может отдавать разные обёртки) ---- */

interface GenerationsResponse {
  data?: GenerationRaw[];
  items?: GenerationRaw[];
  results?: GenerationRaw[];
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    pages?: number;
    totalCount?: number;
    totalPages?: number;
  };
  pagination?: {
    page?: number;
    limit?: number;
    total?: number;
    pages?: number;
  };
  total?: number;
  page?: number;
  limit?: number;
  pages?: number;
}

function extractItems(raw: GenerationsResponse): GenerationRaw[] {
  if (Array.isArray(raw.data)) return raw.data;
  if (Array.isArray(raw.items)) return raw.items;
  if (Array.isArray(raw.results)) return raw.results;
  return [];
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function extractMeta(
  raw: GenerationsResponse,
  page: number,
  limit: number,
  itemsLen: number
): { page: number; limit: number; total: number; pages: number } {
  // Берём любой из возможных контейнеров меты и обращаемся по строковым ключам,
  // т.к. API может называть поля по-разному (total/totalCount и т.п.).
  const metaAny = (raw.meta ?? raw.pagination ?? {}) as Record<string, unknown>;
  const total =
    num(metaAny.total) ??
    num(metaAny.totalCount) ??
    num(raw.total) ??
    itemsLen;
  const pages =
    num(metaAny.pages) ??
    num(metaAny.totalPages) ??
    num(raw.pages) ??
    Math.max(1, Math.ceil(total / limit));
  return {
    page: num(metaAny.page) ?? num(raw.page) ?? page,
    limit: num(metaAny.limit) ?? num(raw.limit) ?? limit,
    total,
    pages,
  };
}

/* ---- Утилита-парсер чисел из «строки или числа» ---- */

export function numberOr(v: unknown, fallback: number): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}
