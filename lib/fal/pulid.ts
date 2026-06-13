// fal.ai FLUX — генерация сцены с красивой AI-моделью (дефолтная модель fal, без face-референса).
// Queue API: submit → request_id → poll status → result. Нужен FAL_KEY.
const MODEL_ENDPOINT = "fal-ai/flux/dev";
const QUEUE = `https://queue.fal.run/${MODEL_ENDPOINT}`;

function key(): string | null { return process.env.FAL_KEY || null; }

// Сабмит генерации модели. faceUrl сейчас не используется (дефолтная модель fal), оставлен для совместимости.
export async function falPulidSubmit(prompt: string, _faceUrl?: string): Promise<string | null> {
  const k = key();
  if (!k) return null;
  // усиливаем промпт привлекательной моделью
  const full = `${prompt}. Featuring a beautiful professional female model, natural confident pose, photorealistic, high-end advertising look.`;
  try {
    const r = await fetch(QUEUE, {
      method: "POST", headers: { Authorization: `Key ${k}`, "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ prompt: full, image_size: "portrait_4_3", num_images: 1, enable_safety_checker: true }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { request_id?: string };
    return j.request_id ?? null;
  } catch { return null; }
}

export interface FalStatus { status: "in_progress" | "done" | "error"; imageUrl?: string; error?: string }

export async function falPulidStatus(requestId: string): Promise<FalStatus> {
  const k = key();
  if (!k) return { status: "error", error: "FAL_KEY не настроен" };
  const auth = { Authorization: `Key ${k}` };
  try {
    const st = await fetch(`${QUEUE}/requests/${requestId}/status`, { headers: auth, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!st.ok) return { status: "error", error: `fal ${st.status}` };
    const sj = (await st.json()) as { status?: string };
    if (sj.status !== "COMPLETED") return { status: "in_progress" };
    const res = await fetch(`${QUEUE}/requests/${requestId}`, { headers: auth, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { status: "error", error: `fal result ${res.status}` };
    const rj = (await res.json()) as { images?: { url: string }[]; detail?: string };
    const url = rj.images?.[0]?.url;
    return url ? { status: "done", imageUrl: url } : { status: "error", error: (rj.detail || "fal без результата").slice(0, 100) };
  } catch (e) { return { status: "error", error: String(e).slice(0, 100) }; }
}
