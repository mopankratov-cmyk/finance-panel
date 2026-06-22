import { NextRequest, NextResponse, after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listJobs, hasStuck } from "@/lib/factory/jobs";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Список джоб для кокпита (вью «Очередь»). Заодно ВОСКРЕШАЕТ зависшую цепочку:
// если есть незавершённая джоба со свободным лизом — будим тик (дешёвая страховка вместо cron-sweeper).
export async function GET(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const jobs = await listJobs(db, 50);

  if (hasStuck(jobs)) {
    const origin = req.nextUrl.origin;
    after(async () => { try { await internalFetch(`${origin}/api/factory/jobs/tick`, { method: "POST", signal: AbortSignal.timeout(8000) }); } catch { /* ok */ } });
  }

  const summary: Record<string, number> = { queued: 0, running: 0, polling: 0, done: 0, failed: 0 };
  jobs.forEach((j) => { summary[j.status] = (summary[j.status] || 0) + 1; });
  return NextResponse.json({
    summary,
    jobs: jobs.map((j) => ({ id: j.id, status: j.status, step: j.step, article: j.article, hook: j.hook, error: j.error, result: j.result })),
  });
}
