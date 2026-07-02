import sharp from "sharp";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";
import { extractJson } from "./extractJson";

// Identity-сверка «реальное фото vs AI-твин» в цикле сборки твина.
// Урок аудита 2026-07-02: техскор кадра не ловит подмену материала/цвета/длины/фурнитуры —
// нужен vision-судья до выдачи твина в конвейер. Fail-open: без ключа сборка не падает,
// но результат помечается как непроверенный.

export interface TwinIdentityCheckResult {
  ran: boolean;
  verdict?: "pass" | "warn" | "fail";
  reasons: string[];
  error?: string;
}

async function toJpegBase64(input: Buffer): Promise<string> {
  const buf = await sharp(input)
    .resize(768, 768, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return buf.toString("base64");
}

export async function checkTwinIdentity(input: {
  sourceBuffer: Buffer;
  twinBuffer: Buffer;
  article: string;
  product: string;
  category: string;
}): Promise<TwinIdentityCheckResult> {
  const client = await createClaudeClient();
  if (!client) return { ran: false, reasons: [], error: "ANTHROPIC_API_KEY отсутствует — identity-сверка пропущена" };
  try {
    const [src, twin] = await Promise.all([toJpegBase64(input.sourceBuffer), toJpegBase64(input.twinBuffer)]);
    const sys = [
      "Ты ОТК цифровых твинов товара для маркетплейса. Кадр 1 — реальное фото товара со съёмки, кадр 2 — AI-твин.",
      "Игнорируй фон, паспарту, подписи, инфографику, тени, модель и ракурс.",
      "Сверь атрибуты САМОГО товара: силуэт и пропорции (длина одежды!), материал и фактуру поверхности (замша/кожа/ткань, гладкая/зернистая), цвет, фурнитуру и цвет металла, ремни/лямки/ручки, карманы, строчку, лого и шильдики.",
      "Верни строго JSON {\"verdict\":\"pass|warn|fail\",\"reasons\":[\"...\"]}.",
      "fail — покупатель получит не тот товар, что видит (другой материал/цвет/длина/фурнитура/выдуманные детали).",
      "warn — мелкие расхождения, которые заметны только при увеличении.",
      "pass — товар соответствует. reasons пиши по-русски и конкретно.",
    ].join(" ");
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      temperature: 0,
      system: sys,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `Товар: ${input.article} · ${input.product} · категория ${input.category}. Кадр 1 — оригинал съёмки:` },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: src } },
          { type: "text", text: "Кадр 2 — AI-твин:" },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: twin } },
        ],
      }],
    });
    const txt = (res.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text || "")
      .join(" ")
      .trim();
    const parsed = extractJson(txt) as { verdict?: string; reasons?: unknown[] } | null;
    const verdict = parsed?.verdict === "pass" || parsed?.verdict === "warn" || parsed?.verdict === "fail" ? parsed.verdict : undefined;
    if (!verdict) return { ran: false, reasons: [], error: "identity-сверка вернула нечитаемый ответ" };
    const reasons = Array.isArray(parsed?.reasons) ? parsed.reasons.map((r) => String(r).slice(0, 200)).filter(Boolean).slice(0, 8) : [];
    return { ran: true, verdict, reasons };
  } catch (e) {
    return { ran: false, reasons: [], error: String((e as Error)?.message || e).slice(0, 160) };
  }
}
