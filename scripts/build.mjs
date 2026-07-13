// Сборка Electron-приложения: 3 группы бандлов через esbuild.
//   - main (CJS): Node/Electron main process → dist-main/
//   - preload (CJS): contextBridge → dist-preload/
//   - renderer (IIFE): UI (popup/history/models) → dist-renderer/
import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const watch = process.argv.includes("--watch");

// Выходные каталоги
const outMain = join(root, "dist-main");
const outPreload = join(root, "dist-preload");
const outRenderer = join(root, "dist-renderer");

// --- Точки входа main (CJS для Electron main process) ---
const mainEntries = [
  join(src, "main/index.ts"),
  join(src, "main/store.ts"),
  join(src, "main/tray.ts"),
  join(src, "main/poller.ts"),
  join(src, "main/updater.ts"),
  join(src, "main/ipc.ts"),
];

// --- Точка входа preload ---
const preloadEntries = [join(src, "preload/index.ts")];

// --- Точки входа renderer ---
const rendererEntries = [
  join(src, "renderer/popup/popup.ts"),
  join(src, "renderer/history/history.ts"),
  join(src, "renderer/models/models.ts"),
];

// --- Копирование статических ассетов renderer (HTML/CSS) ---
const rendererCopyDirs = []; // styles уже линкятся через HTML <link>
const rendererCopyPairs = [
  ["src/renderer/popup/popup.html", "popup/popup.html"],
  ["src/renderer/popup/popup.css", "popup/popup.css"],
  ["src/renderer/history/history.html", "history/history.html"],
  ["src/renderer/history/history.css", "history/history.css"],
  ["src/renderer/models/models.html", "models/models.html"],
  ["src/renderer/models/models.css", "models/models.css"],
  ["src/renderer/styles/tokens.css", "styles/tokens.css"],
  ["src/renderer/styles/base.css", "styles/base.css"],
  ["src/renderer/styles/components.css", "styles/components.css"],
];

async function copyRendererAssets() {
  for (const [from, to] of rendererCopyPairs) {
    const fromPath = join(root, from);
    if (existsSync(fromPath)) await cp(fromPath, join(outRenderer, to));
  }
}

const sharedRenderer = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
};

const builds = [
  // Main process (CJS)
  {
    ...sharedRenderer,
    entryPoints: mainEntries,
    outdir: outMain,
    format: "cjs",
    platform: "node",
    external: ["electron", "electron-store", "electron-updater"],
  },
  // Preload (CJS)
  {
    ...sharedRenderer,
    entryPoints: preloadEntries,
    outdir: outPreload,
    format: "cjs",
    platform: "node",
    external: ["electron"],
  },
  // Renderer (browser IIFE) — каждый entry отдельный бандл
  {
    ...sharedRenderer,
    entryPoints: rendererEntries,
    outdir: outRenderer,
    outbase: join(src, "renderer"),
    entryNames: "[dir]/[name]",
  },
];

async function main() {
  // Очистка
  for (const dir of [outMain, outPreload, outRenderer]) {
    if (!watch && existsSync(dir)) await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
  }

  if (watch) {
    for (const cfg of builds) {
      const ctx = await context(cfg);
      await ctx.watch();
    }
    await copyRendererAssets();
    console.log("[polza] watch ready.");
  } else {
    for (const cfg of builds) {
      await build({ ...cfg, write: true });
    }
    await copyRendererAssets();
    console.log("[polza] build complete.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
