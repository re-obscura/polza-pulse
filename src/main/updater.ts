/* ============================================================================
   updater.ts — автообновление через electron-updater.
   Generic provider качает latest.yml + .exe с Azure публичного URL
   (см. electron-builder.yml → publish.url).
   Проверка при каждом запуске + по запросу из настроек.
   ========================================================================== */

import { autoUpdater } from "electron-updater";
import { Notification } from "electron";
import type { UpdateInfo } from "../types";

let initialized = false;

/** Инициализация: настройка поведения и подписки на события. */
export function initUpdater(): void {
  if (initialized) return;
  initialized = true;

  // В dev-режиме electron-updater не работает — отключаем лишний шум.
  autoUpdater.forceDevUpdateConfig = false;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

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
    new Notification({
      title: "Polza Monitor",
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
    const version = result.updateInfo.version;
    return { available: true, version };
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
