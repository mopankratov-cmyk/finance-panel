// fal.ai видео-движки (image-to-video) через queue API. Крипто-шлюз, ключ FAL_KEY уже в env.
// Премиум-маршрут: реальное фото товара → динамичное видео. Reference/preservation промпт держит товар.
import { extractJson } from "@/lib/factory/extractJson";

const QUEUE = "https://queue.fal.run/";

// каталог моделей: добавление нового движка/версии = строка здесь. Семейство (seedance*/kling*/pika*)
// определяет СХЕМУ входа (buildInput). pro-fast = в 3× дешевле для черновиков-ОТК.
export const FAL_VIDEO_MODELS = {
  kling: "fal-ai/kling-video/v2.1/standard/image-to-video", // $0.28/5с, держит форму
  kling_pro: "fal-ai/kling-video/v2.1/pro/image-to-video",  // жёсткие формы/лого лучше
  seedance: "fal-ai/bytedance/seedance/v1/pro/image-to-video", // динамика/движение камеры/мультисцена
  seedance_fast: "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video", // черновик, ×3 дешевле
  pika: "fal-ai/pika/v2.2/image-to-video", // мягкие сцены, живость
} as const;
export type FalVideoModel = keyof typeof FAL_VIDEO_MODELS;

// Полный набор настроек инструмента (вынесено в инспектор ноды §6 ТЗ — «всё открыто под капотом»).
export interface FalVideoOpts {
  duration?: string | number;   // seedance "2".."12" · kling "5"|"10"
  aspect?: string;              // "9:16" дефолт (БАГ фикс — seedance не слал → auto/не вертикаль)
  resolution?: string;          // "480p"|"720p"|"1080p" (seedance/pika)
  negative?: string;            // kling negative_prompt (анти-слоп, редактируемый)
  end_image_url?: string;       // seedance end_image_url / kling tail_image_url — before/after
  camera_fixed?: boolean;       // seedance — меньше искажений детальных товаров
  seed?: number;                // воспроизводимость (-1 = random)
  cfg_scale?: number;           // kling 0-1
  num_frames?: number;          // seedance 29-289 — ПЕРЕБИВАЕТ duration
  enable_safety_checker?: boolean; // seedance safety-чек
  endpoint?: string;            // прямой override эндпоинта (выбор pro/fast)
}

export interface FalSubmitResult {
  token: string | null;
  status?: number;
  reason?: string;
  detail?: string;
}

// важнейшие термины первыми (модель сильнее весит ранние). Маркеры AI-слопа из ресёрча 2026.
const DEFAULT_NEG = "mirrored text, warped label, deformed product, deformed packaging, melted edges, floating product, changed shape, morphing, distortion, blurry, low quality";

function key(): string | null { return process.env.FAL_KEY || null; }
function family(model: string): "seedance" | "kling" | "pika" { return model.startsWith("seedance") ? "seedance" : model.startsWith("pika") ? "pika" : "kling"; }

async function fetchFalBilling(k: string): Promise<{ balance: number | null; currency: string; raw?: unknown; error?: string }> {
  if (!k) return { balance: null, currency: "USD", error: "FAL_KEY не настроен" };
  try {
    const r = await fetch("https://api.fal.ai/v1/account/billing?expand=credits", { headers: { Authorization: `Key ${k}` }, cache: "no-store", signal: AbortSignal.timeout(15000) });
    const text = await r.text();
    const parsed = extractJson(text);
    const j = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    if (r.status === 401 || r.status === 403) return { balance: null, currency: "USD", error: "нужен admin-ключ (FAL_BILLING_KEY)", raw: j ?? text.slice(0, 200) };
    if (!r.ok || !j) return { balance: null, currency: "USD", error: `fal ${r.status}: ${text.slice(0, 140)}`, raw: j ?? text.slice(0, 200) };
    const credits = (j.credits && typeof j.credits === "object" ? j.credits : j) as Record<string, unknown>;
    const v = credits.current_balance ?? credits.balance ?? credits.amount ?? j.balance;
    const n = typeof v === "number" ? v : Number(v);
    const currency = (typeof credits.currency === "string" && credits.currency) || "USD";
    if (!Number.isFinite(n)) return { balance: null, currency, error: "поле баланса не найдено", raw: j };
    return { balance: n, currency, raw: j };
  } catch (e) { return { balance: null, currency: "USD", error: String(e).slice(0, 140) }; }
}

