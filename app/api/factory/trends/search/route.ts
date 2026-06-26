import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { virloSearchStart } from "@/lib/factory/trendSources";
import { extractJsonArray } from "@/lib/factory/extractJson";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Запуск продукт-ориентированного поиска трендов: товар → ключевые фразы (Claude) → Virlo Orbit.
// Возвращает job_id; результат тянется отдельно (/api/factory/trends/result) — Orbit идёт 15-20 мин.
export async function POST(req: NextRequest) {
  try {
  if (!process.env.VIRLO_API_KEY) return NextResponse.json({ error: "Нужен VIRLO_API_KEY" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const article: string = (body.article || "").toString().trim();
  let name: string = (body.product_name || "").toString().trim();
  let keywords: string[] = Array.isArray(body.keywords) ? body.keywords.filter(Boolean).slice(0, 7) : [];

  if (!name && article) {
    const db = getSupabaseAdmin();
    if (db) { const { data } = await db.from("product_costs").select("name").eq("article", article).maybeSingle(); name = (data?.name as string) || ""; }
  }
  const subject = name || article;
  if (!subject && !keywords.length) return NextResponse.json({ error: "Нужен артикул/название товара или ключевые фразы" }, { status: 400 });

  // ключевые фразы под товар (Claude) — синонимы одного концепта, 3-7 мультислов
  if (!keywords.length) {
    const client = await createClaudeClient();
    if (client) {
      try {
        const r = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 300,
          system: "Ты подбираешь поисковые фразы для разведки виральных коротких видео по товару. Дай 5 КОНКРЕТНЫХ мультисловных фраз-синонимов ОДНОГО концепта (как ищут это видео-обзоры/отзывы), на русском. Верни СТРОГО JSON-массив строк.",
          messages: [{ role: "user", content: `Товар: ${subject}. Дай 5 фраз для поиска залетевших видео в этой нише.` }] });

        const txt = (r.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
        const parsed = extractJsonArray(txt);
        if (parsed?.length) keywords = parsed.map((v) => String(v || "").trim()).filter(Boolean).slice(0, 7);
      } catch { /* фолбэк ниже */ }
    }
    if (!keywords.length) keywords = [subject];
  }

  const jobId = await virloSearchStart(keywords);
  if (!jobId) return NextResponse.json({ error: "Virlo не запустил поиск" }, { status: 502 });
  return NextResponse.json({ job_id: jobId, keywords, product: subject, note: "Orbit идёт 15-20 мин. Проверяй результат через /api/factory/trends/result" });
  } catch (e) {
    return NextResponse.json({
      job_id: null,
      keywords: [],
      product: "",
      error: "поиск трендов упал: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}
