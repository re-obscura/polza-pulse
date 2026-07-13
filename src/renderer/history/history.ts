/* ============================================================================
   history.ts — детальная история генераций (Electron).
   Таблица с фильтрами и сортировкой, детали по клику, экспорт CSV.
   Источник данных: кэш приложения (офлайн-first) через window.polza.
   ========================================================================== */

import "../ui/theme";
import { initTheme } from "../ui/theme";
import {
  groupByDay,
  groupByModel,
  normalizeGenerations,
} from "../lib/aggregate";
import { PolzaClient } from "../lib/polzaClient";
import {
  formatDateTime,
  formatInt,
  formatRub,
  formatRubShort,
  toDayKey,
} from "../lib/format";
import type { Generation, GenerationDetail } from "../../types";

/* ---- DOM ---- */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const tbody = $<HTMLTableSectionElement>("tbody");
const emptyState = $<HTMLDivElement>("empty-state");
const summaryEl = $<HTMLDivElement>("summary");
const chipsType = $<HTMLDivElement>("chips-type");
const fStatus = $<HTMLSelectElement>("f-status");
const fModel = $<HTMLSelectElement>("f-model");
const fFrom = $<HTMLInputElement>("f-from");
const fTo = $<HTMLInputElement>("f-to");
const btnReset = $<HTMLButtonElement>("btn-reset");
const btnRefresh = $<HTMLButtonElement>("btn-refresh");
const refreshIco = btnRefresh.querySelector<HTMLElement>(".refresh-ico")!;
const btnExport = $<HTMLButtonElement>("btn-export");
const btnClose = $<HTMLSpanElement>("btn-close");
const sub = $<HTMLParagraphElement>("sub");
const drawer = $<HTMLDivElement>("drawer");
const drawerBody = $<HTMLDivElement>("drawer-body");
const table = $<HTMLTableElement>("table");

/* ---- Состояние ---- */

let allItems: Generation[] = [];
let keyValue = "";
let filterType = "";
let sortBy: "createdAt" | "cost" = "createdAt";
let sortDir: "asc" | "desc" = "desc";

/* ---- Инициализация ---- */

async function init(): Promise<void> {
  await initTheme();
  bindEvents();
  await load();
}

async function load(): Promise<void> {
  const key = await window.polza.getKey();
  keyValue = key?.value ?? "";
  sub.textContent = key
    ? "Детальный расход по вашему ключу."
    : "Ключ не задан.";

  // Из кэша — мгновенно
  const { cache } = await window.polza.getState();
  if (cache?.history?.length) {
    allItems = cache.history;
    populateModelFilter(allItems);
    render();
  }
  // Свежие данные — в фоне, без повторного вызова load().
  await refresh();
}

async function refresh(): Promise<void> {
  btnRefresh.disabled = true;
  refreshIco.classList.add("is-spinning");
  try {
    // Только читаем кэш; не дёргаем pollOnce (он уже вызван фоном).
    const { cache } = await window.polza.getState();
    allItems = cache?.history ?? [];
    populateModelFilter(allItems);
    render();
  } catch (e) {
    sub.textContent = `Ошибка: ${e instanceof Error ? e.message : "неизвестная"}`;
  } finally {
    btnRefresh.disabled = false;
    refreshIco.classList.remove("is-spinning");
  }
}

/* ---- Фильтрация ---- */

function getFiltered(): Generation[] {
  const status = fStatus.value;
  const model = fModel.value;
  const from = fFrom.value;
  const to = fTo.value;

  let items = allItems;
  if (filterType) items = items.filter((g) => g.requestType === filterType);
  if (status) items = items.filter((g) => g.status === status);
  if (model) items = items.filter((g) => g.model === model);
  if (from) items = items.filter((g) => g.day >= from);
  if (to) items = items.filter((g) => g.day <= to);

  items = [...items].sort((a, b) => {
    let cmp: number;
    if (sortBy === "cost") cmp = a.cost - b.cost;
    else cmp = a.createdAt.localeCompare(b.createdAt);
    return sortDir === "asc" ? cmp : -cmp;
  });
  return items;
}

function getCostlyIds(): Set<string> {
  const cutoff = toDayKey(Date.now() - 7 * 86400000);
  const last7 = allItems.filter((g) => g.day >= cutoff);
  return new Set([...last7].sort((a, b) => b.cost - a.cost).slice(0, 5).map((g) => g.id));
}

/* ---- Рендер ---- */

