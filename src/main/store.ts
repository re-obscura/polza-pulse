/* ============================================================================
   store.ts — персистентное хранилище через electron-store.
   Замена chrome.storage.local. Один ключ, один кэш.
   ========================================================================== */

import Store from "electron-store";
import {
  DEFAULT_SETTINGS,
  type Key,
  type KeyCache,
  type Settings,
} from "../types";

interface StoreShape {
  key: Key | null;
  settings: Settings;
  cache: KeyCache | null;
}

const store = new Store<StoreShape>({
  name: "polza-monitor",
  defaults: {
    key: null,
    settings: DEFAULT_SETTINGS,
    cache: null,
  },
  clearInvalidConfig: true,
});

/* ---- Ключ ---- */

export function getKey(): Key | null {
  return store.get("key") ?? null;
}

export function setKey(key: Key | null): void {
  store.set("key", key);
}

export function patchKey(patch: Partial<Key>): void {
  const cur = getKey();
  if (!cur) return;
  setKey({ ...cur, ...patch });
}

/* ---- Настройки ---- */

export function getSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...store.get("settings") };
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  store.set("settings", next);
  return next;
}

/* ---- Кэш ---- */

export function getCache(): KeyCache | null {
  return store.get("cache") ?? null;
}

export function setCache(cache: KeyCache): void {
  store.set("cache", cache);
}

/* ---- Подписка на изменения (для уведомления renderer) ---- */

export type StoreChangeHandler = (key: keyof StoreShape) => void;
const handlers = new Set<StoreChangeHandler>();

store.onDidChange("key", () => handlers.forEach((h) => h("key")));
store.onDidChange("settings", () => handlers.forEach((h) => h("settings")));
store.onDidChange("cache", () => handlers.forEach((h) => h("cache")));

export function onStoreChange(handler: StoreChangeHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
