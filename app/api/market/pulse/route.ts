import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { hasMpstats, subjectByDate, subjectKeywords, subjectByDateId, subjectKeywordsId, itemKeywords, mpstatsRouteError } from "@/lib/mpstats/client";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";
import { loadHourlyDashboard } from "@/lib/cache/hourlyDashboard";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { closedMoscowDates } from "@/lib/wb/sklejki";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// MPStats-вызовы POST Next не кэширует автоматически: используем общий часовой снимок.

const isoWeek = (s: string) => { const [y, m, dd] = s.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, dd)); const day = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - day); return dt.toISOString().slice(0, 10); };

// «Пульс рынка»: ниша (MPStats) ↔ мы (свои wb_orders), и запросы ↔ наши позиции.
// MPStats — оценочные данные (для тренда/направления, не абсолюта).
// Параметры: subject (путь предмета), cabinet, gran=day|week, date_from/date_to (или weeks).
export async function GET(request: NextRequest) {
  try {
    return await loadPulse(request);
  } catch (error) {
    const failure = mpstatsRouteError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}

async function loadPulse(request: NextRequest) {
  if (!hasMpstats()) return NextResponse.json({ error: "MPSTATS_TOKEN не настроен в окружении" }, { status: 501 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const sp = new URL(request.url).searchParams;
  const subjectId = sp.get("subject_id"); // приоритет: предмет по id (точнее)
  const subject = sp.get("subject") || ""; // legacy: путь категории
  if (!subjectId && !subject) return NextResponse.json({ error: "Укажите ниши (subject_id или путь)" }, { status: 400 });
  const { cabinetId, label } = await resolveShopCabinet(sp.get("cabinet") ?? undefined);
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  const gran: "day" | "week" = sp.get("gran") === "day" ? "day" : "week";

  // период: явные даты (d2 не позже вчера — MPStats требует d2 < сегодня) или последние N недель
  const yest = closedMoscowDates(1)[0];
  const dfP = sp.get("date_from"), dtP = sp.get("date_to");
  let d1: string, d2: string;
  if (dfP && dtP) { d1 = dfP; d2 = dtP > yest ? yest : dtP; }
  else {
    const weeks = Math.min(16, Math.max(2, Number(sp.get("weeks")) || 8));
    const dates = closedMoscowDates(weeks * 7);
    d2 = yest;
    d1 = dates[0];
  }

  const payload = await loadHourlyDashboard(
    "wb-market-pulse",
    { subjectId: subjectId || null, subject, cabinetId, gran, d1, d2 },
    async () => {

  // ниша + запросы: по subject_id (точнее) или по пути категории (legacy)
  const [nicheDays, nicheKw] = await Promise.all(
    subjectId
      ? [subjectByDateId(subjectId, d1, d2), subjectKeywordsId(subjectId, d1, d2, 300)]
      : [subjectByDate(subject, d1, d2), subjectKeywords(subject, d1, d2, 300)],
  );
  const ourDailyRows = await loadAllSupabasePages<{ d: string; nm_id: number; orders_sum: number }>((from, to) => {
    let query = db
      .rpc("rnp_daily_sku", { p_from: d1, p_to: d2, p_cabinet: cabinetId })
      .order("d", { ascending: true })
      .order("nm_id", { ascending: true })
      .range(from, to);
    if (allowedNmIds) query = query.in("nm_id", allowedNmIds.size ? [...allowedNmIds] : [-1]);
    return query;
  }, { label: "Пульс рынка: заказы WB" });

  // бакетизация: день = сама дата, неделя = понедельник недели
  const bkt = (s: string) => (gran === "day" ? s.slice(0, 10) : isoWeek(s.slice(0, 10)));
  const nicheBy = new Map<string, number>();
  for (const r of nicheDays) { if (!r.period) continue; const k = bkt(String(r.period)); nicheBy.set(k, (nicheBy.get(k) ?? 0) + Number(r.revenue ?? 0)); }
  const ourBy = new Map<string, number>();
  for (const r of ourDailyRows) {
    if (!requestAllowsNm(allowedNmIds, r.nm_id)) continue;
    const k = bkt(String(r.d));
    ourBy.set(k, (ourBy.get(k) ?? 0) + Number(r.orders_sum ?? 0));
  }

  const buckets = [...new Set([...nicheBy.keys(), ...ourBy.keys()])].sort();
  // окно сравнения — бакеты, где у НАС есть данные (история заказов короче ниши)
  const ourBuckets = buckets.filter((k) => (ourBy.get(k) ?? 0) > 0);
  const firstOur = ourBuckets[0]; // нашу линию рисуем с этого бакета (раньше — null)
  const series = buckets.map((k) => ({
    bucket: k,
    niche: Math.round(nicheBy.get(k) ?? 0),
    ours: firstOur && k >= firstOur ? Math.round(ourBy.get(k) ?? 0) : null,
  }));
  // рост = средняя второй половины окна / средняя первой (устойчиво к нулям/выбросам)
  const avg = (m: Map<string, number>, ks: string[]) => (ks.length ? ks.reduce((s, k) => s + (m.get(k) ?? 0), 0) / ks.length : 0);
  const growthOver = (m: Map<string, number>, ks: string[]) => {
    if (ks.length < 2) return null;
    const h = Math.max(1, Math.floor(ks.length / 2));
    const a = avg(m, ks.slice(0, h)), b = avg(m, ks.slice(-h));
    return a > 0 ? Math.round((b / a - 1) * 100) : null;
  };
  const nicheGrowth = growthOver(nicheBy, ourBuckets);
  const ourGrowth = growthOver(ourBy, ourBuckets);

  // доля — в окне наших данных; MPStats занижает нишу → доля скорее завышена
  const nicheRevWin = ourBuckets.reduce((a, k) => a + (nicheBy.get(k) ?? 0), 0);
  const ourRevWin = ourBuckets.reduce((a, k) => a + (ourBy.get(k) ?? 0), 0);
  const sharePct = nicheRevWin > 0 ? Math.round((ourRevWin / nicheRevWin) * 1000) / 10 : null;

  // — топ-запросы ниши + наши позиции по топ-SKU кабинета —
  const reportRows = await loadAllSupabasePages<{ nm_id: number; orders_sum_month: number }>((from, to) => {
    let query = db
      .rpc("rnp_report", { p_cabinet: cabinetId })
      .order("nm_id", { ascending: true })
      .range(from, to);
    if (allowedNmIds) query = query.in("nm_id", allowedNmIds.size ? [...allowedNmIds] : [-1]);
    return query;
  }, { label: "Пульс рынка: товары WB" });
  const ourSkus = reportRows
    .filter((row) => requestAllowsNm(allowedNmIds, row.nm_id))
    .slice()
    .sort((a, b) => Number(b.orders_sum_month ?? 0) - Number(a.orders_sum_month ?? 0))
    .slice(0, 15)
    .map((r) => r.nm_id);

  const posByQuery = new Map<string, { org: number | null; ad: number | null }>();
  const kwLists = await Promise.all(ourSkus.map((nm) => itemKeywords(nm, d1, d2)));
  for (const kw of kwLists) {
    for (const w of kw) {
      const cur = posByQuery.get(w.query);
      const org = w.avg_organic_position != null ? Math.round(w.avg_organic_position) : null;
      const ad = w.avg_ad_position != null ? Math.round(w.avg_ad_position) : null;
      if (!cur || (org != null && (cur.org == null || org < cur.org))) posByQuery.set(w.query, { org, ad });
    }
  }

  const queries = nicheKw
    .slice()
    .sort((a, b) => b.wb_count - a.wb_count)
    .slice(0, 15)
    .map((q) => { const p = posByQuery.get(q.word); return { word: q.word, wb_count: q.wb_count, our_org: p?.org ?? null, our_ad: p?.ad ?? null }; });

      return {
        ok: true,
        subject_id: subjectId || null,
        subject,
        cabinet: label || "Все кабинеты",
        gran,
        date_from: d1,
        date_to: d2,
        series,
        niche_growth_pct: nicheGrowth,
        our_growth_pct: ourGrowth,
        rel_growth_pct: nicheGrowth != null && ourGrowth != null ? ourGrowth - nicheGrowth : null,
        share_pct: sharePct,
        queries,
        note: "MPStats — оценочные данные (для тренда). Свои деньги — из кабинета.",
      };
    },
    {
      forceRefresh: request.nextUrl.searchParams.get("refresh") === "1",
      backgroundRefresh: request.nextUrl.searchParams.get("background") === "1",
    },
  );
  return NextResponse.json(payload, { headers: { "X-Dashboard-Cache": "hourly-snapshot" } });
}