function render(): void {
  const items = getFiltered();
  const costlyIds = getCostlyIds();

  const total = items.reduce((s, g) => s + g.cost, 0);
  const tokens = items.reduce((s, g) => s + (g.usage?.totalTokens ?? 0), 0);
  summaryEl.innerHTML = `
    <div class="metric">
      <div class="metric__label">Генераций</div>
      <div class="metric__value nums">${formatInt(items.length)}</div>
    </div>
    <div class="metric">
      <div class="metric__label">Расход</div>
      <div class="metric__value nums">${formatRubShort(total)}</div>
    </div>
    <div class="metric">
      <div class="metric__label">Токенов</div>
      <div class="metric__value nums">${formatInt(tokens)}</div>
    </div>`;

  tbody.innerHTML = "";
  if (items.length === 0) {
    emptyState.hidden = false;
    updateSortIndicators();
    return;
  }
  emptyState.hidden = true;

  const frag = document.createDocumentFragment();
  for (const g of items) {
    const tr = document.createElement("tr");
    tr.dataset.id = g.id;
    if (costlyIds.has(g.id)) tr.classList.add("is-costly");

    const typeChip = `<span class="type-chip">${escapeHtml(String(g.requestType || "—"))}</span>`;
    const statusCls = statusClass(g.status);
    const tok = g.usage?.totalTokens ?? g.usage?.completionTokens ?? 0;

    tr.innerHTML = `
      <td>${formatDateTime(g.createdAt)}</td>
      <td>${typeChip}</td>
      <td class="cell-model"></td>
      <td><span class="status-tag ${statusCls}">${escapeHtml(String(g.status || "—"))}</span></td>
      <td class="num">${tok ? formatInt(tok) : "—"}</td>
      <td class="num">${formatRub(g.cost)}</td>`;
    (tr.querySelector(".cell-model") as HTMLElement).textContent = g.model;
    tr.addEventListener("click", () => void openDetail(g.id));
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
  updateSortIndicators();
}

function statusClass(status: string): string {
  if (status === "completed") return "status-tag--completed";
  if (status === "failed" || status === "canceled") return "status-tag--failed";
  return "";
}

function updateSortIndicators(): void {
  table.querySelectorAll<HTMLElement>("th.sortable").forEach((th) => {
    th.classList.remove("sorted-asc", "sorted-desc");
    if (th.dataset.sort === sortBy) {
      th.classList.add(sortDir === "asc" ? "sorted-asc" : "sorted-desc");
    }
  });
}

function populateModelFilter(items: Generation[]): void {
  const models = [...new Set(items.map((g) => g.model))].sort();
  const cur = fModel.value;
  fModel.innerHTML = '<option value="">Все</option>';
  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    fModel.appendChild(opt);
  }
  fModel.value = cur;
}

/* ---- Детали ---- */

async function openDetail(id: string): Promise<void> {
  drawer.hidden = false;
  drawer.setAttribute("aria-hidden", "false");
  drawerBody.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;

  const cached = allItems.find((g) => g.id === id);
  if (cached) renderDetailPartial(cached);

  const settings = await window.polza.getSettings();
  if (!keyValue) {
    if (cached) renderDetailFull(cached as unknown as GenerationDetail);
    return;
  }

  try {
    const client = new PolzaClient({ key: keyValue, baseUrl: settings.baseUrl, minIntervalMs: 1100 });
    const detail = await client.getGenerationDetail(id);
    renderDetailFull(detail);
  } catch (e) {
    const note = document.createElement("p");
    note.className = "field__error";
    note.textContent = `Не удалось загрузить детали: ${e instanceof Error ? e.message : "ошибка"}`;
    drawerBody.appendChild(note);
  }
}

function renderDetailPartial(g: Generation): void {
  drawerBody.innerHTML = detailRow("Модель", escapeHtml(g.model));
  drawerBody.innerHTML += detailRow("Тип", escapeHtml(String(g.requestType)));
  drawerBody.innerHTML += detailRow("Статус", escapeHtml(String(g.status)));
  drawerBody.innerHTML += detailRow("Дата", formatDateTime(g.createdAt));
  drawerBody.innerHTML += detailRow("Расход", formatRub(g.cost));
  if (g.usage) {
    drawerBody.innerHTML += detailRow("Токены (prompt/completion)", `${formatInt(g.usage.promptTokens ?? 0)} / ${formatInt(g.usage.completionTokens ?? 0)}`);
  }
  drawerBody.innerHTML += `<p class="s-hint">Загружаю подробности…</p>`;
}

