import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { normalizeTargetPlatform } from "@/lib/factory/reelsBrainPlaybook";
import { assessSourceRunHealth, chooseRetryProviderPlan, chooseRetryQueryPivot } from "@/lib/factory/reelsBrainSourceLearning";

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
    const autoRelearn = body.auto_relearn !== false;
    const buildPatterns = body.build_patterns !== false;
    const targetPlatform = normalizeTargetPlatform(body.target_platform || body.platform);
    const origin = req.nextUrl.origin;
    const cookie = req.headers.get("cookie");
    const fanoutHeaders: HeadersInit = { "Content-Type": "application/json" };
    if (cookie) fanoutHeaders.cookie = cookie;
    const log: string[] = [];
    const sourceRuns: unknown[] = [];
    const bakeOffs: unknown[] = [];
    const retries: unknown[] = [];
    const providerShifts: unknown[] = [];

    for (const query of queries) {
      const r = await internalFetch(`${origin}/api/factory/reels-brain/source-run`, {
        method: "POST",
        headers: fanoutHeaders,
        body: JSON.stringify({ niche, query, limit: sourceLimit, target_platform: targetPlatform }),
        signal: AbortSignal.timeout(60000),
      });
      const j = await r.json().catch(() => ({}));
      sourceRuns.push(j);
      log.push(r.ok ? `source ${query}: ${j.inserted ?? 0}/${j.found ?? 0}` : `source ${query}: ${j.error || r.statusText}`);
      if (r.ok && Array.isArray((j as { recommended_queries?: unknown[] }).recommended_queries)) {
        log.push(`queries ${query}: ${((j as { recommended_queries?: string[] }).recommended_queries || []).slice(0, 3).join(" | ")}`);
      }

      if (r.ok && autoRelearn) {
        const policy = (j as {
          relearn_policy?: { min_found?: number; min_relevant?: number; min_inserted?: number; bake_off_limit?: number; retry_limit?: number };
        }).relearn_policy;
        const health = assessSourceRunHealth(
          { ...(j as Record<string, unknown>), target_platform: targetPlatform },
          {
            min_found: policy?.min_found,
            min_relevant: policy?.min_relevant,
            min_inserted: policy?.min_inserted,
          },
        );
        if (health.should_relearn) {
          log.push(`relearn ${query}: ${health.reasons.join(" | ")}`);
          const retryQueryPlan = chooseRetryQueryPivot(j as Record<string, unknown>, {
            should_relearn: health.should_relearn,
          });
          const relearnQueries = Array.from(new Set([query, retryQueryPlan.retry_query].filter(Boolean))) as string[];
          if (retryQueryPlan.retry_query) {
            log.push(`pivot-query ${query}: -> ${retryQueryPlan.retry_query}`);
          }
          const bakeOffRes = await internalFetch(`${origin}/api/factory/reels-brain/bake-off`, {
            method: "POST",
            headers: fanoutHeaders,
            body: JSON.stringify({
              niche,
              queries: relearnQueries.length ? relearnQueries : [query],
              limit: Math.min(30, Math.max(Number(policy?.bake_off_limit || sourceLimit + 5), sourceLimit)),
              target_platform: targetPlatform,
              persist: false,
              persist_memory: true,
            }),
            signal: AbortSignal.timeout(80000),
          });
          const bakeOffJson = await bakeOffRes.json().catch(() => ({}));
          bakeOffs.push({ query, health, bake_off: bakeOffJson });
          log.push(bakeOffRes.ok
            ? `bake-off ${query}: ${String((bakeOffJson as { best_provider_by_platform?: Record<string, { provider?: string }> }).best_provider_by_platform?.[targetPlatform]?.provider || "none")}`
            : `bake-off ${query}: ${(bakeOffJson as { error?: string }).error || bakeOffRes.statusText}`);

          if (bakeOffRes.ok && Number(policy?.retry_limit ?? 1) > 0) {
            const bakeOffWinner = String(
              (bakeOffJson as { best_provider_by_platform?: Record<string, { provider?: string }> }).best_provider_by_platform?.[targetPlatform]?.provider || "",
            ).trim().toLowerCase();
            const retryPlan = chooseRetryProviderPlan(j as Record<string, unknown>, {
              should_relearn: health.should_relearn,
              bake_off_provider: bakeOffWinner,
            });
            const retryQuery = retryQueryPlan.retry_query || query;
            if (retryPlan.retry_provider) {
              providerShifts.push({
                query,
                retry_query: retryQuery,
                from_provider: (j as { remembered_provider?: string | null }).remembered_provider || null,
                to_provider: retryPlan.retry_provider,
                reasons: retryPlan.reasons,
              });
              log.push(`provider-shift ${query}: ${String((j as { remembered_provider?: string | null }).remembered_provider || "auto")} -> ${retryPlan.retry_provider}`);
            }
            const retryRes = await internalFetch(`${origin}/api/factory/reels-brain/source-run`, {
              method: "POST",
              headers: fanoutHeaders,
              body: JSON.stringify({
                niche,
                query: retryQuery,
                limit: sourceLimit,
                target_platform: targetPlatform,
                provider_hint: retryPlan.retry_provider || undefined,
              }),
              signal: AbortSignal.timeout(60000),
            });
            const retryJson = await retryRes.json().catch(() => ({}));
            retries.push({ query, retry_plan: retryPlan, retry: retryJson });
            log.push(retryRes.ok
              ? `retry ${query}: ${retryJson.inserted ?? 0}/${retryJson.found ?? 0}`
              : `retry ${query}: ${retryJson.error || retryRes.statusText}`);
          }
        }
      }
    }

    let analyze: unknown = null;
    if (analyzeLimit > 0) {
      const r = await internalFetch(`${origin}/api/factory/reels-brain/analyze`, {
        method: "POST",
        headers: fanoutHeaders,
        body: JSON.stringify({ niche, limit: analyzeLimit, target_platform: targetPlatform }),
        signal: AbortSignal.timeout(110000),
      });
      analyze = await r.json().catch(() => ({}));
      log.push(r.ok ? `analyze: ${(analyze as { analyzed?: number }).analyzed ?? 0}` : `analyze: ${(analyze as { error?: string }).error || r.statusText}`);
    }

    let taxonomy: unknown = null;
    if (analyzeLimit > 0) {
      const r = await internalFetch(`${origin}/api/factory/jobs/reels-brain-taxonomy-refresh`, {
        method: "POST",
        headers: fanoutHeaders,
        body: JSON.stringify({ niches: niche, limit: Math.max(12, Math.min(50, analyzeLimit * 4)), promote_threshold: 3 }),
        signal: AbortSignal.timeout(60000),
      });
      taxonomy = await r.json().catch(() => ({}));
      log.push(r.ok ? `taxonomy: ${(taxonomy as { classified?: number }).classified ?? 0}` : `taxonomy: ${(taxonomy as { error?: string }).error || r.statusText}`);
    }

    let patterns: unknown = null;
    if (buildPatterns) {
      const r = await internalFetch(`${origin}/api/factory/reels-brain/patterns/build`, {
        method: "POST",
        headers: fanoutHeaders,
        body: JSON.stringify({ niche, limit: 500, persist: persistPatterns }),
        signal: AbortSignal.timeout(45000),
      });
      patterns = await r.json().catch(() => ({}));
      log.push(
        r.ok
          ? `patterns: meta=${((patterns as { memory?: { meta_brain?: { patterns?: unknown[] } } }).memory?.meta_brain?.patterns || []).length}, cross=${((patterns as { memory?: { cross_platform_patterns?: unknown[] } }).memory?.cross_platform_patterns || []).length}`
          : `patterns: ${(patterns as { error?: string }).error || r.statusText}`,
      );
    } else {
      log.push("patterns: skipped");
    }

    return NextResponse.json({
      ok: true,
      niche,
      queries,
      target_platform: targetPlatform,
      source_limit: sourceLimit,
      analyze_limit: analyzeLimit,
      auto_relearn: autoRelearn,
      build_patterns: buildPatterns,
      persist_patterns: persistPatterns,
      log,
      source_runs: sourceRuns,
      bake_offs: bakeOffs,
      provider_shifts: providerShifts,
      retries,
      analyze,
      taxonomy,
      patterns,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "loop reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
