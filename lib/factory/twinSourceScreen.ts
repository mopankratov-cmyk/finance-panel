import sharp from "sharp";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";
import { extractJson } from "./extractJson";

// Vision-скрин кандидата в исходники твина ДО сборки. Ловит два класса брака,
// из-за которых твины выдумывали детали (аудит 2026-07-02):
// 1) карточки маркетплейса с вшитым текстом/плашками/стрелками;
// 2) AI-рендеры товара, замешанные в съёмку (другой силуэт/длина).
// Fail-open: без ключа кандидат пропускается с пометкой, сборку не валим —
// последним рубежом стоит identity-сверка после сборки.

export interface TwinSourceScreenResult {
  ran: boolean;
  ok: boolean;
  role?: string;
  bakedText?: boolean;
  renderSuspect?: boolean;
  reasons: string[];
  error?: string;
}

export async function screenTwinSourceCandidate(input: {
  buffer: Buffer;
  article: string;
  product: string;
  category: string;
}): Promise<TwinSourceScreenResult> {
  const client = await createClaudeClient();
  if (!client) return { ran: false, ok: true, reasons: [], error: "ANTHROPIC_API_KEY отсутствует — скрин исходника пропущен" };
  try {
    const jpeg = await sharp(input.buffer)
      .resize(768, 768, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    const sys = [
      "Ты ОТК исходников для цифровых твинов товара. Смотри на кадр и реши, годится ли он как исходник:",
      "исходник обязан быть реальным фото товара (перёд/три четверти), товар целиком, не перекрыт руками/предметами, БЕЗ вшитого текста, плашек, галок, стрелок, логотипов вне товара.",
      "Также определи, не похож ли кадр на AI-рендер (пластиковая фактура, неестественные тени, нефизичная геометрия).",
      "Верни строго JSON {\"ok\":true|false,\"role\":\"front|three_quarter|side|back|macro|on_model|infographic|cover|other\",\"baked_text\":true|false,\"render_suspect\":true|false,\"reasons\":[\"...\"]}.",
      "ok=false если есть вшитый текст/плашки, товар перекрыт или это подозрение на рендер. reasons по-русски.",
    ].join(" ");
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      temperature: 0,
      system: sys,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `Товар: ${input.article} · ${input.product} · категория ${input.category}. Кандидат в исходники твина:` },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } },
        ],
      }],
    });
    const txt = (res.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text").map((b) => b.text || "").join(" ").trim();
    const parsed = extractJson(txt) as { ok?: boolean; role?: string; baked_text?: boolean; render_suspect?: boolean; reasons?: unknown[] } | null;
    if (!parsed || typeof parsed.ok !== "boolean") return { ran: false, ok: true, reasons: [], error: "скрин вернул нечитаемый ответ" };
    return {
      ran: true,
      ok: parsed.ok === true,
      role: String(parsed.role || "other"),
      bakedText: parsed.baked_text === true,
      renderSuspect: parsed.render_suspect === true,
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map((r) => String(r).slice(0, 160)).slice(0, 6) : [],
    };
  } catch (e) {
    return { ran: false, ok: true, reasons: [], error: String((e as Error)?.message || e).slice(0, 160) };
  }
}
