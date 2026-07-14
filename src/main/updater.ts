/* ============================================================================
   updater.ts — лёгкое автообновление через Azure DevOps REST API + NTLM.

   Артефакты (latest.yml + .exe + .blockmap) хранятся в папке releases/
   ветки dev Git-репозитория. Приложение качает их через REST API
   (download=true), NTLM — через Chromium/SSPI.

   Формат latest.yml — стандартный electron-builder (YAML):
     version: 1.0.11
     files:
       - url: Polza Pulse Setup 1.0.11.exe
         sha512: abc...
         size: 12345678
     path: Polza Pulse Setup 1.0.11.exe
     sha512: abc...
     releaseDate: "2026-07-13T..."
   ========================================================================== */

import { app, Notification, net } from "electron";
import { load as parseYaml } from "js-yaml";
import { createWriteStream, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import type { UpdateInfo } from "../types";

// ---------------------------------------------------------------------------
// Константы
// ---------------------------------------------------------------------------

/** Azure DevOps REST API base — загрузка файла из папки releases/ ветки dev. */
const ORG_URL = "https://s-tfs.intellectika.ru/AiCollection/Polza_Pulse";
const REPO_ID = "Polza_Pulse";
const DOWNLOAD_API = `${ORG_URL}/_apis/git/repositories/${REPO_ID}/items`;
const BRANCH = "dev";
const API_VERSION = "7.1";

/** Префикс пути в репозитории к папке с релизными артефактами. */
const RELEASES_DIR = "releases";

// ---------------------------------------------------------------------------
// Состояние
// ---------------------------------------------------------------------------

let updateDownloaded = false;
let installerPath: string | null = null;
let downloadInProgress = false;

// ---------------------------------------------------------------------------
// Утилиты
// ---------------------------------------------------------------------------

/** Построить URL для скачивания файла из папки releases/ ветки dev через REST API. */
function buildDownloadUrl(fileName: string): string {
  const path = encodeURIComponent(`/${RELEASES_DIR}/${fileName}`);
  return `${DOWNLOAD_API}?path=${path}&versionDescriptor.version=${BRANCH}&download=true&api-version=${API_VERSION}`;
}

/**
 * Выполнить HTTP GET (через electron.net) и вернуть тело ответа как строку.
 * NTLM обрабатывается через событие login, Chromium делает SSPI handshake.
 */
function httpGetString(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url });

    request.on("login", (_authInfo, callback) => {
      // Пустые credentials → Chromium пробует SSPI (NTLM текущего пользователя)
      callback("", "");
    });

    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      response.on("error", reject);
    });

    request.on("error", reject);
    request.end();
  });
}

// ---------------------------------------------------------------------------
// Парсинг latest.yml
// ---------------------------------------------------------------------------

interface LatestYml {
  version: string;
  files?: Array<{ url: string; sha512?: string; size?: number }>;
  path?: string;
  sha512?: string;
  releaseDate?: string;
}

