import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import { getWbCommissionForCabinet, resolveWbRatesForNm } from "@/lib/wb/commissions";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";
import { loadHourlyDashboard } from "@/lib/cache/hourlyDashboard";
import { formatUnitPeriod, parseUnitPeriodQuery, UNIT_PERIOD_TIMEZONE, unitPeriodCacheIdentity } from "@/lib/unit/period";
import { parseUnitMoneyQuery } from "@/lib/unit/query";
import { mergeScopedUnitPeriodRows, type ScopedUnitCatalogRow, type ScopedUnitDailyRow, type ScopedUnitReferenceRow } from "@/lib/unit/scopedPeriodReport";
import { loadRnpDailySkuRows, loadRnpReportRows } from "@/lib/rnp/rpcLoaders";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { checkCronAuth } from "@/lib/sync/helpers";
import { parseUnitCabinetScope } from "@/lib/unit/cabinetScope";
import { isConfiguredCronBearer } from "@/lib/unit/cronAuth";

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

// Юнит-экономика WB «1 в 1» с инферноф (формула калькулятора Юры):
// Прибыль/ед = Цена до СПП − Себес − Фулфилмент − удержания WB − Эквайринг − Реклама(ДРР) − Налог.
// Целевые цены и маржу не публикуем, пока нет себестоимости и фактических ставок WB.
// СПП %/Цена после СПП НЕ считаем — в БД нет (discount_percent ≠ СПП).
export async function GET(req: NextRequest) {
  const isCron = isConfiguredCronBearer(
    req.headers.get("authorization"),
    process.env.CRON_SECRET,
  ) && checkCronAuth(req) === null;
  if (!isCron) {
    const gate = await requireApiSession(["director", "finance", "manager"]);
    if (gate) return gate;
  }

  const sp = new URL(req.url).searchParams;
  let period;
  let money;
  let cabinetScope;
  try {
    period = parseUnitPeriodQuery(sp);
    money = parseUnitMoneyQuery(sp);
    cabinetScope = parseUnitCabinetScope(sp.get("cabinet"));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Некорректные параметры" }, { status: 400 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Сервис данных временно недоступен" }, { status: 503 });
  let resolved = { cabinetId: null as string | null, label: undefined as string | undefined };
  if (!cabinetScope.aggregate) {
    try {
      resolved = await resolveShopCabinet(cabinetScope.rawCabinet);
    } catch {
      return NextResponse.json({ error: "Сервис кабинетов временно недоступен" }, { status: 503 });
    }
    if (resolved.cabinetId !== cabinetScope.rawCabinet) {
      return NextResponse.json({ error: "Кабинет не найден" }, { status: 404 });
    }
  }
  const p_cabinet = cabinetScope.aggregate ? null : resolved.cabinetId;
  const { taxPct, ff, targetMargin } = money;
  if (!(await hasCabinetAccess(p_cabinet))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const allowedNmIds = await requestAllowedNmIds(p_cabinet);
  const forceRefresh = sp.get("refresh") === "1";
  const backgroundRefresh = sp.get("background") === "1";

  const buildPayload = async () => {
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
    const identity = unitPeriodCacheIdentity({ cabinetId: p_cabinet, from: period.from, to: period.to, taxPct, ff, targetMargin });
    let payload = await loadHourlyDashboard(
      "wb-unit-table",
      identity,
      buildPayload,
      { forceRefresh, backgroundRefresh },
    );
    // Пустой снимок мог попасть в часовой кэш до завершения product-scope.
    // При уже заполненном allowlist один раз пересобираем его автоматически.
    if (allowedNmIds !== null && allowedNmIds.size > 0 && payload.rows.length === 0 && !forceRefresh) {
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
