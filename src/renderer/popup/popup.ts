/* ============================================================================
   popup.ts — главный экран Polza Monitor (Electron).
   Работает через window.polza.* (IPC). Один ключ. Лимит расхода.
   ========================================================================== */

import { initTheme, setTheme } from "../ui/theme";
import { drawSparkline, hitTestSparkline } from "../ui/sparkline";
import type { SparkCanvas } from "../ui/sparkline";
import { daySeries } from "../lib/aggregate";
import {
  formatRelativeFromNow,
  formatRub,
  formatRubShort,
  formatDateShort,
  formatInt,
} from "../lib/format";
import { PolzaClient, isAuthError } from "../lib/polzaClient";
import type { KeyCache, Key, ModelInfo, Settings, ThemePref } from "../../types";

/* ---- DOM ---- */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const viewEmpty = $<HTMLDivElement>("view-empty");
const viewMain = $<HTMLDivElement>("view-main");
const viewSettings = $<HTMLDivElement>("view-settings");
const errorBanner = $<HTMLDivElement>("error-banner");

const limitSpent = $<HTMLDivElement>("limit-spent");
const forecastBlock = $<HTMLDivElement>("forecast-block");
const forecastText = $<HTMLSpanElement>("forecast-text");
const forecastDot = $<HTMLSpanElement>("forecast-dot");
const limitBlock = $<HTMLDivElement>("limit-block");
const limitPct = $<HTMLSpanElement>("limit-pct");
const limitValue = $<HTMLSpanElement>("limit-value");
const limitFill = $<HTMLDivElement>("limit-fill");
const spend1d = $<HTMLDivElement>("spend-1d");
const spend7d = $<HTMLDivElement>("spend-7d");
const spend30d = $<HTMLDivElement>("spend-30d");
const sparkCanvas = $<HTMLCanvasElement>("sparkline") as SparkCanvas;
const sparkTooltip = $<HTMLDivElement>("spark-tooltip");
const chartRange = $<HTMLSpanElement>("chart-range");
const topModels = $<HTMLUListElement>("top-models");
const updatedAt = $<HTMLSpanElement>("updated-at");
const btnRefresh = $<HTMLButtonElement>("btn-refresh");
const refreshIco = btnRefresh.querySelector<HTMLElement>(".refresh-ico")!;

// Настройки
const optLimit = $<HTMLInputElement>("opt-limit");
const optInterval = $<HTMLSelectElement>("opt-interval");
const optBaseUrl = $<HTMLInputElement>("opt-baseurl");
const optAutostart = $<HTMLInputElement>("opt-autostart");
const keyForm = $<HTMLFormElement>("key-form");
const keyValueInput = $<HTMLInputElement>("key-value");
const keySaveBtn = $<HTMLButtonElement>("key-save-btn");
const keyHint = $<HTMLParagraphElement>("key-hint");

// Поиск моделей
const modelSearch = $<HTMLInputElement>("model-search");
const modelResults = $<HTMLDivElement>("model-results");
const modelSearchWrap = $<HTMLDivElement>("model-search-wrap");

let chartSeries: { day: string; value: number }[] = [];
let modelsCache: ModelInfo[] | null = null;
let searchDebounce: ReturnType<typeof setTimeout> | null = null;

/* ---- Поиск моделей ---- */

function priceStr(pricing: Record<string, unknown> | undefined): string {
  if (!pricing) return "";
  const p = numberOr(pricing.prompt_per_million ?? pricing.prompt, 0);
  const c = numberOr(pricing.completion_per_million ?? pricing.completion, 0);
  const parts: string[] = [];
  // Цены в API — за 1M токенов, показываем как есть.
  if (p > 0) parts.push(`${formatRubShort(p)} / M tok`);
  if (c > 0 && c !== p) parts.push(`${formatRubShort(c)} / M tok out`);
  return parts.join(" · ");
}

