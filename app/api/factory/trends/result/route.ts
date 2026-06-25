import { NextRequest, NextResponse } from "next/server";
import { virloSearchResult } from "@/lib/factory/trendSources";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Статус/результат Orbit-поиска под товар. Если finalized — отдаём готовую аналитику Virlo + видео.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const id: string = (body.job_id || body.id || "").toString().trim();
    if (!id) return NextResponse.json({ error: "Нужен job_id" }, { status: 400 });

    const status = await virloSearchResult(id, "status");
    if (!status) return NextResponse.json({ error: "Virlo не ответил по статусу" }, { status: 502 });
    const finalized = status.finalized === true || status.status === "completed" || status.status === "partial_failure";
    if (!finalized) {
      return NextResponse.json({ finalized: false, status: status.status || "pending", pending: status.pending_jobs || [], retry_after: status.retry_after_seconds || 60 });
    }

    // готово — берём синтез-аналитику Virlo + топ-видео
    const [analysis, videos] = await Promise.all([
      virloSearchResult(id, "analysis").catch(() => null),
      virloSearchResult(id, "videos").catch(() => null),
    ]);

    const vids = ((videos?.data || videos?.videos || []) as any[]).slice(0, 20).map((v) => ({ url: v.url, caption: v.description || v.title, views: v.views, likes: v.number_of_likes }));
    return NextResponse.json({ finalized: true, status: status.status, analysis: analysis || null, videos: vids, counts: status.counts || null });
  } catch (e) {
    return NextResponse.json({ error: "trends/result crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
