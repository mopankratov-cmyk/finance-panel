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
  const origin = req.nextUrl.origin;
  const niches = String(req.nextUrl.searchParams.get("niches") || "toys,clothing,cosmetics,default");
  const data = await safeJson(`${origin}/api/factory/reels-brain/digest-all?niches=${encodeURIComponent(niches)}`);
  const health = await safeJson(`${origin}/api/factory/reels-brain/health?niches=${encodeURIComponent(niches)}`);
  const rows = Array.isArray((data as { niches?: unknown[] }).niches) ? (data as { niches: Record<string, any>[] }).niches : [];
  const portfolio = (data as { portfolio?: Record<string, any> }).portfolio || {};
  const pipeline = (portfolio.pipeline_progress || (health as any)?.health?.pipeline || {}) as Record<string, any>;

  const html = `<!DOCTYPE html>
  <html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>Reels Brain Portfolio</title>
    <style>
      body{margin:0;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4f7fb;color:#101828}
      .wrap{max-width:1240px;margin:0 auto;padding:24px}
      .hero,.card{border:1px solid #d9e2ef;border-radius:28px;background:#fff;box-shadow:0 10px 32px rgba(15,23,42,.06)}
      .hero{padding:28px;background:linear-gradient(135deg,#081120,#13243f);color:#fff}
      .hero h1{margin:8px 0 0;font-size:42px;line-height:1;letter-spacing:-.04em}
      .hero p{max-width:760px;color:#d1deef;line-height:1.6}
      .grid{display:grid;gap:16px}
      .grid.four{grid-template-columns:repeat(4,minmax(0,1fr))}
      .grid.two{grid-template-columns:1fr 1fr}
      .metric,.card{padding:20px}
      .metric{border:1px solid #d9e2ef;border-radius:20px;background:#f8fafc}
      .metric .v{font-size:30px;font-weight:900}.metric .k{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.16em;color:#718096}
      .eyebrow{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.18em;color:#7d8aa0}
      .title{margin:6px 0 0;font-size:26px;line-height:1.04;letter-spacing:-.04em}
      .list{display:grid;gap:12px}
      .row{border:1px solid #d9e2ef;border-radius:18px;background:#fff;padding:16px}
      .status{display:inline-flex;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:800}
      .ready{background:#def7ec;color:#059669}.watch{background:#fff1d6;color:#b45309}.weak{background:#ffe4ea;color:#e11d48}
      .meta{display:flex;flex-wrap:wrap;gap:8px;font-size:12px;color:#667085}
      @media (max-width:1000px){.grid.four,.grid.two{grid-template-columns:1fr}}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="hero">
        <div class="eyebrow">Owner Read-only Portfolio</div>
        <h1>Reels Brain portfolio overview</h1>
        <p>Read-only витрина по нескольким нишам сразу. Можно быстро увидеть, какие brain lanes готовы, где растет drift и какие ниши первыми требуют operator attention.</p>
      </div>
      <div class="grid four" style="margin-top:16px">
        <div class="metric"><div class="v">${escapeHtml(portfolio.total_niches || 0)}</div><div class="k">Niches</div></div>
        <div class="metric"><div class="v">${escapeHtml(portfolio.ready_niches || 0)}</div><div class="k">Ready</div></div>
        <div class="metric"><div class="v">${escapeHtml(portfolio.watch_niches || 0)}</div><div class="k">Watch</div></div>
        <div class="metric"><div class="v">${escapeHtml(portfolio.avg_readiness || 0)}%</div><div class="k">Avg readiness</div></div>
      </div>
      <div class="grid four" style="margin-top:16px">
        <div class="metric"><div class="v">${escapeHtml(pipeline?.throughput_24h?.inserted || 0)}</div><div class="k">Inserted 24h</div></div>
        <div class="metric"><div class="v">${escapeHtml(pipeline?.throughput_24h?.analyzed || 0)}</div><div class="k">Analyzed 24h</div></div>
        <div class="metric"><div class="v">${escapeHtml(pipeline?.totals?.media_backlog || 0)}</div><div class="k">Media backlog</div></div>
        <div class="metric"><div class="v">${escapeHtml((health as any)?.health?.worker?.issue?.level || "—")}</div><div class="k">Worker state</div></div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="eyebrow">10k Corpus Goal</div>
        <h2 class="title">Progress to platform-scale nasmotrennost</h2>
        <div class="meta" style="margin-top:10px">
          <span>current ${escapeHtml(portfolio.corpus_goal?.total_progress?.current || 0)}</span>
          <span>target ${escapeHtml(portfolio.corpus_goal?.total_progress?.target || 0)}</span>
          <span>progress ${escapeHtml(portfolio.corpus_goal?.total_progress?.progress_pct || 0)}%</span>
          <span>gap ${escapeHtml(portfolio.corpus_goal?.total_progress?.gap || 0)}</span>
          <span>stage ${escapeHtml(portfolio.corpus_goal?.stage?.stage_label || "—")}</span>
          <span>daily need ${escapeHtml(portfolio.corpus_goal?.execution_plan?.daily_required || 0)}</span>
          <span>weekly need ${escapeHtml(portfolio.corpus_goal?.execution_plan?.weekly_required || 0)}</span>
        </div>
        <div class="meta" style="margin-top:10px">
          ${((Array.isArray(portfolio.corpus_goal?.by_platform) ? portfolio.corpus_goal.by_platform : []) as Record<string, any>[]).map((item) => `
            <span>${escapeHtml(item.platform)} ${escapeHtml(item.current || 0)}/${escapeHtml(item.target || 0)} · ${escapeHtml(item.progress_pct || 0)}%</span>
          `).join("")}
        </div>
      </div>
      <div class="grid two" style="margin-top:16px">
        <div class="card">
          <div class="eyebrow">Niche portfolio</div>
          <h2 class="title">What needs attention</h2>
          <div class="list" style="margin-top:16px">
            ${rows.map((row) => `
              <div class="row">
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
                  <div>
                    <div style="font-size:18px;font-weight:900">${escapeHtml(row.niche)}</div>
                    <div class="meta" style="margin-top:8px">
                      <span>readiness ${escapeHtml(row.readiness_avg)}%</span>
                      <span>videos ${escapeHtml(row.total_videos)}</span>
                      <span>target ${escapeHtml(row.corpus_target || 0)}</span>
                      <span>incidents ${escapeHtml(row.total_incidents)}</span>
                      <span>next ${escapeHtml(row.next_action || "monitor")}</span>
                    </div>
                  </div>
                  <span class="status ${escapeHtml(row.status === "ready" ? "ready" : "watch")}">${escapeHtml(row.status)}</span>
                </div>
                <div class="meta" style="margin-top:10px">
                  ${(Array.isArray(row.platforms) ? row.platforms : []).map((platform) =>
                    `<span>${escapeHtml(platform.platform)}: ${escapeHtml(platform.preferred_provider || "none")} · ${escapeHtml(platform.readiness_score)}%${platform.provider_shift?.active ? ` · shift ${escapeHtml(platform.provider_shift.from_provider || "none")}→${escapeHtml(platform.provider_shift.to_provider || "none")}` : ""}${platform.retry_signal?.recommended ? ` · retry ${escapeHtml(platform.retry_signal.action || "monitor")}` : ""}</span>`
                  ).join("")}
                </div>
                <div class="meta" style="margin-top:10px">
                  <span>action ${escapeHtml(row.next_action || "monitor")}</span>
                  <span>priority ${escapeHtml(row.next_action_priority || "p3")}</span>
                  <span>platform ${escapeHtml(row.next_action_platform || "none")}</span>
                  <span>query ${escapeHtml(row.next_action_query || "none")}</span>
                </div>
                <div class="meta" style="margin-top:10px">
                  <span>reason ${escapeHtml(row.next_action_reason || "stable enough")}</span>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
        <div class="card">
          <div class="eyebrow">Action guide</div>
          <h2 class="title">Owner-level interpretation</h2>
          <div class="list" style="margin-top:16px">
            <div class="row">
              <div style="font-weight:900">Priority queue</div>
              <div class="list" style="margin-top:12px">
                ${((Array.isArray(portfolio.action_queue) ? portfolio.action_queue : []) as Record<string, any>[]).map((item) => `
                  <div class="row" style="padding:12px">
                    <div style="font-weight:800">${escapeHtml(item.priority || "p3")} · ${escapeHtml(item.niche || "unknown")} · ${escapeHtml(item.action || "monitor")}</div>
                    <div class="meta" style="margin-top:6px">
                      <span>platform ${escapeHtml(item.platform || "none")}</span>
                      <span>query ${escapeHtml(item.query || "none")}</span>
                    </div>
                    <div class="meta" style="margin-top:6px">
                      <span>retry ${escapeHtml(item.retry_signal?.action || "monitor")}</span>
                      <span>shift ${item.provider_shift?.active ? `${escapeHtml(item.provider_shift.from_provider || "none")}→${escapeHtml(item.provider_shift.to_provider || "none")}` : "none"}</span>
                    </div>
                    <div class="meta" style="margin-top:6px">
                      <span>${escapeHtml(item.reason || "stable enough")}</span>
                    </div>
                  </div>
                `).join("") || `<div class="meta">empty</div>`}
              </div>
            </div>
            <div class="row">
              <div style="font-weight:900">Pipeline truth</div>
              <div class="meta" style="margin-top:8px">
                ${((Array.isArray(pipeline?.platforms) ? pipeline.platforms : []) as Record<string, any>[]).map((item) => `
                  <span>${escapeHtml(item.platform)} media ${escapeHtml(item.media_backlog || 0)} · audio ${escapeHtml(item.audio_backlog || 0)} · analyze ${escapeHtml(item.analyze_backlog || 0)}</span>
                `).join("") || "empty"}
              </div>
            </div>
            <div class="row">
              <div style="font-weight:900">Ready niche</div>
              <div class="meta" style="margin-top:8px">All lanes healthy enough, only periodic review needed.</div>
            </div>
            <div class="row">
              <div style="font-weight:900">Watch niche</div>
              <div class="meta" style="margin-top:8px">At least one platform lane has weak readiness, drift, or stale provider memory.</div>
            </div>
            <div class="row">
              <div style="font-weight:900">Operator next step</div>
              <div class="meta" style="margin-top:8px">Open /agent/reels-brain, run mini bake-off, then source refresh, then loop on the weakest platform.</div>
            </div>
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
