import { NextRequest, NextResponse } from "next/server";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HF_BASE = "https://platform.higgsfield.ai";
const SOUL_SUBMIT = `${HF_BASE}/v1/text2image/soul`;

const SLIDE_ROLE = [
  "обложка: крупный товар, цепляющий премиальный фон",
  "ключевая выгода: товар в применении, эмоция",
  "деталь и текстура крупным планом",
  "товар в интерьере/контексте использования",
  "преимущества: чистая инфо-сцена",
];

// Слайд воронки: Claude строит промпт (товар + единый лук) → Higgsfield рисует. Async → task_id = HF job id.
export async function POST(req: NextRequest) {
  const credentials = process.env.HF_CREDENTIALS;
  if (!credentials) return NextResponse.json({ detail: "HF_CREDENTIALS не настроен" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const idx = Number(body.slide_idx ?? 0);
  const role = SLIDE_ROLE[idx] ?? "продуктовая сцена для карточки";

  let prompt = `High-converting Wildberries product card, vertical 3:4, studio quality, ${role}. Keep the product realistic and intact.`;
  try {
    const client = await createClaudeClient();
    if (client) {
      const res = await client.messages.create({
        model: MODEL, max_tokens: 300,
        system: "You write ONE concise English image prompt for a marketplace product card slide. Keep the real product intact and truthful. Output ONLY the prompt.",
        messages: [{ role: "user", content: `Product: ${body.sku_name || body.sku_art || "product"}${body.sku_dims ? ` (${body.sku_dims})` : ""}. Slide role: ${role}. Unified look/wardrobe: ${body.funnel_wardrobe || "consistent clean premium style"}. Write the prompt.` }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
      if (t) prompt = t;
    }
  } catch { /* дефолтный промпт */ }

  const params: Record<string, unknown> = { prompt, width_and_height: "1536x2048", quality: "1080p", batch_size: 1 };
  const refImg = body.content_url || body.style_image_url || body.ref_url || (body.product_urls?.[0]);
  if (refImg && /^https?:\/\//.test(refImg)) params.image_reference = { type: "image_url", image_url: refImg };

  try {
    const r = await fetch(SOUL_SUBMIT, { method: "POST", headers: { Authorization: `Key ${credentials}`, "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ params }), signal: AbortSignal.timeout(25000) });
    if (!r.ok) return NextResponse.json({ detail: `Higgsfield ${r.status}: ${(await r.text()).slice(0, 150)}` }, { status: 502 });
    const j = (await r.json()) as { id?: string };
    if (!j.id) return NextResponse.json({ detail: "Higgsfield не вернул id" }, { status: 502 });
    return NextResponse.json({ task_id: j.id, slide_key: `slide_${idx + 1}` });
  } catch (e) {
    return NextResponse.json({ detail: String(e).slice(0, 120) }, { status: 502 });
  }
}