// Остаток баланса аккаунта FAL (GET https://api.fal.ai/v1/account/billing?expand=credits).
// ⚠️ Нужен ADMIN-ключ: обычный FAL_KEY → 403 authorization_error (проверено live). Владелец кладёт
// admin-ключ в FAL_BILLING_KEY (Vercel); без него фолбэк на FAL_KEY и честная ошибка «нужен admin-ключ».
// Ответ: { credits: { current_balance: number, currency: "USD" } } (поля при expand=credits).
export async function falBalance(): Promise<{ balance: number | null; currency: string; raw?: unknown; error?: string }> {
  const billingKey = process.env.FAL_BILLING_KEY || "";
  const renderKey = process.env.FAL_KEY || "";
  const primaryKey = billingKey || renderKey;
  if (!primaryKey) return { balance: null, currency: "USD", error: "FAL_KEY не настроен" };
  const primary = await fetchFalBilling(primaryKey);
  if (
    billingKey &&
    renderKey &&
    renderKey !== billingKey &&
    typeof primary.balance === "number" &&
    primary.balance <= 0
  ) {
    const renderAccount = await fetchFalBilling(renderKey);
    if (typeof renderAccount.balance === "number" && renderAccount.balance > 0) {
      return { ...renderAccount, raw: { source: "FAL_KEY", billing_key_balance: primary.balance, billing_key_raw: primary.raw, render_key_raw: renderAccount.raw } };
    }
  }
  return primary;
}

// у каждого СЕМЕЙСТВА своя схема входа — лишние поля дают 422. Условно шлём только заданные опции.
function buildInput(model: FalVideoModel, imageUrl: string, prompt: string, opts?: FalVideoOpts): Record<string, unknown> {
  const fam = family(model);
  if (fam === "seedance") {
    const inp: Record<string, unknown> = { image_url: imageUrl, prompt, resolution: opts?.resolution || process.env.FACTORY_I2V_RESOLUTION || "720p", aspect_ratio: opts?.aspect || "9:16", duration: String(opts?.duration ?? "5") };
    if (opts?.end_image_url) inp.end_image_url = opts.end_image_url;   // before/after (только pro)
    if (typeof opts?.camera_fixed === "boolean") inp.camera_fixed = opts.camera_fixed;
    if (typeof opts?.seed === "number") inp.seed = opts.seed;
    if (typeof opts?.num_frames === "number") inp.num_frames = opts.num_frames; // 29-289, перебивает duration
    if (typeof opts?.enable_safety_checker === "boolean") inp.enable_safety_checker = opts.enable_safety_checker;
    return inp;
  }
  if (fam === "pika") return { image_url: imageUrl, prompt, resolution: opts?.resolution || "720p", duration: Number(opts?.duration ?? 5) };
  // kling — богатый body (проверен): держит форму через preservation + negative
  const inp: Record<string, unknown> = { image_url: imageUrl, prompt, duration: String(opts?.duration === "10" || opts?.duration === 10 ? "10" : "5"), aspect_ratio: opts?.aspect || "9:16", negative_prompt: opts?.negative || DEFAULT_NEG, cfg_scale: typeof opts?.cfg_scale === "number" ? opts.cfg_scale : 0.5 };
  if (opts?.end_image_url) inp.tail_image_url = opts.end_image_url;
  return inp;
}

function falFailureReason(status: number): string {
  return status === 401 ? "ключ невалиден (FAL_KEY)"
    : status === 402 || status === 403 ? "БАЛАНС/ДОСТУП — пополни fal (User locked / Exhausted balance)"
    : status === 422 ? "схема запроса (неверное поле/значение модели)"
    : status === 429 ? "rate-limit (бэкпрешер) — повтор позже"
    : status >= 500 ? "fal 5xx (транзиент)"
    : "иная ошибка";
}

function extractFalVideoUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as {
    video?: { url?: unknown };
    video_url?: unknown;
    url?: unknown;
    output?: { url?: unknown } | unknown;
    result?: unknown;
  };
  const direct = typeof record.video?.url === "string" ? record.video.url
    : typeof record.video_url === "string" ? record.video_url
    : typeof record.url === "string" ? record.url
    : typeof record.output === "string" ? record.output
    : typeof record.output === "object" && record.output && typeof (record.output as { url?: unknown }).url === "string" ? (record.output as { url: string }).url
    : null;
  if (direct) return direct;
  return record.result ? extractFalVideoUrl(record.result) : null;
}

