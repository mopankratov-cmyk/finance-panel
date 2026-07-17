import { NextRequest, NextResponse } from "next/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { loadWbCachedFinance } from "@/lib/finance/wbCachedFinance";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Экран удержаний читает почасовой факт синхронизации. Живой reportDetailByPeriod
// слишком велик для пользовательского запроса и регулярно упирался в лимит 60с.
export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams;
  const weeks = Math.min(8, Math.max(1, Number(sp.get("weeks")) || 4));
  const cabinetId = cabinetIdFromParam(sp.get("cabinet"));
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }

  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - weeks * 7 * 86400000).toISOString().slice(0, 10);

  let finance;
  try {
    finance = await loadWbCachedFinance({ dateFrom: from, dateTo: to, cabinetId, taxPct: 0 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить финансы WB" }, { status: 502 });
  }

  const items = [
    { key: "commission", label: "Комиссия WB", rub: finance.commission, tip: "Фактическая ставка комиссии по SKU из последнего синхронизированного финотчёта" },
    { key: "marketplace_other", label: "Логистика, хранение и прочие удержания", rub: finance.marketplaceOther, tip: "Сводная фактическая ставка прочих удержаний WB по SKU и кабинету" },
    { key: "acquiring", label: "Эквайринг", rub: finance.acquiring, tip: "Фактическая ставка эквайринга из финотчёта" },
    { key: "ads", label: "Реклама WB", rub: finance.ad, tip: "Расход из почасовой синхронизации рекламного кабинета" },
  ].filter((i) => i.rub !== 0).sort((a, b) => b.rub - a.rub);

  const totalDeductions = items.reduce((s, i) => s + i.rub, 0);

  return NextResponse.json({
    period: { from, to, weeks },
    rows_count: finance.rowsCount,
    retail: finance.revenue,
    payout: finance.payout,
    commission: finance.commission,
    returns: finance.returns,
    totalDeductions,
    items,
    deductionsRaw: {
      commission: finance.commission,
      marketplaceOther: finance.marketplaceOther,
      acquiring: finance.acquiring,
      ads: finance.ad,
    },
    source: finance.source,
    updatedAt: finance.updatedAt,
    warnings: finance.warnings,
  });
}
