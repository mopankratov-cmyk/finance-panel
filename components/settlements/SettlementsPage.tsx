"use client";

import { ChevronDown, Handshake, Landmark, ReceiptRussianRuble, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useFinance } from "@/components/providers/FinanceProvider";
import { loadDdsCompanies, loadPaymentCompanyLinks, type DdsCompany } from "@/components/payments/ddsCompanies";
import { Card, CardContent } from "@/components/ui/Card";
import { formatDate, formatMoney } from "@/lib/format";
import { buildSettlements, type Settlement, type SettlementSide } from "@/lib/finance/settlements";

type Filter = "all" | SettlementSide;

const sideLabel: Record<SettlementSide, string> = {
  we_owe: "Мы должны",
  owed_to_us: "Нам должны",
  closed: "Закрыто",
};

function Metric({ icon: Icon, label, amount, tone }: { icon: typeof Landmark; label: string; amount: number; tone: "violet" | "amber" | "emerald" }) {
  const toneClass = tone === "violet" ? "bg-violet-100 text-violet-700" : tone === "amber" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700";
  return <Card><CardContent className="flex items-center gap-3 p-4"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${toneClass}`}><Icon className="h-5 w-5" /></span><div><p className="text-sm text-slate-500">{label}</p><p className="mt-0.5 text-xl font-bold tabular-nums text-slate-950">{formatMoney(amount)}</p></div></CardContent></Card>;
}

function SettlementCard({ settlement }: { settlement: Settlement }) {
  const [open, setOpen] = useState(false);
  const isDebt = settlement.side === "we_owe";
  const flowLabel = settlement.kind === "intercompany" ? "Выдано" : isDebt ? "Получено" : "Выдано";
  const returnedLabel = settlement.kind === "intercompany" ? "Возвращено" : isDebt ? "Возвращено" : "Получено обратно";
  return <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex min-h-20 w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-600">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${settlement.kind === "intercompany" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-700"}`}>{settlement.kind === "intercompany" ? <Users className="h-5 w-5" /> : <Handshake className="h-5 w-5" />}</span>
      <span className="min-w-0 flex-1"><span className="block font-bold text-slate-950">{settlement.counterparty}</span><span className="mt-0.5 block text-sm text-slate-500">С {formatDate(settlement.firstDate)} · операций: {settlement.movements.length}</span></span>
      <span className="text-right"><span className={`block text-xs font-semibold ${settlement.side === "we_owe" ? "text-amber-800" : settlement.side === "owed_to_us" ? "text-emerald-700" : "text-slate-500"}`}>{sideLabel[settlement.side]}</span><span className="mt-0.5 block text-lg font-bold tabular-nums text-slate-950">{formatMoney(settlement.balance)}</span></span>
      <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
    {open && <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-3"><div className="grid gap-2 text-sm sm:grid-cols-3"><p><span className="block text-xs text-slate-500">{flowLabel}</span><strong className="tabular-nums text-slate-950">{formatMoney(settlement.issuedOrReceived)}</strong></p><p><span className="block text-xs text-slate-500">{returnedLabel}</span><strong className="tabular-nums text-slate-950">{formatMoney(settlement.returned)}</strong></p><p><span className="block text-xs text-slate-500">Итог</span><strong className="tabular-nums text-slate-950">{formatMoney(settlement.balance)}</strong></p></div><div className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">{settlement.movements.map((movement) => <div key={movement.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2 text-sm"><span className="whitespace-nowrap text-slate-500">{formatDate(movement.date)}</span><span className="min-w-0"><span className="block truncate font-medium text-slate-800">{movement.label}</span><span className="block truncate text-xs text-slate-500">{movement.category}{movement.companyName ? ` · ${movement.companyName}` : ""}</span></span><strong className="whitespace-nowrap tabular-nums text-slate-950">{formatMoney(movement.amount)}</strong></div>)}</div></div>}
  </article>;
}

export function SettlementsPage() {
  const { state } = useFinance();
  const [companies, setCompanies] = useState<DdsCompany[]>([]);
  const [companyByPayment, setCompanyByPayment] = useState<Map<string, string | null>>(new Map());
  const [filter, setFilter] = useState<Filter>("all");
  useEffect(() => { void Promise.all([loadDdsCompanies(), loadPaymentCompanyLinks()]).then(([nextCompanies, links]) => { setCompanies(nextCompanies); setCompanyByPayment(new Map(links.map((link) => [link.paymentId, link.companyId]))); }).catch(() => {}); }, []);
  const settlements = useMemo(() => buildSettlements(state.payments, companyByPayment, companies), [state.payments, companyByPayment, companies]);
  const totals = useMemo(() => ({ weOwe: settlements.filter((item) => item.side === "we_owe").reduce((sum, item) => sum + item.balance, 0), owedToUs: settlements.filter((item) => item.side === "owed_to_us").reduce((sum, item) => sum + item.balance, 0) }), [settlements]);
  const visible = settlements.filter((item) => filter === "all" || item.side === filter);
  return <main className="space-y-5 p-4 md:p-6"><section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between"><div><h1 className="text-2xl font-bold text-slate-950">Взаиморасчёты</h1><p className="mt-1 max-w-2xl text-sm text-slate-500">Беспроцентные долги с людьми и между контурами компаний. Данные собираются из проведённого ДДС; официальные договоры остаются в разделе «Кредиты».</p></div><div className="inline-flex w-fit items-center gap-2 rounded-xl bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-800"><ReceiptRussianRuble className="h-4 w-4" />Только фактические операции</div></section><section className="grid gap-3 sm:grid-cols-3"><Metric icon={Landmark} label="Мы должны" amount={totals.weOwe} tone="amber" /><Metric icon={Handshake} label="Нам должны" amount={totals.owedToUs} tone="emerald" /><Metric icon={Users} label="Открытых взаиморасчётов" amount={settlements.filter((item) => item.side !== "closed").length} tone="violet" /></section><div className="flex flex-wrap gap-2" role="group" aria-label="Фильтр взаиморасчётов">{(["all", "we_owe", "owed_to_us", "closed"] as Filter[]).map((item) => <button key={item} type="button" onClick={() => setFilter(item)} className={`min-h-11 rounded-xl px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 ${filter === item ? "bg-violet-600 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>{item === "all" ? `Все (${settlements.length})` : sideLabel[item]}</button>)}</div><section className="space-y-3">{visible.length ? visible.map((settlement) => <SettlementCard key={settlement.id} settlement={settlement} />) : <Card><CardContent className="py-12 text-center"><Handshake className="mx-auto h-8 w-8 text-slate-300" /><h2 className="mt-3 font-bold text-slate-900">Взаиморасчётов пока нет</h2><p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">Здесь появятся проведённые поступления, выдачи и возвраты займов без карточки официального договора. Для появления в реестре у операции должна быть финансовая статья и контрагент в ДДС.</p></CardContent></Card>}</section></main>;
}
