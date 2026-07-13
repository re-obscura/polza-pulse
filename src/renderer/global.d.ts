/* ============================================================================
   global.d.ts — объявление window.polza (внедряется через preload contextBridge).
   ========================================================================== */

import type { PolzaApi } from "../preload";

declare global {
  interface Window {
    polza: PolzaApi;
  }
}

export {};
