// De-risk + основа render-сервиса: программный рендер Remotion-композиции через renderMedia().
// Это ровно то, что побежит на Yandex-VM (Linux), только тут — локально для доказательства.
// Запуск: node scripts/render-local.mjs [ReelV5] [out/render-test.mp4]
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia, ensureBrowser } from "@remotion/renderer";

const ROOT = process.cwd();
const compositionId = process.argv[2] || "ReelV5";
const outPath = path.resolve(ROOT, process.argv[3] || `out/${compositionId}-local.mp4`);

const t0 = Date.now();
const log = (m) => console.log(`[render +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

log(`composition=${compositionId} → ${outPath}`);

// 1) Chrome Headless Shell (кешируется после первого раза)
log("ensureBrowser…");
await ensureBrowser();

// 2) бандл точки входа (remotion/index.ts). publicDir — чтобы staticFile('reel-assets/…') резолвился.
log("bundle…");
const serveUrl = await bundle({
  entryPoint: path.join(ROOT, "remotion/index.ts"),
  publicDir: path.join(ROOT, "public"),
  // бандл тяжёлый (видео в public) — webpack только для composition-кода
});
log("bundle готов");

// 3) выбрать композицию (читает Root.tsx → durationInFrames/fps/size)
const composition = await selectComposition({ serveUrl, id: compositionId });
log(`composition: ${composition.width}x${composition.height} @${composition.fps}fps, ${composition.durationInFrames}f`);

// 4) рендер в mp4 (h264)
await renderMedia({
  composition,
  serveUrl,
  codec: "h264",
  outputLocation: outPath,
  onProgress: ({ progress }) => {
    if (Math.round(progress * 100) % 20 === 0) log(`progress ${Math.round(progress * 100)}%`);
  },
});
log(`✅ готово: ${outPath}`);
