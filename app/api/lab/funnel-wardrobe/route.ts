import { NextRequest, NextResponse } from "next/server";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Лу проектирует единый «лук» (стиль/палитра/фон) для всей воронки — для консистентности слайдов.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    const client = await createClaudeClient();
    if (!client) return NextResponse.json({ ok: false, error: "ANTHROPIC_API_KEY не настроен" });
    const parts: ({ type: "text"; text: string } | { type: "image"; source: { type: "url"; url: string } })[] = [];
    if (body.style_image_url && /^https?:\/\//.test(body.style_image_url)) parts.push({ type: "image", source: { type: "url", url: body.style_image_url } });
    for (const u of (body.ref_urls || []).slice(0, 3)) if (/^https?:\/\//.test(u)) parts.push({ type: "image", source: { type: "url", url: u } });
    parts.push({ type: "text", text: `Товар: ${body.sku_name || body.sku_art || "товар"}${body.model_name ? `, модель: ${body.model_name}` : ""}. На основе референсов опиши ЕДИНЫЙ лук для всех слайдов воронки: палитра, освещение, фон, настроение, props. Кратко, одним абзацем (English ok). Это будет передано как стиль во все слайды.` });
    const res = await client.messages.create({
      model: MODEL, max_tokens: 300,
      system: "You define a consistent visual wardrobe/look for a marketplace funnel (palette, lighting, background, mood, props) so all slides match. Output ONE concise paragraph, no preamble.",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: "user", content: parts as any }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wardrobe = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    return wardrobe ? NextResponse.json({ ok: true, wardrobe }) : NextResponse.json({ ok: false, error: "пусто" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).slice(0, 120) });
  }
}
