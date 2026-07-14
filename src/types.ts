/* ============================================================================
   Доменные типы Polza Monitor.
   Эндпоинты: /v1/balance, /v1/history/generations, /v1/history/generations/{id}.
   Авторизация API-ключом: ключ видит только свои генерации.
   ========================================================================== */

/** Режим отображения badge на иконке трея. */
export type BadgeMode = "balance" | "spendToday";

/** Режим прогноза «хватит на N дней»: среднее или медиана. */
export type ForecastMode = "mean" | "median";

/** Тема оформления: light / dark / system (следует ОС). */
export type ThemePref = "light" | "dark" | "system";

/** Тип запроса генерации (chat / image / video / audio). */
export type RequestType = "chat" | "image" | "video" | "audio";

/** Статус генерации в API. */
export type GenerationStatus =
  | "completed"
  | "failed"
  | "pending"
  | "in_progress"
  | "canceled"
  | string;

/* --------------------------------------------------------------------------
   API-ответы
   -------------------------------------------------------------------------- */

/** GET /v1/balance — поле может называться по-разному, нормализуем в Balance. */
export interface Balance {
  /** Сумма в рублях. */
  amount: number;
  /** Валюта (обычно RUB). */
  currency: string;
}

/** usage из истории/деталей: токены по этапам. */
export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  [k: string]: unknown;
}

/**
 * Элемент списка GET /v1/history/generations.
 * cost приходит строкой — нормализуем в number (Generation.cost).
 */
export interface GenerationRaw {
  id: string | number;
  model?: string;
  requestType?: RequestType | string;
  status?: GenerationStatus;
  cost?: string | number;
  clientCost?: string | number;
  usage?: Usage;
  createdAt?: string;
  finishedAt?: string;
  provider?: string;
  [k: string]: unknown;
}

/** Нормализованная генерация (после парсинга cost/дат). */
export interface Generation {
  id: string;
  model: string;
  requestType: RequestType | string;
  status: GenerationStatus;
  /** Расход в рублях, число. */
  cost: number;
  usage?: Usage;
  /** ISO-строка. */
  createdAt: string;
  /** Дата (YYYY-MM-DD) — для группировки по дням. */
  day: string;
  provider?: string;
}

/** Параметры запроса /v1/history/generations. */
export interface GenerationsParams {
  page?: number;
  limit?: number; // 1–100
  dateFrom?: string; // ISO 8601
  dateTo?: string; // ISO 8601
  requestType?: RequestType | string;
  status?: GenerationStatus;
  sortBy?: "createdAt" | "clientCost";
  sortOrder?: "asc" | "desc";
}

