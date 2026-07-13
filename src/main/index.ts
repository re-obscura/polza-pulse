/* ============================================================================
   index.ts — точка входа Electron main process.
   Создаёт окно, трей, запускает polling и проверку обновлений.
   Закрытие окна (×) → скрытие в трей; выход — через меню трея.
   ========================================================================== */

import {
  app,
  BrowserWindow,
  Menu,
  shell,
  nativeTheme,
  type Event,
} from "electron";
import { join } from "node:path";
import { getSettings, onStoreChange } from "./store";
import { pollOnce, startPolling } from "./poller";
import { checkOnStartup, isUpdateDownloaded, quitAndInstall } from "./updater";
import { createTray, updateTrayStatus } from "./tray";
import { registerIpc } from "./ipc";
import { getCache } from "./store";
import type { ThemePref } from "../types";

// NTLM-флаги Chromium для Windows-аутентификации на Azure DevOps Server.
// Должны быть установлены до app.whenReady().
app.commandLine.appendSwitch("auth-server-whitelist", "*s-tfs.intellectika.ru*");
app.commandLine.appendSwitch("auth-negotiate-delegate-whitelist", "*s-tfs.intellectika.ru*");

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

// Один инстанс приложения — если запущен второй, фокусируем первый.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

function applyThemeToNative(pref: ThemePref): void {
  if (pref === "dark") nativeTheme.themeSource = "dark";
  else if (pref === "light") nativeTheme.themeSource = "light";
  else nativeTheme.themeSource = "system";
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 740,
    minWidth: 380,
    minHeight: 480,
    show: false, // показываем после ready-to-show
    frame: true,
    resizable: true,
    maximizable: false,
    autoHideMenuBar: true,
    title: "polza-pulse",
    backgroundColor: "#1a1a1a",
    webPreferences: {
      preload: join(__dirname, "..", "dist-preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Убираем меню полностью.
  Menu.setApplicationMenu(null);

  void win.loadFile(join(__dirname, "..", "dist-renderer", "popup", "popup.html"));

  win.once("ready-to-show", () => {
    win.show();
  });

  // Закрытие (×) → скрываем в трей, не выходим.
  win.on("close", (e: Event) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  // Внешние ссылки — в системном браузере.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  return win;
}

// Не выходим, когда все окна закрыты — живём в трее.
app.on("window-all-closed", () => {
  // Ничего не делаем: окно скрыто в трей, приложение продолжает работать.
});

app.whenReady().then(() => {
  // Нативная тема.
  applyThemeToNative(getSettings().theme);

  mainWindow = createMainWindow();

  // Трей.
  const tray = createTray(
    mainWindow,
    () => void pollOnce(),
    () => {
      isQuitting = true;
      // Если скачано обновление — установить и перезапустить, иначе просто выйти.
      if (isUpdateDownloaded()) {
        quitAndInstall();
      } else {
        app.quit();
      }
    }
  );
  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // IPC.
  registerIpc();

  // Polling: немедленный опрос + таймер.
  void pollOnce().then((cache) => updateTrayStatus(cache));
  startPolling();

  // Подписка на изменения store: обновляем трей + оповещаем renderer.
  onStoreChange((field) => {
    if (field === "cache") updateTrayStatus(getCache());
    if (field === "settings") {
      const s = getSettings();
      applyThemeToNative(s.theme);
    }
    // Оповещаем все открытые окна (renderer).
    for (const win of BrowserWindow.getAllWindows()) {
      if (field === "cache") win.webContents.send("CACHE_CHANGED");
      if (field === "settings") win.webContents.send("SETTINGS_CHANGED");
      if (field === "key") win.webContents.send("KEY_CHANGED");
    }
  });

  // Проверка обновлений при запуске (тихо, в фоне).
  checkOnStartup();
});

// Выход — только через isQuitting (меню трея).
app.on("before-quit", () => {
  isQuitting = true;
});
