/* ============================================================================
   preload/index.ts — безопасный мост между renderer и main через contextBridge.
   Renderer получает доступ к window.polza.* — никакого прямого IPC/Node.
   ========================================================================== */

import { contextBridge, ipcRenderer } from "electron";
import type {
  Key,
  KeyCache,
  ModelInfo,
  Settings,
  UpdateInfo,
} from "../types";

const polza = {
  // ---- Состояние и данные ----
  getState: (): Promise<{ cache: KeyCache | null }> =>
    ipcRenderer.invoke("GET_STATE"),
  refresh: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("REFRESH"),

  // ---- Настройки ----
  getSettings: (): Promise<Settings> => ipcRenderer.invoke("GET_SETTINGS"),
  setSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke("SET_SETTINGS", patch),

  // ---- Ключ ----
  getKey: (): Promise<Key | null> => ipcRenderer.invoke("GET_KEY"),
  setKey: (key: Key | null): Promise<boolean> =>
    ipcRenderer.invoke("SET_KEY", key),

  // ---- Обновления ----
  checkForUpdates: (): Promise<UpdateInfo> => ipcRenderer.invoke("CHECK_UPDATES"),
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke("INSTALL_UPDATE"),

  // ---- Версия ----
  getVersion: (): Promise<string> => ipcRenderer.invoke("GET_VERSION"),

  // ---- Внешние действия ----
  openExternal: (url: string): Promise<boolean> =>
    ipcRenderer.invoke("OPEN_EXTERNAL", url),
  openWindow: (name: "history" | "models"): Promise<boolean> =>
    ipcRenderer.invoke("OPEN_WINDOW", name),

  // ---- Модели ----
  fetchModels: (): Promise<ModelInfo[]> => ipcRenderer.invoke("FETCH_MODELS"),

  // ---- События main → renderer ----
  onCacheChanged: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on("CACHE_CHANGED", handler);
    return () => ipcRenderer.removeListener("CACHE_CHANGED", handler);
  },
  onSettingsChanged: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on("SETTINGS_CHANGED", handler);
    return () => ipcRenderer.removeListener("SETTINGS_CHANGED", handler);
  },
  onKeyChanged: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on("KEY_CHANGED", handler);
    return () => ipcRenderer.removeListener("KEY_CHANGED", handler);
  },
};

contextBridge.exposeInMainWorld("polza", polza);

// Тип для TypeScript в renderer (window.polza).
export type PolzaApi = typeof polza;