/** Ответ-обёртка списка генераций (нормализованный). */
export interface GenerationsResult {
  items: GenerationRaw[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}

/** GET /v1/history/generations/{id} — детальный ответ. */
export interface GenerationDetail extends GenerationRaw {
  latencyMs?: number;
  queueTimeMs?: number;
  finishReason?: string;
  attemptsCount?: number;
  clientCost?: string | number;
}

/* --------------------------------------------------------------------------
   Ключ и настройки (storage schema)
   -------------------------------------------------------------------------- */

/**
 * Единственный API-ключ приложения.
 * Мульти-ключевая архитектура убрана — ключ только один.
 */
export interface Key {
  /** Человекочитаемая метка: «Мой ключ». */
  label: string;
  /** Сам ключ (pza_...). */
  value: string;
  /** Последний результат валидации. */
  valid?: boolean;
  lastCheckedAt?: number;
  lastError?: string;
  createdAt: number;
}

/** Настройки приложения. */
export interface Settings {
  /** Интервал опроса API, минут (1/5/15/60). */
  pollIntervalMin: number;
  /** Ручной лимит расхода, ₽. По умолчанию 4000. */
  spendLimit: number;
  /** Режим прогноза. */
  forecastMode: ForecastMode;
  /** Режим badge. */
  badgeMode: BadgeMode;
  /** Валюта отображения (пока всегда RUB). */
  currency: string;
  /** Base URL API — хедж открытого вопроса ТЗ §8. */
  baseUrl: string;
  /** Тема оформления. */
  theme: ThemePref;
}

export const DEFAULT_SETTINGS: Settings = {
  pollIntervalMin: 5,
  spendLimit: 4000,
  forecastMode: "median",
  badgeMode: "spendToday",
  currency: "RUB",
  baseUrl: "https://polza.ai/api/v1",
  theme: "system",
};

/** Ключ DEFAULT_BASE_URL экспортируем отдельно для UI (нельзя менять без причины). */
export const DEFAULT_BASE_URL = DEFAULT_SETTINGS.baseUrl;

/* --------------------------------------------------------------------------
   Агрегаты и прогноз (вычисляются локально)
   -------------------------------------------------------------------------- */

/** Расход по дням: { '2026-07-10': 12.4, ... }. */
export type DaySpend = Record<string, number>;

/** Почасовой профиль трат (0–23) — считается в aggregate для буд. 4.8. */
export type HourSpend = number[]; // length 24

/** Топ-модель по расходу. */
export interface ModelStat {
  model: string;
  cost: number;
  count: number;
}

/** Полный агрегат по истории. */
export interface Aggregate {
  /** Сумма по дням (за период загрузки). */
  byDay: DaySpend;
  /** Траты по часам суток (усреднённые по дням) — сумма. */
  byHour: HourSpend;
  /** Расход по моделям. */
  byModel: ModelStat[];
  /** Расход за последние 1 день (24ч). */
  spend1d: number;
  /** Расход за последние 7 дней. */
  spend7d: number;
  /** Расход за последние 30 дней. */
  spend30d: number;
  /** Кол-во генераций в выборке. */
  count: number;
  /** Период выборки. */
  from: string;
  to: string;
}

/** Прогноз «хватит на N дней» (4.9). */
export interface Forecast {
  /** Дневной расход (mean или median), ₽/день. */
  avgDaily: number;
  /** Сколько дней хватит баланса. */
  daysLeft: number | null;
  /** Ожидаемая дата обнуления (ISO). */
  zeroDate: string | null;
  /** Режим расчёта. */
  mode: ForecastMode;
  /** true — данных недостаточно для прогноза. */
  insufficient: boolean;
}

/* --------------------------------------------------------------------------
   Кэш (offline-first)
   -------------------------------------------------------------------------- */

/** Кэш приложения: последний снимок данных (один ключ — один кэш). */
export interface KeyCache {
  balance: Balance | null;
  history: Generation[];
  aggregate: Aggregate | null;
  forecast: Forecast | null;
  updatedAt: number; // epoch ms
  /** Была ли ошибка при последнем опросе. */
  error?: string;
}

/* --------------------------------------------------------------------------
   Сообщения между renderer и main (IPC)
   -------------------------------------------------------------------------- */

/** IPC-контракт: renderer → main. */
export type IpcRequest =
  | { type: "GET_STATE" }
  | { type: "REFRESH" }
  | { type: "GET_SETTINGS" }
  | { type: "SET_SETTINGS"; patch: Partial<Settings> }
  | { type: "GET_KEY" }
  | { type: "SET_KEY"; key: Key | null }
  | { type: "CHECK_UPDATES" }
  | { type: "OPEN_EXTERNAL"; url: string }
  | { type: "OPEN_WINDOW"; name: "models" | "history" };

/** IPC-контракт: main → renderer (события). */
export type IpcEvent =
  | { type: "CACHE_CHANGED" }
  | { type: "SETTINGS_CHANGED" }
  | { type: "KEY_CHANGED" };

/** Результат проверки обновлений. */
export interface UpdateInfo {
  available: boolean;
  version?: string;
  downloaded?: boolean;
}

/* --------------------------------------------------------------------------
   Модели (GET /v1/models)
   -------------------------------------------------------------------------- */

/** Ценообразование модели (RUB). */
export interface ModelPricing {
  prompt_per_million?: number | string;
  completion_per_million?: number | string;
  currency?: string;
  [k: string]: unknown;
}

/** Модель из GET /v1/models. */
export interface ModelInfo {
  id: string;
  name: string;
  type?: string;
  context_length?: number;
  top_provider?: {
    is_moderated?: boolean;
    context_length?: number;
    pricing?: ModelPricing;
  };
  short_description?: string;
}
