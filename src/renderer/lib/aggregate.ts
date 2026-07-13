/* ============================================================================
   aggregate.ts — группировка истории по дате / модели / часам + расход 1/7/30д.
   Всё считается локально из уже загруженной истории (Рамс №9 «экологичный» —
   не делаем лишних запросов ради агрегации).
   ========================================================================== */

import type {
  Aggregate,
  DaySpend,
  Generation,
  GenerationRaw,
  HourSpend,
  ModelStat,
} from "../../types";
import { numberOr } from "./polzaClient";
import { toDayKey } from "./format";

/** Нормализовать одну «сырую» генерацию в доменную (с числовым cost и day). */
export function normalizeGeneration(raw: GenerationRaw): Generation | null {
  const id = raw.id;
  if (id === undefined || id === null || id === "") return null;

  // cost из списка (строка/число); clientCost — fallback для деталей.
  const cost = numberOr(raw.cost ?? raw.clientCost, 0);

  const createdAtRaw = raw.createdAt;
  const createdAt =
    typeof createdAtRaw === "string" && createdAtRaw
      ? createdAtRaw
      : new Date().toISOString();

  return {
    id: String(id),
    model: typeof raw.model === "string" ? raw.model : "—",
    requestType: typeof raw.requestType === "string" ? raw.requestType : "chat",
    status: typeof raw.status === "string" ? raw.status : "unknown",
    cost,
    usage: raw.usage,
    createdAt,
    day: toDayKey(createdAt),
    provider: typeof raw.provider === "string" ? raw.provider : undefined,
  };
}

/** Нормализовать массив сырых генераций, отбрасывая невалидные. */
export function normalizeGenerations(raws: GenerationRaw[]): Generation[] {
  const out: Generation[] = [];
  for (const r of raws) {
    const g = normalizeGeneration(r);
    if (g) out.push(g);
  }
  return out;
}

/** Расход по дням: { 'YYYY-MM-DD': сумма cost }. */
export function groupByDay(items: Generation[]): DaySpend {
  const byDay: DaySpend = {};
  for (const g of items) {
    byDay[g.day] = (byDay[g.day] ?? 0) + g.cost;
  }
  return byDay;
}

/** Топ моделей по расходу (по убыванию). */
export function groupByModel(items: Generation[], topN = Infinity): ModelStat[] {
  const map = new Map<string, ModelStat>();
  for (const g of items) {
    const cur = map.get(g.model);
    if (cur) {
      cur.cost += g.cost;
      cur.count += 1;
    } else {
      map.set(g.model, { model: g.model, cost: g.cost, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost).slice(0, topN);
}

/**
 * Почасовой профиль трат (0–23): сумма по часам создания.
 * Считается уже сейчас — бесплатно для буд. виджета 4.8 «сегодня vs обычно».
 */
export function groupByHour(items: Generation[]): HourSpend {
  const hours: HourSpend = new Array(24).fill(0);
  for (const g of items) {
    const h = new Date(g.createdAt).getHours();
    if (h >= 0 && h < 24) hours[h] += g.cost;
  }
  return hours;
}

/** Сумма cost за последние N дней (от now назад), по полю day. */
export function spendLastNDays(byDay: DaySpend, n: number, now = Date.now()): number {
  let sum = 0;
  const today = new Date(now);
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = toDayKey(d);
    sum += byDay[key] ?? 0;
  }
  return sum;
}

/**
 * Построить полный агрегат по нормализованной истории одного ключа.
 * @param items нормализованные генерации (уже за нужный период).
 */
export function buildAggregate(
  items: Generation[],
  now = Date.now()
): Aggregate {
  const byDay = groupByDay(items);
  const byHour = groupByHour(items);
  const byModel = groupByModel(items);
  const spend1d = spendLastNDays(byDay, 1, now);
  const spend7d = spendLastNDays(byDay, 7, now);
  const spend30d = spendLastNDays(byDay, 30, now);

  // Период выборки
  let from = "";
  let to = "";
  if (items.length) {
    const times = items
      .map((g) => g.createdAt)
      .sort();
    from = times[0];
    to = times[times.length - 1];
  }

  return {
    byDay,
    byHour,
    byModel,
    spend1d,
    spend7d,
    spend30d,
    count: items.length,
    from,
    to,
  };
}

/**
 * Серия значений по дням для спарклайна (последние n дней, включая нули).
 * Возвращает [{ day, value }, ...] в хронологическом порядке.
 */
export function daySeries(byDay: DaySpend, n: number, now = Date.now()): { day: string; value: number }[] {
  const out: { day: string; value: number }[] = [];
  const today = new Date(now);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = toDayKey(d);
    out.push({ day: key, value: byDay[key] ?? 0 });
  }
  return out;
}

/**
 * Медиана дневного расхода за последние N дней (устойчива к выбросам —
 * одна видео-генерация не должна драматически искажать прогноз).
 */
export function medianDailySpend(byDay: DaySpend, n: number, now = Date.now()): number {
  const series = daySeries(byDay, n, now).map((d) => d.value);
  if (!series.length) return 0;
  const sorted = [...series].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
