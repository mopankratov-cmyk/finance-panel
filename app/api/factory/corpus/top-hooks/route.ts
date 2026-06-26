import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// GET /api/factory/corpus/top-hooks?niche=cosmetics&limit=30
// Возвращает хуки из viral_hooks, отсортированные по viability_score DESC.
// viability_score: 1=from playbook, 2=from analyze_video, 3=hook-judge score≥8, 4=gen-save OTK≥8, 5=winner(🏆)
// Graceful при отсутствии таблицы.

export async function GET(req: NextRequest) {
  try {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ hooks: [], warning: "Supabase не настроен — корпус хуков временно пустой" });

  const sp = new URL(req.url).searchParams;
  const niche = sp.get("niche") || "";
  const limit = Math.min(parseInt(sp.get("limit") || "50", 10), 100);

  try {
    let q = db.from("viral_hooks").select("hook_text,niche,viability_score,effectiveness_notes").order("viability_score", { ascending: false }).order("id", { ascending: false }).limit(limit);
    if (niche) q = q.eq("niche", niche);

    const { data, error } = await q;
    if (error?.code === "42P01") return NextResponse.json({ hooks: [], warning: "viral_hooks не применена — применить 20260620_viral_corpus.sql" });
    if (error) return NextResponse.json({ hooks: [], warning: error.message });

    const hooks = (data ?? []).map((h: { hook_text: string; niche: string; viability_score: number; effectiveness_notes: string | null }) => ({
      text: h.hook_text,
      niche: h.niche,
      score: h.viability_score,
      note: h.effectiveness_notes || "",
    }));

    return NextResponse.json({ hooks });
  } catch (e) {
    return NextResponse.json({ hooks: [], warning: String(e).slice(0, 100) });
  }
  } catch (e) {
    return NextResponse.json({ hooks: [], warning: "топ хуков упал: " + String((e as Error)?.message || e).slice(0, 160) });
  }
}
