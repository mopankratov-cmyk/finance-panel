import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";
import { yaList, yaDownloadHref } from "@/lib/yandex/disk";

type ImgBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string } };

async function fetchB64(url: string): Promise<ImgBlock | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const media = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
    if (!/^image\//.test(media)) return null;
    return { type: "image", source: { type: "base64", media_type: media, data: buf.toString("base64") } };
  } catch { return null; }
}

export interface GenPromptInput {
  sku_folder_id?: string; sku_name?: string; sku_dims?: string; sku_art?: string;
  refs?: { src?: string }[]; model_name?: string; user_prompt?: string;
  corrections?: string; prev_prompt?: string;
}

// Собирает промпт для Higgsfield: фото товара (Яндекс) + референсы → Claude vision → англ. промпт.
export async function genLabPrompt(inp: GenPromptInput): Promise<{ prompt: string; imagesTotal: number }> {
  const client = await createClaudeClient();
  if (!client) throw new Error("ANTHROPIC_API_KEY не настроен");

  const productBlocks: ImgBlock[] = [];
  // фото товара из папки Яндекса (до 4)
  if (inp.sku_folder_id) {
    let path = "";
    try { path = Buffer.from(inp.sku_folder_id, "base64url").toString(); } catch { path = ""; }
    if (path) {
      const imgs = (await yaList(path)).filter((f) => f.isImage).slice(0, 4);
      for (const im of imgs) {
        const href = await yaDownloadHref(im.path);
        if (href) { const b = await fetchB64(href); if (b) productBlocks.push(b); }
      }
    }
  }
  // референсы (до 4): data-url → base64, http → url
  const refBlocks: ImgBlock[] = [];
  for (const ref of (inp.refs ?? []).slice(0, 4)) {
    const src = ref.src || "";
    if (src.startsWith("data:image")) {
      const m = src.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
      if (m) refBlocks.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
    } else if (/^https?:\/\//.test(src)) {
      refBlocks.push({ type: "image", source: { type: "url", url: src } });
    }
  }

  const sys = "You are a senior creative director writing ONE English prompt for an image-to-image generator (Higgsfield Soul) to produce a high-converting Wildberries marketplace product card. " +
    "RULES (critical): KEEP the real product EXACTLY as in the product photos — its shape, proportions, packaging, colors, logos and branding must stay unchanged and truthful (never misrepresent size/dimensions). " +
    "Use the REFERENCE images only for scene style: lighting, background, mood, props, composition. " +
    "Vertical 3:4 card, studio quality, sharp, realistic, no text/watermarks. Output ONLY the prompt text, no preamble, no quotes.";

  const parts: ({ type: "text"; text: string } | ImgBlock)[] = [];
  if (productBlocks.length) { parts.push({ type: "text", text: `PRODUCT photos (keep exactly) — ${inp.sku_name || inp.sku_art || "product"}${inp.sku_dims ? `, dimensions: ${inp.sku_dims}` : ""}:` }); parts.push(...productBlocks); }
  if (refBlocks.length) { parts.push({ type: "text", text: "STYLE REFERENCE images (use for mood/scene only):" }); parts.push(...refBlocks); }
  const extra = [inp.model_name ? `Model/character vibe: ${inp.model_name}.` : "", inp.user_prompt ? `User wish: ${inp.user_prompt}.` : "", inp.corrections ? `Apply corrections to previous: ${inp.corrections}.` : "", inp.prev_prompt ? `Previous prompt (vary meaningfully): ${inp.prev_prompt}` : ""].filter(Boolean).join(" ");
  parts.push({ type: "text", text: (extra || "Write the single best prompt.") + " Now write the single image-to-image prompt." });

  const res = await client.messages.create({
    model: MODEL, max_tokens: 400,
    system: sys,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: [{ role: "user", content: parts as any }],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prompt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
  return { prompt, imagesTotal: productBlocks.length + refBlocks.length };
}
