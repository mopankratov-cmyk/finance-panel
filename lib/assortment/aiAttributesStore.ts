import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ANTHROPIC_MODEL } from "@/lib/ai/models";
import { AI_META_KEY, aiPrompt, mergeAiAttributes, parseAiAttributes } from "./aiAttributes";
import type { Attributes } from "./attributes";
import type { AssortmentDirection } from "./constants";
import { RU_SOURCE_IDS } from "./ruMarket";
import { signedUrls } from "./storage";

export class AiAttributesUnavailableError extends Error {}

export function aiAttributesConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.POLZA_API_KEY || process.env.POLZA_AI_API_KEY);
}

async function askAnthropic(direction: AssortmentDirection, imageUrls: string[]): Promise<{ text: string; model: string }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 55_000, maxRetries: 0 });
  const content: Anthropic.MessageCreateParams["messages"][number]["content"] = imageUrls.map((url) => ({ type: "image" as const, source: { type: "url" as const, url } }));
  content.push({ type: "text", text: "Опиши признаки по этим фото." });
  // Opus 5 не принимает temperature (см. lib/loans/aiRecognition.ts).
  const response = await client.messages.create({ model: ANTHROPIC_MODEL, max_tokens: 1200, system: aiPrompt(direction), messages: [{ role: "user", content }] });
  return { text: response.content.filter((c) => c.type === "text").map((c) => c.text).join("\n"), model: ANTHROPIC_MODEL };
}

async function askPolza(direction: AssortmentDirection, imageUrls: string[]): Promise<{ text: string; model: string }> {
  const model = process.env.POLZA_MODEL || "openai/gpt-4o";
  const response = await fetch("https://polza.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.POLZA_API_KEY || process.env.POLZA_AI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: aiPrompt(direction) },
        { role: "user", content: [{ type: "text", text: "Опиши признаки по этим фото." }, ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } }))] },
      ],
    }),
    signal: AbortSignal.timeout(55_000),
  });
  const payload = (await response.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message || `Polza вернула ошибку ${response.status}`);
  return { text: payload?.choices?.[0]?.message?.content ?? "", model: `polza:${model}` };
}

/** Основной провайдер — Anthropic, резерв — Polza (как у распознавания договоров). */
async function askModel(direction: AssortmentDirection, imageUrls: string[]): Promise<{ text: string; model: string }> {
  let primaryError = "";
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await askAnthropic(direction, imageUrls);
    } catch (error) {
      primaryError = error instanceof Error ? error.message : "ошибка Anthropic";
    }
  }
  if (process.env.POLZA_API_KEY || process.env.POLZA_AI_API_KEY) {
    try {
      return await askPolza(direction, imageUrls);
    } catch (error) {
      throw new AiAttributesUnavailableError(`ИИ не ответил: Anthropic — ${primaryError || "нет ключа"}; Polza — ${error instanceof Error ? error.message : "ошибка"}`);
    }
  }
  throw new AiAttributesUnavailableError(primaryError ? `ИИ не ответил: ${primaryError}` : "ИИ не подключён: нет ключей Anthropic и Polza");
}

/** Оценить признаки одной модели по первым двум фото. */
export async function estimateAttributes(db: SupabaseClient, referenceId: string): Promise<{ filled: string[]; model: string } | null> {
  const { data: ref, error } = await db.from("assortment_references").select("id,direction,attributes,version").eq("id", referenceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!ref) return null;
  const { data: media } = await db.from("assortment_media").select("storage_path,position").eq("reference_id", referenceId).order("position", { ascending: true }).limit(2);
  const paths = (media ?? []).map((m) => String(m.storage_path)).filter(Boolean);
  if (paths.length === 0) return null;
  const urls = await signedUrls(db, paths);
  const imageUrls = paths.map((p) => urls.get(p)).filter((u): u is string => Boolean(u));
  if (imageUrls.length === 0) return null;

  const direction = ref.direction as AssortmentDirection;
  const answer = await askModel(direction, imageUrls);
  const estimate = parseAiAttributes(direction, answer.text);
  const { attributes, filled } = mergeAiAttributes((ref.attributes ?? {}) as Attributes, estimate, answer.model, new Date().toISOString());
  const { data: updated, error: updateError } = await db.from("assortment_references")
    .update({ attributes, version: Number(ref.version) + 1, updated_at: new Date().toISOString() })
    .eq("id", referenceId).eq("version", ref.version).select("id");
  if (updateError) throw new Error(updateError.message);
  if (!updated || updated.length === 0) return null; // карточку правили одновременно — оценим в следующий раз
  return { filled, model: answer.model };
}

/** Модели с фото, которые ИИ ещё не разбирал: свежие сначала. */
export async function pendingForAi(db: SupabaseClient, limit: number): Promise<string[]> {
  // Находка без фото ИИ-отметку не получает (оценивать нечего) и остаётся в голове очереди каждый день: берём не одну страницу
  // «60 самых новых», а листаем дальше, пока не наберётся limit находок с фото, — иначе фото-less новички выедали бы лимит впустую.
  const PAGE = Math.max(limit * 3, 30);
  const MAX_PAGES = 8;
  const picked: string[] = [];
  for (let page = 0; page < MAX_PAGES && picked.length < limit; page += 1) {
    const { data, error } = await db.from("assortment_references")
      .select("id")
      .is(`attributes->${AI_META_KEY}`, null)
      .not("status", "in", "(rejected,archived)")
      // Топ WB и Lime — ориентир рынка, а не референс: ИИ на них не тратим.
      .or(`source_id.is.null,source_id.not.in.(${RU_SOURCE_IDS.join(",")})`)
      .order("first_seen_at", { ascending: false })
      .order("id", { ascending: true })
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) throw new Error(error.message);
    const ids = (data ?? []).map((r) => String(r.id));
    if (ids.length === 0) break;
    const { data: media, error: mediaError } = await db.from("assortment_media").select("reference_id").in("reference_id", ids);
    if (mediaError) throw new Error(mediaError.message);
    const withPhotos = new Set((media ?? []).map((m) => String(m.reference_id)));
    for (const id of ids) if (withPhotos.has(id) && picked.length < limit) picked.push(id);
    if (ids.length < PAGE) break;
  }
  return picked;
}
