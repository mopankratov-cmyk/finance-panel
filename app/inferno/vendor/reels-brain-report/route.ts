import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function safeJson(url: string) {
  try {
    const res = await internalFetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    return await res.json().catch(() => ({}));
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest) {
  const niche = String(req.nextUrl.searchParams.get("niche") || "toys").trim() || "toys";
  const origin = req.nextUrl.origin;
  const [summary, digest, report] = await Promise.all([
    safeJson(`${origin}/api/factory/reels-brain/summary?niche=${encodeURIComponent(niche)}`),
    safeJson(`${origin}/api/factory/reels-brain/digest?niche=${encodeURIComponent(niche)}`),
    safeJson(`${origin}/api/factory/reels-brain/report?niches=${encodeURIComponent(niche)}`),
  ]);

  const platforms = Array.isArray((summary as { platforms?: unknown[] }).platforms) ? (summary as { platforms: Record<string, any>[] }).platforms : [];
  const incidents = Array.isArray((digest as { digest?: { latest_incidents?: unknown[] } }).digest?.latest_incidents)
    ? ((digest as { digest: { latest_incidents: Record<string, any>[] } }).digest.latest_incidents)
    : [];
  const pipeline = ((report as { pipeline_progress?: Record<string, any> }).pipeline_progress) || {};
  const pipelinePlatforms = Array.isArray(pipeline.platforms) ? pipeline.platforms : [];
  const sourceMixAudit = ((report as { source_mix_audit?: Record<string, any> }).source_mix_audit) || {};
  const sourceMixSummary = (sourceMixAudit.summary && typeof sourceMixAudit.summary === "object") ? sourceMixAudit.summary : {};
  const sourceMixPlatforms = Array.isArray(sourceMixAudit.by_platform) ? sourceMixAudit.by_platform : [];
  const sourceMixNiches = Array.isArray(sourceMixAudit.by_niche) ? sourceMixAudit.by_niche : [];
  const sourceMixWatchlist = Array.isArray(sourceMixAudit.exact_gap_watchlist) ? sourceMixAudit.exact_gap_watchlist : [];
  const sourceMixRiskClass = sourceMixSummary.fallback_dependency_risk === "low"
    ? "ready"
    : sourceMixSummary.fallback_dependency_risk === "medium"
      ? "watch"
      : "weak";
  const html = `<!DOCTYPE html>
  <html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>Reels Brain Live Report</title>
    <style>
      body{margin:0;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f3f6fb;color:#101828}
      .wrap{max-width:1180px;margin:0 auto;padding:24px}
      .hero,.card{background:#fff;border:1px solid #d8e0eb;border-radius:28px;box-shadow:0 10px 32px rgba(15,23,42,.06)}
      .hero{padding:28px;background:linear-gradient(135deg,#07111f,#11213b);color:#fff}
      .hero h1{margin:10px 0 0;font-size:42px;line-height:1;letter-spacing:-.04em}
      .hero p{max-width:760px;color:#d3deee;line-height:1.6}
      .grid{display:grid;gap:16px}
      .grid.two{grid-template-columns:1.2fr .8fr}
      .grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
      .card{padding:20px}
      .eyebrow{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.18em;color:#7d8aa0}
      .title{margin:6px 0 0;font-size:26px;line-height:1.05;letter-spacing:-.04em}
      .metric{border:1px solid #d8e0eb;border-radius:20px;padding:16px;background:#f8fafc}
      .metric .v{font-size:30px;font-weight:900}
      .metric .k{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.16em;color:#718097}
      .status{display:inline-flex;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:800}
      .ready{background:#def7ec;color:#059669}.watch{background:#fff1d6;color:#b45309}.weak{background:#ffe4ea;color:#e11d48}
      .list{display:grid;gap:10px}
      .row{border:1px solid #d8e0eb;border-radius:18px;padding:14px;background:#fff}
      .meta{font-size:12px;color:#667085;display:flex;gap:8px;flex-wrap:wrap}
      @media (max-width:900px){.grid.two,.grid.three{grid-template-columns:1fr}}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="hero">
        <div class="eyebrow">Live Read-only Report</div>
        <h1>Reels Brain Health: ${escapeHtml(niche)}</h1>
        <p>Публичная read-only витрина живого health state по платформам. Здесь нет мутаций, только текущее состояние мозга, provider champions, readiness и последние инциденты.</p>
      </div>
      <div class="grid three" style="margin-top:16px">
        <div class="metric"><div class="v">${escapeHtml((digest as any)?.digest?.platforms?.length || 0)}</div><div class="k">Platforms</div></div>
        <div class="metric"><div class="v">${escapeHtml((digest as any)?.digest?.total_incidents || 0)}</div><div class="k">Incidents</div></div>
        <div class="metric"><div class="v">${escapeHtml((digest as any)?.digest?.critical_incidents || 0)}</div><div class="k">Critical</div></div>
      </div>
      <div class="grid three" style="margin-top:16px">
        <div class="metric"><div class="v">${escapeHtml(pipeline?.throughput_24h?.analyzed || 0)}</div><div class="k">Analyzed 24h</div></div>
        <div class="metric"><div class="v">${escapeHtml(pipeline?.totals?.audio_backlog || 0)}</div><div class="k">Audio backlog</div></div>
        <div class="metric"><div class="v">${escapeHtml(pipeline?.primary_bottleneck?.label || "—")}</div><div class="k">Primary bottleneck</div></div>
      </div>
      <div class="grid two" style="margin-top:16px">
        <div class="card">
          <div class="eyebrow">Platforms</div>
          <h2 class="title">Readiness by platform</h2>
          <div class="list" style="margin-top:16px">
            ${platforms.map((row) => `
              <div class="row">
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
                  <div>
                    <div style="font-weight:900;font-size:18px">${escapeHtml(row.platform)}</div>
                    <div class="meta">
                      <span>provider ${escapeHtml(row.preferred_provider?.provider || row.preferred_provider || "none")}</span>
                      <span>videos ${escapeHtml(row.videos)}</span>
                      <span>patterns ${escapeHtml(row.pattern_count)}</span>
                    </div>
                  </div>
                  <span class="status ${escapeHtml(row.status || "watch")}">${escapeHtml(row.status || "watch")}</span>
                </div>
                <div class="meta" style="margin-top:10px">
                  <span>readiness ${escapeHtml(row.training_readiness?.score ?? 0)}%</span>
                  <span>drift ${escapeHtml(row.provider_drift ? "yes" : "no")}</span>
                  <span>stale ${escapeHtml(row.provider_stale_days ?? 0)}d</span>
                  <span>top query ${escapeHtml(row.query_leaderboard?.[0]?.query || row.recommended_queries?.[0] || "—")}</span>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
        <div class="card">
          <div class="eyebrow">Trust layer</div>
          <h2 class="title">Source mix audit</h2>
          <div class="list" style="margin-top:16px">
            <div class="row">
              <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
                <div>
                  <div style="font-weight:900;font-size:18px">How much brain already thinks through exact-proof</div>
                  <div class="meta" style="margin-top:8px">
                    <span>exact-ready ${escapeHtml(sourceMixSummary.exact_ready_solutions || 0)}</span>
                    <span>transfer-only ${escapeHtml(sourceMixSummary.transfer_only_solutions || 0)}</span>
                    <span>untraced ${escapeHtml(sourceMixSummary.untraced_solutions || 0)}</span>
                    <span>coverage ${escapeHtml(sourceMixSummary.exact_ready_coverage_pct || 0)}%</span>
                  </div>
                </div>
                <span class="status ${sourceMixRiskClass}">${escapeHtml(sourceMixSummary.fallback_dependency_risk || "high")} risk</span>
              </div>
              <div class="meta" style="margin-top:10px">
                <span>exact gap ${escapeHtml(sourceMixSummary.exact_gap_segments || 0)}</span>
                <span>validation traced ${escapeHtml(sourceMixSummary.validation_traced_posts || 0)}</span>
                <span>validation exact ${escapeHtml(sourceMixSummary.validation_exact_posts || 0)}</span>
                <span>legacy ${escapeHtml(sourceMixSummary.legacy_fallback_policy || "guarded")}</span>
              </div>
              <div class="meta" style="margin-top:10px">
                <span>${escapeHtml(sourceMixAudit.next_step || "Source mix guidance will appear here once the report is ready.")}</span>
              </div>
            </div>
            ${sourceMixPlatforms.length ? sourceMixPlatforms.map((row) => `
              <div class="row">
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
                  <div style="font-weight:900">${escapeHtml(row.platform)}</div>
                  <span class="status ${escapeHtml(Number(row.exact_ready_pct || 0) >= 50 ? "ready" : Number(row.exact_ready_pct || 0) >= 20 ? "watch" : "weak")}">${escapeHtml(row.exact_ready_pct || 0)}% exact-ready</span>
                </div>
                <div class="meta" style="margin-top:8px">
                  <span>segments ${escapeHtml(row.total || 0)}</span>
                  <span>exact ${escapeHtml(row.exact_ready || 0)}</span>
                  <span>transfer ${escapeHtml(row.transfer_only || 0)}</span>
                  <span>untraced ${escapeHtml(row.untraced || 0)}</span>
                </div>
              </div>
            `).join("") : `<div class="row"><div style="font-weight:800">Source mix audit пока пустой</div><div class="meta" style="margin-top:8px">Сначала мозгу нужно собрать segment solutions и generation packs.</div></div>`}
          </div>
        </div>
      </div>
      <div class="grid two" style="margin-top:16px">
        <div class="card">
          <div class="eyebrow">Niche trust</div>
          <h2 class="title">Exact-proof by niche</h2>
          <div class="list" style="margin-top:16px">
            ${sourceMixNiches.length ? sourceMixNiches.map((row) => `
              <div class="row">
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
                  <div style="font-weight:900">${escapeHtml(row.niche)}</div>
                  <span class="status ${escapeHtml(Number(row.exact_ready_pct || 0) >= 50 ? "ready" : Number(row.exact_ready_pct || 0) >= 20 ? "watch" : "weak")}">${escapeHtml(row.exact_ready_pct || 0)}% exact-ready</span>
                </div>
                <div class="meta" style="margin-top:8px">
                  <span>segments ${escapeHtml(row.total || 0)}</span>
                  <span>exact ${escapeHtml(row.exact_ready || 0)}</span>
                  <span>transfer ${escapeHtml(row.transfer_only || 0)}</span>
                  <span>untraced ${escapeHtml(row.untraced || 0)}</span>
                </div>
              </div>
            `).join("") : `<div class="row"><div style="font-weight:800">Niche-level source audit пока пустой</div></div>`}
          </div>
        </div>
        <div class="card">
          <div class="eyebrow">Pipeline</div>
          <h2 class="title">Backlog by platform</h2>
          <div class="list" style="margin-top:16px">
            ${pipelinePlatforms.length ? pipelinePlatforms.map((row) => `
              <div class="row">
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
                  <div style="font-weight:900">${escapeHtml(row.platform)}</div>
                  <span class="status ${escapeHtml(row.status === "healthy" ? "ready" : "watch")}">${escapeHtml(row.status || "watch")}</span>
                </div>
                <div class="meta" style="margin-top:8px">
                  <span>media ${escapeHtml(row.media_backlog || 0)}</span>
                  <span>audio ${escapeHtml(row.audio_backlog || 0)}</span>
                  <span>transcript ${escapeHtml(row.transcript_backlog || 0)}</span>
                  <span>analyze ${escapeHtml(row.analyze_backlog || 0)}</span>
                </div>
              </div>
            `).join("") : `<div class="row"><div style="font-weight:800">Pipeline data пока недоступен</div></div>`}
          </div>
        </div>
        <div class="card">
          <div class="eyebrow">Exact gaps</div>
          <h2 class="title">Where exact-proof is still missing</h2>
          <div class="list" style="margin-top:16px">
            ${sourceMixWatchlist.length ? sourceMixWatchlist.map((row) => `
              <div class="row">
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
                  <div>
                    <div style="font-weight:900">${escapeHtml(row.label)}</div>
                    <div class="meta" style="margin-top:8px">
                      <span>${escapeHtml(row.status || "unknown")}</span>
                      <span>urgency ${escapeHtml(row.urgency_score || 0)}</span>
                      <span>transfer ${escapeHtml(row.transfer_count || 0)}</span>
                    </div>
                  </div>
                  <span class="status watch">exact gap</span>
                </div>
                <div class="meta" style="margin-top:10px">
                  <span>${escapeHtml(row.desired_proof || "Need exact-proof evidence.")}</span>
                </div>
                <div class="meta" style="margin-top:8px">
                  <span>next ${escapeHtml(row.current_action || "watch_segment")}</span>
                </div>
              </div>
            `).join("") : `<div class="row"><div style="font-weight:800">Exact-gap watchlist пока пуст</div></div>`}
          </div>
        </div>
        <div class="card">
          <div class="eyebrow">Incidents</div>
          <h2 class="title">Latest alerts</h2>
          <div class="list" style="margin-top:16px">
            ${incidents.length ? incidents.map((row) => `
              <div class="row">
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
                  <div style="font-weight:800">${escapeHtml(row.message)}</div>
                  <span class="status ${escapeHtml(row.severity === "critical" ? "weak" : row.severity === "watch" ? "watch" : "ready")}">${escapeHtml(row.severity)}</span>
                </div>
                <div class="meta" style="margin-top:8px">
                  <span>${escapeHtml(row.platform)}</span>
                  <span>${escapeHtml(row.provider || row.kind)}</span>
                  <span>${escapeHtml(row.query || "—")}</span>
                </div>
              </div>
            `).join("") : `<div class="row"><div style="font-weight:800">Инцидентов пока нет</div><div class="meta" style="margin-top:8px">Мозг по этой нише сейчас без свежих предупреждений.</div></div>`}
          </div>
        </div>
      </div>
    </div>
  </body>
  </html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
