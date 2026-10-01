"use client";

import { FinanceTabs } from "@/components/FinanceTabs";
import { ActionableError } from "@/components/ui/ActionableError";
import { LoadingBanner, useElapsedSeconds } from "@/components/ui/LoadingState";
import { formatRub } from "@/lib/analytics/format";
import { Banknote, ExternalLink, Upload } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { TaxSectionTabs } from "./TaxSectionTabs";

type Kind = "atm" | "individual" | "sbp" | "atm_deposit";
type Operation = { id: string; date: string; purpose: string; counterparty: string; amount: number; kind: Kind };
type Month = { month: string; withdrawn: number; deposited: number; total: number; count: number; byKind: Record<Kind, number>; operations: Operation[] };
type Company = { id: string; name: string; withdrawn: number; deposited: number; total: number; months: Month[] };
type CashoutResponse = { from: string; to: string; companies: Company[]; error?: string };

const todayMsk = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const monthLabel = (month: string) => new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
const endOfMonth = (month: string, limit: string) => {
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  return last < limit ? last : limit;
};
const KIND_LABEL: Record<Kind, string> = { atm: "Снятие в банкомате", individual: "Физлицу", sbp: "СБП", atm_deposit: "Внесено через банкомат" };

export function CashoutPage() {
  const today = useMemo(() => todayMsk(), []);
  const [asOf, setAsOf] = useState(today);
  const [data, setData] = useState<CashoutResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState("");
  const elapsed = useElapsedSeconds(loading);
  const from = `${asOf.slice(0, 4)}-01-01`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/finance/cashout?${new URLSearchParams({ from, to: asOf })}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as CashoutResponse;
        if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        setData(body);
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Не удалось загрузить операции");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [asOf, from, reload]);

  return <div className="mx-auto max-w-[1600px] px-3 py-4 sm:px-4 lg:py-5">
    <FinanceTabs />
    <TaxSectionTabs active="cashout" />
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-lg bg-amber-100 text-amber-700"><Banknote className="h-5 w-5" /></div>
      <div className="min-w-[240px] flex-1"><h1 className="text-2xl font-bold text-slate-900">Обнал</h1><p className="text-sm text-slate-500">Снятия в банкомате, переводы физлицам и по СБП, которые собственник должен вернуть на счёт</p></div>
      <Link href="/payments?bankImport=1&cashoutImport=1" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-violet-300 bg-white px-4 text-sm font-semibold text-violet-700 hover:bg-violet-50"><Upload className="h-4 w-4" />Загрузить выписки для «Обнала»</Link>
      <label className="text-xs font-semibold text-slate-600">Показать с 1 января по дату<input type="date" min="2025-01-01" max={today} value={asOf} onChange={(event) => setAsOf(event.target.value || today)} className="mt-1 block min-h-11 rounded-lg border border-slate-300 bg-white px-3" /></label>
    </div>
    {loading ? <LoadingBanner seconds={elapsed} hint="банковские выписки Панкратова и РИО" /> : null}
    {error ? <ActionableError message={error} label="Обнал" onRetry={() => setReload((value) => value + 1)} tone="rose" className="mb-3" /> : null}
    {!loading && !error && !data?.companies.length ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Компании ИП Панкратов и ООО РИО не найдены в справочнике компаний.</div> : null}
    <div className="grid gap-4 xl:grid-cols-2">
      {data?.companies.map((company) => <section key={company.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3"><div><h2 className="font-bold text-slate-950">{company.name}</h2><p className="text-xs text-slate-500">Снято и переведено: {formatRub(company.withdrawn)} · внесено: {formatRub(company.deposited)}</p></div><div className="text-right"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Остаток к возврату</div><div className={`text-xl font-extrabold tabular-nums ${company.total > 0 ? "text-rose-700" : "text-emerald-700"}`}>{formatRub(company.total)}</div></div></div>
        <div className="scroll-x"><table className="w-full min-w-[820px] text-sm"><thead><tr className="bg-slate-800 text-left text-white"><th className="p-2.5">Месяц</th><th className="p-2.5 text-right">Снято</th><th className="p-2.5 text-right">Физлицам</th><th className="p-2.5 text-right">СБП</th><th className="p-2.5 text-right">Внесено</th><th className="p-2.5 text-right">Остаток</th></tr></thead><tbody>
          {company.months.map((month) => {
            const key = `${company.id}:${month.month}`;
            const href = `/payments?${new URLSearchParams({ from: `${month.month}-01`, to: endOfMonth(month.month, asOf), company: company.id, cashout: "1" })}`;
            return <Fragment key={key}><tr className="border-b"><td className="p-2.5"><button type="button" onClick={() => setExpanded((current) => current === key ? "" : key)} className="font-semibold capitalize text-violet-700 underline decoration-dotted underline-offset-4">{monthLabel(month.month)}</button><span className="ml-2 text-xs text-slate-400">{month.count} оп.</span></td><td className="p-2.5 text-right tabular-nums">{formatRub(month.byKind.atm)}</td><td className="p-2.5 text-right tabular-nums">{formatRub(month.byKind.individual)}</td><td className="p-2.5 text-right tabular-nums">{formatRub(month.byKind.sbp)}</td><td className="p-2.5 text-right font-semibold tabular-nums text-emerald-700">− {formatRub(month.deposited)}</td><td className="p-2.5 text-right"><Link href={href} title="Открыть эти операции в ДДС" className={`inline-flex items-center gap-1 font-bold tabular-nums underline underline-offset-4 ${month.total > 0 ? "text-rose-700" : "text-emerald-700"}`}>{formatRub(month.total)}<ExternalLink className="h-3.5 w-3.5" /></Link></td></tr>
              {expanded === key ? <tr className="border-b bg-violet-50/40"><td colSpan={6} className="p-3"><div className="space-y-2">{month.operations.map((operation) => <div key={operation.id} className="grid gap-1 rounded-lg border border-violet-100 bg-white p-2 text-xs sm:grid-cols-[90px_145px_1fr_130px] sm:items-center"><span>{operation.date}</span><span className={`font-semibold ${operation.kind === "atm_deposit" ? "text-emerald-700" : "text-slate-600"}`}>{KIND_LABEL[operation.kind]}</span><span className="min-w-0"><b>{operation.counterparty || "Контрагент не указан"}</b><span className="block truncate text-slate-500">{operation.purpose}</span></span><Link href={`/payments?payment=${encodeURIComponent(operation.id)}`} className={`inline-flex items-center justify-end gap-1 font-bold underline underline-offset-4 ${operation.kind === "atm_deposit" ? "text-emerald-700" : "text-violet-700"}`}>{operation.kind === "atm_deposit" ? "+ " : ""}{formatRub(operation.amount)}<ExternalLink className="h-3.5 w-3.5" /></Link></div>)}</div></td></tr> : null}</Fragment>;
          })}
          {!company.months.length ? <tr><td colSpan={6} className="p-8 text-center text-slate-500">За выбранный период операций не найдено.</td></tr> : null}
        </tbody></table></div>
      </section>)}
    </div>
    <p className="mt-4 text-xs leading-5 text-slate-500">Остаток к возврату = снятия в банкомате + переводы физлицам + СБП − внесения наличных через банкомат. В расчёт входят только проведённые строки банковских выписок; внутренние переводы и ручные операции не учитываются. Нажмите месяц для расшифровки; сумма месяца или отдельной операции открывает соответствующие строки в ДДС.</p>
  </div>;
}
