/* ============================================================================
   forecast.ts — прогноз «хватит на N дней» (ТЗ 4.9).
   avgDaily = sum(cost7d)/7 (mean) ИЛИ медиана дневного расхода (median).
   daysLeft = balance / avgDaily; zeroDate — ожидаемая дата обнуления.
   Рамс №5 «честный»: при нехватке данных возвращаем insufficient=true,
   а не фейковый прогноз.
   ========================================================================== */

import type { Aggregate, DaySpend, Forecast, ForecastMode } from "../../types";
import { medianDailySpend, spendLastNDays } from "./aggregate";

/** Средний дневной расход за последние 7 дней (mean). */
function meanDailySpend(byDay: DaySpend, now = Date.now()): number {
  return spendLastNDays(byDay, 7, now) / 7;
}

/**
 * Рассчитать прогноз.
 * @param balance текущий баланс, ₽
 * @param aggregate агрегат по истории (использует byDay)
 * @param mode mean | median
 */
export function buildForecast(
  balance: number,
  aggregate: Aggregate | null,
  mode: ForecastMode = "median",
  now = Date.now()
): Forecast {
  if (!aggregate || aggregate.count === 0) {
    return {
      avgDaily: 0,
      daysLeft: null,
      zeroDate: null,
      mode,
      insufficient: true,
    };
  }

  const avgDaily =
    mode === "median"
      ? medianDailySpend(aggregate.byDay, 7, now)
      : meanDailySpend(aggregate.byDay, now);

  // Недостаточно данных: нет трат за 7 дней → честно говорим об этом.
  if (avgDaily <= 0) {
    return {
      avgDaily: 0,
      daysLeft: null,
      zeroDate: null,
      mode,
      insufficient: true,
    };
  }

  // Баланс неположительный — прогноз бессмысленен.
  if (!(balance > 0)) {
    return {
      avgDaily,
      daysLeft: 0,
      zeroDate: null,
      mode,
      insufficient: true,
    };
  }

  const daysLeft = Math.floor(balance / avgDaily);
  const zero = new Date(now);
  zero.setDate(zero.getDate() + daysLeft);

  return {
    avgDaily,
    daysLeft,
    zeroDate: zero.toISOString(),
    mode,
    insufficient: false,
  };
}

/**
 * Уровень состояния прогноза/баланса для цветовой индикации badge.
 * ok / warn (< 7 дней) / alert (< 3 дня или ниже порога).
 */
export function forecastLevel(
  forecast: Forecast,
  opts: { balance: number; alertThreshold: number }
): "ok" | "warn" | "alert" {
  const { balance, alertThreshold } = opts;
  if (balance <= alertThreshold) return "alert";
  if (forecast.insufficient || forecast.daysLeft === null) return "ok";
  if (forecast.daysLeft < 3) return "alert";
  if (forecast.daysLeft < 7) return "warn";
  return "ok";
}

/**
 * Уровень прогноза строго по дням (без учёта баланса) — для подписи
 * «хватит на N дней» в интерфейсе.
 *   < 3   → alert  (красный)
 *   3–7   → warn   (жёлтый)
 *   7+    → ok     (зелёный)
 * Недостаточно данных → mute (нейтральный).
 */
export function forecastDaysLevel(
  forecast: Forecast
): "ok" | "warn" | "alert" | "mute" {
  if (forecast.insufficient || forecast.daysLeft === null) return "mute";
  if (forecast.daysLeft < 3) return "alert";
  if (forecast.daysLeft < 7) return "warn";
  return "ok";
}