/** Скачать и распарсить latest.yml из ветки releases. */
async function fetchLatestYml(): Promise<LatestYml | null> {
  const url = buildDownloadUrl("latest.yml");
  try {
    const raw = await httpGetString(url);
    const parsed = parseYaml(raw) as LatestYml;
    if (!parsed || typeof parsed.version !== "string") {
      console.error("[polza] latest.yml: missing version field");
      return null;
    }
    return parsed;
  } catch (e) {
    console.error("[polza] failed to fetch latest.yml:", (e as Error).message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Скачивание .exe
// ---------------------------------------------------------------------------

/** Скачать .exe установщик во временный файл. Возвращает путь к файлу. */
function downloadInstaller(
  latest: LatestYml,
  onProgress?: (pct: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Определяем имя файла из latest.yml (берём первое из files или поле path)
    const fileEntry = latest.files?.[0];
    const fileName = fileEntry?.url ?? latest.path;
    if (!fileName) {
      reject(new Error("latest.yml: no file path"));
      return;
    }

    const url = buildDownloadUrl(fileName);
    const dest = join(tmpdir(), `polza-setup-${latest.version}.exe`);

    const request = net.request({ url });

    request.on("login", (_authInfo, callback) => {
      callback("", "");
    });

    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} downloading installer`));
        return;
      }

      const totalSize =
        parseInt(response.headers["content-length"] as string, 10) || 0;
      let downloaded = 0;

      const out = createWriteStream(dest);
      response.on("data", (chunk) => {
        downloaded += chunk.length;
        if (totalSize > 0 && onProgress) {
          onProgress(Math.round((downloaded / totalSize) * 100));
        }
        out.write(chunk);
      });
      response.on("end", () => {
        out.end();
        resolve(dest);
      });
      response.on("error", (err) => {
        out.close();
        reject(err);
      });
    });

    request.on("error", reject);
    request.end();
  });
}

// ---------------------------------------------------------------------------
// Публичное API
// ---------------------------------------------------------------------------

/** Проверить обновления при запуске (тихо, в фоне). */
export async function checkOnStartup(): Promise<void> {
  // В dev-режиме и не на Windows обновления не работают.
  if (!app.isPackaged || process.platform !== "win32") return;

  try {
    const latest = await fetchLatestYml();
    if (!latest) return;

    const currentVersion = app.getVersion();
    if (latest.version === currentVersion) {
      console.log("[polza] app is up to date");
      return;
    }

    console.log(`[polza] update available: ${latest.version} (current: ${currentVersion})`);
    downloadInProgress = true;

    const dest = await downloadInstaller(latest, (pct) => {
      console.log(`[polza] downloading update: ${pct}%`);
    });

    downloadInProgress = false;
    updateDownloaded = true;
    installerPath = dest;

    console.log("[polza] update downloaded:", latest.version);
    new Notification({
      title: "Polza Pulse",
      body: `Скачано обновление ${latest.version}. Применю при выходе из приложения.`,
      silent: false,
    }).show();
  } catch (e) {
    downloadInProgress = false;
    console.error("[polza] startup update check failed:", (e as Error).message);
  }
}

/** Проверить обновления по запросу из настроек. */
export async function checkForUpdates(): Promise<UpdateInfo> {
  if (!app.isPackaged || process.platform !== "win32") {
    return { available: false };
  }

  if (downloadInProgress) {
    return { available: true, downloaded: false };
  }

  try {
    const latest = await fetchLatestYml();
    if (!latest) return { available: false };

    const currentVersion = app.getVersion();
    const available = latest.version !== currentVersion;

    if (!available) {
      return { available: false };
    }

    // Если уже скачано и версия совпадает — ничего не делаем.
    if (updateDownloaded && installerPath && existsSync(installerPath)) {
      return { available: true, version: latest.version, downloaded: true };
    }

    // Запускаем фоновую загрузку.
    downloadInProgress = true;
    downloadInstaller(latest, (pct) => {
      console.log(`[polza] downloading update: ${pct}%`);
    })
      .then((dest) => {
        downloadInProgress = false;
        updateDownloaded = true;
        installerPath = dest;
        new Notification({
          title: "Polza Pulse",
          body: `Скачано обновление ${latest.version}. Применю при выходе из приложения.`,
          silent: false,
        }).show();
      })
      .catch((e) => {
        downloadInProgress = false;
        console.error("[polza] download failed:", (e as Error).message);
      });

    return { available: true, version: latest.version, downloaded: false };
  } catch (e) {
    console.error("[polza] update check failed:", (e as Error).message);
    return { available: false };
  }
}

/** Установить скачанное обновление и перезапустить. */
export function quitAndInstall(): void {
  if (!installerPath || !existsSync(installerPath)) {
    console.error("[polza] no installer to run");
    return;
  }

  // Запускаем установщик без /S — NSIS сам закроет приложение и заменит файлы.
  // При perMachine=false установка идёт в профиль текущего пользователя без UAC.
  spawn(installerPath, [], {
    detached: true,
    stdio: "ignore",
  }).unref();

  app.quit();
}

/** Проверить, скачано ли обновление и готово к установке. */
export function isUpdateDownloaded(): boolean {
  return updateDownloaded && installerPath != null && existsSync(installerPath);
}
