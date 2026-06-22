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
//   RENDER_CONCURRENCY           — сколько РЕНДЕРОВ (джоб) параллельно (дефолт 1; renderMedia тяжёлый по CPU)
//   REMOTION_ENTRY               — путь к точке входа (дефолт ../remotion/index.ts от этого файла)
//   ── тюнинг скорости ОДНОГО рендера (см. лог [timing] чтобы настраивать по цифрам) ──
//   RENDER_FRAME_CONCURRENCY     — сколько КАДРОВ рендерить параллельно (дефолт min(6, ядра))
//   RENDER_OFFTHREAD_THREADS     — потоков извлечения видео-кадров (Remotion-дефолт 2 — это и был затык!; наш дефолт min(6, ядра))
//                                  ВАЖНО: держи ≳ RENDER_FRAME_CONCURRENCY, иначе 6 OffthreadVideo-слоёв ReelV5 задушат пул извлечения
//   RENDER_OFFTHREAD_CACHE_MB    — кэш декодированных кадров компоновщика, МБ (0 = дефолт Remotion)
//   RENDER_SCALE                 — масштаб рендера (1 = 1080×1920; 0.66 ≈ 720p — кратно быстрее, ниже качество)
//   RENDER_X264_PRESET           — x264-пресет (дефолт faster; veryfast/ultrafast — быстрее/хуже)
//   RENDER_TIMEOUT_MS            — таймаут кадра, мс (дефолт 120000)
//   RENDER_REUSE_BROWSER         — 1 (дефолт): один Chrome на selectComposition+renderMedia (вместо двух запусков). 0 — выключить
import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia, ensureBrowser, openBrowser } from "@remotion/renderer";
import { createClient } from "@supabase/supabase-js";
import { createJobStore } from "./jobStore.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const ENTRY = process.env.REMOTION_ENTRY || path.join(REPO_ROOT, "remotion/index.ts");
const PUBLIC_DIR = path.join(REPO_ROOT, "public");
const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.REMOTION_RENDER_TOKEN || "";
const CONCURRENCY = Math.max(1, Number(process.env.RENDER_CONCURRENCY || 1));
const BUCKET = "factory-media";

// ── тюнинг скорости одного рендера (резолвим один раз; см. лог [timing]) ──
const CORES = os.cpus().length;
// Remotion-дефолт offthreadVideoThreads=2 — корень «очень долго»: 6 OffthreadVideo-слоёв ReelV5 на 2 потока.
// Поднимаем извлечение И frame-concurrency синхронно, чтобы реально загрузить ядра ВМ.
const FRAME_CONCURRENCY = Math.max(1, Number(process.env.RENDER_FRAME_CONCURRENCY) || Math.min(6, CORES));
const OFFTHREAD_THREADS = Math.max(1, Number(process.env.RENDER_OFFTHREAD_THREADS) || Math.min(6, CORES));
const OFFTHREAD_CACHE_BYTES = Math.max(0, Number(process.env.RENDER_OFFTHREAD_CACHE_MB) || 0) * 1024 * 1024;
const RENDER_SCALE = Number(process.env.RENDER_SCALE) || 1;
const X264_PRESET = process.env.RENDER_X264_PRESET || "faster";
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS) || 120000;
const REUSE_BROWSER = process.env.RENDER_REUSE_BROWSER !== "0"; // переиспользовать Chrome в пределах одного рендера

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ── Supabase (заливка результата + кросс-инстанс стор джоб) ──
let _supa = null;
function supa() {
  if (_supa) return _supa;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supa = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _supa;
}