async function searchModels(q: string): Promise<void> {
  const lower = q.toLowerCase();
  // Загружаем модели один раз и кешируем.
  if (!modelsCache) {
    try {
      modelsCache = (await window.polza.fetchModels()) ?? [];
    } catch {
      modelResults.innerHTML = `<div class="model-result-item" style="color:var(--alert-ink)">Ошибка загрузки</div>`;
      modelResults.hidden = false;
      return;
    }
  }
  const filtered = modelsCache.filter(
    (m) => m.id.toLowerCase().includes(lower) || m.name.toLowerCase().includes(lower)
  ).slice(0, 10);

  if (filtered.length === 0) {
    modelResults.innerHTML = `<div class="model-result-item" style="color:var(--ink-3)">Ничего не найдено</div>`;
  } else {
    modelResults.innerHTML = filtered.map((m) => {
      const type = m.type ?? "";
      const ctx = m.context_length ?? m.top_provider?.context_length;
      const ctxStr = ctx ? `${formatInt(ctx)} ток.` : "";
      const price = priceStr(m.top_provider?.pricing as Record<string, unknown> | undefined);
      return `<div class="model-result-item" data-id="${escapeHtml(m.id)}">
        <div class="model-result-id">${escapeHtml(m.id)}</div>
        <div class="model-result-meta">
          ${type ? `<span class="model-result-type model-result-type--${escapeHtml(type)}">${escapeHtml(type)}</span>` : ""}
          ${ctxStr ? `<span>${ctxStr}</span>` : ""}
          ${price ? `<span class="model-result-price">${escapeHtml(price)}</span>` : ""}
        </div>
      </div>`;
    }).join("");
  }
  modelResults.hidden = false;

  // Клик по строке → копировать ID.
  modelResults.querySelectorAll(".model-result-item[data-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = (el as HTMLElement).dataset.id!;
      void copyModelId(id);
    });
  });
}

async function copyModelId(id: string): Promise<void> {
  await navigator.clipboard.writeText(id);
  // Мини-уведомление (toast)
  let toast = modelSearchWrap.querySelector<HTMLDivElement>(".model-result-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "model-result-toast";
    modelSearchWrap.appendChild(toast);
  }
  toast.textContent = `Скопировано: ${id}`;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 1800);
  closeModelResults();
}

