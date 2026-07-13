/* ============================================================================
   updater.ts — автообновление через electron-updater (GenericProvider + NTLM).

   Артефакты (latest.yml + .exe) раздаются через IIS-виртуальный каталог
   на Azure DevOps Server. Доступ — NTLM (Windows-аутентификация текущего
   пользователя через SSPI). Chromium-флаги для Negotiate заданы в index.ts.
   ========================================================================== */

import { autoUpdater } from "electron-updater";
import { Notification, app } from "electron";
import type { UpdateInfo } from "../types";

/** Базовый URL, откуда качаются обновления.
 *  Это IIS-виртуальный каталог (или папка) с latest.yml + .exe.
 *  NTLM-аутентификация — через текущего пользователя Windows. */
const UPDATE_FEED_URL =
  "https://s-tfs.intellectika.ru/polza-updates/";

let initialized = false;
let updateDownloaded = false;

/** Инициализация: настройка поведения, NTLM-обработчик, подписки на события. */
export function initUpdater(): void {
  if (initialized) return;
  initialized = true;

  // GenericProvider: качает latest.yml и .exe с любого HTTP-сервера.
  autoUpdater.setFeedURL({
    provider: "generic",
    url: UPDATE_FEED_URL,
  });

  // NTLM-обработчик: когда сервер отвечает 401 + WWW-Authenticate: Negotiate,
  // Chromium (Electron) через SSPI делает handshake от имени текущего
  // пользователя Windows. Пустые credentials = "использовать учётку Windows".
  autoUpdater.on("login", (_authInfo, callback) => {
    callback("", "");
  });

  // В dev-режиме electron-updater не работает — отключаем лишний шум.
  autoUpdater.forceDevUpdateConfig = false;
  // Качаем обновление в фоне, но НЕ устанавливаем при выходе через autoInstallOnAppQuit —
  // это конфликтует с NSIS (процесс ещё жив). Вместо этого quitAndInstall() вызывается
  // явно при выходе через меню трея, если обновление скачано.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("update-available", (info) => {
    console.log("[polza] update available:", info.version);
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[polza] app is up to date");
  });

  autoUpdater.on("download-progress", (progress) => {
    console.log(
      `[polza] downloading update: ${progress.percent.toFixed(1)}%`
    );
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("[polza] update downloaded:", info.version);
    updateDownloaded = true;
    new Notification({
      title: "Polza Pulse",
      body: `Скачано обновление ${info.version}. Применю при выходе из приложения.`,
      silent: false,
    }).show();
  });

  autoUpdater.on("error", (err) => {
    console.error("[polza] updater error:", err.message);
  });
}

/** Проверить обновления при запуске (тихо, в фоне). */
export function checkOnStartup(): void {
  initUpdater();
  // catch ошибки, чтобы не ронять приложение при недоступности сервера.
  autoUpdater.checkForUpdatesAndNotify().catch((e) => {
    console.error("[polza] startup update check failed:", e?.message ?? e);
  });
}

/** Проверить обновления по запросу из настроек. */
export async function checkForUpdates(): Promise<UpdateInfo> {
  initUpdater();
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result || !result.updateInfo) {
      return { available: false };
    }
    const latest = result.updateInfo.version;
    // Если версия из latest.yml совпадает с установленной — обновления нет.
    const available = latest !== app.getVersion();
    return { available, version: available ? latest : undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[polza] update check failed:", msg);
    return { available: false };
  }
}

/** Установить скачанное обновление и перезапустить. */
export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}

/** Проверить, скачано ли обновление и готово к установке. */
export function isUpdateDownloaded(): boolean {
  return updateDownloaded;
}