// ── стор статуса джоб: in-memory (быстрый путь, та же инстанс) + Supabase (кросс-инстанс для ФЛОТА) ──
// Рендер всегда идёт на инстанс, принявшей /render. В Supabase пишем только статус/прогресс/результат,
// чтобы /status/:id отвечал с ЛЮБОЙ инстанс за балансировщиком. Нет таблицы/Supabase → тихо только in-memory.
// Логика и тесты — в jobStore.mjs (телеметрия НИКОГДА не валит рендер). Миграция: 20260622_render_jobs.sql.
const store = createJobStore({ getClient: supa, log });
const persistJob = (id, fields) => store.persist(id, fields);
const fetchJob = (id) => store.fetch(id);

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
  if (!job) return; // джоба уже вычищена/отменена — рендерить нечего (а onProgress не упадёт на undefined)
  const tmp = path.join(os.tmpdir(), `remotion-${id}.mp4`);
  const t0 = Date.now();
  let tSelected = t0;
  let browser = null;
  try {
    const serveUrl = await getServeUrl();
    // один Chrome на весь рендер: общий для selectComposition+renderMedia (иначе Remotion поднимает его дважды).
    // fail-safe: не открылся → ppt пустой, Remotion поднимет свой на каждый вызов (поведение как раньше).
    if (REUSE_BROWSER) {
      try { browser = await openBrowser("chrome"); }
      catch (e) { log(`warm browser недоступен — fallback на свежий: ${String(e?.message || e).slice(0, 120)}`); browser = null; }
    }
    const ppt = browser ? { puppeteerInstance: browser } : {};
    const comp = await selectComposition({ serveUrl, id: composition, inputProps, ...ppt });
    tSelected = Date.now();
    const durationOverride = Number.isFinite(durationInFrames) && durationInFrames > 0
      ? { durationInFrames } : {};
    log(`render ${id}: ${composition} ${comp.width}x${comp.height} @${comp.fps} ${durationOverride.durationInFrames || comp.durationInFrames}f | conc=${FRAME_CONCURRENCY} threads=${OFFTHREAD_THREADS} scale=${RENDER_SCALE} preset=${X264_PRESET}`);
    await renderMedia({
      composition: { ...comp, ...durationOverride },
      serveUrl, inputProps, ...ppt, codec: "h264", outputLocation: tmp,
      // Затык ReelV5 — извлечение кадров из 6 OffthreadVideo-слоёв. Remotion-дефолт = 2 потока (offthreadVideoThreads),
      // поэтому раньше frame-concurrency приходилось душить до 4. Теперь поднимаем ОБА синхронно (см. ENV-блок вверху):
      // threads ≳ concurrency → пул извлечения поспевает, и ядра ВМ реально грузятся. Тюнить по логу [timing].
      concurrency: FRAME_CONCURRENCY,
      offthreadVideoThreads: OFFTHREAD_THREADS,
      ...(OFFTHREAD_CACHE_BYTES ? { offthreadVideoCacheSizeInBytes: OFFTHREAD_CACHE_BYTES } : {}),
      ...(RENDER_SCALE !== 1 ? { scale: RENDER_SCALE } : {}),
      x264Preset: X264_PRESET,
      // дефолтные 28с малы: несколько рендереров разом тянут кадры из тяжёлых видео (OffthreadVideo → <Img blob>)
      timeoutInMilliseconds: RENDER_TIMEOUT_MS,
      onProgress: ({ progress }) => {
        job.progress = Math.round(progress * 100);
        // кросс-инстанс прогресс (троттл ≥3с, чтобы не молотить БД на каждом кадре)
        const now = Date.now();
        if (now - (job._dbAt || 0) > 3000) { job._dbAt = now; persistJob(id, { status: "in_progress", progress: job.progress }); }
      },
    });
    const tRendered = Date.now();

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

    const tDone = Date.now();
    const sec = (ms) => (ms / 1000).toFixed(1);
    // разбивка времени → видно, что душит: select(бандл/браузер), render(кадры+извлечение+x264), upload(сеть)
    log(`[timing] ${id}: select=${sec(tSelected - t0)}s render=${sec(tRendered - tSelected)}s upload=${sec(tDone - tRendered)}s total=${sec(tDone - t0)}s`);
    job.status = "done"; job.videoUrl = videoUrl;
    await persistJob(id, { status: "done", progress: 100, video_url: videoUrl, error: null });
    log(`✅ ${id} → ${videoUrl}`);
  } catch (e) {
    job.status = "error"; job.error = String(e?.message || e).slice(0, 300);
    await persistJob(id, { status: "error", error: job.error });
    log(`❌ ${id}: ${job.error}`);
  } finally {
    if (browser) { try { await browser.close({ silent: true }); } catch { /* уже закрыт/упал — не мешаем завершению */ } }
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
    let b = ""; let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    req.on("data", (c) => {
      if (done) return;
      b += c;
      if (b.length > 2e6) { finish({ __tooLarge: true }); req.destroy(); } // резолвим ДО destroy — иначе промис висел бы вечно ('end' не придёт)
    });
    req.on("end", () => { try { finish(JSON.parse(b || "{}")); } catch { finish(null); } });
    req.on("error", () => finish(null));   // обрыв/destroy — не зависаем
    req.on("aborted", () => finish(null));
  });
}

