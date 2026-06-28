import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { decideAutoFeedback } from "@/lib/factory/feedbackQueue";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function text(value: unknown, max = 180): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function positiveInt(value: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, n);
}

function nextAnalysis(current: Record<string, unknown> | null | undefined, decision: ReturnType<typeof decideAutoFeedback>) {
  const now = new Date().toISOString();
  const base = current && typeof current === "object" ? current : {};
  return {
    ...base,
    memory_label: decision.label,
    memory_score: decision.score,
    memory_confidence: decision.confidence,
    memory_reasons: [decision.reason],
    memory_reviewed_at: now,
    memory_review_source: "auto_feedback_v1",
    auto_feedback_action: decision.action,
    auto_feedback_reason: decision.reason,
    auto_feedback_at: now,
  };
}

export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const apply = body.apply === true;
    const limit = positiveInt(body.limit, 500, 5000);
    const niche = text(body.niche, 80);

    let q = db
      .from("content_assets")
      .select("id,name,kind,url,niche,article,analysis,is_winner,winner_at,created_at")
      .eq("disk", "gen")
      .eq("kind", "video")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (niche) q = q.eq("niche", niche);

    const { data, error } = await q;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const rows = ((data || []) as Record<string, unknown>[]);
    const decisions = rows.map((row) => ({ row, decision: decideAutoFeedback(row) }));
    const actionable = decisions.filter(({ decision }) => decision.action === "winner" || decision.action === "trash");
    const errors: string[] = [];
    let updated = 0;
    let winner_seeded = 0;
    let reject_seeded = 0;

    if (apply) {
      for (const { row, decision } of actionable) {
        const update: Record<string, unknown> = {
          analysis: nextAnalysis(row.analysis as Record<string, unknown> | null, decision),
        };
        if (decision.action === "winner") {
          update.is_winner = true;
          update.winner_at = new Date().toISOString();
          update.winner_learnings = {
            hook: text((row.analysis as Record<string, unknown> | null)?.hook || row.name, 120),
            note: decision.reason,
            source: "auto_feedback_v1",
          };
        }
        const { error: updateError } = await db.from("content_assets").update(update).eq("id", row.id);
        if (updateError) {
          errors.push(updateError.message.slice(0, 180));
          if (errors.length >= 20) break;
          continue;
        }
        updated += 1;

        if (decision.action === "winner") {
          try {
            const hook = text((row.analysis as Record<string, unknown> | null)?.hook || row.name, 120);
            if (hook) {
              const hookNiche = text(row.niche, 80) || nicheFromArticle(text(row.article, 80), text(row.name, 120));
              await db.from("viral_hooks").upsert(
                { niche: hookNiche, hook_text: hook, viability_score: 5, effectiveness_notes: `auto winner: ${decision.reason}`.slice(0, 200) },
                { onConflict: "niche,hook_text", ignoreDuplicates: false },
              );
              winner_seeded += 1;
            }
          } catch {
            // Learning seed best-effort.
          }
        }
        if (decision.action === "trash") {
          try {
            await db.from("cf_signals").insert({
              event: "rejected",
              reason_chip: decision.reason.slice(0, 80),
              niche: text(row.niche, 80) || null,
              article: text(row.article, 80) || null,
              mode: "auto_feedback_v1",
            });
            reject_seeded += 1;
          } catch {
            // Optional anti-signal table may be absent.
          }
        }
      }
    }

    const by_action = { winner: 0, trash: 0, keep: 0 };
    const by_label = { winner: 0, usable: 0, trash: 0 };
    for (const { decision } of decisions) {
      by_action[decision.action] += 1;
      by_label[decision.label] += 1;
    }

    return NextResponse.json({
      ok: errors.length === 0,
      apply,
      scanned: rows.length,
      actionable: actionable.length,
      updated,
      winner_seeded,
      reject_seeded,
      by_action,
      by_label,
      sample_winner: decisions.filter(({ decision }) => decision.action === "winner").slice(0, 10).map(({ row, decision }) => ({ id: row.id, name: row.name, url: row.url, reason: decision.reason })),
      sample_trash: decisions.filter(({ decision }) => decision.action === "trash").slice(0, 10).map(({ row, decision }) => ({ id: row.id, name: row.name, url: row.url, reason: decision.reason })),
      note: by_action.winner > 0
        ? "auto-feedback found objective winner signals"
        : "no objective winner signal found; auto-feedback will not invent winners from weak OTK",
      errors,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      apply: false,
      scanned: 0,
      actionable: 0,
      updated: 0,
      error: "feedback-queue auto crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
