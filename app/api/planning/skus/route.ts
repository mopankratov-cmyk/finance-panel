import { NextRequest, NextResponse } from "next/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";
import { loadRnpReportRows } from "@/lib/rnp/rpcLoaders";
import { loadCabinetPimRowsHourly } from "@/lib/wb/cards";
import { hasMpstats, itemSubject } from "@/lib/mpstats/client";
import {
  knownMpstatsSubjectId,
  loadMpstatsSeasonality,
  moscowCalendarDate,
  normalizedSubjectName,
  unavailableMpstatsSeasonality,
  type MpstatsSeasonalityResult,
} from "@/lib/planning/mpstatsSeasonality";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RpcRow {
  nm_id: number;
  article: string;
  orders_week: number;
  orders_sum_week: number;
  orders_month: number;
  orders_sum_month: number;
  stock: number;
}

// Контракт inferno: {skus:[{art,name,cat,ms_stock,wb_stock,wb_own,wb_jc}], count, ...}
export async function GET(request: NextRequest) {
  const searchParams = new URL(request.url).searchParams;
  const { cabinetId } = await resolveShopCabinet(searchParams.get("cabinet") ?? undefined);
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ skus: [], count: 0 });
  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  const currentDate = moscowCalendarDate();
  const currentYear = Number(currentDate.slice(0, 4));
  const currentMonth = Number(currentDate.slice(5, 7));
  const requestedYear = Number(searchParams.get("year"));
  const requestedMonth = Number(searchParams.get("month"));
  const targetYear = Number.isInteger(requestedYear) && requestedYear >= 2020 && requestedYear <= currentYear + 3
    ? requestedYear
    : currentYear;
  const targetMonth = Number.isInteger(requestedMonth) && requestedMonth >= 1 && requestedMonth <= 12
    ? requestedMonth
    : currentMonth;

  const [rpcRes, costsRes, pimRows] = await Promise.all([
    loadRnpReportRows<RpcRow>(db, cabinetId, {
      allowedNmIds,
      label: "Планирование WB: товары",
    }),
    db.from("product_costs").select("article, name, brand"),
    loadCabinetPimRowsHourly(cabinetId).catch(() => []),
  ]);

  const meta = new Map<string, { name: string; cat: string }>();
  for (const c of costsRes.data ?? []) {
    meta.set(c.article as string, { name: (c.name as string) ?? "", cat: (c.brand as string) || "Без категории" });
  }
  const pimByNmId = new Map(pimRows.map((row) => [row.nmId, row]));
  const pimByArticle = new Map(pimRows.map((row) => [row.article, row]));
  const scopedRows = rpcRes.filter((row) => requestAllowsNm(allowedNmIds, row.nm_id));

  const subjectGroups = new Map<string, { name: string; representativeNmId: number; ordersMonth: number }>();
  for (const row of scopedRows) {
    const pim = pimByNmId.get(row.nm_id) ?? pimByArticle.get(row.article);
    const subjectName = pim?.subject?.trim() ?? "";
    const key = normalizedSubjectName(subjectName);
    if (!key) continue;
    const previous = subjectGroups.get(key);
    if (!previous || Number(row.orders_month ?? 0) > previous.ordersMonth) {
      subjectGroups.set(key, {
        name: subjectName,
        representativeNmId: row.nm_id,
        ordersMonth: Number(row.orders_month ?? 0),
      });
    }
  }

  const subjectIds = new Map<string, number>();
  for (const [key, group] of subjectGroups) {
    const knownId = knownMpstatsSubjectId(group.name);
    if (knownId) subjectIds.set(key, knownId);
  }
  if (hasMpstats()) {
    const unknownGroups = [...subjectGroups.entries()]
      .filter(([key]) => !subjectIds.has(key))
      .sort((a, b) => b[1].ordersMonth - a[1].ordersMonth)
      .slice(0, 8);
    await Promise.all(unknownGroups.map(async ([key, group]) => {
      try {
        const resolved = await itemSubject(group.representativeNmId);
        if (resolved?.id) subjectIds.set(key, resolved.id);
      } catch {
        // План остаётся доступен с нейтральным коэффициентом; MPSTATS —
        // вспомогательный источник и не должен ломать загрузку каталога.
      }
    }));
  }

  const seasonalityBySubject = new Map<string, MpstatsSeasonalityResult>();
  await Promise.all([...subjectGroups.entries()].map(async ([key, group]) => {
    const subjectId = subjectIds.get(key) ?? null;
    if (!subjectId) {
      seasonalityBySubject.set(key, unavailableMpstatsSeasonality(group.name, null));
      return;
    }
    if (!hasMpstats() && `${targetYear}-${String(targetMonth).padStart(2, "0")}` > currentDate.slice(0, 7)) {
      seasonalityBySubject.set(
        key,
        unavailableMpstatsSeasonality(group.name, subjectId, "MPSTATS не настроен; применён нейтральный коэффициент 1,0"),
      );
      return;
    }
    try {
      seasonalityBySubject.set(key, await loadMpstatsSeasonality({
        subjectId,
        subjectName: group.name,
        targetYear,
        targetMonth,
        currentDate,
      }));
    } catch {
      seasonalityBySubject.set(
        key,
        unavailableMpstatsSeasonality(group.name, subjectId, "MPSTATS временно недоступен; применён нейтральный коэффициент 1,0"),
      );
    }
  }));

  const skus = scopedRows
    .map((r) => {
      const m = meta.get(r.article);
      const pim = pimByNmId.get(r.nm_id) ?? pimByArticle.get(r.article);
      const subject = pim?.subject?.trim() ?? "";
      const seasonality = seasonalityBySubject.get(normalizedSubjectName(subject))
        ?? unavailableMpstatsSeasonality(subject, null);
      const wb = Number(r.stock ?? 0);
      return {
        nm_id: r.nm_id,
        external_id: String(r.nm_id),
        art: r.article || String(r.nm_id),
        name: m?.name || pim?.name || r.article || String(r.nm_id),
        cat: subject || m?.cat || "Без категории",
        subject,
        ms_stock: 0,
        wb_stock: wb,
        wb_own: wb,
        wb_jc: 0,
        orders_week: Number(r.orders_week ?? 0),
        orders_sum_week: Number(r.orders_sum_week ?? 0),
        orders_month: Number(r.orders_month ?? 0),
        orders_sum_month: Number(r.orders_sum_month ?? 0),
        avg_daily_7: Number(r.orders_week ?? 0) / 7,
        avg_price_month: Number(r.orders_month ?? 0) > 0 ? Number(r.orders_sum_month ?? 0) / Number(r.orders_month ?? 0) : 0,
        seasonality_factor: seasonality.factor,
        seasonality_raw_factor: seasonality.rawFactor,
        seasonality_source: seasonality.source,
        seasonality_subject: seasonality.subjectName,
        seasonality_subject_id: seasonality.subjectId,
        seasonality_note: seasonality.note,
        demand_factor: 1,
      };
    })
    .sort((a, b) => a.art.localeCompare(b.art));

  return NextResponse.json({
    skus,
    count: skus.length,
    wb_stock_date: new Date().toISOString().slice(0, 10),
    jc_stock_date: null,
    ms_matched: 0,
    wb_matched: skus.length,
    wb_jc_matched: 0,
    planning_period: `${targetYear}-${String(targetMonth).padStart(2, "0")}`,
  });
}
