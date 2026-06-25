// V24 · openreels бренд-кит: структурные ПРОИЗВОДСТВЕННЫЕ пресеты бренда (голос/персона/шаблон/музыка/
// шрифт/цвет/CTA/бан-слова/хэштеги). resolveBrandKit тянет кит по товару (detectBrand → brand_kits).
// applyKitToParams накладывает фикс-айдентику на params ноды (бренд всегда своим голосом/шрифтом/цветом).
// brandKitPromptBlock даёт текст-инструкцию для system-промпта (CTA/бан/хэштеги). Дополняет brandProfiles.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectBrand } from "./brandProfiles";

export interface BrandKit {
  brand: string;
  niche?: string | null;
  voice_id?: string | null;
  persona_id?: string | null;
  visual_style?: string | null;
  music_url?: string | null;
  caption_font?: string | null;
  caption_color?: string | null;
  caption_highlight?: string | null;
  cta?: string | null;
  ban_words: string[];
  hashtags: string[];
  notes?: string | null;
}


function rowToKit(r: Record<string, any>): BrandKit {
  return {
    brand: String(r.brand || ""), niche: r.niche ?? null,
    voice_id: r.voice_id ?? null, persona_id: r.persona_id ?? null, visual_style: r.visual_style ?? null, music_url: r.music_url ?? null,
    caption_font: r.caption_font ?? null, caption_color: r.caption_color ?? null, caption_highlight: r.caption_highlight ?? null,
    cta: r.cta ?? null,
    ban_words: Array.isArray(r.ban_words) ? r.ban_words.map((x: unknown) => String(x)).filter(Boolean) : [],
    hashtags: Array.isArray(r.hashtags) ? r.hashtags.map((x: unknown) => String(x)).filter(Boolean) : [],
    notes: r.notes ?? null,
  };
}

// Кит по товару: detectBrand → строка brand_kits. null = бренд не распознан или кит не заведён → autofill как раньше.
export async function resolveBrandKit(db: SupabaseClient, article: string, name = ""): Promise<BrandKit | null> {
  const brand = detectBrand(article || "", name || "");
  if (!brand) return null;
  try {
    const { data } = await db.from("brand_kits").select("*").eq("brand", brand).limit(1);
    const row = (data as Record<string, unknown>[] | null)?.[0];
    return row ? rowToKit(row) : null;
  } catch { return null; } // таблица не применена / best-effort
}

// Накладываем брендовую айдентику на params ноды — ТОЛЬКО релевантные движку поля (creatify: голос/персона/
// стиль/музыка + caption_setting.*; shotstack: font.*). Не лезем в seedance/disk_real (там нет брендовых полей)
// — иначе normalizeParams завалит вывод варнингами «движок не знает поле». Только заданные поля кита.
export function applyKitToParams(tool: string, params: Record<string, unknown>, kit: BrandKit | null): Record<string, unknown> {
  if (!kit) return params;
  const p = { ...params };
  if (tool === "creatify") {
    if (kit.voice_id) p.override_voice = kit.voice_id;
    if (kit.persona_id) p.override_avatar = kit.persona_id;
    if (kit.visual_style) p.visual_style = kit.visual_style;
    if (kit.music_url) p.background_music_url = kit.music_url;
    if (kit.caption_font) p["caption_setting.font_family"] = kit.caption_font;
    if (kit.caption_color) p["caption_setting.text_color"] = kit.caption_color;
    if (kit.caption_highlight) p["caption_setting.highlight_text_color"] = kit.caption_highlight;
  } else if (tool === "shotstack") {
    if (kit.caption_font) p["font.family"] = kit.caption_font;
    if (kit.caption_color) p["font.color"] = kit.caption_color;
  }
  return p;
}

// Текст-инструкция для system-промпта: CTA + бан-слова + хэштеги + что айдентика фиксирована.
export function brandKitPromptBlock(kit: BrandKit | null): string {
  if (!kit) return "";
  const lines: string[] = [`БРЕНД-КИТ «${kit.brand}» (фиксированная айдентика — соблюдай):`];
  if (kit.cta) lines.push(`CTA-шаблон: ${kit.cta}`);
  if (kit.ban_words.length) lines.push(`БАН-СЛОВА (НЕ используй ни в промптах, ни в тексте): ${kit.ban_words.join(", ")}`);
  if (kit.hashtags.length) lines.push(`Бренд-хэштеги (для постинга): ${kit.hashtags.join(" ")}`);
  if (kit.voice_id || kit.persona_id || kit.caption_font) lines.push("Голос/персона/шрифт/цвет берутся из кита автоматически — НЕ выбирай их сам.");
  return lines.length > 1 ? "\n" + lines.join("\n") + "\n" : "";
}
