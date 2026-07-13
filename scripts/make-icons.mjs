// Генерация минималистичных монохромных PNG-иконок расширения (Рамс: сдержанно).
// Без внешних зависимостей: чистый PNG-енкодер через zlib.
// Иконка — залитый круг (нейтральный) с сигнальным акцентом.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "icons");

/* ---- Простой RGBA-буфер ---- */
class Canvas {
  constructor(size) {
    this.size = size;
    this.px = new Uint8Array(size * size * 4); // RGBA, прозрачный
  }
  set(x, y, [r, g, b, a = 255]) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    // Alpha-композитинг поверх прозрачного фона (source-over).
    const i = (y * this.size + x) * 4;
    const sa = a / 255;
    const da = this.px[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa === 0) return;
    this.px[i] = Math.round((r * sa + this.px[i] * da * (1 - sa)) / oa);
    this.px[i + 1] = Math.round(
      (g * sa + this.px[i + 1] * da * (1 - sa)) / oa
    );
    this.px[i + 2] = Math.round(
      (b * sa + this.px[i + 2] * da * (1 - sa)) / oa
    );
    this.px[i + 3] = Math.round(oa * 255);
  }
  fillCircle(cx, cy, r, color) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r * r) this.set(x, y, color);
      }
    }
  }
  // Кольцо (обводка круга) — для «приборного» вида.
  strokeCircle(cx, cy, r, thickness, color) {
    const rOut = r;
    const rIn = r - thickness;
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= rOut * rOut && d2 >= rIn * rIn) this.set(x, y, color);
      }
    }
  }
}

/* ---- Минимальный PNG-енкодер ---- */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePng(canvas) {
  const size = canvas.size;
  // Добавляем filter-byte (0) в начало каждой строки.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter byte
    raw.set(canvas.px.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---- Рисуем иконку: кольцо-«прибор» + дуга-индикатор ---- */
function makeIcon(size) {
  const c = new Canvas(size);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const r = size * 0.42;
  const thick = Math.max(1, Math.round(size * 0.09));

  // Тёмное кольцо (нейтральный антрацит)
  c.strokeCircle(cx, cy, r, thick, [26, 26, 26, 255]);

  // Сигнальный Braun-красный сектор-индикатор (правая нижняя четверть)
  // — простой «заполненный кусочек» вдоль кольца.
  const segs = 64;
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    // Дуга от 135° до 405° (т.е. 45°), ~270° заполнения по нижней части.
    const a0 = (Math.PI * (135 + t * 270)) / 180;
    const px = Math.round(cx + Math.cos(a0) * (r - thick / 2));
    const py = Math.round(cy + Math.sin(a0) * (r - thick / 2));
    c.set(px, py, [212, 80, 42, 255]);
    // утолщаем точку для заметности
    c.set(px + 1, py, [212, 80, 42, 255]);
    c.set(px, py + 1, [212, 80, 42, 255]);
  }

  // Центральная точка
  c.fillCircle(cx, cy, thick * 0.55, [26, 26, 26, 255]);
  return c;
}

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128, 256]) {
  const png = encodePng(makeIcon(size));
  const file = join(outDir, `icon-${size}.png`);
  writeFileSync(file, png);
  console.log(`[polza] icon ${size} → ${file} (${png.length} bytes)`);
}
