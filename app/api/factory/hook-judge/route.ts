import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { judgeHooks, type HookJudgeCorpusHook } from "@/lib/factory/hookJudge";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

function firstFallbackHook(body: Record<string, unknown>) {
  const raw = Array.isArray(body.candidates) ? body.candidates : Array.isArray(body.hooks) ? body.hooks : [];
  const item = raw[0];
  const hook = item && typeof item === "object" && !Array.isArray(item)
    ? String((item as Record<string, unknown>).hook || (item as Record<string, unknown>).hook_text || (item as Record<string, unknown>).text || "").trim()
    : String(item || "").trim();
  if (!hook) return null;
  return { id: "fallback-1", hook, source_index: 0, score: 5, verdict: "ok" as const, reasons: ["hook-judge fallback: проверка не блокирует MVP"] };
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json().catch(() => ({}));
    const article = String(body.article || "").trim();
    const niche = String(body.niche || nicheFromArticle(article, "") || "").trim();
    let corpus: HookJudgeCorpusHook[] = Array.isArray(body.corpus) ? body.corpus.slice(0, 20) : [];

    if (!corpus.length && niche) {
      const db = getSupabaseAdmin();
      if (db) {
        try {
          const { data } = await db.from("viral_hooks")
            .select("hook_text,viability_score")
            .eq("niche", niche)
            .order("viability_score", { ascending: false })
            .limit(20);
          corpus = (data as HookJudgeCorpusHook[] | null) || [];
        } catch { /* corpus is optional */ }
      }
    }

    const result = judgeHooks({ hooks: body.hooks, candidates: body.candidates, corpus });
    return NextResponse.json({ ...result, niche: niche || null }, { status: result.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const fallback = firstFallbackHook(body);
    return NextResponse.json({
      ok: true,
      source: "deterministic",
      winner: fallback,
      ranked: fallback ? [fallback] : [],
      corpus_used: 0,
      warning: "оценка хуков упала, выпуск не заблокирован: " + String((e as Error)?.message || e).slice(0, 160),
    }, { headers: { "Cache-Control": "no-store" } });
  }
}
