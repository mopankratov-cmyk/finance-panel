import { NextRequest, NextResponse } from "next/server";
import { falPulidSubmit } from "@/lib/fal/pulid";

export const dynamic = "force-dynamic";

const HF_BASE = "https://platform.higgsfield.ai";
const SOUL_SUBMIT = `${HF_BASE}/v1/text2image/soul`;
const WH_BY_RATIO: Record<string, string> = {
  "3:4": "1536x2048",
  "1:1": "2048x2048",
  "9:16": "1152x2048",
  "16:9": "2048x1152",
  "4:3": "2048x1536",
};

// Лаборатория контента: сабмит задачи генерации изображения в Higgsfield Soul.
// Асинхронно — возвращаем task_id (= id job-set), UI поллит /api/lab/image-status/{id}.
export async function POST(request: NextRequest) {
  const credentials = process.env.HF_CREDENTIALS;
  if (!credentials) return NextResponse.json({ detail: "HF_CREDENTIALS не настроен" }, { status: 500 });
  const auth = { Authorization: `Key ${credentials}`, "Content-Type": "application/json" };

  const body = await request.json().catch(() => ({}));
  const prompt: string = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const aspect: string = typeof body.aspect_ratio === "string" ? body.aspect_ratio : "3:4";
  const referenceUrl: string | null = typeof body.reference_url === "string" ? body.reference_url : null;
  if (!prompt) return NextResponse.json({ detail: "Нет промпта" }, { status: 400 });

  // Если выбрана AI-модель (лицо) → fal FLUX-PuLID для консистентного лица. task_id с префиксом fal:
  const modelFace: string = typeof body.model_face_url === "string" ? body.model_face_url : "";
  if (modelFace && process.env.FAL_KEY) {
    const origin = new URL(request.url).origin;
    const faceAbs = modelFace.startsWith("/") ? origin + modelFace : modelFace;
    const reqId = await falPulidSubmit(prompt, faceAbs);
    if (reqId) return NextResponse.json({ task_id: `fal:${reqId}` });
    // если fal не ответил — падать не будем, уйдём в Higgsfield ниже
  }

  // resolution '4K' → 1080p×высокое; Higgsfield Soul использует quality-строку (известно-рабочее 1080p).
  const params: Record<string, unknown> = {
    prompt,
    width_and_height: WH_BY_RATIO[aspect] ?? WH_BY_RATIO["3:4"],
    quality: "1080p",
    batch_size: 1,
  };
  if (referenceUrl) params.image_reference = { type: "image_url", image_url: referenceUrl };

  try {
    const res = await fetch(SOUL_SUBMIT, { method: "POST", headers: auth, cache: "no-store", body: JSON.stringify({ params }), signal: AbortSignal.timeout(20000) });
    if (!res.ok) return NextResponse.json({ detail: `Higgsfield ${res.status}: ${(await res.text()).slice(0, 150)}` }, { status: 502 });
    const j = (await res.json()) as { id?: string };
    if (!j.id) return NextResponse.json({ detail: "Higgsfield не вернул id задачи" }, { status: 502 });
    return NextResponse.json({ task_id: j.id });
  } catch (e) {
    return NextResponse.json({ detail: String(e).slice(0, 120) }, { status: 502 });
  }
}
