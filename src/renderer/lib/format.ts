/* ============================================================================
   Форматирование: ₽, даты, числа, относительное время.
   Табличные цифры везде — «понятный» дизайн (Рамс №4).
   ========================================================================== */

/** Рубль: 247,50 ₽ — два знака, разделитель запятая, суффикс. */
export function formatRub(value: number, opts: { sign?: boolean } = {}): string {
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  const prefix = opts.sign ? (value < 0 ? "−" : "+") : "";
  return `${prefix}${formatted}\u00A0₽`; // NBSP перед ₽
}

/** Короткие деньги: 318,9 ₽ (без trailing нулей, до 2 знаков). */
export function formatRubShort(value: number): string {
  const formatted = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
  }).format(value);
  return `${formatted}\u00A0₽`;
}

/** Компактные деньги для badge/tight-UI: 247₽ / 1,2K₽. */
export function formatRubCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) {
    const k = value / 1000;
    const s = new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 1,
    }).format(k);
    return `${s}K₽`;
  }
  const s = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  }).format(value);
  return `${s}₽`;
}

/** Целое число с разделителями разрядов. */
export function formatInt(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

/** Процент: +75% / −12%. */
export function formatPct(value: number, opts: { sign?: boolean } = {}): string {
  const rounded = Math.round(value);
  const prefix = opts.sign && rounded > 0 ? "+" : "";
  return `${prefix}${rounded}%`;
}

/* ---- Даты ---- */

/** Дата (YYYY-MM-DD) из ISO-строки или epoch. */
export function toDayKey(input: string | number | Date): string {
  const d = new Date(input);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 10 июл — короткая дата. */
export function formatDateShort(input: string | number | Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
  }).format(new Date(input));
}

/** 10 июл 2026 — средняя дата. */
export function formatDateMid(input: string | number | Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(input));
}

/** 10.07.2026 — для CSV. */
export function formatDateIso(input: string | number | Date): string {
  return toDayKey(input).replace(/-/g, ".");
}

/** 14:32 — время. */
export function formatTime(input: string | number | Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(input));
}

/** 10 июл, 14:32 — дата+время. */
export function formatDateTime(input: string | number | Date): string {
  return `${formatDateShort(input)}, ${formatTime(input)}`;
}

/* ---- Относительное время (offline-метка) ---- */

/** «обновлено 4 мин назад» / «только что» / «2 ч назад» / «вчера». */
export function formatRelativeFromNow(
  epochMs: number,
  now: number = Date.now()
): string {
  const diff = Math.max(0, now - epochMs);
  const sec = Math.floor(diff / 1000);
  if (sec < 30) return "только что";
  if (sec < 60) return `${sec}\u00A0с назад`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}\u00A0мин назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}\u00A0ч\u00A0назад`;
  const days = Math.floor(hr / 24);
  if (days === 1) return "вчера";
  return `${days}\u00A0дн назад`;
}

/** Кол-во дней словами для прогноза: «33 дня» / «1 день» / «2 дня». */
export function formatDays(n: number): string {
  const abs = Math.abs(Math.floor(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  let word = "дней";
  if (mod10 === 1 && mod100 !== 11) word = "день";
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20))
    word = "дня";
  return `${abs}\u00A0${word}`;
}

/** Усечение строки с многоточием. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