// Сабмит image-to-video с диагностикой. Токен = base64url от response_url.
export async function falVideoSubmitDetailed(model: FalVideoModel, imageUrl: string, prompt: string, opts?: FalVideoOpts): Promise<FalSubmitResult> {
  const k = key();
  if (!k) return { token: null, reason: "FAL_KEY не настроен" };
  const endpoint = opts?.endpoint || FAL_VIDEO_MODELS[model] || FAL_VIDEO_MODELS.kling;
  try {
    const r = await fetch(`${QUEUE}${endpoint}`, {
      method: "POST",
      // X-Fal-Request-Timeout — серверный дедлайн рендера (наш AbortSignal стопит только НАШ опрос, fal продолжал бы биллить)
      headers: { Authorization: `Key ${k}`, "Content-Type": "application/json", "X-Fal-Request-Timeout": "180" },
      cache: "no-store",
      body: JSON.stringify(buildInput(model, imageUrl, prompt, opts)),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      const reason = falFailureReason(r.status);
      const detail = body.slice(0, 240);
      console.warn(`[falVideoSubmit] ${model} → ${r.status} ${reason}: ${detail}`);
      return { token: null, status: r.status, reason, detail };
    }
    const j = (await r.json().catch(() => ({}))) as { response_url?: string };
    return { token: j.response_url ? Buffer.from(j.response_url).toString("base64url") : null, reason: j.response_url ? undefined : "fal submit без response_url" };
  } catch (e) {
    const reason = "сеть/таймаут";
    const detail = String(e).slice(0, 180);
    console.warn(`[falVideoSubmit] ${model} ${reason}: ${detail}`);
    return { token: null, reason, detail };
  }
}

// Обратная совместимость: старые роуты ждут только token/null.
export async function falVideoSubmit(model: FalVideoModel, imageUrl: string, prompt: string, opts?: FalVideoOpts): Promise<string | null> {
  const r = await falVideoSubmitDetailed(model, imageUrl, prompt, opts);
  return r.token;
}

// Серверный compose через fal-ai/ffmpeg-api/compose (НЕ браузер — отдаёт mp4, работает в батче).
// Слоит одновременные треки по таймлайну: видео + опц. прозрачный оверлей-PNG (хук-текст/субтитры,
// тип image) + опц. аудио (mp3 ElevenLabs). FAL_KEY (крипто) уже есть. ВНИМАНИЕ: поведение image-трека
// (наложение поверх видео с альфой) у fal недокументировано — нужен один живой смоук-тест (роут /api/factory/overlay).
export async function falCompose(
  videoUrl: string,
  opts: { overlayUrl?: string; audioUrl?: string; durationSec: number; maxWaitMs?: number },
): Promise<{ videoUrl?: string; responseUrl?: string; pending?: boolean; error?: string }> {
  const k = key();
  if (!k) return { error: "FAL_KEY не настроен" };
  const durMs = Math.max(1, Math.round(opts.durationSec || 5)) * 1000; // ⚠️ fal compose keyframes — в МИЛЛИСЕКУНДАХ (раньше слали секунды → клип 5мс = чёрный кадр)
  const auth = { Authorization: `Key ${k}` };

  const tracks: any[] = [{ id: "v", type: "video", keyframes: [{ timestamp: 0, duration: durMs, url: videoUrl }] }];
  // image-трек кладём ПОСЛЕ видео — оверлей поверх (z-order по порядку треков)
  if (opts.overlayUrl) tracks.push({ id: "o", type: "image", keyframes: [{ timestamp: 0, duration: durMs, url: opts.overlayUrl }] });
  if (opts.audioUrl) tracks.push({ id: "a", type: "audio", keyframes: [{ timestamp: 0, duration: durMs, url: opts.audioUrl }] });
  const deadline = Date.now() + (opts.maxWaitMs || 48000); // бюджет под 60с-функцию
  try {
    const sub = await fetch(`${QUEUE}fal-ai/ffmpeg-api/compose`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ tracks }), signal: AbortSignal.timeout(25000) });
    if (!sub.ok) return { error: `fal compose ${sub.status}` };
    const sj = (await sub.json()) as { response_url?: string };
    const responseUrl = sj.response_url;
    if (!responseUrl) return { error: "compose без response_url" };
    // опрос до готовности (compose быстрый, но async) — в пределах дедлайна
    while (Date.now() < deadline) {
      const st = await fetch(`${responseUrl}/status`, { headers: auth, cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (st.ok) { const s = (await st.json()) as { status?: string }; if (s.status === "COMPLETED") break; }
      await new Promise((r) => setTimeout(r, 3000 + Math.floor(Math.random() * 700)));
    }
    if (Date.now() >= deadline) return { pending: true, responseUrl, error: "compose still processing" };
    const res = await fetch(responseUrl, { headers: auth, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `compose result ${res.status}` };
    const rj = (await res.json()) as Record<string, unknown>;
    const url = extractFalVideoUrl(rj);
    return url ? { videoUrl: url } : { responseUrl, error: "compose без video_url" };
  } catch (e) { return { error: String(e).slice(0, 120) }; }
}

// Обратная совместимость: мукс голоса (ElevenLabs mp3) на ролик = compose без оверлея.
export async function falMux(videoUrl: string, audioUrl: string, durationSec: number): Promise<{ videoUrl?: string; error?: string }> {
  return falCompose(videoUrl, { audioUrl, durationSec });
}

// Таймлайн из нескольких клипов (видео ИЛИ статичных изображений) — для U2 гибридного монтажа.
// clips: [{url, type("video"|"image"), durationSec}] — склеиваем последовательно.
// type="image" → статичный кадр нужной длительности (не оверлей, а full-frame заглушка между клипами).
// В одну дорожку FAL получает несколько keyframes со смещениями → fal ffmpeg секвенирует их.
export interface FalTimelineClip { url: string; type: "video" | "image"; durationSec: number }
export async function falTimeline(
  clips: FalTimelineClip[],
  opts?: { audioUrl?: string; maxWaitMs?: number },
): Promise<{ videoUrl?: string; responseUrl?: string; pending?: boolean; error?: string }> {
  const k = key();
  if (!k) return { error: "FAL_KEY не настроен" };
  if (!clips.length) return { error: "пустой список клипов" };

  // Строим треки: видео-клипы → один video-трек с keyframes по таймлайну;
  // image-клипы выставляем как полноэкранные image-треки в нужный временной слот.
  // Полное наложение не то — FAL compose суммирует треки по z-order, а НЕ конкатенирует.
  // Поэтому используем один video-трек: video-клипы последовательно, image-клипы — отдельные image-треки
  // (видео-трек прерывается, image-трек «заполняет» паузу).
  const videoKeyframes: { timestamp: number; duration: number; url: string }[] = [];
  const imageKeyframes: { timestamp: number; duration: number; url: string }[] = [];
  let t = 0; // мс (fal compose keyframes — в МИЛЛИСЕКУНДАХ, не секундах)
  for (const clip of clips) {
    const d = Math.max(1, Math.round(clip.durationSec)) * 1000; // сек → мс
    if (clip.type === "video") videoKeyframes.push({ timestamp: t, duration: d, url: clip.url });
    else imageKeyframes.push({ timestamp: t, duration: d, url: clip.url });
    t += d;
  }
  const totalDur = t; // мс
  const auth = { Authorization: `Key ${k}` };

  const tracks: any[] = [];
  if (videoKeyframes.length) tracks.push({ id: "v", type: "video", keyframes: videoKeyframes });
  // каждый image-слот → отдельный image-трек (чтобы не перекрывались)
  imageKeyframes.forEach((kf, i) => tracks.push({ id: `img${i}`, type: "image", keyframes: [kf] }));
  if (opts?.audioUrl) tracks.push({ id: "a", type: "audio", keyframes: [{ timestamp: 0, duration: totalDur, url: opts.audioUrl }] });
  const deadline = Date.now() + (opts?.maxWaitMs || 55000);
  try {
    const sub = await fetch(`${QUEUE}fal-ai/ffmpeg-api/compose`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ tracks }), signal: AbortSignal.timeout(25000) });
    if (!sub.ok) return { error: `fal timeline compose ${sub.status}` };
    const sj = (await sub.json()) as { response_url?: string };
    const responseUrl = sj.response_url;
    if (!responseUrl) return { error: "timeline compose без response_url" };
    while (Date.now() < deadline) {
      const st = await fetch(`${responseUrl}/status`, { headers: auth, cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (st.ok) { const s = (await st.json()) as { status?: string }; if (s.status === "COMPLETED") break; }
      await new Promise((r) => setTimeout(r, 3000 + Math.floor(Math.random() * 700)));
    }
    if (Date.now() >= deadline) return { pending: true, responseUrl, error: "timeline compose still processing" };
    const res = await fetch(responseUrl, { headers: auth, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `timeline result ${res.status}` };
    const rj = (await res.json()) as Record<string, unknown>;
    const url = extractFalVideoUrl(rj);
    return url ? { videoUrl: url } : { responseUrl, error: "timeline без video_url" };
  } catch (e) { return { error: String(e).slice(0, 120) }; }
}

// общий poll очереди fal для utility-моделей (merge/subtitle): submit → status → result.video.url. Best-effort.
async function falQueueVideo(endpoint: string, body: Record<string, unknown>, maxWaitMs: number): Promise<{ result?: Record<string, unknown>; responseUrl?: string; pending?: boolean; error?: string }> {
  const k = key();
  if (!k) return { error: "FAL_KEY не настроен" };
  const auth = { Authorization: `Key ${k}` };
  const deadline = Date.now() + maxWaitMs;
  try {
    const sub = await fetch(`${QUEUE}${endpoint}`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
    if (!sub.ok) { const t = await sub.text().catch(() => ""); return { error: `fal ${endpoint.split("/").pop()} ${sub.status}: ${t.slice(0, 120)}` }; }
    const sj = (await sub.json()) as { response_url?: string };
    const responseUrl = sj.response_url;
    if (!responseUrl) return { error: "нет response_url" };
    while (Date.now() < deadline) {
      const st = await fetch(`${responseUrl}/status`, { headers: auth, cache: "no-store", signal: AbortSignal.timeout(15000) }).catch(() => null);
      if (st?.ok) { const s = (await st.json()) as { status?: string }; if (s.status === "COMPLETED") break; }
      await new Promise((r) => setTimeout(r, 3000 + Math.floor(Math.random() * 700)));
    }
    if (Date.now() >= deadline) return { pending: true, responseUrl, error: `${endpoint.split("/").pop() || "queue"} still processing` };
    const res = await fetch(responseUrl, { headers: auth, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `result ${res.status}` };
    return { result: (await res.json()) as Record<string, unknown>, responseUrl };
  } catch (e) { return { error: String(e).slice(0, 120) }; }
}

// #16 · конкатенация клипов с НОРМАЛИЗАЦИЕЙ fps/разрешения (compose их НЕ нормализует → смешанные seedance/kling
// клипы дрожат/леттербоксятся). fal-ai/ffmpeg-api/merge-videos: video_urls[] (по порядку) → video.url.
export async function falMergeVideos(
  videoUrls: string[],
  opts?: { resolution?: string; targetFps?: number; maxWaitMs?: number },
): Promise<{ videoUrl?: string; error?: string }> {
  if (!videoUrls.length) return { error: "пустой список видео" };
  const body: Record<string, unknown> = { video_urls: videoUrls, resolution: opts?.resolution || "portrait_16_9" };
  if (typeof opts?.targetFps === "number") body.target_fps = opts.targetFps;
  const r = await falQueueVideo("fal-ai/ffmpeg-api/merge-videos", body, opts?.maxWaitMs || 90000);
  if (r.error) return { error: r.error };
  const url = extractFalVideoUrl(r.result);
  return url ? { videoUrl: url } : { error: "merge без video.url" };
}

// #15 · авто-субтитры со словесной караоке-подсветкой, выжженные в видео (главный native-feel рывок для Reels/TikTok).
// fal-ai/workflow-utilities/auto-subtitle: video_url → video.url (+ words). Дефолты под наш стиль: RU, Montserrat,
// акцент-подсветка cyan, низ, анимация. Заменяет статичный PNG-капшен на word-level (compose-путь/полировка готового).
export async function falAutoSubtitle(
  videoUrl: string,
  opts?: { language?: string; fontName?: string; fontSize?: number; fontColor?: string; highlightColor?: string; position?: "top" | "center" | "bottom"; animation?: boolean; maxWaitMs?: number },
): Promise<{ videoUrl?: string; words?: unknown; responseUrl?: string; pending?: boolean; error?: string }> {
  if (!videoUrl) return { error: "нет video_url" };
  const body: Record<string, unknown> = {
    video_url: videoUrl,
    language: opts?.language || "ru",
    font_name: opts?.fontName || "Montserrat",
    font_size: opts?.fontSize ?? 84,
    font_color: opts?.fontColor || "white",
    highlight_color: opts?.highlightColor || "cyan", // караоке-подсветка в акцент канона
    position: opts?.position || "bottom",
    enable_animation: opts?.animation ?? true,
  };
  const r = await falQueueVideo("fal-ai/workflow-utilities/auto-subtitle", body, opts?.maxWaitMs || 120000);
  if (r.pending || !r.result) return { pending: r.pending, responseUrl: r.responseUrl, error: r.error };
  if (r.error) return { error: r.error };
  const url = extractFalVideoUrl(r.result);
  return url ? { videoUrl: url, words: r.result?.words, responseUrl: r.responseUrl } : { responseUrl: r.responseUrl, error: "auto-subtitle без video.url" };
}

// диагностика: сырой ответ FAL на сабмит (статус+тело) — понять 401(ключ)/402-403(баланс)/422(модель)
export async function falSubmitRaw(model: FalVideoModel, imageUrl: string, prompt: string): Promise<{ ok: boolean; status: number; body: string; hasKey: boolean }> {
  const k = key();
  if (!k) return { ok: false, status: 0, body: "FAL_KEY не настроен в env", hasKey: false };
  const endpoint = FAL_VIDEO_MODELS[model] || FAL_VIDEO_MODELS.kling;
  try {
    const r = await fetch(`${QUEUE}${endpoint}`, { method: "POST", headers: { Authorization: `Key ${k}`, "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify(buildInput(model, imageUrl, prompt)), signal: AbortSignal.timeout(25000) });
    const body = (await r.text()).slice(0, 300);
    return { ok: r.ok, status: r.status, body, hasKey: true };
  } catch (e) { return { ok: false, status: -1, body: String(e).slice(0, 200), hasKey: true }; }
}

export interface FalVideoStatus { status: "in_progress" | "done" | "error"; videoUrl?: string; error?: string }

export async function falVideoStatus(token: string): Promise<FalVideoStatus> {
  const k = key();
  if (!k) return { status: "error", error: "FAL_KEY не настроен" };
  let responseUrl: string;
  try { responseUrl = Buffer.from(token, "base64url").toString(); } catch { return { status: "error", error: "плохой токен" }; }
  if (!/^https:\/\/queue\.fal\.run\//.test(responseUrl)) return { status: "error", error: "плохой url" };
  const auth = { Authorization: `Key ${k}` };
  try {
    const st = await fetch(`${responseUrl}/status`, { headers: auth, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!st.ok) return { status: "error", error: `fal ${st.status}` };
    const sj = (await st.json()) as { status?: string };
    if (sj.status !== "COMPLETED") return { status: "in_progress" };
    const res = await fetch(responseUrl, { headers: auth, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const detail = body.slice(0, 140);
      // queue.fal иногда отдаёт COMPLETED на /status чуть раньше, чем result-ресурс реально созреет.
      // В этом окне /result может вернуть 404/409/422; трактуем как транзиент и даём graph-run дополлить.
      if (res.status === 404 || res.status === 409 || res.status === 422) {
        return { status: "in_progress", error: detail ? `fal result ${res.status}: ${detail}` : `fal result ${res.status}` };
      }
      return { status: "error", error: detail ? `fal result ${res.status}: ${detail}` : `fal result ${res.status}` };
    }
    // разные fal-модели кладут URL в разные поля: seedance → video.url, другие → url/video_url/output.url
    const rj = (await res.json()) as { detail?: string } & Record<string, unknown>;
    const url = extractFalVideoUrl(rj);
    return url ? { status: "done", videoUrl: url } : { status: "error", error: (rj.detail || "fal без видео").slice(0, 100) };
  } catch (e) { return { status: "error", error: String(e).slice(0, 100) }; }
}
