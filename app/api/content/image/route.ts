import { NextRequest, NextResponse } from "next/server";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";
import { getWbCardImage } from "@/lib/wb/cardImage";
import type { Anthropic } from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HF_BASE = "https://platform.higgsfield.ai";
// Higgsfield Soul — фирменная и более экономная по кредитам image-модель.
const SOUL_SUBMIT = `${HF_BASE}/v1/text2image/soul`;

// WB-карточки вертикальные 3:4. Soul принимает размер строкой ШxВ.
const DEFAULT_RATIO = "3:4";
const WH_BY_RATIO: Record<string, string> = {
  "3:4": "1536x2048",
  "1:1": "2048x2048",
  "9:16": "1152x2048",
};

interface SoulJob {
  status: "queued" | "in_progress" | "completed" | "failed" | "nsfw";
  results: { raw?: { url: string }; min?: { url: string } } | null;
}
interface SoulJobSet {
  id: string;
  jobs: SoulJob[];
}

// Просим Claude составить англоязычный фото-промпт.
// fromCard=true → промпт для image-to-image: сохранить сам товар, обновить сцену/фон.
async function buildImagePrompt(name: string, article: string, fromCard: boolean): Promise<string> {
  const client = await createClaudeClient();
  if (!client) throw new Error("ANTHROPIC_API_KEY не настроен");
  const system = fromCard
    ? "You write concise English prompts for an image-to-image model. A reference photo of the real product is provided — KEEP the exact product, its packaging, shape, colors and branding unchanged. Only restyle the scene: lighting, background, props, mood for a high-converting marketplace card. Output ONLY the prompt, no preamble."
    : "You write concise English prompts for a text-to-image model to produce clean, professional Wildberries marketplace product photos: studio lighting, neutral/white or soft contextual background, sharp focus, realistic, no text or watermarks, vertical product card composition. Output ONLY the prompt, no preamble.";
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system,
    messages: [
      {
        role: "user",
        content: `Product: ${name || article} (article ${article}). Write a single photographic prompt for a high-converting marketplace product shot.`,
      },
    ],
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
    return NextResponse.json(
      { error: "HF_CREDENTIALS не настроен (KEY_ID:KEY_SECRET из cloud.higgsfield.ai)" },
      { status: 500 },
    );
  }
  const auth = { Authorization: `Key ${credentials}`, "Content-Type": "application/json" };

  const body = await request.json().catch(() => ({}));
  const article: string = typeof body.article === "string" ? body.article : "";
  const name: string = typeof body.name === "string" ? body.name : "";
  const nmId: number | null = typeof body.nmId === "number" ? body.nmId : null;
  const fromCard: boolean = body.fromCard === true;
  const aspectRatio: string = typeof body.aspectRatio === "string" ? body.aspectRatio : DEFAULT_RATIO;
  let prompt: string = typeof body.prompt === "string" ? body.prompt : "";

  if (!prompt && !article && !name) {
    return NextResponse.json({ error: "Не указан товар или промпт" }, { status: 400 });
  }

  try {
    // image-to-image: фото из карточки WB как референс
    let referenceUrl: string | null = null;
    if (fromCard) {
      if (!nmId) {
        return NextResponse.json({ error: "Нет nm_id для фото из карточки" }, { status: 400 });
      }
      referenceUrl = await getWbCardImage(nmId);
      if (!referenceUrl) {
        return NextResponse.json({ error: "Не нашёл фото карточки WB для этого nm_id" }, { status: 404 });
      }
    }

    if (!prompt) prompt = await buildImagePrompt(name, article, fromCard);

    // 1) submit
    const params: Record<string, unknown> = {
      prompt,
      width_and_height: WH_BY_RATIO[aspectRatio] ?? WH_BY_RATIO[DEFAULT_RATIO],
      quality: "1080p",
      batch_size: 1,
    };
    if (referenceUrl) {
      params.image_reference = { type: "image_url", image_url: referenceUrl };
    }
    const submitRes = await fetch(SOUL_SUBMIT, {
      method: "POST",
      headers: auth,
      cache: "no-store",
      body: JSON.stringify({ params }),
    });
    if (!submitRes.ok) {
      const text = await submitRes.text();
      return NextResponse.json({ error: `Higgsfield ${submitRes.status}: ${text.slice(0, 150)}`, prompt }, { status: 502 });
    }
    const submitted = (await submitRes.json()) as SoulJobSet;

    // 2) poll job-set до готовности (в рамках лимита функции ~60с)
    let job: SoulJob | undefined = submitted.jobs?.[0];
    for (let i = 0; i < 17 && (!job || job.status === "queued" || job.status === "in_progress"); i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const pollRes = await fetch(`${HF_BASE}/v1/job-sets/${submitted.id}`, { headers: auth, cache: "no-store" });
      if (!pollRes.ok) continue;
      const js = (await pollRes.json()) as SoulJobSet;
      job = js.jobs?.[0];
    }

    if (!job || job.status !== "completed") {
      const reason = job?.status === "nsfw" ? "контент отклонён модерацией" : job?.status === "failed" ? "генерация не удалась" : "превышено время ожидания";
      return NextResponse.json({ error: `Higgsfield: ${reason}`, prompt }, { status: 502 });
    }

    const imageUrl = job.results?.raw?.url ?? job.results?.min?.url ?? null;
    if (!imageUrl) {
      return NextResponse.json({ error: "Higgsfield не вернул URL", prompt }, { status: 502 });
    }

    return NextResponse.json({ imageUrl, prompt, referenceUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
