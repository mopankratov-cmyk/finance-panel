import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { buildRnpReport, type RnpRow } from "@/lib/rnp/buildRnp";
import { getWbCommissionMerged } from "@/lib/wb/commissions";
import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { fetchWbCatalogPrices, WbPriceScopeError } from "@/lib/wb/prices";
import { solvePrices } from "@/lib/unit/priceSolver";

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
  const cabinet = url.searchParams.get("cabinet");
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

  const comm = await getWbCommissionMerged(30);

  // Каталожные цены — best-effort: токену кабинета может не хватать скоупа «Цены и скидки».
  const wantNms = new Set<number>(wantNm ? [wantNm] : rnp.map((r) => r.nmId));
  const priceByNm = new Map<number, number>();
  try {
    const cabs = await getActiveWbCabinets();
    for (const c of cabs) {
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
    const rates = comm.byNm.get(r.nmId);
    const commissionPct = rates?.pct ?? comm.avgPct;
    const acquiringPct = rates?.acqPct ?? comm.avgAcqPct;
    const extraPct = rates?.extraPct ?? comm.avgExtraPct;
    const feeFraction = (commissionPct + acquiringPct + extraPct + comm.overheadPct) / 100;
    const month = r.periods.month;
    const currentRevenue = month.ordersCount > 0 ? month.ordersSum / month.ordersCount : 0;
    const res = solvePrices({
      cogs: r.cost ?? 0,
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
      rates: { commissionPct, acquiringPct, extraPct, overheadPct: comm.overheadPct, ratesSource: rates ? "nm" : "avg" },
      ...res,
    };
  };

  if (wantNm) {
    const r = rnp.find((x) => x.nmId === wantNm);
    if (!r) return NextResponse.json({ error: "nm не найден в РНП" }, { status: 404 });
    return NextResponse.json({ margins, item: buildOne(r) });
  }

  const items = rnp.slice(0, 500).map(buildOne);
  return NextResponse.json({ margins, count: items.length, items });
}
