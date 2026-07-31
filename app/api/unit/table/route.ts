import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import { getWbCommissionForCabinet, resolveWbRatesForNm } from "@/lib/wb/commissions";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";
import { loadHourlyDashboard } from "@/lib/cache/hourlyDashboard";
import { formatUnitPeriod, parseUnitPeriodQuery, UNIT_PERIOD_TIMEZONE, unitPeriodCacheIdentity } from "@/lib/unit/period";
import { parseUnitMoneyQuery, parseUnitRefreshQuery, validateUnitSingletonQuery } from "@/lib/unit/query";
import { mergeScopedUnitPeriodRows, type ScopedUnitCatalogRow, type ScopedUnitDailyRow, type ScopedUnitReferenceRow } from "@/lib/unit/scopedPeriodReport";
import { loadRnpDailySkuRows, loadRnpReportRows } from "@/lib/rnp/rpcLoaders";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { checkCronAuth } from "@/lib/sync/helpers";
import { isConfiguredCronBearer } from "@/lib/unit/cronAuth";
import {
  assertUnitScopeAccess,
  assertUnitMemberAccess,
  parseUnitCabinetQuery,
  resolveUnitCabinetScope,
  UnitScopeError,
  type UnitResolvedScope,
} from "@/lib/unit/groupScope";
import { loadUnitCommissionCache } from "@/lib/unit/commissionCache";
import { aggregateUnitContributions, type UnitContribution } from "@/lib/unit/groupAggregation";
import { mapLimitAllOrThrow } from "@/lib/unit/mapLimit";
import { loadUnitProductScope } from "@/lib/unit/productScope";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RpcRow {
  nm_id: number;
  article: string;
  orders_month: number;
  orders_sum_month: number;
  buyouts_month: number;
  stock: number;
  in_way_to_client: number;
  cost: number | null;
  ad_spend_month: number;
}

type UnitDb = NonNullable<ReturnType<typeof getSupabaseAdmin>>;
type ProductMeta = { name: string; cat: string; storage: number; cost: number | null };

