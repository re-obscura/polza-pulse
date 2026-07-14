/* ============================================================================
   tray.ts — системный трей Windows.
   Иконка + tooltip + контекстное меню. Цвет статуса в tooltip.
   Закрытие окна (×) → скрытие в трей; выход — только через меню.
   ========================================================================== */

import { Tray, Menu, nativeImage, app, type BrowserWindow } from "electron";
import { join } from "node:path";
import { getSettings } from "./store";
import type { KeyCache } from "../types";
import { formatRubShort } from "../renderer/lib/format";

let tray: Tray | null = null;

/** Создать трей. Возвращает созданный экземпляр. */
export function createTray(
  mainWindow: BrowserWindow,
  onRefresh: () => void,
  onQuit: () => void
): Tray {
  const iconPath = join(__dirname, "..", "icons", "logo-dark-32.png");
  const icon = nativeImage.createFromPath(iconPath);
  // Windows: цветная иконка; macOS: template (авто-инверсия под тему).
  icon.setTemplateImage(process.platform === "darwin");

  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip(`polza-pulse v${app.getVersion()}`);

  const menu = Menu.buildFromTemplate([
    {
      label: "Открыть Polza Monitor",
      click: () => showWindow(mainWindow),
    },
    {
      label: "Обновить",
      click: () => onRefresh(),
    },
    { type: "separator" },
    {
      label: "История и экспорт",
      click: () => openWindow(mainWindow, "history"),
    },
    {
      label: "Разбивка по моделям",
      click: () => openWindow(mainWindow, "models"),
    },
    { type: "separator" },
    {
      label: "Выход",
      click: () => onQuit(),
    },
  ]);

  tray.setContextMenu(menu);

  // Клик по иконе — показать окно.
  tray.on("click", () => showWindow(mainWindow));
  // Двойной клик — то же самое (некоторые пользователи ожидают dblclick).
  tray.on("double-click", () => showWindow(mainWindow));

  return tray;
}

/** Обновить tooltip и статус трея по свежему кэшу. */
export function updateTrayStatus(cache: KeyCache | null): void {
  if (!tray) return;
  if (!cache || !cache.aggregate) {
    tray.setToolTip(`polza-pulse v${app.getVersion()}`);
    return;
  }
  const settings = getSettings();
  const spentToday = cache.aggregate.spend1d;
  const limit = settings.spendLimit;
  const pct = limit > 0 ? Math.round((spentToday / limit) * 100) : 0;

  // Уровень — по использованию дневного лимита.
  let levelText = "";
  if (pct >= 100) levelText = "лимит превышен";
  else if (pct >= 75) levelText = "близко к лимиту";

  tray.setToolTip(
    `polza-pulse v${app.getVersion()}${levelText ? " — " + levelText : ""}\n` +
      `сегодня ${formatRubShort(spentToday)}, ${pct}% лимита, за 7 дней ${formatRubShort(cache.aggregate.spend7d)}`
  );
}

export function getTray(): Tray | null {
  return tray;
}

function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Открыть окно конкретного раздела (history/models) в новой вкладке/окне. */
function openWindow(_main: BrowserWindow, name: "history" | "models"): void {
  // Отправляем событие в renderer, который откроет соответствующее окно.
  // Реализация открытия — в ipc.ts через IPC OPEN_WINDOW.
  const { ipcMain } = require("electron");
  ipcMain.emit("open-sub-window", name);
}
