import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getWbCommissionForCabinet } from "@/lib/wb/commissions";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";
import { loadRnpReportRows } from "@/lib/rnp/rpcLoaders";
import { loadHourlyDashboard } from "@/lib/cache/hourlyDashboard";
import { loadCabinetUnitSetting, resolveTaxPct } from "@/lib/unit/cabinetSettings";
import { UNIT_DEFAULT_TAX_PCT } from "@/lib/unit/query";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RpcRow {
  nm_id: number; article: string;
  orders_month: number; orders_sum_month: number;
  buyouts_month: number; buyouts_sum_month: number;
  stock: number; cost: number | null; ad_spend_month: number;
}

// Ставка по умолчанию: у кабинета может быть своя, её и берём.
const DEFAULT_TAX = UNIT_DEFAULT_TAX_PCT;

// ABC-анализ прибыли: какие SKU дают основную долю чистой прибыли (A/B/C) + убыточный «хвост».
export async function GET(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const p_cabinet = cabinetIdFromParam(new URL(req.url).searchParams.get("cabinet"));
  if (!(await hasCabinetAccess(p_cabinet))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const allowedNmIds = await requestAllowedNmIds(p_cabinet);
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";

  // Часовой снимок: ABC считается из тяжёлого rnp_report за месячное окно и
  // ничего не кэшировал — каждый заход стоил 8 секунд на крупном кабинете.
  // Данные суточной свежести, поэтому час здесь ничего не искажает.
  const payload = await loadHourlyDashboard(
    "wb-abc",
    // Схема 2: у строки появился класс «?» (нет себестоимости), прибыль стала
    // nullable, а ставка налога берётся из настроек кабинета. Без бампа снимок
    // старой формы жил бы ещё час и отдавал новому экрану пустую пятую плитку.
    { cabinetId: p_cabinet, schema: 2, extra: allowedNmIds ? [...allowedNmIds].sort().join(",") : "all" },
    async () => buildAbc(db, p_cabinet, allowedNmIds),
    refresh ? { forceRefresh: true } : {},
  );
  return NextResponse.json(payload);
}

async function buildAbc(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  p_cabinet: string | null,
  allowedNmIds: Set<number> | null,
) {
  const [rpcRes, costsRes, comm] = await Promise.all([
    loadRnpReportRows<RpcRow>(db, p_cabinet, {
      allowedNmIds,
      label: "ABC WB: товары",
    }),
    db.from("product_costs").select("article, name"),
    getWbCommissionForCabinet(p_cabinet, 30, { allowLiveFallback: false }),
  ]);
  const nameByArt = new Map<string, string>();
  for (const c of costsRes.data ?? []) nameByArt.set(c.article as string, (c.name as string) ?? "");
  const acq = comm.avgAcqPct > 0 ? comm.avgAcqPct : 1.5;
  // Налоговый режим у каждого юрлица свой — вбитые семь процентов делали
  // «прибыль» ABC неверной для всех остальных.
  const taxPct = resolveTaxPct({
    requested: null,
    cabinet: (await loadCabinetUnitSetting(db, p_cabinet).catch(() => null))?.taxPct ?? null,
    fallback: DEFAULT_TAX,
  }).taxPct;
  const commForNm = (nm: number) => comm.byNm.get(nm)?.pct ?? (comm.avgPct > 0 ? comm.avgPct : 25);

  const items = rpcRes.filter((r) => requestAllowsNm(allowedNmIds, r.nm_id)).map((r) => {
    const bs = Number(r.buyouts_sum_month ?? 0);
    const bc = Number(r.buyouts_month ?? 0);
    // Товар без заведённой закупочной цены раньше считался с себестоимостью
    // НОЛЬ: вся выручка минус комиссии превращалась в «прибыль», и такой SKU
    // уверенно въезжал в класс A «Ядро прибыли». Незнание себестоимости — не
    // ноль: прибыль по такому товару не считается вовсе.
    const costKnown = r.cost != null && Number(r.cost) > 0;
    const cost = costKnown ? Number(r.cost) : 0;
    const ad = Number(r.ad_spend_month ?? 0);
    const c = commForNm(r.nm_id);
    // чистая прибыль за 30 дней = выручка с выкупов − себес − комиссия% − эквайринг% − налог% − реклама
    const profit = costKnown ? Math.round(bs - cost * bc - bs * (c + acq + taxPct) / 100 - ad) : null;
    const rev = Math.round(Number(r.orders_sum_month ?? 0));
    return {
      nm: r.nm_id, art: r.article || String(r.nm_id), name: nameByArt.get(r.article) || "",
      img_url: wbCardImageUrl(r.nm_id), revenue: rev, profit,
      margin: profit != null && bs > 0 ? Math.round((profit / bs) * 1000) / 10 : null,
    };
  });

  // ранжируем по прибыли; накопительная доля по положительной прибыли → классы A/B/C
  const profitable = items.filter((i) => i.profit != null && i.profit > 0).sort((a, b) => b.profit! - a.profit!);
  const losers = items.filter((i) => i.profit != null && i.profit <= 0).sort((a, b) => a.profit! - b.profit!);
  // Отдельная корзина: посчитать нечем. Смешивать её с убыточными нельзя —
  // «убыточный» это вывод, а здесь вывода нет.
  const unknown = items.filter((i) => i.profit == null);
  const totalProfit = profitable.reduce((s, i) => s + (i.profit ?? 0), 0);

  let cum = 0;
  const ranked = profitable.map((i) => {
    cum += i.profit ?? 0;
    const cumPct = totalProfit > 0 ? (cum / totalProfit) * 100 : 0;
    const cls = cumPct <= 80 ? "A" : cumPct <= 95 ? "B" : "C";
    return { ...i, cumPct: Math.round(cumPct * 10) / 10, share: totalProfit > 0 ? Math.round(((i.profit ?? 0) / totalProfit) * 1000) / 10 : 0, cls };
  });
  const tail = losers.map((i) => ({ ...i, cumPct: null, share: null, cls: "D" }));
  const unrated = unknown.map((i) => ({ ...i, cumPct: null, share: null, cls: "?" }));

  const counts = { A: 0, B: 0, C: 0, D: tail.length, "?": unrated.length };
  for (const r of ranked) counts[r.cls as "A" | "B" | "C"]++;

  return {
    rows: [...ranked, ...tail, ...unrated],
    totalProfit,
    counts,
    skuTotal: items.length,
    aShareOfSku: items.length > 0 ? Math.round((counts.A / items.length) * 1000) / 10 : 0,
    period_days: 30,
  };
}