async function loadGroupPayload(
  db: UnitDb,
  scope: Extract<UnitResolvedScope, { mode: "group" }>,
  period: { from: string; to: string },
  money: { taxPct: number; ff: number; targetMargin: number },
) {
  const costsRes = await db.from("product_costs").select("article, name, entity, cost_rub, warehouse_expenses");
  if (costsRes.error) throw new Error(costsRes.error.message);
  const meta = new Map<string, ProductMeta>();
  for (const costRow of costsRes.data ?? []) {
    meta.set(costRow.article as string, {
      name: (costRow.name as string) ?? "",
      cat: (costRow.entity as string) ?? "",
      storage: Number(costRow.warehouse_expenses ?? 0),
      cost: costRow.cost_rub == null ? null : Number(costRow.cost_rub),
    });
  }

  const parts = await mapLimitAllOrThrow(scope.members, 3, async (cabinetId) => {
    const [rpcResult, allowedNmIds, commissions] = await Promise.all([
      db.rpc("unit_report_period", {
        p_cabinet: cabinetId,
        p_from: period.from,
        p_to: period.to,
      }),
      loadUnitProductScope(cabinetId, {
        cabinet: async () => {
          const result = await db.from("wb_cabinets")
            .select("name, trade_mark, brand_filters")
            .eq("id", cabinetId)
            .eq("marketplace", "wb")
            .eq("is_active", true)
            .maybeSingle();
          return { data: result.data, error: result.error };
        },
        scopeRows: () => loadAllSupabasePages<{ nm_id: unknown }>((from, to) => db
          .from("wb_cabinet_product_scope")
          .select("nm_id")
          .eq("cabinet_id", cabinetId)
          .order("nm_id", { ascending: true })
          .range(from, to), {
          label: "Unit group: allowlist товарного контура",
          maxPages: 1_000,
        }),
      }),
      loadUnitCommissionCache(async (table, columns, scopedCabinetId, from, to) => {
        const query = db.from(table)
          .select(columns)
          .eq("cabinet_id", scopedCabinetId)
          .order(table === "wb_nm_commissions" ? "nm_id" : "cabinet_id", { ascending: true })
          .range(from, to);
        const result = await query;
        return { data: result.data, error: result.error };
      }, cabinetId),
    ]);
    if (rpcResult.error) throw new Error(rpcResult.error.message);
    let scopedRows = ((rpcResult.data ?? []) as RpcRow[])
      .filter((row) => requestAllowsNm(allowedNmIds, row.nm_id));

    if (allowedNmIds !== null && allowedNmIds.size > 0 && scopedRows.length === 0) {
      const [dailyRows, referenceRows, catalogRows] = await Promise.all([
        loadRnpDailySkuRows<ScopedUnitDailyRow>(db, {
          from: period.from,
          to: period.to,
          cabinetId,
          allowedNmIds,
          label: "Unit group: календарный факт по SKU",
        }),
        loadRnpReportRows<ScopedUnitReferenceRow>(db, cabinetId, {
          allowedNmIds,
          label: "Unit group: остатки и себестоимость",
        }),
        loadAllSupabasePages<{ nm_id: number; article: string }>((from, to) => db
          .from("wb_cabinet_product_scope")
          .select("nm_id, article")
          .eq("cabinet_id", cabinetId)
          .in("nm_id", [...allowedNmIds])
          .order("nm_id", { ascending: true })
          .range(from, to), { label: "Unit group: товарный контур", maxPages: 100 }),
      ]);
      scopedRows = mergeScopedUnitPeriodRows(
        allowedNmIds,
        dailyRows,
        referenceRows,
        catalogRows.map((row) => ({ ...row, cost: meta.get(row.article)?.cost ?? null })),
      );
    }

    return scopedRows.map((row): UnitContribution => {
      const rates = commissions.resolve(row.nm_id);
      const rowCost = row.cost != null && Number(row.cost) > 0
        ? Number(row.cost)
        : meta.get(row.article)?.cost ?? null;
      return {
        cabinetId,
        nmId: row.nm_id,
        article: row.article || String(row.nm_id),
        orders: Number(row.orders_month ?? 0),
        revenue: Number(row.orders_sum_month ?? 0),
        buyouts: Number(row.buyouts_month ?? 0),
        stock: Number(row.stock ?? 0) + Number(row.in_way_to_client ?? 0),
        adSpend: Number(row.ad_spend_month ?? 0),
        costPerUnit: rowCost != null && rowCost > 0 ? rowCost : null,
        marketplacePct: rates.marketplacePct,
        acquiringPct: rates.acquiringPct,
        ratesFactual: rates.factual,
      };
    });
  });

  const aggregated = aggregateUnitContributions(parts.flat(), money);
  const round0 = (value: number) => Math.round(value);
  const round1 = (value: number) => Math.round(value * 10) / 10;
  const blank = (value: number | null) => value == null || !Number.isFinite(value) ? "" : value;
  const rows = aggregated.map((row): (string | number)[] => {
    const product = meta.get(row.article);
    return [
      "", "",
      row.article,
      product?.cat ?? "",
      row.nmId,
      row.stock,
      blank(row.costPerUnit == null ? null : round0(row.costPerUnit)),
      blank(row.revenue > 0 && row.orders > 0 ? round0(row.revenue / row.orders) : null),
      row.orders,
      round0(row.revenue),
      blank(row.buyoutPct == null ? null : round1(row.buyoutPct)),
      blank(row.marketplacePct == null ? null : round1(row.marketplacePct)),
      blank(row.marketplacePerUnit == null ? null : round0(row.marketplacePerUnit)),
      blank(row.acquiringRub == null || row.revenue <= 0 || row.orders <= 0 ? null : round0(row.acquiringRub / row.orders)),
      round0(row.adSpend),
      blank(row.drrPct == null ? null : round1(row.drrPct)),
      blank(row.revenue > 0 && row.orders > 0 ? round0(row.taxRub / row.orders) : null),
      blank(row.marginPerUnit == null ? null : round0(row.marginPerUnit)),
      blank(row.marginBeforeDrrPct == null ? null : round1(row.marginBeforeDrrPct)),
      blank(row.marginAfterDrrPct == null ? null : round1(row.marginAfterDrrPct)),
      "",
      "",
    ];
  });
  const costsKnown = aggregated.filter((row) => row.costPerUnit != null).length;
  const factualRatesKnown = aggregated.filter((row) => row.marketplacePct != null).length;
  const complete = aggregated.filter((row) => row.costPerUnit != null && row.marketplacePct != null).length;
  return {
    headers: [
      "", "", "Артикул", "Юрлицо", "SKU",
      "Текущий остаток + в пути", "Себес ₽/ед", "Цена до СПП ₽/ед", "Заказы", "Выручка ₽",
      "Продажи / заказы %", "Удержания WB %", "Удержания WB ₽/ед", "Эквайринг ₽/ед", "Реклама ₽",
      "ДРР %", "Налог ₽/ед", "Маржа ₽/ед", "Маржа % до ДРР", "Вал % ПОСЛЕ ДРР",
      `Цена до СПП ₽/ед для ${money.targetMargin}% маржи`, "Дельта %",
    ],
    rows,
    img_urls: aggregated.map((row) => wbCardImageUrl(row.nmId)),
    names: aggregated.map((row) => meta.get(row.article)?.name ?? ""),
    source_url: null,
    coverage: { total: rows.length, costsKnown, factualRatesKnown, complete },
    meta_text: `Группа ${scope.members.length} кабинетов · юнит по ${rows.length} SKU · полный факт ${complete}/${rows.length} · ставки комиссий — последний синхронизированный 30-дневный snapshot, не исторический факт выбранного периода · целевая цена и дельта для группы недоступны · налог ${money.taxPct}% · ${formatUnitPeriod(period)}`,
    periodFrom: period.from,
    periodTo: period.to,
    timezone: UNIT_PERIOD_TIMEZONE,
  };
}

