// fal.ai видео-движки (image-to-video) через queue API. Крипто-шлюз, ключ FAL_KEY уже в env.
// Премиум-маршрут: реальное фото товара → динамичное видео. Reference/preservation промпт держит товар.
const QUEUE = "https://queue.fal.run/";

// каталог моделей: добавление нового движка = строка здесь (как советует спек video-gen-system)
export const FAL_VIDEO_MODELS = {
  kling: "fal-ai/kling-video/v2.1/standard/image-to-video", // $0.28/5с, держит форму
  seedance: "fal-ai/bytedance/seedance/v1/pro/image-to-video", // сильна на текстуре/мультишоте
} as const;
export type FalVideoModel = keyof typeof FAL_VIDEO_MODELS;

function key(): string | null { return process.env.FAL_KEY || null; }

// Сабмит image-to-video. Возвращает токен (base64url от response_url) или null.
export async function falVideoSubmit(model: FalVideoModel, imageUrl: string, prompt: string, opts?: { duration?: "5" | "10"; aspect?: string; negative?: string }): Promise<string | null> {
  const k = key();
  if (!k) return null;
  const endpoint = FAL_VIDEO_MODELS[model] || FAL_VIDEO_MODELS.kling;
  try {
    const r = await fetch(`${QUEUE}${endpoint}`, {
      method: "POST", headers: { Authorization: `Key ${k}`, "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({
        image_url: imageUrl,
        prompt,
        duration: opts?.duration || "5",
        aspect_ratio: opts?.aspect || "9:16",
        negative_prompt: opts?.negative || "distortion, morphing, deformed product, changed shape, extra objects, blurry, low quality, warped label",
        cfg_scale: 0.5,
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { response_url?: string };
    return j.response_url ? Buffer.from(j.response_url).toString("base64url") : null;
  } catch { return null; }
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
