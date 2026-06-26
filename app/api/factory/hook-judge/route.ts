import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { judgeHooks, type HookJudgeCorpusHook } from "@/lib/factory/hookJudge";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
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
    return NextResponse.json({
      ok: false,
      source: "deterministic",
      winner: null,
      ranked: [],
      corpus_used: 0,
      error: "hook-judge crash: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