// Юнит-экономика WB «1 в 1» с инферноф (формула калькулятора Юры):
// Прибыль/ед = Цена до СПП − Себес − Фулфилмент − удержания WB − Эквайринг − Реклама(ДРР) − Налог.
// Целевые цены и маржу не публикуем, пока нет себестоимости и фактических ставок WB.
// СПП %/Цена после СПП НЕ считаем — в БД нет (discount_percent ≠ СПП).
export async function GET(req: NextRequest) {
  const isCron = isConfiguredCronBearer(
    req.headers.get("authorization"),
    process.env.CRON_SECRET,
  ) && checkCronAuth(req) === null;
  let session = null;
  if (!isCron) {
    const gate = await requireApiSession(["director", "finance", "manager", "seller"]);
    if (gate) return gate;
    session = await getServerSession();
    if (!session) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
    if (!["director", "finance", "manager", "seller"].includes(session.role)) {
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    }
  }

  const sp = new URL(req.url).searchParams;
  let period;
  let money;
  let rawCabinet;
  let refresh;
  try {
    validateUnitSingletonQuery(sp);
    period = parseUnitPeriodQuery(sp);
    money = parseUnitMoneyQuery(sp);
    rawCabinet = parseUnitCabinetQuery(sp);
    refresh = parseUnitRefreshQuery(sp);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Некорректные параметры" }, { status: 400 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Сервис данных временно недоступен" }, { status: 503 });
  let scope: UnitResolvedScope;
  try {
    scope = await resolveUnitCabinetScope(rawCabinet, {
      group: async (id) => {
        const result = await db.from("cabinet_groups")
          .select("id, marketplace, member_ids")
          .eq("id", id)
          .eq("marketplace", "wb")
          .maybeSingle();
        return { data: result.data, error: result.error };
      },
      authorizeMembers: (members) => assertUnitMemberAccess(session, members),
      cabinets: async (ids) => {
        const result = await db.from("wb_cabinets")
          .select("id, marketplace, is_active")
          .in("id", ids)
          .eq("marketplace", "wb")
          .eq("is_active", true);
        return { data: result.data, error: result.error };
      },
    });
    assertUnitScopeAccess(session, scope);
  } catch (error) {
    if (error instanceof UnitScopeError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Сервис кабинетов временно недоступен" }, { status: 503 });
  }
  const p_cabinet = scope.mode === "single" ? scope.cabinetId : null;
  const { taxPct, ff, targetMargin } = money;
  const allowedNmIds = scope.mode === "group" ? null : await requestAllowedNmIds(p_cabinet);
  const { forceRefresh, backgroundRefresh } = refresh;

  const buildPayload = async () => {
    if (scope.mode === "group") {
      return loadGroupPayload(db, scope, period, money);
    }
    const [rpcRes, costsRes, comm] = await Promise.all([
      db.rpc("unit_report_period", { p_cabinet, p_from: period.from, p_to: period.to }),
      db.from("product_costs").select("article, name, entity, cost_rub, warehouse_expenses"),
      getWbCommissionForCabinet(p_cabinet, 30),
    ]);
    if (rpcRes.error) throw new Error(rpcRes.error.message);
    if (costsRes.error) throw new Error(costsRes.error.message);
    const meta = new Map<string, { name: string; cat: string; storage: number; cost: number | null }>();
    for (const c of costsRes.data ?? []) meta.set(c.article as string, {
      name: (c.name as string) ?? "",
      cat: (c.entity as string) ?? "",
      storage: Number(c.warehouse_expenses ?? 0),
      cost: c.cost_rub == null ? null : Number(c.cost_rub),
    });

    const r0 = (n: number) => Math.round(n);
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const blank = (n: number | null) => (n == null || !isFinite(n) ? "" : n);

    const rows: (string | number)[][] = [];
    const img_urls: string[] = [];
    const names: string[] = [];
    let costsKnown = 0;
    let factualRatesKnown = 0;

    let scopedRows = ((rpcRes.data ?? []) as RpcRow[])
      .filter((row) => requestAllowsNm(allowedNmIds, row.nm_id));

    // Optima and other restricted cabinets are driven by their allowlist.
    // If the legacy calendar RPC returns no allowed SKU, rebuild the same period
    // from the current paged RNP sources instead of failing the whole screen.
    if (p_cabinet && allowedNmIds !== null && allowedNmIds.size > 0 && scopedRows.length === 0) {
      const [dailyRows, referenceRows, catalogRows] = await Promise.all([
        loadRnpDailySkuRows<ScopedUnitDailyRow>(db, {
          from: period.from,
          to: period.to,
          cabinetId: p_cabinet,
          allowedNmIds,
          label: "Unit: календарный факт по SKU",
        }),
        loadRnpReportRows<ScopedUnitReferenceRow>(db, p_cabinet, {
          allowedNmIds,
          label: "Unit: остатки и себестоимость",
        }),
        loadAllSupabasePages<{ nm_id: number; article: string }>((from, to) => db
          .from("wb_cabinet_product_scope")
          .select("nm_id, article")
          .eq("cabinet_id", p_cabinet)
          .in("nm_id", [...allowedNmIds])
          .order("nm_id", { ascending: true })
          .range(from, to), { label: "Unit: товарный контур", maxPages: 100 }),
      ]);
      const enrichedCatalogRows: ScopedUnitCatalogRow[] = catalogRows.map((row) => ({
        ...row,
        cost: meta.get(row.article)?.cost ?? null,
      }));
      scopedRows = mergeScopedUnitPeriodRows(allowedNmIds, dailyRows, referenceRows, enrichedCatalogRows);
    }

    const sorted = scopedRows.slice().sort((a, b) => Number(b.orders_sum_month) - Number(a.orders_sum_month));

    for (const r of sorted) {
      const m = meta.get(r.article);
      const orders = r.orders_month;
      const rev = Number(r.orders_sum_month);
      const costKnown = r.cost != null && Number(r.cost) > 0;
      const cost = costKnown ? Number(r.cost) : 0;
      const ad = Number(r.ad_spend_month ?? 0);
      const stock = Number(r.stock ?? 0) + Number(r.in_way_to_client ?? 0);
      const price = orders > 0 ? rev / orders : 0;          // Цена до СПП = ср. finished_price
      const buyoutPct = orders > 0 ? (r.buyouts_month / orders) * 100 : null;
      const drr = rev > 0 ? (ad / rev) * 100 : 0;
      const adPerUnit = orders > 0 ? ad / orders : 0;
      const rates = resolveWbRatesForNm(comm, r.nm_id);
      if (costKnown) costsKnown++;
      if (rates.factual) factualRatesKnown++;
      const marketplaceRub = price * rates.marketplacePct / 100;
      const acqRub = price * rates.acquiringPct / 100;
      const taxRub = price * taxPct / 100;
      const canCalculate = price > 0 && costKnown && rates.factual;
      // Маржа ДО ДРР (без рекламы)
      const marginBeforeDrr = canCalculate ? price - cost - ff - marketplaceRub - acqRub - taxRub : null;
      const marginBeforeDrrPct = marginBeforeDrr != null ? (marginBeforeDrr / price) * 100 : null;
      // Маржа/ед и вал % ПОСЛЕ ДРР (минус реклама)
      const marginUnit = marginBeforeDrr != null ? marginBeforeDrr - adPerUnit : null;
      const valAfterDrrPct = marginUnit != null ? (marginUnit / price) * 100 : null;
      // Целевая цена до СПП для N% маржи: price = (cost+ff) / (1 − (comm+acq+tax+drr+margin)/100)
      const den = 1 - (rates.marketplacePct + rates.acquiringPct + taxPct + drr + targetMargin) / 100;
      const targetPrice = canCalculate && den > 0 ? (cost + ff) / den : null;
      const deltaPct = targetPrice && price > 0 ? ((price - targetPrice) / targetPrice) * 100 : null;

      rows.push([
        "",                                   // 0 чекбокс
        "",                                   // 1 фото
        r.article || String(r.nm_id),         // 2 артикул (+ название под)
        m?.cat || "",                         // 3 категория
        r.nm_id,                              // 4 SKU → ссылка
        stock,                                // 5 Остаток + в пути
        blank(costKnown ? r0(cost) : null),   // 6 Себес ₽
        blank(price > 0 ? r0(price) : null),  // 7 Цена до СПП ₽
        orders,                               // 8 Заказы
        r0(rev),                              // 9 Выручка ₽
        buyoutPct != null ? r1(buyoutPct) : "", // 10 Выкуп %
        blank(rates.factual ? r1(rates.marketplacePct) : null), // 11 комиссия + логистика/хранение/прочие WB
        blank(price > 0 && rates.factual ? r0(marketplaceRub) : null), // 12 удержания WB ₽
        blank(price > 0 && rates.factual ? r0(acqRub) : null), // 13 Эквайринг ₽
        r0(ad),                               // 14 Реклама ₽
        r1(drr),                              // 15 ДРР %
        blank(price > 0 ? r0(taxRub) : null), // 16 Налог ₽
        blank(marginUnit != null ? r0(marginUnit) : null), // 17 Маржа/ед ₽
        marginBeforeDrrPct != null ? r1(marginBeforeDrrPct) : "", // 18 Маржа % до ДРР
        valAfterDrrPct != null ? r1(valAfterDrrPct) : "",          // 19 Вал % ПОСЛЕ ДРР
        targetPrice != null ? r0(targetPrice) : "",                // 20 Цена до СПП для N% маржи
        deltaPct != null ? r1(deltaPct) : "",                      // 21 Дельта %
      ]);
      img_urls.push(wbCardImageUrl(r.nm_id));
      names.push(m?.name || "");
    }

    const totalRows = rows.length;
    const completeRows = sorted.filter((row) => row.cost != null && Number(row.cost) > 0 && resolveWbRatesForNm(comm, row.nm_id).factual).length;
    return {
      headers: [
        "", "", "Артикул", "Юрлицо", "SKU",
        "Остаток + в пути", "Себес ₽", "Цена до СПП ₽", "Заказы", "Выручка ₽",
        "Выкуп %", "Удержания WB %", "Удержания WB ₽", "Эквайринг ₽", "Реклама ₽",
        "ДРР %", "Налог ₽", "Маржа/ед ₽", "Маржа % до ДРР", "Вал % ПОСЛЕ ДРР",
        `Цена до СПП для ${targetMargin}% маржи`, "Дельта %",
      ],
      rows,
      img_urls,
      names,
      source_url: null,
      coverage: { total: totalRows, costsKnown, factualRatesKnown, complete: completeRows },
      meta_text: `Юнит по ${totalRows} SKU · полный факт ${completeRows}/${totalRows} · себестоимость ${costsKnown}/${totalRows} · ставки WB ${factualRatesKnown}/${totalRows} · налог ${taxPct}% · ${formatUnitPeriod(period)}`,
      periodFrom: period.from,
      periodTo: period.to,
      timezone: UNIT_PERIOD_TIMEZONE,
    };
  };

  try {
    const identity = unitPeriodCacheIdentity({
      scopeKey: scope.scopeKey,
      from: period.from,
      to: period.to,
      taxPct,
      ff,
      targetMargin,
    });
    let payload = await loadHourlyDashboard(
      "wb-unit-table",
      identity,
      buildPayload,
      { forceRefresh, backgroundRefresh },
    );
    // Пустой снимок мог попасть в часовой кэш до завершения product-scope.
    // При уже заполненном allowlist один раз пересобираем его автоматически.
    if (scope.mode !== "group" && allowedNmIds !== null && allowedNmIds.size > 0 && payload.rows.length === 0 && !forceRefresh) {
      payload = await loadHourlyDashboard(
        "wb-unit-table",
        identity,
        buildPayload,
        { forceRefresh: true },
      );
    }
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ error: "Сервис данных временно недоступен" }, { status: 503 });
  }
}
