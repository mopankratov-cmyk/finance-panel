import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { hasMpstats, subjectByDate, subjectKeywords, itemKeywords } from "@/lib/mpstats/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// «Пульс рынка»: ниша (MPStats) ↔ мы (свои wb_orders), и запросы ↔ наши позиции.
// MPStats — оценочные данные (для тренда/направления, не абсолюта).
export async function GET(request: NextRequest) {
  if (!hasMpstats()) return NextResponse.json({ error: "MPSTATS_TOKEN не настроен в окружении" }, { status: 501 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const sp = new URL(request.url).searchParams;
  const subject = sp.get("subject") || "";
  if (!subject) return NextResponse.json({ error: "Укажите subject (путь предмета)" }, { status: 400 });
  const weeks = Math.min(12, Math.max(2, Number(sp.get("weeks")) || 8));
  const { cabinetId, label } = await resolveShopCabinet(sp.get("cabinet") ?? undefined);

  const to = new Date(Date.now() - 86400000); // MPStats требует d2 < сегодня (вчера)
  const from = new Date(Date.now() - weeks * 7 * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const d1 = fmt(from), d2 = fmt(to);

  // параллельно: ниша по дням (MPStats), запросы ниши (MPStats), наша динамика (своя БД)
  const [nicheDays, nicheKw, ourDailyRes] = await Promise.all([
    subjectByDate(subject, d1, d2),
    subjectKeywords(subject, d1, d2, 300),
    db.rpc("rnp_daily", { p_from: d1, p_to: d2, p_cabinet: cabinetId }),
  ]);

  // — недельная агрегация ниши и нас —
  const isoWeek = (s: string) => { const [y, m, dd] = s.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, dd)); const day = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - day); return dt.toISOString().slice(0, 10); };
  const nicheByWeek = new Map<string, number>();
  for (const r of nicheDays) { const p = r.period; if (!p) continue; const w = isoWeek(String(p).slice(0, 10)); nicheByWeek.set(w, (nicheByWeek.get(w) ?? 0) + Number(r.revenue ?? 0)); }
  const ourByWeek = new Map<string, number>();
  for (const r of (ourDailyRes.data ?? []) as { d: string; orders_sum: number }[]) { const w = isoWeek(String(r.d).slice(0, 10)); ourByWeek.set(w, (ourByWeek.get(w) ?? 0) + Number(r.orders_sum ?? 0)); }

  const weeksList = [...new Set([...nicheByWeek.keys(), ...ourByWeek.keys()])].sort();
  // окно сравнения — недели, где у НАС есть данные (история заказов короче ниши)
  const ourWeeks = weeksList.filter((w) => (ourByWeek.get(w) ?? 0) > 0);
  const firstOur = ourWeeks[0]; // нашу линию рисуем с этой недели (раньше — null, не 0)
  const series = weeksList.map((w) => ({
    week: w,
    niche: Math.round(nicheByWeek.get(w) ?? 0),
    ours: firstOur && w >= firstOur ? Math.round(ourByWeek.get(w) ?? 0) : null,
  }));
  // рост = средняя второй половины окна / средняя первой (устойчиво к нулям и выбросам)
  const avg = (m: Map<string, number>, ws: string[]) => (ws.length ? ws.reduce((s, w) => s + (m.get(w) ?? 0), 0) / ws.length : 0);
  const growthOver = (m: Map<string, number>, ws: string[]) => {
    if (ws.length < 2) return null;
    const h = Math.max(1, Math.floor(ws.length / 2));
    const a = avg(m, ws.slice(0, h)), b = avg(m, ws.slice(-h));
    return a > 0 ? Math.round((b / a - 1) * 100) : null;
  };
  const nicheGrowth = growthOver(nicheByWeek, ourWeeks);
  const ourGrowth = growthOver(ourByWeek, ourWeeks);

  // доля — в окне наших данных (одинаковые недели); MPStats занижает нишу → доля скорее завышена
  const nicheRevWin = ourWeeks.reduce((a, w) => a + (nicheByWeek.get(w) ?? 0), 0);
  const ourRevWin = ourWeeks.reduce((a, w) => a + (ourByWeek.get(w) ?? 0), 0);
  const sharePct = nicheRevWin > 0 ? Math.round((ourRevWin / nicheRevWin) * 1000) / 10 : null;

  // — топ-запросы ниши + наши позиции по топ-SKU кабинета —
  // топ-SKU кабинета по выручке (для позиций) — из rnp_report
  const repRes = await db.rpc("rnp_report", { p_cabinet: cabinetId });
  const ourSkus = ((repRes.data ?? []) as { nm_id: number; orders_sum_month: number }[])
    .slice()
    .sort((a, b) => Number(b.orders_sum_month ?? 0) - Number(a.orders_sum_month ?? 0))
    .slice(0, 3)
    .map((r) => r.nm_id);

  const posByQuery = new Map<string, { org: number | null; ad: number | null }>();
  for (const nm of ourSkus) {
    const kw = await itemKeywords(nm, d1, d2);
    for (const w of kw) {
      const cur = posByQuery.get(w.query);
      const org = w.avg_organic_position != null ? Math.round(w.avg_organic_position) : null;
      const ad = w.avg_ad_position != null ? Math.round(w.avg_ad_position) : null;
      // лучшая (минимальная) позиция среди наших SKU
      if (!cur || (org != null && (cur.org == null || org < cur.org))) posByQuery.set(w.query, { org, ad });
    }
  }

  const queries = nicheKw
    .slice()
    .sort((a, b) => b.wb_count - a.wb_count)
    .slice(0, 15)
    .map((q) => {
      const p = posByQuery.get(q.word);
      return { word: q.word, wb_count: q.wb_count, our_org: p?.org ?? null, our_ad: p?.ad ?? null };
    });

  return NextResponse.json({
    ok: true,
    subject,
    cabinet: label || "Все кабинеты",
    weeks,
    series,
    niche_growth_pct: nicheGrowth,
    our_growth_pct: ourGrowth,
    rel_growth_pct: nicheGrowth != null && ourGrowth != null ? ourGrowth - nicheGrowth : null,
    share_pct: sharePct,
    queries,
    note: "MPStats — оценочные данные (для тренда). Свои деньги — из кабинета.",
  });
}
