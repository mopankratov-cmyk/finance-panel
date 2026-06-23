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
//   RENDER_GL                    — WebGL-бэкенд headless Chrome (пусто=дефолт Chrome). На VM БЕЗ GPU Remotion
//                                  рекомендует "swangle" (надёжный software-ANGLE: ровные градиенты/без пустых кадров,
//                                  критично для CSS-моушена BRoll). Также: "angle", "egl", "swiftshader". Ставить на VM.
//   RENDER_REUSE_BROWSER         — 1 (дефолт): один Chrome на selectComposition+renderMedia (вместо двух запусков). 0 — выключить
//   LOCALIZE_ASSETS              — 1 (дефолт): качать+нормализовать remote-видео из пропсов локально, отдавать по 127.0.0.1 (×2-5 для прод-рендеров). 0 — выкл
//   ASSET_PORT                   — порт локального статик-сервера ассетов (дефолт 8090, только 127.0.0.1)
import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia, renderStill, ensureBrowser, openBrowser } from "@remotion/renderer";
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
// GL-бэкенд: дефолт пуст (текущее рабочее поведение). На VM без GPU выставить RENDER_GL=swangle (см. ENV-блок).
const RENDER_GL = (process.env.RENDER_GL || "").trim();
const CHROMIUM_OPTIONS = RENDER_GL ? { gl: RENDER_GL } : undefined;

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

// ── локализация ассетов: завод шлёт remote-URL клипов, и OffthreadVideo иначе ходит в сеть ПОКАДРОВО
// (×сотни кадров × несколько слоёв). Качаем каждый уникальный видео/аудио-URL ОДИН раз во временную папку,
// видео нормализуем ffmpeg'ом (g=1 → мгновенный seek, единый yuv420p/aac), и отдаём Remotion'у по
// http://127.0.0.1 (локальное чтение). Смоук на staticFile-ассетах не затрагивается (там не http-URL).
// Выключить: LOCALIZE_ASSETS=0. Любая ошибка → оставляем исходный URL (рендер не падает, просто медленнее).
const LOCALIZE = process.env.LOCALIZE_ASSETS !== "0";
const ASSET_PORT = Number(process.env.ASSET_PORT || 8090);
const ASSET_DIR = path.join(os.tmpdir(), "render-assets");
const VIDEO_RE = /\.(mp4|mov|webm|mkv|m4v)(\?|$)/i;
const MEDIA_RE = /\.(mp4|mov|webm|mkv|m4v|mp3|wav|m4a|aac|ogg)(\?|$)/i;
const localCache = new Map(); // remote URL → http://127.0.0.1 URL (переживает несколько рендеров)
const fnv1a = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); };

function ffmpegNormalize(input, output) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-c:v", "libx264", "-preset", "veryfast",
      "-crf", "20", "-g", "1", "-keyint_min", "1", "-sc_threshold", "0", "-pix_fmt", "yuv420p", "-c:a", "aac", output]);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg exit " + code))));
  });
}

