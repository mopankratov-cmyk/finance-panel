// fal.ai FLUX-PuLID — генерация с консистентным лицом модели по 1 фото-референсу.
// Queue API: submit → request_id → poll status → result. Нужен FAL_KEY.
const QUEUE = "https://queue.fal.run/fal-ai/flux-pulid";

function key(): string | null { return process.env.FAL_KEY || null; }

// Сабмит задачи. Возвращает request_id или null.
export async function falPulidSubmit(prompt: string, faceUrl: string): Promise<string | null> {
  const k = key();
  if (!k) return null;
  try {
    const r = await fetch(QUEUE, {
      method: "POST", headers: { Authorization: `Key ${k}`, "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ prompt, reference_image_url: faceUrl, image_size: "portrait_4_3", num_images: 1, enable_safety_checker: true }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { request_id?: string };
    return j.request_id ?? null;
  } catch { return null; }
}

export interface FalStatus { status: "in_progress" | "done" | "error"; imageUrl?: string; error?: string }

// Статус задачи fal по request_id.
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
    const rj = (await res.json()) as { images?: { url: string }[] };
    const url = rj.images?.[0]?.url;
    return url ? { status: "done", imageUrl: url } : { status: "error", error: "fal без результата" };
  } catch (e) { return { status: "error", error: String(e).slice(0, 100) }; }
}
