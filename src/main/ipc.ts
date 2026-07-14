/* ============================================================================
   ipc.ts — обработчики IPC между renderer и main process.
   Реализует контракт IpcRequest (renderer → main) и IpcEvent (main → renderer).
   ========================================================================== */

import { ipcMain, BrowserWindow, shell, app } from "electron";
import { join } from "node:path";
import { getKey, setKey, getSettings, setSettings, getCache } from "./store";
import { pollOnce, startPolling } from "./poller";
import { checkForUpdates, quitAndInstall } from "./updater";
import type { Key } from "../types";

/** Поддиректории renderer для под-окон. */
const RENDERER_VIEWS: Record<string, string> = {
  history: "history/history.html",
  models: "models/models.html",
};

/** Зарегистрировать все IPC-обработчики. */
export function registerIpc(): void {
  // ---- Состояние и данные ----
  ipcMain.handle("GET_STATE", () => {
    return { cache: getCache() };
  });

  ipcMain.handle("REFRESH", async () => {
    const cache = await pollOnce();
    return { ok: !cache?.error, error: cache?.error };
  });

  // ---- Настройки ----
  ipcMain.handle("GET_SETTINGS", () => getSettings());
  ipcMain.handle("SET_SETTINGS", (_e, patch) => {
    const next = setSettings(patch);
    // Перенастроить интервал опроса.
    startPolling();
    return next;
  });

  // ---- Ключ ----
  ipcMain.handle("GET_KEY", () => getKey());
  ipcMain.handle("SET_KEY", (_e, key: Key | null) => {
    setKey(key);
    return true;
  });

  // ---- Обновления ----
  ipcMain.handle("CHECK_UPDATES", () => checkForUpdates());
  ipcMain.handle("INSTALL_UPDATE", () => {
    quitAndInstall();
    return true;
  });

  // ---- Версия ----
  ipcMain.handle("GET_VERSION", () => app.getVersion());

  // ---- Внешние действия ----
  ipcMain.handle("OPEN_EXTERNAL", (_e, url: string) => {
    void shell.openExternal(url);
    return true;
  });

  // ---- Модели ----
  ipcMain.handle("FETCH_MODELS", async () => {
    const settings = getSettings();
    const url = `${settings.baseUrl}/models`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: unknown[] };
    return json.data ?? [];
  });

  ipcMain.handle("OPEN_WINDOW", (_e, name: string) => {
    openSubWindow(name);
    return true;
  });
}

/** Открыть под-окно (history / models). */
const subWindows = new Map<string, BrowserWindow>();

function openSubWindow(name: string): void {
  const existing = subWindows.get(name);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return;
  }

  const file = RENDERER_VIEWS[name];
  if (!file) return;

  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    // Без parent: под-окно независимое, не блокирует главное окно.
    title: name === "history" ? "История генераций" : "Разбивка по моделям",
    autoHideMenuBar: true,
    backgroundColor: "#161616",
    webPreferences: {
      preload: join(__dirname, "..", "dist-preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  void win.loadFile(join(__dirname, "..", "dist-renderer", file));
  win.on("closed", () => subWindows.delete(name));
  subWindows.set(name, win);
}
