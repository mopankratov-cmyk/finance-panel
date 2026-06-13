import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WB_STATS_TOKEN = process.env.WB_STATS_TOKEN || process.env.WB_TOKEN_STATISTICS;

interface DetailRow {
  supplier_oper_name?: string;
  bonus_type_name?: string;
  ppvz_for_pay?: number;
  retail_amount?: number;
  delivery_rub?: number;
  storage_fee?: number;
  penalty?: number;
  acceptance?: number;
  deduction?: number;
  acquiring_fee?: number;
  ppvz_sales_commission?: number;
  return_amount?: number;
}

const num = (v: unknown) => Number(v ?? 0) || 0;

// Финотчёт-детализация: где WB удерживает деньги (reportDetailByPeriod). Кэш 1ч (лимит 1 req/min).
export async function GET(request: NextRequest) {
  if (!WB_STATS_TOKEN) return NextResponse.json({ error: "WB_STATS_TOKEN не настроен" }, { status: 500 });
  const weeks = Math.min(8, Math.max(1, Number(new URL(request.url).searchParams.get("weeks")) || 4));
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - weeks * 7 * 86400000).toISOString().slice(0, 10);
  const url = `https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod?dateFrom=${from}&dateTo=${to}&limit=100000&rrdid=0`;

  let rows: DetailRow[];
  try {
    const res = await fetch(url, { headers: { Authorization: WB_STATS_TOKEN }, next: { revalidate: 3600 } });
    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json({ error: `WB ${res.status}: ${t.slice(0, 150)}` }, { status: 502 });
    }
    rows = (await res.json()) as DetailRow[];
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 120) }, { status: 502 });
  }
  if (!Array.isArray(rows)) rows = [];

  // суммы по статьям удержаний (по всем строкам)
  let retail = 0, ppvz = 0, logistics = 0, storage = 0, penalty = 0, acceptance = 0,
    acquiring = 0, commission = 0, deductionTotal = 0, returns = 0;
  // разбор удержаний по типу
  const ded = { ads: 0, credit: 0, transit: 0, other: 0 };

  for (const r of rows) {
    const op = r.supplier_oper_name ?? "";
    retail += num(r.retail_amount);
    ppvz += num(r.ppvz_for_pay) * (op === "Возврат" ? -1 : 1);
    logistics += num(r.delivery_rub);
    storage += num(r.storage_fee);
    penalty += num(r.penalty);
    acceptance += num(r.acceptance);
    acquiring += num(r.acquiring_fee);
    commission += num(r.ppvz_sales_commission);
    if (op === "Возврат") returns += num(r.ppvz_for_pay);
    const d = num(r.deduction);
    if (d !== 0) {
      deductionTotal += d;
      const bt = (r.bonus_type_name ?? "").toLowerCase();
      if (bt.includes("продвижени") || bt.includes("реклам")) ded.ads += d;
      else if (bt.includes("кредит")) ded.credit += d;
      else if (bt.includes("транзит") || bt.includes("поставк") || bt.includes("доставк")) ded.transit += d;
      else ded.other += d;
    }
  }

  const r0 = (v: number) => Math.round(v);
  // позиции «куда ушли деньги» (удержания)
  const items = [
    { key: "ads", label: "Реклама (WB Продвижение, авто-удержание)", rub: r0(ded.ads), tip: "Списания за продвижение через финотчёт — помимо рекламного кабинета" },
    { key: "logistics", label: "Логистика", rub: r0(logistics), tip: "Доставка до покупателя и обратно" },
    { key: "storage", label: "Хранение", rub: r0(storage), tip: "Платное хранение на складах WB" },
    { key: "acquiring", label: "Эквайринг", rub: r0(acquiring), tip: "Комиссия за приём платежей" },
    { key: "acceptance", label: "Платная приёмка", rub: r0(acceptance), tip: "Приёмка поставок" },
    { key: "penalty", label: "Штрафы", rub: r0(penalty), tip: "Штрафы WB" },
    { key: "credit", label: "Кредит WB", rub: r0(ded.credit), tip: "Погашение кредита/процентов" },
    { key: "transit", label: "Транзитные поставки", rub: r0(ded.transit), tip: "Доставка транзитных поставок" },
    { key: "deduction_other", label: "Прочие удержания", rub: r0(ded.other), tip: "Прочие удержания из финотчёта" },
  ].filter((i) => i.rub !== 0).sort((a, b) => b.rub - a.rub);

  const totalDeductions = items.reduce((s, i) => s + i.rub, 0);

  return NextResponse.json({
    period: { from, to, weeks },
    rows_count: rows.length,
    retail: r0(retail),
    payout: r0(ppvz),
    commission: r0(commission),
    returns: r0(returns),
    totalDeductions,
    items,
    deductionsRaw: { logistics: r0(logistics), storage: r0(storage), penalty: r0(penalty), acceptance: r0(acceptance), acquiring: r0(acquiring), ...ded },
  });
}
