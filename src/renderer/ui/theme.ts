/* ============================================================================
   theme.ts — управление темой (light / dark / system).
   Установка data-theme на :root; «system» следует prefers-color-scheme
   (см. tokens.css). Работает через window.polza (Electron IPC).
   ========================================================================== */

import type { ThemePref } from "../../types";

const ROOT = () => document.documentElement;

/** Применить тему к документу (без записи в storage). */
export function applyTheme(pref: ThemePref): void {
  ROOT().setAttribute("data-theme", pref);
}

/** Текущая сохранённая тема. */
export async function getCurrentTheme(): Promise<ThemePref> {
  const s = await window.polza.getSettings();
  return s.theme;
}

/** Сменить тему (записывает в storage + применяет). */
export async function setTheme(pref: ThemePref): Promise<void> {
  applyTheme(pref);
  await window.polza.setSettings({ theme: pref });
}

/**
 * Инициализировать тему на странице.
 * Читает сохранённую тему, применяет и подписывается на изменения,
 * чтобы тема синхронизировалась между окнами.
 */
export async function initTheme(): Promise<ThemePref> {
  const pref = await getCurrentTheme();
  applyTheme(pref);
  // Реагируем на смену темы из других окон.
  window.polza.onSettingsChanged(() => {
    void getCurrentTheme().then(applyTheme);
  });
  return pref;
}

/** Человеческие подписи для переключателя. */
export const THEME_LABELS: Record<ThemePref, string> = {
  light: "Светлая",
  dark: "Тёмная",
  system: "Системная",
};
