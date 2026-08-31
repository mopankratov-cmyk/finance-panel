import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { buildRnpReport, type RnpRow } from "@/lib/rnp/buildRnp";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getWbCommissionForCabinet, resolveWbRatesForNm } from "@/lib/wb/commissions";
import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { fetchWbCatalogPrices, WbPriceScopeError } from "@/lib/wb/prices";
import { solvePrices } from "@/lib/unit/priceSolver";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { loadCabinetUnitSetting, resolveExtraCommissionPct, resolveTaxPct } from "@/lib/unit/cabinetSettings";
import { UNIT_DEFAULT_TAX_PCT } from "@/lib/unit/query";
import { EMPTY_UNIT_SPP_RATES, loadUnitSppRates, sppShareForNm } from "@/lib/unit/sppRates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/unit/price-solver?nm=&cabinet=&margins=15,25,35
// Обратный решатель цены под целевую маржу. nm задан → один товар, иначе — таблица.
const DEFAULT_MARGINS = [15, 25, 35];

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const url = new URL(request.url);
  const wantNm = url.searchParams.get("nm") ? Number(url.searchParams.get("nm")) : null;
  const cabinetParam = url.searchParams.get("cabinet");
  const { cabinetId } = await resolveShopCabinet(cabinetParam ?? undefined);
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const cabinet = cabinetId ?? "all";
  const marginsParam = url.searchParams.get("margins");
  const parsed = (marginsParam ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 100);
  const margins = parsed.length ? parsed : DEFAULT_MARGINS;

  let rnp: RnpRow[];
  try {
    rnp = await buildRnpReport(cabinet);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }

  const comm = await getWbCommissionForCabinet(cabinetId, 30, { allowLiveFallback: false });
  if (comm.avgPct <= 0 || comm.avgAcqPct <= 0) {
    return NextResponse.json(
      { error: "Нет фактических комиссий и эквайринга WB. Дождитесь суточной синхронизации ставок — расчёт цены на дефолтах отключён." },
      { status: 503 },
    );
  }

  // Те же входные данные, что и у таблицы юнита: ставка налога кабинета,
  // комиссия посредника, подготовка из справочника себестоимостей и СПП.
  const db = getSupabaseAdmin();
  const sppPeriodTo = new Date().toISOString().slice(0, 10);
  const sppPeriodFrom = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  // Три запроса подряд стоили роуту секунд при бюджете в минуту — идут разом,
  // а СПП сужается до товаров выборки, а не читает продажи всех кабинетов.
  const [settings, costRows, sppRates] = db
    ? await Promise.all([
      loadCabinetUnitSetting(db, cabinetId).catch(() => null),
      loadAllSupabasePages<{ article: string; warehouse_expenses: number | string | null }>((from, to) => db
        .from("product_costs")
        .select("article, warehouse_expenses")
        .order("article", { ascending: true })
        .range(from, to), { label: "Калькулятор цены: подготовка", maxPages: 100 }).catch(() => []),
      loadUnitSppRates(db, {
        cabinetId,
        from: sppPeriodFrom,
        to: sppPeriodTo,
        nmIds: rnp.map((row) => row.nmId),
        label: "Калькулятор цены: СПП по продажам",
      }),
    ])
    : [null, [] as { article: string; warehouse_expenses: number | string | null }[], EMPTY_UNIT_SPP_RATES];
  const taxPct = resolveTaxPct({ requested: null, cabinet: settings?.taxPct ?? null, fallback: UNIT_DEFAULT_TAX_PCT }).taxPct;
  const extraCommissionPct = resolveExtraCommissionPct({ requested: null, cabinet: settings?.extraCommissionPct ?? null }).extraCommissionPct;
  const prepByArticle = new Map<string, number>();
  for (const row of costRows) prepByArticle.set(String(row.article), Number(row.warehouse_expenses ?? 0) || 0);

  // Каталожные цены — best-effort: токену кабинета может не хватать скоупа «Цены и скидки».
  const wantNms = new Set<number>(wantNm ? [wantNm] : rnp.map((r) => r.nmId));
  const priceByNm = new Map<number, number>();
  try {
    const cabs = await getActiveWbCabinets();
    const selectedCabinets = cabinetId ? cabs.filter((candidate) => candidate.id === cabinetId) : cabs;
    for (const c of selectedCabinets) {
      try {
        const prices = await fetchWbCatalogPrices(c.token, wantNms);
        for (const [nm, p] of prices) if (!priceByNm.has(nm) && p.price > 0) priceByNm.set(nm, p.price);
      } catch (e) {
        if (!(e instanceof WbPriceScopeError)) throw e;
      }
    }
  } catch {
    /* каталог опционален — Δ% считается и без него */
  }

  const buildOne = (r: RnpRow) => {
    const rates = resolveWbRatesForNm(comm, r.nmId);
    const month = r.periods.month;
    const currentRevenue = month.ordersCount > 0 ? month.ordersSum / month.ordersCount : 0;
    // Калькулятор обязан считать ровно то же, что колонка «Цена для N% маржи»
    // рядом с ним. Раньше он забывал налог, комиссию кабинета, ДРР и
    // подготовку — и требовал цену заметно НИЖЕ, чем таблица на том же экране.
    const sppShare = sppShareForNm(sppRates, r.nmId);
    const effectiveTaxPct = taxPct * (1 - (sppShare ?? 0));
    const drrPct = r.drr != null && Number.isFinite(r.drr) ? Math.max(0, Number(r.drr)) : 0;
    const feeFraction = (
      rates.marketplacePct
      + rates.acquiringPct
      + extraCommissionPct
      + effectiveTaxPct
      + drrPct
    ) / 100;
    const prep = prepByArticle.get(r.article) ?? 0;
    const res = solvePrices({
      cogs: r.cost != null && r.cost > 0 ? r.cost + prep : 0,
      feeFraction,
      currentRevenue,
      currentCatalogPrice: priceByNm.get(r.nmId) ?? null,
      margins,
    });
    return {
      nm: r.nmId,
      article: r.article,
      cogs: r.cost,
      stock: r.stock,
      drr: r.drr,
      currentRevenue: Math.round(currentRevenue),
      currentCatalogPrice: priceByNm.get(r.nmId) ?? null,
      rates: {
        commissionPct: rates.commissionPct,
        acquiringPct: rates.acquiringPct,
        extraPct: rates.extraPct,
        overheadPct: rates.overheadPct,
        ratesSource: rates.source,
      },
      ...res,
    };
  };

  if (wantNm) {
    const r = rnp.find((x) => x.nmId === wantNm);
    if (!r) return NextResponse.json({ error: "nm не найден в РНП" }, { status: 404 });
    return NextResponse.json({ margins, item: buildOne(r) });
  }

  // Обрезка была молчаливой: шторка показывала 500 строк и не говорила, что
  // за ними ещё товары. Отдаём и предел, и настоящий размер выборки.
  const LIMIT = 500;
  const items = rnp.slice(0, LIMIT).map(buildOne);
  return NextResponse.json({
    margins,
    count: items.length,
    total: rnp.length,
    truncated: rnp.length > LIMIT,
    items,
  });
}
