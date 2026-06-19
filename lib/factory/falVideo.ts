// fal.ai видео-движки (image-to-video) через queue API. Крипто-шлюз, ключ FAL_KEY уже в env.
// Премиум-маршрут: реальное фото товара → динамичное видео. Reference/preservation промпт держит товар.
const QUEUE = "https://queue.fal.run/";

// каталог моделей: добавление нового движка = строка здесь (как советует спек video-gen-system)
export const FAL_VIDEO_MODELS = {
  kling: "fal-ai/kling-video/v2.1/standard/image-to-video", // $0.28/5с, держит форму — жёсткие формы
  seedance: "fal-ai/bytedance/seedance/v1/pro/image-to-video", // динамика/движение камеры/мультисцена
  pika: "fal-ai/pika/v2.2/image-to-video", // мягкие сцены, руки-в-кадре, живость
} as const;
export type FalVideoModel = keyof typeof FAL_VIDEO_MODELS;

// важнейшие термины первыми (модель сильнее весит ранние). Маркеры AI-слопа из ресёрча 2026.
const DEFAULT_NEG = "mirrored text, warped label, deformed product, deformed packaging, melted edges, floating product, changed shape, morphing, distortion, blurry, low quality";

function key(): string | null { return process.env.FAL_KEY || null; }

// у каждого движка СВОЯ схема входа — отправка лишних полей (cfg_scale/negative для seedance/pika) даёт 422.
function buildInput(model: FalVideoModel, imageUrl: string, prompt: string, opts?: { duration?: "5" | "10"; aspect?: string; negative?: string }): Record<string, unknown> {
  const dur = opts?.duration === "10" ? "10" : "5";
  if (model === "seedance") return { image_url: imageUrl, prompt, resolution: "720p", duration: dur };
  if (model === "pika") return { image_url: imageUrl, prompt, resolution: "720p", duration: Number(dur) };
  // kling — богатый body (проверен): держит форму через preservation + negative
  return { image_url: imageUrl, prompt, duration: dur, aspect_ratio: opts?.aspect || "9:16", negative_prompt: opts?.negative || DEFAULT_NEG, cfg_scale: 0.5 };
}

// Сабмит image-to-video. Возвращает токен (base64url от response_url) или null.
export async function falVideoSubmit(model: FalVideoModel, imageUrl: string, prompt: string, opts?: { duration?: "5" | "10"; aspect?: string; negative?: string }): Promise<string | null> {
  const k = key();
  if (!k) return null;
  const endpoint = FAL_VIDEO_MODELS[model] || FAL_VIDEO_MODELS.kling;
  try {
    const r = await fetch(`${QUEUE}${endpoint}`, {
      method: "POST", headers: { Authorization: `Key ${k}`, "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify(buildInput(model, imageUrl, prompt, opts)),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { response_url?: string };
    return j.response_url ? Buffer.from(j.response_url).toString("base64url") : null;
  } catch { return null; }
}

// Серверный compose через fal-ai/ffmpeg-api/compose (НЕ браузер — отдаёт mp4, работает в батче).
// Слоит одновременные треки по таймлайну: видео + опц. прозрачный оверлей-PNG (хук-текст/субтитры,
// тип image) + опц. аудио (mp3 ElevenLabs). FAL_KEY (крипто) уже есть. ВНИМАНИЕ: поведение image-трека
// (наложение поверх видео с альфой) у fal недокументировано — нужен один живой смоук-тест (роут /api/factory/overlay).
export async function falCompose(
  videoUrl: string,
  opts: { overlayUrl?: string; audioUrl?: string; durationSec: number; maxWaitMs?: number },
): Promise<{ videoUrl?: string; error?: string }> {
  const k = key();
  if (!k) return { error: "FAL_KEY не настроен" };
  const dur = Math.max(1, Math.round(opts.durationSec || 5));
  const auth = { Authorization: `Key ${k}` };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tracks: any[] = [{ id: "v", type: "video", keyframes: [{ timestamp: 0, duration: dur, url: videoUrl }] }];
  // image-трек кладём ПОСЛЕ видео — оверлей поверх (z-order по порядку треков)
  if (opts.overlayUrl) tracks.push({ id: "o", type: "image", keyframes: [{ timestamp: 0, duration: dur, url: opts.overlayUrl }] });
  if (opts.audioUrl) tracks.push({ id: "a", type: "audio", keyframes: [{ timestamp: 0, duration: dur, url: opts.audioUrl }] });
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
      await new Promise((r) => setTimeout(r, 3000));
    }
    const res = await fetch(responseUrl, { headers: auth, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `compose result ${res.status}` };
    const rj = (await res.json()) as { video_url?: string };
    return rj.video_url ? { videoUrl: rj.video_url } : { error: "compose без video_url" };
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
): Promise<{ videoUrl?: string; error?: string }> {
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
  let t = 0;
  for (const clip of clips) {
    const d = Math.max(1, Math.round(clip.durationSec));
    if (clip.type === "video") videoKeyframes.push({ timestamp: t, duration: d, url: clip.url });
    else imageKeyframes.push({ timestamp: t, duration: d, url: clip.url });
    t += d;
  }
  const totalDur = t;
  const auth = { Authorization: `Key ${k}` };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      await new Promise((r) => setTimeout(r, 3000));
    }
    const res = await fetch(responseUrl, { headers: auth, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `timeline result ${res.status}` };
    const rj = (await res.json()) as { video_url?: string };
    return rj.video_url ? { videoUrl: rj.video_url } : { error: "timeline без video_url" };
  } catch (e) { return { error: String(e).slice(0, 120) }; }
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
    if (!res.ok) return { status: "error", error: `fal result ${res.status}` };
    const rj = (await res.json()) as { video?: { url?: string }; detail?: string };
    const url = rj.video?.url;
    return url ? { status: "done", videoUrl: url } : { status: "error", error: (rj.detail || "fal без видео").slice(0, 100) };
  } catch (e) { return { status: "error", error: String(e).slice(0, 100) }; }
}
