import { NextRequest, NextResponse } from "next/server";
import { fetchSalesReport } from "@/lib/wb/fetchSalesReport";
import { fetchNmOrderStatsByNm } from "@/lib/opiu/fetchNmStats";
import { fetchProductCosts } from "@/lib/opiu/loadMonth";
import { fetchDeliveryCosts } from "@/lib/opiu/fetchGoogleCosts";
import { fetchPaidStorage } from "@/lib/opiu/fetchPaidStorage";
import { fetchPaidAcceptance } from "@/lib/opiu/fetchPaidAcceptance";
import { fetchIncomes } from "@/lib/opiu/fetchIncomes";
import { buildCostLookup } from "@/lib/opiu/metrics";
import { buildMarginByNm } from "@/lib/opiu/metricsByNm";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const maxDuration = 180;

const DEFAULT_TAX = 0.06;
const INCOMES_LOOKBACK_DAYS = 400;

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

async function fetchAdSpendByNm(from: string, to: string): Promise<Map<number, number>> {
  const db = getSupabaseAdmin();
  const result = new Map<number, number>();
  if (!db) return result;
  const { data, error } = await db
    .from("wb_advert_nm_daily")
    .select("nm_id, spent")
    .gte("date", from)
    .lte("date", to);
  if (error || !data) return result;
  for (const row of data as { nm_id: number; spent: number | null }[]) {
    result.set(row.nm_id, (result.get(row.nm_id) ?? 0) + Number(row.spent ?? 0));
  }
  return result;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const refresh = params.get("refresh") === "1";
  const taxParam = Number(params.get("tax"));
  const taxRate = Number.isFinite(taxParam) && taxParam > 0 ? taxParam / 100 : DEFAULT_TAX;

  const today = new Date();
  const to = params.get("to") || toISO(today);
  const from = params.get("from") || toISO(addDays(today, -6));

  try {
    const incomesFrom = toISO(addDays(new Date(from), -INCOMES_LOOKBACK_DAYS));

    const [sales, nmStatsByNm, costs, deliveryCosts, storageRows, acceptanceRows, incomes, adSpendByNm] =
      await Promise.all([
        fetchSalesReport(from, to, refresh),
        fetchNmOrderStatsByNm(from, to, refresh),
        fetchProductCosts(),
        fetchDeliveryCosts().catch(() => []),
        fetchPaidStorage(from, to, refresh),
        fetchPaidAcceptance(from, to, refresh),
        fetchIncomes(incomesFrom, refresh),
        fetchAdSpendByNm(from, to),
      ]);

    const costLookup = buildCostLookup(costs, deliveryCosts);

    const { rows, totals } = buildMarginByNm({
      from,
      to,
      sales,
      nmStatsByNm,
      costLookup,
      storageRows,
      acceptanceRows,
      incomes,
      adSpendByNm,
      taxRate,
    });

    return NextResponse.json({
      period: { from, to },
      taxRate,
      rows,
      totals,
      timestamp: new Date().toISOString(),
      meta: {
        salesRows: sales.length,
        nmCount: rows.length,
        storageRows: storageRows.length,
        acceptanceRows: acceptanceRows.length,
        incomesRows: incomes.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ошибка загрузки маржи по артикулам";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