let idSeq = 0;
const server = http.createServer(async (req, res) => {
 try {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true, bundled: !!serveUrlPromise, busy: active, queued: queue.length, store: store.active() ? "supabase+memory" : "memory" });
  }
  if (req.method === "POST" && url.pathname === "/reload") {
    if (!authed(req)) return send(res, 401, { error: "unauthorized" });
    getServeUrl(true); return send(res, 200, { ok: true, rebundling: true });
  }
  if (req.method === "POST" && url.pathname === "/render") {
    if (!authed(req)) return send(res, 401, { error: "unauthorized" });
    const body = await readBody(req);
    if (body && body.__tooLarge) return send(res, 413, { error: "тело запроса слишком большое (>2MB)" });
    if (!body || !body.composition) return send(res, 400, { error: "нужен composition" });
    const id = `${Date.now().toString(36)}-${(idSeq++).toString(36)}`;
    jobs.set(id, { status: "in_progress", progress: 0, createdAt: Date.now() });
    // создаём строку в общем сторе ДО ответа → немедленный кросс-инстанс /status найдёт джобу (фолбэк-безопасно)
    await persistJob(id, { status: "in_progress", progress: 0, created_at: new Date().toISOString() });
    queue.push(() => runRender(id, String(body.composition), body.inputProps || {}, Number(body.durationInFrames)));
    pump();
    return send(res, 200, { id });
  }
  if (req.method === "GET" && url.pathname.startsWith("/status/")) {
    if (!authed(req)) return send(res, 401, { error: "unauthorized" });
    const id = url.pathname.slice("/status/".length);
    const job = jobs.get(id);
    if (job) return send(res, 200, { status: job.status, progress: job.progress, videoUrl: job.videoUrl, error: job.error });
    // не на этой инстанс (флот за балансировщиком) → спросим общий стор
    const remote = await fetchJob(id);
    if (remote) return send(res, 200, remote);
    return send(res, 404, { status: "error", error: "job не найден" });
  }
  send(res, 404, { error: "not found" });
 } catch (e) {
    log("handler error:", e?.message || e);
    if (!res.headersSent) send(res, 500, { error: "internal" });
 }
});
// зависшие сокеты гарантированно закрываются (см. защиту readBody от больших тел)
server.requestTimeout = 120e3;
server.headersTimeout = 65e3;

// чистим старые ЗАВЕРШЁННЫЕ джобы раз в час (in_progress не трогаем — иначе потеряем готовый результат)
setInterval(() => {
  const cutoff = Date.now() - 6 * 3600e3;
  for (const [id, j] of jobs) if (j.status !== "in_progress" && j.createdAt < cutoff) jobs.delete(id);
  store.cleanup(new Date(cutoff).toISOString()); // и в общем сторе (флот): чистим завершённые старше 6ч
}, 3600e3).unref();

server.listen(PORT, () => {
  log(`render-service на :${PORT} | jobs=${CONCURRENCY} frame-conc=${FRAME_CONCURRENCY} offthread-threads=${OFFTHREAD_THREADS} scale=${RENDER_SCALE} preset=${X264_PRESET} cores=${CORES} | token=${TOKEN ? "set" : "OPEN(!)"}`);
  getServeUrl().catch((e) => log("bundle при старте упал:", e?.message || e)); // прогреть бандл
});
