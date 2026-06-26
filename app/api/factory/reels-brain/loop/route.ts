import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function queryList(body: Record<string, unknown>): string[] {
  if (Array.isArray(body.queries)) {
    const q = body.queries.map((x) => String(x || "").trim()).filter(Boolean);
    if (q.length) return Array.from(new Set(q)).slice(0, 8);
  }
  const one = String(body.query || body.niche || "").trim();
  return one ? [one] : [];
}

// POST { niche, queries?, source_limit?, analyze_limit?, persist_patterns? }
// First hidden corpus loop: source-run per query → analyze top videos → build Pattern Memory.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const niche = String(body.niche || "").trim();
    if (!niche) return NextResponse.json({ error: "нужна niche" }, { status: 400 });
    const queries = queryList(body);
    if (!queries.length) return NextResponse.json({ error: "нужен query или queries[]" }, { status: 400 });

    const sourceLimit = Math.min(50, Math.max(1, Number(body.source_limit || 20)));
    const analyzeLimit = Math.min(25, Math.max(0, Number(body.analyze_limit ?? 8)));
    const persistPatterns = body.persist_patterns !== false;
    const origin = req.nextUrl.origin;
    const log: string[] = [];
    const sourceRuns: unknown[] = [];

    for (const query of queries) {
      const r = await internalFetch(`${origin}/api/factory/reels-brain/source-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche, query, limit: sourceLimit }),
        signal: AbortSignal.timeout(60000),
      });
      const j = await r.json().catch(() => ({}));
      sourceRuns.push(j);
      log.push(r.ok ? `source ${query}: ${j.inserted ?? 0}/${j.found ?? 0}` : `source ${query}: ${j.error || r.statusText}`);
    }

    let analyze: unknown = null;
    if (analyzeLimit > 0) {
      const r = await internalFetch(`${origin}/api/factory/reels-brain/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche, limit: analyzeLimit }),
        signal: AbortSignal.timeout(110000),
      });
      analyze = await r.json().catch(() => ({}));
      log.push(r.ok ? `analyze: ${(analyze as { analyzed?: number }).analyzed ?? 0}` : `analyze: ${(analyze as { error?: string }).error || r.statusText}`);
    }

    const r = await internalFetch(`${origin}/api/factory/reels-brain/patterns/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche, limit: 500, persist: persistPatterns }),
      signal: AbortSignal.timeout(45000),
    });
    const patterns = await r.json().catch(() => ({}));
    log.push(r.ok ? `patterns: ${((patterns as { memory?: { patterns?: unknown[] } }).memory?.patterns || []).length}` : `patterns: ${(patterns as { error?: string }).error || r.statusText}`);

    return NextResponse.json({
      ok: true,
      niche,
      queries,
      source_limit: sourceLimit,
      analyze_limit: analyzeLimit,
      persist_patterns: persistPatterns,
      log,
      source_runs: sourceRuns,
      analyze,
      patterns,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "loop reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
