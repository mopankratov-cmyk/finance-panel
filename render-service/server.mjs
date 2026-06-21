// Remotion render-микросервис. Крутится на Yandex Cloud VM (или любой Linux+Chrome).
// Контракт submit→poll = зеркало lib/factory/shotstack.ts, чтобы завод врезался без переписывания очереди.
//
//   POST /render   { composition, inputProps?, durationInFrames? }  → { id }
//   GET  /status/:id                                                → { status: in_progress|done|error, videoUrl?, error? }
//   GET  /health                                                    → { ok, bundled, busy, queued }
//
// Авторизация: заголовок `Authorization: Bearer <REMOTION_RENDER_TOKEN>` на /render и /status.
// Готовый mp4 заливается в Supabase Storage (bucket factory-media, префикс renders/) → постоянный публичный URL.
//
// ENV:
//   REMOTION_RENDER_TOKEN        — общий секрет (Vercel-завод шлёт тот же)
//   NEXT_PUBLIC_SUPABASE_URL     — Supabase URL
//   SUPABASE_SERVICE_ROLE_KEY    — service-role ключ (заливка в Storage)
//   PORT                         — порт (дефолт 8080)
//   RENDER_CONCURRENCY           — сколько рендеров параллельно (дефолт 1; renderMedia тяжёлый по CPU)
//   REMOTION_ENTRY               — путь к точке входа (дефолт ../remotion/index.ts от этого файла)
import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia, ensureBrowser } from "@remotion/renderer";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const ENTRY = process.env.REMOTION_ENTRY || path.join(REPO_ROOT, "remotion/index.ts");
const PUBLIC_DIR = path.join(REPO_ROOT, "public");
const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.REMOTION_RENDER_TOKEN || "";
const CONCURRENCY = Math.max(1, Number(process.env.RENDER_CONCURRENCY || 1));
const BUCKET = "factory-media";

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ── Supabase (заливка результата) ──
function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ── одноразовый бандл (кешируется в памяти; /reload пересоберёт после деплоя новой композиции) ──
let serveUrlPromise = null;
function getServeUrl(force = false) {
  if (force) serveUrlPromise = null;
  if (!serveUrlPromise) {
    serveUrlPromise = (async () => {
      log("ensureBrowser…");
      await ensureBrowser();
      log("bundle…", ENTRY);
      const url = await bundle({ entryPoint: ENTRY, publicDir: PUBLIC_DIR });
      log("bundle готов");
      return url;
    })();
  }
  return serveUrlPromise;
}

// ── очередь рендеров (in-memory; для батч-завода маленькой VM достаточно) ──
const jobs = new Map(); // id → { status, videoUrl?, error?, createdAt }
let active = 0;
const queue = [];

function pump() {
  while (active < CONCURRENCY && queue.length) {
    const task = queue.shift();
    active++;
    task().finally(() => { active--; pump(); });
  }
}

async function runRender(id, composition, inputProps, durationInFrames) {
  const job = jobs.get(id);
  const tmp = path.join(os.tmpdir(), `remotion-${id}.mp4`);
  try {
    const serveUrl = await getServeUrl();
    const comp = await selectComposition({ serveUrl, id: composition, inputProps });
    const durationOverride = Number.isFinite(durationInFrames) && durationInFrames > 0
      ? { durationInFrames } : {};
    log(`render ${id}: ${composition} ${comp.width}x${comp.height} @${comp.fps} ${durationOverride.durationInFrames || comp.durationInFrames}f`);
    await renderMedia({
      composition: { ...comp, ...durationOverride },
      serveUrl, inputProps, codec: "h264", outputLocation: tmp,
      onProgress: ({ progress }) => { job.progress = Math.round(progress * 100); },
    });

    // заливка в Supabase Storage
    const db = supa();
    if (!db) throw new Error("Supabase env не настроен (NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)");
    try { await db.storage.createBucket(BUCKET, { public: true }); } catch { /* уже есть */ }
    const buf = await fs.readFile(tmp);
    const objPath = `renders/${id}.mp4`;
    const { error } = await db.storage.from(BUCKET).upload(objPath, buf, { contentType: "video/mp4", upsert: true });
    if (error) throw new Error(`upload: ${error.message}`);
    const videoUrl = db.storage.from(BUCKET).getPublicUrl(objPath).data?.publicUrl;
    if (!videoUrl) throw new Error("getPublicUrl вернул пусто");

    job.status = "done"; job.videoUrl = videoUrl;
    log(`✅ ${id} → ${videoUrl}`);
  } catch (e) {
    job.status = "error"; job.error = String(e?.message || e).slice(0, 300);
    log(`❌ ${id}: ${job.error}`);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

// ── HTTP ──
function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}
function authed(req) {
  if (!TOKEN) return true; // если токен не задан — открыто (для локального теста); в проде ЗАДАТЬ
  return (req.headers.authorization || "") === `Bearer ${TOKEN}`;
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = ""; req.on("data", (c) => { b += c; if (b.length > 2e6) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve(null); } });
  });
}

let idSeq = 0;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true, bundled: !!serveUrlPromise, busy: active, queued: queue.length });
  }
  if (req.method === "POST" && url.pathname === "/reload") {
    if (!authed(req)) return send(res, 401, { error: "unauthorized" });
    getServeUrl(true); return send(res, 200, { ok: true, rebundling: true });
  }
  if (req.method === "POST" && url.pathname === "/render") {
    if (!authed(req)) return send(res, 401, { error: "unauthorized" });
    const body = await readBody(req);
    if (!body || !body.composition) return send(res, 400, { error: "нужен composition" });
    const id = `${Date.now().toString(36)}-${(idSeq++).toString(36)}`;
    jobs.set(id, { status: "in_progress", progress: 0, createdAt: Date.now() });
    queue.push(() => runRender(id, String(body.composition), body.inputProps || {}, Number(body.durationInFrames)));
    pump();
    return send(res, 200, { id });
  }
  if (req.method === "GET" && url.pathname.startsWith("/status/")) {
    if (!authed(req)) return send(res, 401, { error: "unauthorized" });
    const id = url.pathname.slice("/status/".length);
    const job = jobs.get(id);
    if (!job) return send(res, 404, { status: "error", error: "job не найден" });
    return send(res, 200, { status: job.status, progress: job.progress, videoUrl: job.videoUrl, error: job.error });
  }
  send(res, 404, { error: "not found" });
});

// чистим старые джобы раз в час (память)
setInterval(() => {
  const cutoff = Date.now() - 6 * 3600e3;
  for (const [id, j] of jobs) if (j.createdAt < cutoff) jobs.delete(id);
}, 3600e3).unref();

server.listen(PORT, () => {
  log(`render-service на :${PORT} | concurrency=${CONCURRENCY} | token=${TOKEN ? "set" : "OPEN(!)"}`);
  getServeUrl().catch((e) => log("bundle при старте упал:", e?.message || e)); // прогреть бандл
});