async function localizeUrl(u) {
  const cached = localCache.get(u);
  if (cached) return cached;
  const key = fnv1a(u);
  const isVideo = VIDEO_RE.test(u);
  const ext = isVideo ? "mp4" : ((u.split("?")[0].match(/\.(\w{2,4})$/) || [])[1] || "bin");
  const out = path.join(ASSET_DIR, `${key}.${ext}`);
  const localUrl = `http://127.0.0.1:${ASSET_PORT}/${key}.${ext}`;
  try {
    await fs.mkdir(ASSET_DIR, { recursive: true });
    const exists = await fs.access(out).then(() => true).catch(() => false);
    if (!exists) {
      const r = await fetch(u, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(`fetch ${r.status}`);
      const raw = path.join(ASSET_DIR, `${key}.src`);
      await fs.writeFile(raw, Buffer.from(await r.arrayBuffer()));
      if (isVideo) { await ffmpegNormalize(raw, out); await fs.rm(raw, { force: true }); }
      else { await fs.rename(raw, out); }
    }
    localCache.set(u, localUrl);
    return localUrl;
  } catch (e) {
    log(`localize пропущен ${u.slice(0, 60)}: ${String(e?.message || e).slice(0, 80)}`);
    return u; // graceful — рендер пойдёт с исходным URL
  }
}

// глубокий обход пропсов: каждую строку-медиа-URL заменяем на локальный
async function localizeAssets(obj) {
  if (Array.isArray(obj)) return Promise.all(obj.map(localizeAssets));
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = await localizeAssets(v);
    return out;
  }
  if (typeof obj === "string" && /^https?:\/\//.test(obj) && MEDIA_RE.test(obj)) return localizeUrl(obj);
  return obj;
}

// статик-сервер локализованных ассетов (Remotion читает их по localhost — без сети покадрово)
if (LOCALIZE) {
  http.createServer((req, res) => {
    const name = path.basename(decodeURIComponent(new URL(req.url, "http://x").pathname));
    const s = createReadStream(path.join(ASSET_DIR, name));
    s.on("error", () => { res.writeHead(404); res.end(); });
    s.on("open", () => { res.writeHead(200, { "Content-Type": "application/octet-stream" }); s.pipe(res); });
  }).listen(ASSET_PORT, "127.0.0.1", () => log(`asset-server на 127.0.0.1:${ASSET_PORT}`));
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

async function runRender(id, composition, inputProps, durationInFrames, still = false) {
  const job = jobs.get(id);
  if (!job) return; // джоба уже вычищена/отменена — рендерить нечего (а onProgress не упадёт на undefined)
  const tmp = path.join(os.tmpdir(), `remotion-${id}.${still ? "png" : "mp4"}`); // СТАТИКА: renderStill→PNG, иначе видео
  const t0 = Date.now();
  let tLocalized = t0;
  let tSelected = t0;
  let browser = null;
  try {
    const serveUrl = await getServeUrl();
    // локализуем remote-ассеты (скачать+нормализовать один раз) — иначе OffthreadVideo тянет их из сети покадрово
    const props = LOCALIZE ? await localizeAssets(inputProps) : inputProps;
    tLocalized = Date.now();
    // один Chrome на весь рендер: общий для selectComposition+renderMedia (иначе Remotion поднимает его дважды).
    // fail-safe: не открылся → ppt пустой, Remotion поднимет свой на каждый вызов (поведение как раньше).
    if (REUSE_BROWSER) {
      try { browser = await openBrowser("chrome", CHROMIUM_OPTIONS ? { chromiumOptions: CHROMIUM_OPTIONS } : undefined); }
      catch (e) { log(`warm browser недоступен — fallback на свежий: ${String(e?.message || e).slice(0, 120)}`); browser = null; }
    }
    const ppt = browser ? { puppeteerInstance: browser } : {};
    const comp = await selectComposition({ serveUrl, id: composition, inputProps: props, ...ppt, ...(CHROMIUM_OPTIONS ? { chromiumOptions: CHROMIUM_OPTIONS } : {}) });
    tSelected = Date.now();
    const durationOverride = Number.isFinite(durationInFrames) && durationInFrames > 0
      ? { durationInFrames } : {};
    log(`render ${id}: ${composition} ${comp.width}x${comp.height} @${comp.fps} ${durationOverride.durationInFrames || comp.durationInFrames}f | conc=${FRAME_CONCURRENCY} threads=${OFFTHREAD_THREADS} scale=${RENDER_SCALE} preset=${X264_PRESET}`);
    if (still) {
      // СТАТИКА: один кадр → PNG (линия пинов/карточек, без видео-кодека)
      await renderStill({ serveUrl, composition: { ...comp, ...durationOverride }, inputProps: props, ...ppt, output: tmp, frame: 0, ...(CHROMIUM_OPTIONS ? { chromiumOptions: CHROMIUM_OPTIONS } : {}) });
    } else {
    await renderMedia({
      composition: { ...comp, ...durationOverride },
      serveUrl, inputProps: props, ...ppt, codec: "h264", outputLocation: tmp,
      // Затык ReelV5 — извлечение кадров из 6 OffthreadVideo-слоёв. Remotion-дефолт = 2 потока (offthreadVideoThreads),
      // поэтому раньше frame-concurrency приходилось душить до 4. Теперь поднимаем ОБА синхронно (см. ENV-блок вверху):
      // threads ≳ concurrency → пул извлечения поспевает, и ядра ВМ реально грузятся. Тюнить по логу [timing].
      concurrency: FRAME_CONCURRENCY,
      offthreadVideoThreads: OFFTHREAD_THREADS,
      ...(OFFTHREAD_CACHE_BYTES ? { offthreadVideoCacheSizeInBytes: OFFTHREAD_CACHE_BYTES } : {}),
      ...(RENDER_SCALE !== 1 ? { scale: RENDER_SCALE } : {}),
      x264Preset: X264_PRESET,
      ...(CHROMIUM_OPTIONS ? { chromiumOptions: CHROMIUM_OPTIONS } : {}), // GL-бэкенд (RENDER_GL=swangle на VM без GPU)
      // дефолтные 28с малы: несколько рендереров разом тянут кадры из тяжёлых видео (OffthreadVideo → <Img blob>)
      timeoutInMilliseconds: RENDER_TIMEOUT_MS,
      onProgress: ({ progress }) => {
        job.progress = Math.round(progress * 100);
        // кросс-инстанс прогресс (троттл ≥3с, чтобы не молотить БД на каждом кадре)
        const now = Date.now();
        if (now - (job._dbAt || 0) > 3000) { job._dbAt = now; persistJob(id, { status: "in_progress", progress: job.progress }); }
      },
    });
    }
    const tRendered = Date.now();

    // заливка в Supabase Storage
    const db = supa();
    if (!db) throw new Error("Supabase env не настроен (NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)");
    const buf = await fs.readFile(tmp);
    const objPath = `renders/${id}.${still ? "png" : "mp4"}`;
    // ретрай заливки: транзиентный "fetch failed"/5xx к Supabase НЕ должен хоронить уже готовый (оплаченный) рендер.
    // upload бросает на сетевой ошибке И возвращает {error} на серверной — ловим оба, бэкофф 1.5с×попытка.
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let upErr = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        if (attempt === 1) { try { await db.storage.createBucket(BUCKET, { public: true }); } catch { /* уже есть */ } }
        const { error } = await db.storage.from(BUCKET).upload(objPath, buf, { contentType: still ? "image/png" : "video/mp4", upsert: true });
        if (!error) { upErr = null; break; }
        upErr = error.message || String(error);
      } catch (e) { upErr = String(e?.message || e); } // напр. "fetch failed" — сетевой транзиент
      if (attempt < 4) { log(`upload ${id} retry ${attempt}/3 (${upErr})`); await sleep(1500 * attempt); }
    }
    if (upErr) throw new Error(`upload (после 4 попыток): ${upErr}`);
    const videoUrl = db.storage.from(BUCKET).getPublicUrl(objPath).data?.publicUrl;
    if (!videoUrl) throw new Error("getPublicUrl вернул пусто");

    const tDone = Date.now();
    const sec = (ms) => (ms / 1000).toFixed(1);
    // разбивка времени → видно, что душит: select(бандл/браузер), render(кадры+извлечение+x264), upload(сеть)
    log(`[timing] ${id}: localize=${sec(tLocalized - t0)}s select=${sec(tSelected - tLocalized)}s render=${sec(tRendered - tSelected)}s upload=${sec(tDone - tRendered)}s total=${sec(tDone - t0)}s`);
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
    queue.push(() => runRender(id, String(body.composition), body.inputProps || {}, Number(body.durationInFrames), !!body.still));
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
