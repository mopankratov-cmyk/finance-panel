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

const DEFAULT_NEG = "distortion, morphing, deformed product, changed shape, extra objects, blurry, low quality, warped label";

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

// Серверный мукс аудио+видео через fal-ai/ffmpeg-api/compose (НЕ браузер — отдаёт mp4, работает в батче).
// Инфра под голос (ElevenLabs): накладывает mp3 на готовый ролик. FAL_KEY (крипто) уже есть.
export async function falMux(videoUrl: string, audioUrl: string, durationSec: number): Promise<{ videoUrl?: string; error?: string }> {
  const k = key();
  if (!k) return { error: "FAL_KEY не настроен" };
  const dur = Math.max(1, Math.round(durationSec || 5));
  const auth = { Authorization: `Key ${k}` };
  const body = {
    tracks: [
      { id: "v", type: "video", keyframes: [{ timestamp: 0, duration: dur, url: videoUrl }] },
      { id: "a", type: "audio", keyframes: [{ timestamp: 0, duration: dur, url: audioUrl }] },
    ],
  };
  try {
    const sub = await fetch(`${QUEUE}fal-ai/ffmpeg-api/compose`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
    if (!sub.ok) return { error: `fal compose ${sub.status}` };
    const sj = (await sub.json()) as { response_url?: string };
    const responseUrl = sj.response_url;
    if (!responseUrl) return { error: "compose без response_url" };
    // опрос до готовности (мукс быстрый, но async)
    for (let i = 0; i < 30; i++) {
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