function renderDetailFull(d: GenerationDetail): void {
  const promptTok = Number(d.usage?.promptTokens ?? 0);
  const completionTok = Number(d.usage?.completionTokens ?? 0);
  const totalTok = Number(d.usage?.totalTokens ?? 0) || promptTok + completionTok;
  drawerBody.innerHTML = "";
  const dl = document.createElement("dl");
  dl.className = "drawer__dl";
  const rows: [string, string][] = [
    ["ID", escapeHtml(String(d.id))],
    ["Модель", escapeHtml(String(d.model ?? "—"))],
    ["Тип", escapeHtml(String(d.requestType ?? "—"))],
    ["Статус", escapeHtml(String(d.status ?? "—"))],
    ["Провайдер", escapeHtml(String(d.provider ?? "—"))],
    ["Дата создания", d.createdAt ? formatDateTime(d.createdAt) : "—"],
    ["Расход (clientCost)", formatRub(Number(d.clientCost ?? d.cost ?? 0))],
    ["Токены всего", totalTok ? formatInt(totalTok) : "—"],
    ["Prompt / Completion", `${formatInt(promptTok)} / ${formatInt(completionTok)}`],
    ["Latency", d.latencyMs != null ? `${formatInt(d.latencyMs)} мс` : "—"],
    ["Queue time", d.queueTimeMs != null ? `${formatInt(d.queueTimeMs)} мс` : "—"],
    ["Finish reason", escapeHtml(String(d.finishReason ?? "—"))],
    ["Attempts", d.attemptsCount != null ? formatInt(d.attemptsCount) : "—"],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.innerHTML = v;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  drawerBody.appendChild(dl);
}

function detailRow(label: string, value: string): string {
  return `<div class="drawer__dl" style="margin-bottom:var(--space-2)"><span style="color:var(--ink-2)">${label}</span><span>${value}</span></div>`;
}

/* ---- Экспорт CSV ---- */

function exportCsv(): void {
  const items = getFiltered();
  if (items.length === 0) {
    alert("Нет данных для экспорта.");
    return;
  }
  const lines: string[] = [];
  lines.push("# Лист: Генерации");
  lines.push(csvRow(["Дата", "Тип", "Модель", "Статус", "Токены", "Расход ₽"]));
  for (const g of items) {
    lines.push(csvRow([formatDateTime(g.createdAt), String(g.requestType), g.model, String(g.status), String(g.usage?.totalTokens ?? ""), g.cost.toFixed(2)]));
  }
  lines.push("");
  lines.push("# Сводка: по дням");
  lines.push(csvRow(["День", "Расход ₽", "Генераций"]));
  const byDay = groupByDay(items);
  const dayCounts = countBy(items, (g) => g.day);
  for (const day of Object.keys(byDay).sort()) {
    lines.push(csvRow([day, byDay[day].toFixed(2), String(dayCounts[day] ?? 0)]));
  }
  lines.push("");
  lines.push("# Сводка: по моделям");
  lines.push(csvRow(["Модель", "Расход ₽", "Генераций"]));
  for (const m of groupByModel(items)) {
    lines.push(csvRow([m.model, m.cost.toFixed(2), String(m.count)]));
  }
  const csv = "\uFEFF" + lines.join("\r\n");
  // Скачивание через Blob в Electron renderer работает.
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `polza-history-${toDayKey(Date.now())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function countBy<T>(items: T[], sel: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = sel(it);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
function csvRow(cols: string[]): string {
  return cols.map(csvCell).join(";");
}
function csvCell(s: string): string {
  const v = s ?? "";
  if (/[";\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ---- События ---- */

function bindEvents(): void {
  btnRefresh.addEventListener("click", () => void refresh());
  btnExport.addEventListener("click", () => exportCsv());
  btnClose.addEventListener("click", () => window.close());
  btnReset.addEventListener("click", () => {
    filterType = "";
    setActiveChip("");
    fStatus.value = "";
    fModel.value = "";
    fFrom.value = "";
    fTo.value = "";
    render();
  });
  // Чипы типа
  chipsType.querySelectorAll<HTMLButtonElement>(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      filterType = chip.dataset.type ?? "";
      setActiveChip(filterType);
      render();
    });
  });
  [fStatus, fModel, fFrom, fTo].forEach((el) => el.addEventListener("change", render));
  table.querySelectorAll<HTMLElement>("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const field = th.dataset.sort as "createdAt" | "cost";
      if (sortBy === field) sortDir = sortDir === "asc" ? "desc" : "asc";
      else { sortBy = field; sortDir = "desc"; }
      render();
    });
  });
  drawer.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeDrawer));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !drawer.hidden) closeDrawer();
  });
  // Фоновые обновления кэша — просто перечитываем данные, без вызова poll/refresh.
  window.polza.onCacheChanged(() => {
    window.polza.getState().then(({ cache }) => {
      allItems = cache?.history ?? [];
      populateModelFilter(allItems);
      render();
    });
  });
}

function setActiveChip(type: string): void {
  chipsType.querySelectorAll<HTMLButtonElement>(".chip").forEach((chip) => {
    chip.classList.toggle("is-active", (chip.dataset.type ?? "") === type);
  });
}

function closeDrawer(): void {
  drawer.hidden = true;
  drawer.setAttribute("aria-hidden", "true");
}

// normalizeGenerations импортируется на случай расширения; оставим реэкспорт.
void normalizeGenerations;

void init();
