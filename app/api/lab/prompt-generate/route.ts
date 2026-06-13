import { NextRequest, NextResponse } from "next/server";
import { genLabPrompt } from "@/lib/lab/genPrompt";
import { newTaskId, putTask } from "@/lib/lab/promptStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Инициировать генерацию промпта. Claude быстрый → считаем синхронно, кладём в store, отдаём task_id.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = newTaskId();
  try {
    const { prompt, imagesTotal } = await genLabPrompt(body);
    if (!prompt) { putTask(id, { status: "error", error: "пустой промпт", createdAt: Date.now() }); return NextResponse.json({ detail: "пустой промпт" }, { status: 502 }); }
    putTask(id, { status: "done", prompt, audit: { prompt_words: prompt.split(/\s+/).length, images_total: imagesTotal }, createdAt: Date.now(), inputs: body });
    return NextResponse.json({ task_id: id });
  } catch (e) {
    putTask(id, { status: "error", error: String(e).slice(0, 200), createdAt: Date.now() });
    return NextResponse.json({ detail: String(e).slice(0, 200) }, { status: 502 });
  }
}
