/* ============================================================================
   models.ts — экран разбивки расхода по моделям в стиле истории/главной.
   Строки с названием модели, кол-вом, расходом, долей и микро-баром.
   ========================================================================== */

import "../ui/theme";
import { initTheme } from "../ui/theme";
import { groupByModel } from "../lib/aggregate";
import { formatInt, formatRubShort } from "../lib/format";
import type { Generation } from "../../types";

/* ---- DOM ---- */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const modelsList = $<HTMLUListElement>("models-list");
const emptyState = $<HTMLDivElement>("empty-state");
const sub = $<HTMLParagraphElement>("sub");
const periodSel = $<HTMLSelectElement>("period");
const btnRefresh = $<HTMLButtonElement>("btn-refresh");
const refreshIco = btnRefresh.querySelector<HTMLElement>(".refresh-ico")!;
const btnClose = $<HTMLSpanElement>("btn-close");
const totalModels = $<HTMLDivElement>("total-models");
const totalSpend = $<HTMLDivElement>("total-spend");
const totalCount = $<HTMLDivElement>("total-count");

let allHistory: Generation[] = [];

/* ---- Жизненный цикл ---- */

async function init(): Promise<void> {
  await initTheme();
  periodSel.addEventListener("change", render);
  btnClose.addEventListener("click", () => window.close());
  btnRefresh.addEventListener("click", async () => {
    btnRefresh.disabled = true;
    refreshIco.classList.add("is-spinning");
    try {
      await window.polza.refresh();
      await load();
    } finally {
      btnRefresh.disabled = false;
      refreshIco.classList.remove("is-spinning");
    }
  });
  window.polza.onCacheChanged(() => void load());
  await load();
}

async function load(): Promise<void> {
  const { cache } = await window.polza.getState();
  if (!cache) { emptyState.hidden = false; return; }
  allHistory = cache.history ?? [];
  render();
}

function render(): void {
  const days = Number(periodSel.value) || 30;
  sub.textContent = `Расход за последние ${days} дн.`;

  const now = Date.now();
  const items = allHistory.filter((g) => {
    const ageDays = Math.floor((now - new Date(g.createdAt).getTime()) / 86400000);
    return ageDays < days;
  });

  const stats = groupByModel(items);
  const totalCost = stats.reduce((s, m) => s + m.cost, 0);
  const totalCountNum = stats.reduce((s, m) => s + m.count, 0);

  // Итоги
  totalModels.textContent = formatInt(stats.length);
  totalSpend.textContent = formatRubShort(totalCost);
  totalCount.textContent = formatInt(totalCountNum);

  // Список моделей
  modelsList.innerHTML = "";
  if (stats.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  const frag = document.createDocumentFragment();
  for (const m of stats) {
    const share = totalCost > 0 ? (m.cost / totalCost) * 100 : 0;
    const li = document.createElement("li");
    li.className = "model-row";
    li.innerHTML = `
      <div class="model-row__info">
        <span class="model-row__name"></span>
        <span class="model-row__count nums">${formatInt(m.count)}</span>
      </div>
      <div class="model-row__stats">
        <span class="model-row__cost nums"></span>
        <span class="model-row__share nums">${Math.round(share)}%</span>
        <div class="model-row__bar"><div class="model-row__bar-fill" style="width:${share.toFixed(1)}%"></div></div>
      </div>`;
    (li.querySelector(".model-row__name") as HTMLElement).textContent = m.model;
    (li.querySelector(".model-row__cost") as HTMLElement).textContent = formatRubShort(m.cost);
    frag.appendChild(li);
  }
  modelsList.appendChild(frag);
}

void init();