function closeModelResults(): void {
  modelResults.hidden = true;
  modelResults.innerHTML = "";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function numberOr(v: unknown, fallback: number): number {
  if (typeof v === "number") return isNaN(v) ? fallback : v;
  if (typeof v === "string") { const n = Number(v); return isNaN(n) ? fallback : n; }
  return fallback;
}

/* ---- Жизненный цикл ---- */

async function init(): Promise<void> {
  await initTheme();
  // Спарклайн должен перерисовываться при любой смене темы.
  const redraw = () => drawSparklineNow();
  new MutationObserver(redraw).observe(document.documentElement, {
    attributes: true, attributeFilter: ["data-theme"],
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
  bindEvents();
  await loadSettingsUI();
  await render();
  void refresh();
}

/* ---- Рендер ---- */

async function render(): Promise<void> {
  // Если открыты настройки — не перерисовываем основной вид.
  // Настройки закрываются только явно (✕, Escape, повторный клик ⚙).
  if (!viewSettings.hidden) return;

  const { polza } = window;
  const key = await polza.getKey();

  if (!key) {
    showView("empty");
    return;
  }

  const { cache } = await polza.getState();
  renderState(cache);
}

function showView(name: "empty" | "main"): void {
  viewEmpty.hidden = name !== "empty";
  viewMain.hidden = name !== "main";
}

function showSettings(open: boolean): void {
  viewSettings.hidden = !open;
  if (open) {
    viewEmpty.hidden = true;
    viewMain.hidden = true;
  }
}

function renderState(cache: KeyCache | null): void {
  showView("main");

  if (cache?.error) {
    errorBanner.hidden = false;
    errorBanner.textContent = cache.error;
  } else {
    errorBanner.hidden = true;
  }

  if (!cache || !cache.aggregate) {
    limitSpent.textContent = "—";
    spend1d.textContent = spend7d.textContent = spend30d.textContent = "—";
    topModels.innerHTML = `<li style="color:var(--ink-3)">Нет данных</li>`;
    chartRange.textContent = "";
    updatedAt.textContent = "ожидание данных…";
    forecastText.textContent = "Недостаточно данных";
    forecastBlock.dataset.level = "mute";
    forecastDot.className = "dot dot--mute";
    return;
  }

  const agg = cache.aggregate;
  // Главный показатель — расход за сегодня (из дневного лимита).
  limitSpent.textContent = formatRub(agg.spend1d);
  spend1d.textContent = formatRubShort(agg.spend1d ?? 0);
  spend7d.textContent = formatRubShort(agg?.spend7d ?? 0);
  spend30d.textContent = formatRubShort(agg?.spend30d ?? 0);

  if (agg) {
    chartSeries = daySeries(agg.byDay, 30);
    drawSparklineNow();
    chartRange.textContent = "30 дней";
  }

  renderTopModels(cache);
  renderForecast(cache);
  void renderLimit(cache);

  updatedAt.textContent = cache.updatedAt
    ? formatRelativeFromNow(cache.updatedAt)
    : "";
  scheduleRelativeRefresh();
}

function renderTopModels(cache: KeyCache): void {
  const agg = cache.aggregate;
  if (!agg || agg.count === 0) {
    topModels.innerHTML = `<li style="color:var(--ink-3)">Нет генераций</li>`;
    return;
  }
  const now = Date.now();
  const series = daySeries(agg.byDay, 7, now).map((d) => d.day);
  const last7 = new Set(series);
  const map = new Map<string, { cost: number; count: number }>();
  for (const g of cache.history) {
    if (!last7.has(g.day)) continue;
    const cur = map.get(g.model);
    if (cur) {
      cur.cost += g.cost;
      cur.count += 1;
    } else {
      map.set(g.model, { cost: g.cost, count: 1 });
    }
  }
  const top = [...map.entries()]
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5);

  topModels.innerHTML = "";
  if (top.length === 0) {
    const li = document.createElement("li");
    li.style.color = "var(--ink-3)";
    li.textContent = "За неделю не было генераций";
    topModels.appendChild(li);
    return;
  }
  for (const m of top) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="model-name"></span><span class="model-cost nums"></span>`;
    (li.querySelector(".model-name") as HTMLElement).textContent = m.model;
    (li.querySelector(".model-cost") as HTMLElement).textContent =
      formatRubShort(m.cost);
    topModels.appendChild(li);
  }
}

/** Индикатор справа: остаток дневного лимита. */
async function renderForecast(cache: KeyCache): Promise<void> {
  const settings = await window.polza.getSettings();
  const limit = settings.spendLimit;
  const spentToday = cache.aggregate?.spend1d ?? 0;
  if (limit <= 0) {
    forecastBlock.dataset.level = "mute";
    forecastDot.className = "dot dot--mute";
    forecastText.textContent = "Лимит не задан";
    return;
  }
  const remain = Math.max(0, limit - spentToday);
  const pct = (spentToday / limit) * 100;
  let level: "ok" | "warn" | "alert";
  if (pct >= 100) level = "alert";
  else if (pct >= 75) level = "warn";
  else level = "ok";
  forecastBlock.dataset.level = level;
  forecastDot.className = `dot dot--${level}`;
  forecastText.textContent = `Остаток ${formatRubShort(remain)}`;
}

async function renderLimit(cache: KeyCache): Promise<void> {
  const settings = await window.polza.getSettings();
  const limit = settings.spendLimit;
  const spentToday = cache.aggregate?.spend1d ?? 0;
  if (limit <= 0) {
    limitBlock.hidden = true;
    return;
  }
  limitBlock.hidden = false;
  const pct = Math.min(100, Math.round((spentToday / limit) * 100));
  limitPct.textContent = `${pct}% лимита`;
  limitValue.textContent = `${formatRubShort(spentToday)} / ${formatRubShort(limit)}`;
  limitFill.style.width = `${pct}%`;
  limitFill.className = "bar__fill";
  if (pct >= 100) limitFill.classList.add("bar__fill--alert");
  else if (pct >= 75) limitFill.classList.add("bar__fill--warn");
  else limitFill.classList.add("bar__fill--ok");
}

/* ---- Тултип графика ---- */

function onSparkMove(e: MouseEvent): void {
  const p = hitTestSparkline(sparkCanvas, e.clientX);
  if (!p || chartSeries.length === 0) {
    sparkTooltip.hidden = true;
    return;
  }
  const point = chartSeries[p.index];
  if (!point) {
    sparkTooltip.hidden = true;
    return;
  }
  sparkTooltip.innerHTML = `<b>${formatRubShort(point.value)}</b> · ${formatDateShort(point.day)}`;
  // Сначала показываем тултип (hidden снимаем), чтобы offsetWidth посчитался.
  sparkTooltip.style.removeProperty("visibility");
  sparkTooltip.hidden = false;

  const wrapRect = sparkCanvas.parentElement!.getBoundingClientRect();
  const canvasRect = sparkCanvas.getBoundingClientRect();
  const xInWrap = canvasRect.left - wrapRect.left + p.x;
  const tipW = sparkTooltip.offsetWidth || 70;
  const wrapW = wrapRect.width;
  let tipLeft = xInWrap - tipW / 2;
  if (tipLeft < 2) tipLeft = 2;
  if (tipLeft + tipW + 2 > wrapW) tipLeft = wrapW - tipW - 2;
  sparkTooltip.style.left = `${tipLeft}px`;
  sparkTooltip.style.transform = "none";
}

function onSparkLeave(): void {
  sparkTooltip.hidden = true;
}

/** Цвет линии спарклайна для текущей темы. */
function sparklineColor(): string {
  // Не читаем CSS --ink (ненадёжно), определяем по html-атрибуту.
  const theme = document.documentElement.getAttribute("data-theme") ?? "system";
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "#f0ede6" : "#1a1a1a";
  }
  return theme === "dark" ? "#f0ede6" : "#1a1a1a";
}

/** Рисование спарклайна с актуальным цветом темы. */
function drawSparklineNow(): void {
  if (chartSeries.length === 0) return;
  const color = sparklineColor();
  drawSparkline(sparkCanvas, {
    values: chartSeries.map((d) => d.value),
    color,
    gridLines: chartSeries.length,
  });
}

/* ---- Обновление ---- */

let refreshing = false;
async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  refreshIco.classList.add("is-spinning");
  btnRefresh.disabled = true;
  try {
    const res = await window.polza.refresh();
    await render();
    if (!res.ok && res.error) {
      errorBanner.hidden = false;
      errorBanner.textContent = res.error;
    }
  } finally {
    refreshing = false;
    refreshIco.classList.remove("is-spinning");
    btnRefresh.disabled = false;
  }
}

let relativeTimer: number | undefined;
function scheduleRelativeRefresh(): void {
  if (relativeTimer) return;
  relativeTimer = window.setInterval(async () => {
    const { cache } = await window.polza.getState();
    if (cache?.updatedAt)
      updatedAt.textContent = formatRelativeFromNow(cache.updatedAt);
  }, 30_000);
}

/* ---- Настройки ---- */

async function loadSettingsUI(): Promise<void> {
  const s = await window.polza.getSettings();
  optLimit.value = String(s.spendLimit);
  optInterval.value = String(s.pollIntervalMin);
  optBaseUrl.value = s.baseUrl;
  optAutostart.checked = await window.polza.getAutostart();
  const key = await window.polza.getKey();
  keyValueInput.value = key?.value ?? "";
  // Подтягиваем реальную версию из package.json → app.getVersion()
  $<HTMLSpanElement>("app-version").textContent = await window.polza.getVersion();
}

async function saveSettingsFromUI(): Promise<void> {
  const patch: Partial<Settings> = {
    pollIntervalMin: Number(optInterval.value) || 5,
    spendLimit: Number(optLimit.value) || 0,
    badgeMode: "spendToday",
    baseUrl: optBaseUrl.value.trim() || "https://polza.ai/api/v1",
  };
  await window.polza.setSettings(patch);
  await render();
}

/* ---- Сохранение ключа ---- */

async function onSaveKey(e: Event): Promise<void> {
  e.preventDefault();
  const value = keyValueInput.value.trim();
  if (!value) {
    flashHint(keyHint, "Введите API-ключ (pza_...)", true);
    return;
  }
  keySaveBtn.disabled = true;
  const orig = keySaveBtn.textContent;
  keySaveBtn.innerHTML = '<span class="spinner"></span>';

  const settings = await window.polza.getSettings();
  const client = new PolzaClient({ key: value, baseUrl: settings.baseUrl });
  try {
    // Валидация: тестовый запрос баланса (результат не показываем сотруднику).
    await client.getBalance();
    const key: Key = {
      label: "Мой ключ",
      value,
      valid: true,
      lastCheckedAt: Date.now(),
      createdAt: Date.now(),
    };
    await window.polza.setKey(key);
    flashHint(keyHint, "Ключ сохранён и проверен.", false);
    await window.polza.refresh();
    await render();
  } catch (err) {
    flashHint(
      keyHint,
      isAuthError(err)
        ? "Ключ отклонён (401). Проверьте значение."
        : err instanceof Error
          ? err.message
          : "Не удалось проверить ключ.",
      true
    );
  } finally {
    keySaveBtn.disabled = false;
    keySaveBtn.textContent = orig;
  }
}

function flashHint(el: HTMLElement, text: string, isError: boolean): void {
  el.textContent = text;
  el.style.color = isError ? "var(--alert-ink)" : "var(--ok-ink)";
}

/* ---- События ---- */

function bindEvents(): void {
  btnRefresh.addEventListener("click", () => void refresh());

  $<HTMLButtonElement>("btn-settings").addEventListener("click", async () => {
    if (viewSettings.hidden) {
      await loadSettingsUI();
      showSettings(true);
    } else {
      showSettings(false);
      await render();
    }
  });
  $<HTMLButtonElement>("btn-close-settings").addEventListener("click", async () => {
    showSettings(false);
    await render();
  });
  $<HTMLButtonElement>("btn-setup").addEventListener("click", async () => {
    await loadSettingsUI();
    showSettings(true);
  });

  [optLimit, optInterval, optBaseUrl].forEach(
    (el) => el.addEventListener("change", () => void saveSettingsFromUI())
  );

  optAutostart.addEventListener("change", async () => {
    await window.polza.setAutostart(optAutostart.checked);
  });

  keyForm.addEventListener("submit", (e) => void onSaveKey(e));

  $<HTMLButtonElement>("btn-theme").addEventListener("click", async () => {
    // Определяем фактически показанную тему (с учётом system → ОС).
    const root = document.documentElement.getAttribute("data-theme") ?? "system";
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const effective = root === "system" ? (prefersDark ? "dark" : "light") : root;
    // Переключаем на противоположную — гарантированно видимое изменение.
    const next: ThemePref = effective === "dark" ? "light" : "dark";
    await setTheme(next);
  });

  $<HTMLAnchorElement>("btn-history").addEventListener("click", (e) => {
    e.preventDefault();
    void window.polza.openWindow("history");
  });
  $<HTMLAnchorElement>("btn-models").addEventListener("click", (e) => {
    e.preventDefault();
    void window.polza.openWindow("models");
  });

  $<HTMLButtonElement>("btn-check-updates").addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("btn-check-updates");
    btn.disabled = true;
    const orig = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      const info = await window.polza.checkForUpdates();
      const hint = $<HTMLParagraphElement>("update-hint");
      if (info.available) {
        hint.textContent = `Доступна версия ${info.version}. Будет установлена при выходе.`;
      } else {
        hint.textContent = "У вас актуальная версия.";
      }
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !viewSettings.hidden) {
      showSettings(false);
      void render();
    }
  });

  sparkCanvas.addEventListener("mousemove", onSparkMove);
  sparkCanvas.addEventListener("mouseleave", onSparkLeave);

  // Фоновые обновления кэша/настроек НЕ закрывают панель настроек —
  // только обновляют значения полей, если настройки открыты.
  window.polza.onCacheChanged(() => {
    if (viewSettings.hidden) void render();
  });
  window.polza.onSettingsChanged(() => {
    void loadSettingsUI();
  });

  // ---- Поиск моделей ----
  modelSearch.addEventListener("input", () => {
    const q = modelSearch.value.trim();
    if (!q) {
      closeModelResults();
      return;
    }
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => void searchModels(q), 300);
  });

  modelSearch.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeModelResults(); modelSearch.blur(); }
  });

  // Закрываем дропдаун при клике вне поля поиска и результатов.
  document.addEventListener("click", (e) => {
    const target = e.target as Node;
    if (!modelSearchWrap.contains(target) && !modelResults.contains(target)) {
      closeModelResults();
    }
  });
}

void init();
