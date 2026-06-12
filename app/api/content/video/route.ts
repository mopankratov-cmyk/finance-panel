import { NextRequest, NextResponse } from "next/server";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";
import { getWbCardImage } from "@/lib/wb/cardImage";
import type { Anthropic } from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HF_BASE = "https://platform.higgsfield.ai";
const VIDEO_SUBMIT = `${HF_BASE}/v1/image2video/dop`;

interface SoulJob {
  status: "queued" | "in_progress" | "completed" | "failed" | "nsfw";
  results: { raw?: { url: string }; min?: { url: string } } | null;
}
interface SoulJobSet {
  id: string;
  jobs: SoulJob[];
}

async function buildMotionPrompt(name: string, article: string): Promise<string> {
  const client = await createClaudeClient();
  if (!client) throw new Error("ANTHROPIC_API_KEY не настроен");
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system:
      "You write short English prompts for an image-to-video model that animates a product photo for a marketplace card: subtle cinematic camera motion (slow push-in, gentle orbit, parallax), keep the product centered and intact, soft studio feel. One sentence, output ONLY the prompt.",
    messages: [{ role: "user", content: `Product: ${name || article}. Write one image-to-video motion prompt.` }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();
}

export async function POST(request: NextRequest) {
  const credentials = process.env.HF_CREDENTIALS;
  if (!credentials) {
    return NextResponse.json({ error: "HF_CREDENTIALS не настроен" }, { status: 500 });
  }
  const auth = { Authorization: `Key ${credentials}`, "Content-Type": "application/json" };

  const b = await request.json().catch(() => ({}));
  const article: string = typeof b.article === "string" ? b.article : "";
  const name: string = typeof b.name === "string" ? b.name : "";
  const nmId: number | null = typeof b.nmId === "number" ? b.nmId : null;
  const imageUrl: string = typeof b.imageUrl === "string" ? b.imageUrl : "";
  let prompt: string = typeof b.prompt === "string" ? b.prompt : "";

  try {
    // источник кадра: переданный URL (например результат фото-генерации) или фото карточки
    let baseImage = imageUrl;
    if (!baseImage && nmId) baseImage = (await getWbCardImage(nmId)) ?? "";
    if (!baseImage) {
      return NextResponse.json({ error: "Нет исходного изображения (нужен nmId или imageUrl)" }, { status: 400 });
    }

    if (!prompt) prompt = await buildMotionPrompt(name, article);

    const submitRes = await fetch(VIDEO_SUBMIT, {
      method: "POST",
      headers: auth,
      cache: "no-store",
      body: JSON.stringify({
        params: {
          prompt,
          model: "dop-turbo",
          input_images: [{ type: "image_url", image_url: baseImage }],
        },
      }),
    });
    if (!submitRes.ok) {
      const text = await submitRes.text();
      return NextResponse.json({ error: `Higgsfield ${submitRes.status}: ${text.slice(0, 200)}`, prompt }, { status: 502 });
    }
    const submitted = (await submitRes.json()) as SoulJobSet;
    // видео рендерится дольше лимита функции → возвращаем id, статус опрашивает UI
    return NextResponse.json({ jobSetId: submitted.id, prompt, sourceImage: baseImage });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
