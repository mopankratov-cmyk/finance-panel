import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { ozonTransactionTotals, ozonServiceBreakdown } from "@/lib/ozon/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const r0 = (v: number) => Math.round(v);

// Ozon-аналог «где теряем»: итоги транзакций (комиссия/логистика/услуги/возвраты) + разбор услуг.
export async function GET(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const sp = new URL(request.url).searchParams;
  const weeks = Math.min(8, Math.max(1, Number(sp.get("weeks")) || 4));
  const cabinetId = sp.get("cabinet");

  // выбираем Ozon-кабинет (конкретный или первый активный)
  let q = db.from("wb_cabinets").select("id, name, client_id, token").eq("marketplace", "ozon").eq("is_active", true);
  if (cabinetId) q = q.eq("id", cabinetId);
  const { data: cabs } = await q.limit(1);
  const cab = cabs?.[0];
  if (!cab?.client_id || !cab?.token) {
    return NextResponse.json({ error: "Нет подключённого Ozon-кабинета. Добавьте его в разделе «Кабинеты WB».", noCabinet: true });
  }

  const creds = { clientId: cab.client_id as string, apiKey: cab.token as string };
  const toD = new Date(), fromD = new Date(Date.now() - weeks * 7 * 86400000);
  const fromIso = fromD.toISOString(), toIso = toD.toISOString();

  const t = await ozonTransactionTotals(creds, fromIso, toIso);
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: 502 });
  const services = await ozonServiceBreakdown(creds, fromIso, toIso);

  const tot = t.totals;
  // удержания Ozon (берём по модулю — это вычеты из выручки)
  const items = [
    { key: "commission", label: "Комиссия Ozon", rub: r0(Math.abs(tot.sale_commission)), tip: "Комиссия за продажу" },
    { key: "delivery", label: "Логистика и обработка", rub: r0(Math.abs(tot.processing_and_delivery)), tip: "Обработка отправлений и доставка" },
    { key: "services", label: "Услуги (реклама, хранение и др.)", rub: r0(Math.abs(tot.services_amount)), tip: "Платные услуги Ozon: продвижение, хранение, размещение" },
    { key: "refunds", label: "Возвраты и отмены", rub: r0(Math.abs(tot.refunds_and_cancellations)), tip: "Возвраты и отмены заказов" },
    { key: "other", label: "Прочие удержания", rub: r0(Math.abs(tot.others_amount)), tip: "Прочее" },
  ].filter((i) => i.rub !== 0).sort((a, b) => b.rub - a.rub);

  // топ услуг (если есть детализация)
  const serviceItems = Object.entries(services)
    .map(([name, rub]) => ({ name, rub: r0(Math.abs(rub)) }))
    .filter((s) => s.rub > 0).sort((a, b) => b.rub - a.rub).slice(0, 10);

  const totalDeductions = items.reduce((s, i) => s + i.rub, 0);
  const retail = r0(Math.abs(tot.accruals_for_sale));

  return NextResponse.json({
    marketplace: "ozon",
    cabinet: cab.name,
    period: { from: fromIso.slice(0, 10), to: toIso.slice(0, 10), weeks },
    retail,
    payout: r0(tot.accruals_for_sale - Math.abs(tot.sale_commission) - Math.abs(tot.processing_and_delivery) - Math.abs(tot.services_amount) + tot.compensation_amount),
    totalDeductions,
    items,
    serviceItems,
  });
}
