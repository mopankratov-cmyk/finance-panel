import { NextResponse } from "next/server";
import { genLabPrompt, type GenPromptInput } from "@/lib/lab/genPrompt";
import { newTaskId, putTask, getTask } from "@/lib/lab/promptStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Перегенерация промпта по id предыдущей задачи (берём её inputs, просим Лу сделать иначе).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: prevId } = await ctx.params;
  const prev = getTask(prevId);
  if (!prev?.inputs) return NextResponse.json({ detail: "нет данных предыдущей задачи" }, { status: 404 });
  const inputs = { ...(prev.inputs as GenPromptInput), prev_prompt: prev.prompt || "", corrections: "make it visually different — new angle, lighting and scene" };
  const id = newTaskId();
  try {
    const { prompt, imagesTotal } = await genLabPrompt(inputs);
    putTask(id, { status: "done", prompt, audit: { prompt_words: prompt.split(/\s+/).length, images_total: imagesTotal }, createdAt: Date.now(), inputs });
    return NextResponse.json({ task_id: id });
  } catch (e) {
    putTask(id, { status: "error", error: String(e).slice(0, 200), createdAt: Date.now() });
    return NextResponse.json({ detail: String(e).slice(0, 200) }, { status: 502 });
  }
}
