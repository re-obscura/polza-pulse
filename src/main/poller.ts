/* ============================================================================
   poller.ts — периодический опрос API (замена chrome.alarms + service-worker).
   setInterval в main process: balance + history(30д) → aggregate → forecast
   → cache → update tray.
   ========================================================================== */

import { PolzaClient, isAuthError } from "../renderer/lib/polzaClient";
import { buildAggregate, normalizeGenerations } from "../renderer/lib/aggregate";
import { buildForecast } from "../renderer/lib/forecast";
import type { KeyCache } from "../types";
import { getCache, getKey, getSettings, patchKey, setCache } from "./store";

let timer: NodeJS.Timeout | null = null;
let polling = false;

/** Немедленный опрос (одиночный). */
export async function pollOnce(): Promise<KeyCache> {
  if (polling) return getCache()!;
  polling = true;
  try {
    const settings = getSettings();
    const now = Date.now();

    const key = getKey();
    if (!key) {
      const empty: KeyCache = {
        balance: null,
        history: [],
        aggregate: null,
        forecast: null,
        updatedAt: now,
      };
      setCache(empty);
      return empty;
    }

    const client = new PolzaClient({
      key: key.value,
      baseUrl: settings.baseUrl,
      minIntervalMs: 1100,
    });

    const dateTo = new Date(now).toISOString();
    const from = new Date(now);
    from.setDate(from.getDate() - 30);
    const dateFrom = from.toISOString();

    const prev = getCache();
    try {
      const [balance, rawGen] = await Promise.all([
        client.getBalance(),
        client.getAllGenerations(dateFrom, dateTo, { maxPages: 30 }),
      ]);

      const history = normalizeGenerations(rawGen);
      const aggregate = buildAggregate(history, now);
      const forecast = buildForecast(
        balance.amount,
        aggregate,
        settings.forecastMode,
        now
      );

      const cache: KeyCache = {
        balance,
        history,
        aggregate,
        forecast,
        updatedAt: now,
      };
      setCache(cache);

      if (key.valid === false || key.lastError) {
        patchKey({ valid: true, lastError: undefined, lastCheckedAt: now });
      }

      return cache;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
      if (isAuthError(e)) patchKey({ valid: false, lastError: msg, lastCheckedAt: now });

      const cache: KeyCache = {
        balance: prev?.balance ?? null,
        history: prev?.history ?? [],
        aggregate: prev?.aggregate ?? null,
        forecast: prev?.forecast ?? null,
        updatedAt: prev?.updatedAt ?? now,
        error: msg,
      };
      setCache(cache);
      console.warn(`[polza] poll error:`, msg);
      return cache;
    }
  } finally {
    polling = false;
  }
}

/** Запустить/перенастроить таймер опроса по интервалу из настроек. */
export function startPolling(): void {
  stopPolling();
  const { pollIntervalMin } = getSettings();
  const periodMs = Math.max(1, pollIntervalMin) * 60_000;
  timer = setInterval(() => {
    void pollOnce();
  }, periodMs);
}

/** Остановить таймер. */
export function stopPolling(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
