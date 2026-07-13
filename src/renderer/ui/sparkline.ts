/* ============================================================================
   sparkline.ts — лёгкий canvas-спарклайн без зависимостей.
   Рамс №9 «экологичный»: никаких тяжёлых chart-либ.
   Рисуем минималистичную заливку + линию. Учитывает devicePixelRatio.
   ========================================================================== */

export interface SparklineOptions {
  /** Значения (например, дневной расход). */
  values: number[];
  /** Цвет линии/заливки (по умолчанию currentColor). */
  color?: string;
  /** Рисовать ли мягкую заливку под линией. */
  fill?: boolean;
  /** Толщина линии, px. */
  strokeWidth?: number;
  /** Паддинги внутри canvas, px. */
  padding?: number;
}

/** Точка графика для hit-test (тултип). */
export interface SparkPoint {
  x: number;
  y: number;
  value: number;
  index: number;
}

interface SparkCanvas extends HTMLCanvasElement {
  __sparkPoints?: SparkPoint[];
  __sparkPad?: number;
}
export type { SparkCanvas };

/**
 * Нарисовать спарклайн в переданный canvas.
 * Размер берётся из CSS-размеров canvas (clientWidth/clientHeight).
 */
export function drawSparkline(
  canvas: SparkCanvas,
  opts: SparklineOptions
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const cssW = canvas.clientWidth || canvas.width || 100;
  const cssH = canvas.clientHeight || canvas.height || 30;
  const dpr = window.devicePixelRatio || 1;
  // Выставляем физический размер под DPR для чёткости.
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const values = opts.values;
  const n = values.length;
  const pad = opts.padding ?? 3;
  const stroke = opts.strokeWidth ?? 1.5;
  const color = opts.color || getComputedStyle(canvas).color || "#1a1a1a";
  const fill = opts.fill !== false;

  const innerW = cssW - pad * 2;
  const innerH = cssH - pad * 2;

  if (n === 0) return;

  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;

  // Если все нули — рисуем ровную линию понизу.
  const xAt = (i: number) => pad + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => pad + innerH - ((v - min) / span) * innerH;

  // Заливка
  if (fill && n > 1) {
    ctx.beginPath();
    ctx.moveTo(xAt(0), pad + innerH);
    for (let i = 0; i < n; i++) ctx.lineTo(xAt(i), yAt(values[i]));
    ctx.lineTo(xAt(n - 1), pad + innerH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad, 0, pad + innerH);
    grad.addColorStop(0, withAlpha(color, 0.22));
    grad.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Линия
  ctx.beginPath();
  if (n === 1) {
    // Одна точка — рисуем горизонтальную линию по центру.
    ctx.moveTo(pad, yAt(values[0]));
    ctx.lineTo(pad + innerW, yAt(values[0]));
  } else {
    ctx.moveTo(xAt(0), yAt(values[0]));
    for (let i = 1; i < n; i++) ctx.lineTo(xAt(i), yAt(values[i]));
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = stroke;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  // Запомним геометрию для hit-test (тултип).
  const xPositions: number[] = [];
  for (let i = 0; i < n; i++) xPositions.push(xAt(i));
  (canvas as SparkCanvas).__sparkPoints = xPositions.map((x, i) => ({
    x,
    y: yAt(values[i]),
    value: values[i],
    index: i,
  }));
  (canvas as SparkCanvas).__sparkPad = pad;

  // Точка на последнем значении (акцент «сейчас»).
  if (n > 0) {
    const lx = xAt(n - 1);
    const ly = yAt(values[n - 1]);
    ctx.beginPath();
    ctx.arc(lx, ly, 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

/** Превратить rgb()/hex в rgba() с альфой (для заливки). */
function withAlpha(color: string, alpha: number): string {
  const c = color.trim();
  // #rrggbb
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  // rgb(r, g, b)
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(",").map((p) => p.trim());
    return `rgba(${parts[0]},${parts[1]},${parts[2]},${alpha})`;
  }
  return c;
}

/**
 * Найти ближайшую к курсору точку графика (по X).
 * Возвращает null, если график ещё не отрисован.
 */
export function hitTestSparkline(canvas: SparkCanvas, clientX: number): SparkPoint | null {
  const points = canvas.__sparkPoints;
  if (!points || points.length === 0) return null;
  const rect = canvas.getBoundingClientRect();
  const relX = clientX - rect.left;
  let best = points[0];
  let bestDist = Math.abs(relX - best.x);
  for (const p of points) {
    const d = Math.abs(relX - p.x);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}
