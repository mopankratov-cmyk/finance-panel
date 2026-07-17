import { NextRequest, NextResponse } from "next/server";
import { ozonServiceBreakdown, ozonTransactionTotals, type OzonTotals } from "@/lib/ozon/api";
import { getOzonCabinetScope } from "@/lib/ozon/cabinet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const num = (value: unknown) => Number(value ?? 0) || 0;
const r0 = (value: number) => Math.round(value);

function emptyTotals(): OzonTotals {
  return {
    accruals_for_sale: 0,
    sale_commission: 0,
    processing_and_delivery: 0,
    refunds_and_cancellations: 0,
    services_amount: 0,
    compensation_amount: 0,
    money_transfer: 0,
    others_amount: 0,
  };
}

function addTotals(target: OzonTotals, value: OzonTotals) {
  for (const key of Object.keys(target) as Array<keyof OzonTotals>) target[key] += num(value[key]);
}

// Ozon-аналог «где теряем» с агрегацией выбранного кабинета, группы или всех
// доступных кабинетов. Ошибка одного кабинета не скрывает данные остальных.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const weeks = Math.min(8, Math.max(1, Number(sp.get("weeks")) || 4));
  const resolved = await getOzonCabinetScope(sp.get("cabinet"));
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error, noCabinet: true }, { status: 404 });
  }

  const toDate = new Date();
  const fromDate = new Date(Date.now() - weeks * 7 * 86_400_000);
  const fromIso = fromDate.toISOString();
  const toIso = toDate.toISOString();
  const results = await Promise.all(resolved.scope.cabinets.map(async (cabinet) => {
    const totals = await ozonTransactionTotals(cabinet.creds, fromIso, toIso);
    if (!totals.ok) return { cabinet: cabinet.name, ok: false as const, error: totals.error };
    const services = await ozonServiceBreakdown(cabinet.creds, fromIso, toIso);
    return { cabinet: cabinet.name, ok: true as const, totals: totals.totals, services };
  }));
  const ready = results.filter((result) => result.ok);
  if (!ready.length) {
    return NextResponse.json({
      error: results.map((result) => `${result.cabinet}: ${result.ok ? "нет данных" : result.error}`).join("; ") || "Ozon не вернул данные",
    }, { status: 502 });
  }

  const totals = emptyTotals();
  const servicesByName = new Map<string, number>();
  for (const result of ready) {
    if (!result.ok) continue;
    addTotals(totals, result.totals);
    for (const [name, value] of Object.entries(result.services)) {
      servicesByName.set(name, (servicesByName.get(name) ?? 0) + Math.abs(num(value)));
    }
  }

  const items = [
    { key: "commission", label: "Комиссия Ozon", rub: r0(Math.abs(totals.sale_commission)), tip: "Комиссия за продажу" },
    { key: "delivery", label: "Логистика и обработка", rub: r0(Math.abs(totals.processing_and_delivery)), tip: "Обработка отправлений и доставка" },
    { key: "services", label: "Услуги (реклама, хранение и др.)", rub: r0(Math.abs(totals.services_amount)), tip: "Платные услуги Ozon: продвижение, хранение, размещение" },
    { key: "refunds", label: "Возвраты и отмены", rub: r0(Math.abs(totals.refunds_and_cancellations)), tip: "Возвраты и отмены заказов" },
    { key: "other", label: "Прочие удержания", rub: r0(Math.abs(totals.others_amount)), tip: "Прочее" },
  ].filter((item) => item.rub !== 0).sort((left, right) => right.rub - left.rub);
  const serviceItems = [...servicesByName.entries()]
    .map(([name, rub]) => ({ name, rub: r0(rub) }))
    .filter((item) => item.rub > 0)
    .sort((left, right) => right.rub - left.rub)
    .slice(0, 10);
  const totalDeductions = items.reduce((sum, item) => sum + item.rub, 0);

  return NextResponse.json({
    marketplace: "ozon",
    cabinet: resolved.scope.label,
    cabinets: ready.map((result) => result.cabinet),
    scope: resolved.scope.mode,
    period: { from: fromIso.slice(0, 10), to: toIso.slice(0, 10), weeks },
    retail: r0(Math.abs(totals.accruals_for_sale)),
    payout: r0(totals.accruals_for_sale - Math.abs(totals.sale_commission) - Math.abs(totals.processing_and_delivery) - Math.abs(totals.services_amount) + totals.compensation_amount),
    returns: r0(Math.abs(totals.refunds_and_cancellations)),
    totalDeductions,
    items,
    serviceItems,
    warnings: results.flatMap((result) => result.ok ? [] : [`${result.cabinet}: ${result.error}`]),
  });
}
