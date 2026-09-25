"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Landmark,
  RefreshCw,
  Scale,
  Wallet,
  X,
} from "lucide-react";
import { FinanceTabs } from "@/components/FinanceTabs";
import { useFinance } from "@/components/providers/FinanceProvider";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { connectedBalanceTotals, loanLiabilitySnapshot } from "@/lib/finance/statementBalance";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import type { ScheduleRowRecord } from "@/lib/loans/scheduleRows";

type InventoryKind = "fulfillment" | "wb" | "ozon" | "supplier_transit";
type InventoryCategory = { kind: InventoryKind; complete: boolean; amount: number | null; quantity: number; rowsCount: number; provisional: boolean; reconciledAt: string | null; errors: string[] };
type InventoryLine = { id: string; article: string; name: string; location: string; reference: string | null; quantity: number; costRub: number | null; packagingRub: number | null; unitValue: number | null; totalValue: number | null };
type InventorySnapshot = { amount: number | null; complete: boolean; categories: InventoryCategory[]; computedAt: string | null };
type BankCashAccount = { id: string; name: string; bank: string | null; accountNumber: string | null; statementAmount: number | null; ddsAmount: number; difference: number | null; matchesDds: boolean; error: string | null };
type MarketplaceCashRow = { sourceKey: string; label: string; amount: number | null; availableAmount: number | null; currency: string; status: string; error: string | null; capturedAt: string };
type MarketplaceCashCategory = { complete: boolean; amount: number | null; rows: MarketplaceCashRow[]; errors: string[] };
type CashSnapshot = { amount: number | null; complete: boolean; bank: { amount: number | null; complete: boolean; accounts: BankCashAccount[] }; marketplaces: { wb: MarketplaceCashCategory; ozon: MarketplaceCashCategory } };
type CashDetailKind = "bank" | "wb" | "ozon";
type BalanceCompany = { id: string; name: string; companyIds: string[] };
type CashSourceTest = {
  capturedAt: string;
  cashSummaries: Array<{ sourceKey: string; marketplace: "wb" | "ozon"; cabinetName: string; amount: number | null; availableAmount: number | null; currency: string; status: string; error: string | null }>;
  errors: string[];
};

const INVENTORY_LABELS: Record<InventoryKind, string> = {
  fulfillment: "На фулфилменте",
  wb: "На складе WB",
  ozon: "На складе Ozon",
  supplier_transit: "В пути от поставщика",
};

const money = (value: number | null) => value === null ? "—" : formatMoney(value);
const percent = (value: number | null) => value === null
  ? "—"
  : new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 1 }).format(value);

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
  return body;
}

async function loadInventory(month: string, companyId: string): Promise<InventorySnapshot> {
  const body = await fetch(`/api/finance/balance-stock?month=${encodeURIComponent(month)}&company=${encodeURIComponent(companyId)}`, { cache: "no-store" })
    .then((response) => responseJson<{
      amount: number | null; complete: boolean; capturedAt: string | null;
      categories: InventoryCategory[];
    }>(response));
  return {
    amount: body.amount,
    complete: body.complete,
    computedAt: body.capturedAt,
    categories: body.categories,
  };
}

async function loadCash(month: string, companyId: string): Promise<CashSnapshot> {
  return fetch(`/api/finance/balance-cash?month=${encodeURIComponent(month)}&company=${encodeURIComponent(companyId)}`, { cache: "no-store" })
    .then((response) => responseJson<CashSnapshot>(response));
}

function Metric({ label, value, note, tone = "slate" }: { label: string; value: string; note: string; tone?: "slate" | "emerald" | "violet" | "amber" }) {
  const tones = {
    slate: "border-slate-200 bg-white",
    emerald: "border-emerald-200 bg-emerald-50/60",
    violet: "border-violet-200 bg-violet-50/60",
    amber: "border-amber-200 bg-amber-50/60",
  };
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${tones[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-bold tabular-nums text-slate-950 sm:text-2xl">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{note}</p>
    </div>
  );
}

function StatementRow({ label, amount, detail, muted = false, href, onClick }: { label: string; amount: number | null; detail?: string; muted?: boolean; href?: string; onClick?: () => void }) {
  const content = (
    <div className={`grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 text-left sm:px-5 ${href || onClick ? "transition-colors hover:bg-slate-50" : ""}`}>
      <div className="min-w-0">
        <p className={`text-sm font-medium ${muted ? "text-slate-500" : "text-slate-800"}`}>{label}</p>
        {detail ? <p className="mt-0.5 text-xs leading-5 text-slate-500">{detail}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-sm font-semibold tabular-nums ${amount === null ? "text-slate-400" : "text-slate-950"}`}>{money(amount)}</span>
        {href || onClick ? <ChevronRight className="h-4 w-4 text-slate-400" /> : null}
      </div>
    </div>
  );
  if (href) return <Link href={href}>{content}</Link>;
  return onClick ? <button type="button" onClick={onClick} className="block w-full">{content}</button> : content;
}

function InventoryDetails({ kind, month, companyId, onClose }: { kind: InventoryKind; month: string; companyId: string; onClose: () => void }) {
  const [lines, setLines] = useState<InventoryLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    fetch(`/api/finance/balance-stock?month=${encodeURIComponent(month)}&kind=${kind}&company=${encodeURIComponent(companyId)}`, { cache: "no-store" })
      .then((response) => responseJson<{ lines: InventoryLine[] }>(response))
      .then((body) => { setLines(body.lines); setError(null); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить детализацию"))
      .finally(() => setLoading(false));
  }, [companyId, kind, month]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label={`Детализация: ${INVENTORY_LABELS[kind]}`}>
      <div className="flex max-h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5">
          <div><h2 className="font-bold text-slate-950">{INVENTORY_LABELS[kind]}</h2><p className="text-xs text-slate-500">Снимок на {formatDate(`${month}-01`)} · {lines.length} позиций</p></div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-auto">
          {loading ? <p className="p-5 text-sm text-slate-500">Загружаем детализацию…</p> : error ? <p className="p-5 text-sm text-rose-700">{error}</p> : lines.length === 0 ? <p className="p-5 text-sm text-slate-500">На дату снимка остатков нет.</p> : (
            <table className="min-w-[900px] w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-500"><tr><th className="px-4 py-3 text-left">Артикул / товар</th><th className="px-3 py-3 text-left">Место / документ</th><th className="px-3 py-3 text-right">Количество</th><th className="px-3 py-3 text-right">Себестоимость</th><th className="px-3 py-3 text-right">Упаковка</th><th className="px-3 py-3 text-right">За единицу</th><th className="px-4 py-3 text-right">Сумма</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{lines.map((line) => <tr key={line.id} className="hover:bg-slate-50"><td className="px-4 py-3"><div className="font-semibold text-slate-900">{line.article}</div><div className="text-slate-500">{line.name}</div></td><td className="px-3 py-3"><div>{line.location || "—"}</div>{line.reference ? <div className="text-slate-500">{line.reference}</div> : null}</td><td className="px-3 py-3 text-right tabular-nums">{line.quantity.toLocaleString("ru-RU")}</td><td className="px-3 py-3 text-right tabular-nums">{money(line.costRub)}</td><td className="px-3 py-3 text-right tabular-nums">{money(line.packagingRub)}</td><td className="px-3 py-3 text-right tabular-nums">{money(line.unitValue)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{money(line.totalValue)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function CashDetails({ kind, month, snapshot, onClose }: { kind: CashDetailKind; month: string; snapshot: CashSnapshot; onClose: () => void }) {
  const title = kind === "bank" ? "Расчётные счета" : `Денежные средства на ${kind === "wb" ? "WB" : "Ozon"}`;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5">
          <div><h2 className="font-bold text-slate-950">{title}</h2><p className="text-xs text-slate-500">Остаток на начало {formatDate(`${month}-01`)}</p></div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-auto">
          {kind === "bank" ? (
            <table className="min-w-[800px] w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-500"><tr><th className="px-4 py-3 text-left">Счёт</th><th className="px-3 py-3 text-right">По выписке</th><th className="px-3 py-3 text-right">По ДДС</th><th className="px-4 py-3 text-right">Разница</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{snapshot.bank.accounts.map((row) => <tr key={row.id} className="hover:bg-slate-50"><td className="px-4 py-3"><div className="font-semibold text-slate-900">{row.name}</div><div className="text-slate-500">{[row.bank, row.accountNumber].filter(Boolean).join(" · ") || "Нет сопоставления"}</div>{row.error ? <div className="mt-1 text-rose-700">{row.error}</div> : null}</td><td className="px-3 py-3 text-right font-semibold tabular-nums">{money(row.statementAmount)}</td><td className="px-3 py-3 text-right tabular-nums">{money(row.ddsAmount)}</td><td className={`px-4 py-3 text-right font-semibold tabular-nums ${row.matchesDds ? "text-emerald-700" : "text-rose-700"}`}>{money(row.difference)}</td></tr>)}</tbody>
            </table>
          ) : (
            <table className="min-w-[700px] w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-500"><tr><th className="px-4 py-3 text-left">Кабинет</th><th className="px-3 py-3 text-right">Всего у маркетплейса</th><th className="px-4 py-3 text-right">Доступно к выводу</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{snapshot.marketplaces[kind].rows.map((row) => <tr key={row.sourceKey} className="hover:bg-slate-50"><td className="px-4 py-3"><div className="font-semibold text-slate-900">{row.label}</div><div className="text-slate-500">Снимок {new Date(row.capturedAt).toLocaleString("ru-RU")}</div>{row.error ? <div className="mt-1 text-rose-700">{row.error}</div> : null}</td><td className="px-3 py-3 text-right font-semibold tabular-nums">{money(row.amount)}</td><td className="px-4 py-3 text-right tabular-nums">{row.availableAmount === null ? "—" : money(row.availableAmount)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export function BalancePage() {
  const { state, hydrated, loadError } = useFinance();
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [companies, setCompanies] = useState<BalanceCompany[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const asOf = `${month}-01`;
  const [scheduleRows, setScheduleRows] = useState<ScheduleRowRecord[]>([]);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [inventory, setInventory] = useState<InventorySnapshot | null>(null);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [cashSnapshot, setCashSnapshot] = useState<CashSnapshot | null>(null);
  const [cashError, setCashError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [detailKind, setDetailKind] = useState<InventoryKind | null>(null);
  const [cashDetailKind, setCashDetailKind] = useState<CashDetailKind | null>(null);
  const [testingSources, setTestingSources] = useState(false);
  const [sourceTest, setSourceTest] = useState<CashSourceTest | null>(null);
  const [sourceTestError, setSourceTestError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/finance/balance-scopes", { cache: "no-store" })
      .then((response) => responseJson<{ companies: BalanceCompany[] }>(response))
      .then((body) => {
        setCompanies(body.companies);
        setCompanyId((current) => current && body.companies.some((company) => company.id === current) ? current : body.companies[0]?.id ?? "");
        setCompaniesError(null);
      })
      .catch((error) => setCompaniesError(error instanceof Error ? error.message : "Не удалось загрузить юрлица"));
  }, []);

  const refreshExternal = useCallback(async () => {
    if (!companyId) return;
    setRefreshing(true);
    const [schedules, stocks, cashResult] = await Promise.allSettled([
      fetch("/api/finance/loans/schedule", { cache: "no-store" })
        .then((response) => responseJson<{ rows?: ScheduleRowRecord[]; error?: string }>(response)),
      loadInventory(month, companyId),
      loadCash(month, companyId),
    ]);
    if (schedules.status === "fulfilled") {
      setScheduleRows(schedules.value.rows ?? []);
      setScheduleError(null);
    } else {
      setScheduleRows([]);
      setScheduleError(schedules.reason instanceof Error ? schedules.reason.message : "Не удалось загрузить графики кредитов");
    }
    if (stocks.status === "fulfilled") {
      setInventory(stocks.value);
      setInventoryError(null);
    } else {
      setInventory(null);
      setInventoryError(stocks.reason instanceof Error ? stocks.reason.message : "Не удалось загрузить месячный остаток маркетплейсов");
    }
    if (cashResult.status === "fulfilled") {
      setCashSnapshot(cashResult.value);
      setCashError(null);
    } else {
      setCashSnapshot(null);
      setCashError(cashResult.reason instanceof Error ? cashResult.reason.message : "Не удалось загрузить денежные остатки");
    }
    setRefreshing(false);
  }, [companyId, month]);

  useEffect(() => { void refreshExternal(); }, [refreshExternal]);

  const testSources = useCallback(async () => {
    setTestingSources(true);
    setSourceTestError(null);
    try {
      const response = await fetch("/api/sync/trigger?job=balance-monthly-stock&dryRun=1", { method: "POST" });
      const body = await response.json().catch(() => ({})) as { error?: string; result?: CashSourceTest } & Partial<CashSourceTest>;
      const result = body.result ?? (body.cashSummaries ? body as CashSourceTest : null);
      if (!result) throw new Error(body.error || `Проверка вернула ошибку ${response.status}`);
      setSourceTest(result);
      if (!response.ok && !result.cashSummaries?.length) throw new Error(body.error || `Проверка вернула ошибку ${response.status}`);
    } catch (error) {
      setSourceTest(null);
      setSourceTestError(error instanceof Error ? error.message : "Не удалось проверить источники");
    } finally {
      setTestingSources(false);
    }
  }, []);

  const selectedCompany = companies.find((company) => company.id === companyId) ?? null;
  const cash = cashSnapshot?.amount ?? null;
  const assignedLoanIds = useMemo(() => new Set(state.payments.flatMap((payment) => {
    const match = payment.companyId ? payment.comment?.match(/\[loan:([^:\]]+):/) : null;
    return match ? [match[1]] : [];
  })), [state.payments]);
  const scopedLoanIds = useMemo(() => new Set(state.payments.filter((payment) => payment.companyId && selectedCompany?.companyIds.includes(payment.companyId)).flatMap((payment) => {
    const match = payment.comment?.match(/\[loan:([^:\]]+):/);
    return match ? [match[1]] : [];
  })), [selectedCompany, state.payments]);
  const scopedLoans = useMemo(() => state.loans.filter((loan) => scopedLoanIds.has(loan.id)), [scopedLoanIds, state.loans]);
  const scopedScheduleRows = useMemo(() => scheduleRows.filter((row) => scopedLoanIds.has(row.loanId)), [scheduleRows, scopedLoanIds]);
  const loanSnapshot = useMemo(() => loanLiabilitySnapshot(scopedLoans, scopedScheduleRows, asOf), [asOf, scopedLoans, scopedScheduleRows]);
  const unassignedLoanCount = state.loans.filter((loan) => loan.status === "active" && !assignedLoanIds.has(loan.id)).length;
  const inventoryReady = inventory?.complete === true && inventory.amount !== null;
  const provisionalFulfillment = inventory?.categories.find((item) => item.kind === "fulfillment" && item.provisional);
  const inventoryWarning = inventory && !inventory.complete
    ? inventory.categories.flatMap((item) => item.errors).join("; ") || "месячный снимок неполный"
    : provisionalFulfillment
      ? `Фулфилмент предварительный: поздние документы с датой до начала месяца автоматически попадут в ежедневный пересчёт. Итог станет финальным после закрытия складского периода.${provisionalFulfillment.reconciledAt ? ` Последняя сверка: ${new Date(provisionalFulfillment.reconciledAt).toLocaleString("ru-RU")}.` : ""}`
      : null;
  const complete = hydrated && !loadError && cash !== null && inventoryReady && !scheduleError && unassignedLoanCount === 0;
  const totals = complete ? connectedBalanceTotals({ cash, inventory: inventory.amount!, loans: loanSnapshot.amount }) : null;
  const sourcesReady = [cash !== null, inventoryReady, !scheduleError && hydrated && unassignedLoanCount === 0].filter(Boolean).length;
  const cashWarnings = cashSnapshot ? [
    ...cashSnapshot.bank.accounts.map((row) => row.error).filter(Boolean),
    ...cashSnapshot.marketplaces.wb.errors,
    ...cashSnapshot.marketplaces.ozon.errors,
  ] : [];

  return (
    <div className="mx-auto w-full max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <FinanceTabs />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-violet-700"><Scale className="h-4 w-4" /> Финрезультат</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Баланс</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Управленческий снимок «{selectedCompany?.name ?? "юрлицо не выбрано"}» на {formatDate(asOf)}. Данные разных юрлиц не суммируются.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select value={companyId} onChange={(event) => setCompanyId(event.target.value)} aria-label="Юрлицо баланса"
            className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm">
            {companies.length === 0 ? <option value="">Юрлица не загружены</option> : null}
            {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
          <input type="month" value={month} max={todayISO().slice(0, 7)} onChange={(event) => setMonth(event.target.value || todayISO().slice(0, 7))}
            aria-label="Месяц баланса" className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm" />
          <button type="button" onClick={() => void refreshExternal()} disabled={refreshing}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Обновить
          </button>
          <button type="button" onClick={() => void testSources()} disabled={testingSources}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${testingSources ? "animate-spin" : ""}`} /> {testingSources ? "Проверяем…" : "Проверить источники"}
          </button>
        </div>
      </div>

      {companiesError ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">Юрлица: {companiesError}</div> : null}

      {(sourceTest || sourceTestError) ? (
        <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${sourceTestError || sourceTest?.errors.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
          <p className="font-semibold">Тест без записи{sourceTest?.capturedAt ? ` · ${new Date(sourceTest.capturedAt).toLocaleString("ru-RU")}` : ""}</p>
          {sourceTestError ? <p className="mt-1">{sourceTestError}</p> : null}
          {sourceTest?.cashSummaries.map((item) => <p key={item.sourceKey} className="mt-1">{item.marketplace.toUpperCase()} · {item.cabinetName}: {money(item.amount)}{item.availableAmount !== null ? ` · доступно к выводу ${money(item.availableAmount)}` : ""}{item.error ? ` · ${item.error}` : ""}</p>)}
          {sourceTest?.errors.map((error, index) => <p key={`${error}-${index}`} className="mt-1">Ошибка: {error}</p>)}
        </div>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Подключённые активы" value={money(totals?.assets ?? null)} note="Деньги + все товарные остатки" tone="emerald" />
        <Metric label="Обязательства" value={money(totals?.liabilities ?? null)} note="Остаток тела кредитов" tone="amber" />
        <Metric label="Расчётный капитал" value={money(totals?.calculatedEquity ?? null)} note="Активы минус обязательства" tone="violet" />
        <Metric label="Покрытие источников" value={`${sourcesReady} из 3`} note={complete ? "Все источники обновлены" : "Часть данных недоступна"} />
      </div>

      {(loadError || cashError || cashWarnings.length || inventoryError || inventoryWarning || scheduleError || loanSnapshot.estimatedCount > 0 || unassignedLoanCount > 0) ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div className="space-y-1">
            {loadError ? <p>Счета ДДС: {loadError}</p> : null}
            {cashError ? <p>Денежные средства: {cashError}</p> : null}
            {cashWarnings.map((warning, index) => <p key={`${warning}-${index}`}>Сверка денег: {warning}</p>)}
            {inventoryError ? <p>Маркетплейсы: {inventoryError}</p> : null}
            {inventoryWarning ? <p>Товарные остатки: {inventoryWarning}</p> : null}
            {scheduleError ? <p>Кредиты: {scheduleError}</p> : null}
            {unassignedLoanCount > 0 ? <p>У {unassignedLoanCount} активных кредитов не определено юрлицо: они не включены ни в один баланс до заполнения графика и компании.</p> : null}
            {loanSnapshot.estimatedCount > 0 ? <p>У {loanSnapshot.estimatedCount} активных кредитов нет графика: показана исходная сумма договора.</p> : null}
          </div></div>
        </div>
      ) : null}

      <div className="mt-6 grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="flex items-center justify-between bg-emerald-50/70">
            <div className="flex items-center gap-2"><CircleDollarSign className="h-5 w-5 text-emerald-700" /><div><h2 className="font-bold text-slate-950">Активы</h2><p className="text-xs text-slate-500">То, чем располагает бизнес</p></div></div>
            <span className="font-bold tabular-nums text-emerald-800">{money(totals?.assets ?? null)}</span>
          </CardHeader>
          <div className="divide-y divide-slate-100">
            <StatementRow label="Денежные средства" amount={cash} detail="Выписки банков + деньги у маркетплейсов на 00:01" />
            <StatementRow label="↳ Расчётные счета" amount={cashSnapshot?.bank.amount ?? null} detail={`${cashSnapshot?.bank.accounts.length ?? 0} счетов · входящий остаток выписки · сверка с ДДС`} muted onClick={() => setCashDetailKind("bank")} />
            <StatementRow label="↳ Денежные средства на WB" amount={cashSnapshot?.marketplaces.wb.amount ?? null} detail="Полный баланс кабинета; доступное к выводу — в детализации" muted onClick={() => setCashDetailKind("wb")} />
            <StatementRow label="↳ Денежные средства на Ozon" amount={cashSnapshot?.marketplaces.ozon.amount ?? null} detail="Баланс кабинета Ozon на момент снимка" muted onClick={() => setCashDetailKind("ozon")} />
            <StatementRow label="Товарные остатки" amount={inventoryReady ? inventory.amount : null} detail={inventory?.computedAt ? `Снимок запущен ${new Date(inventory.computedAt).toLocaleString("ru-RU")} · на первое число месяца` : inventoryError ?? "Ожидается снимок 1-го числа в 00:01 МСК"} />
            {inventory?.categories.map((category) => <StatementRow key={category.kind} label={`↳ ${INVENTORY_LABELS[category.kind]}`} amount={category.amount} detail={`${category.quantity.toLocaleString("ru-RU")} шт · ${category.rowsCount} позиций${category.complete ? "" : " · данные неполные"}${category.provisional ? " · предварительно" : ""}`} muted onClick={() => setDetailKind(category.kind)} />)}
            <StatementRow label="Дебиторская задолженность" amount={null} detail="В панели пока нет реестра задолженности покупателей" muted />
            <StatementRow label="Основные средства" amount={null} detail="Источник данных ещё не подключён" muted />
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="flex items-center justify-between bg-amber-50/70">
            <div className="flex items-center gap-2"><Landmark className="h-5 w-5 text-amber-700" /><div><h2 className="font-bold text-slate-950">Обязательства и капитал</h2><p className="text-xs text-slate-500">Источники финансирования</p></div></div>
            <span className="font-bold tabular-nums text-amber-900">{money(totals?.assets ?? null)}</span>
          </CardHeader>
          <div className="divide-y divide-slate-100">
            <StatementRow label="Кредиты и займы" amount={hydrated && !scheduleError ? loanSnapshot.amount : null} detail={`${loanSnapshot.details.length} активных договоров`} href="/loans" />
            {loanSnapshot.details.slice(0, 5).map((item) => <StatementRow key={item.id} label={`↳ ${item.name}`} amount={item.amount} detail={item.estimated ? "Оценка: нет графика" : undefined} muted />)}
            <StatementRow label="Кредиторская задолженность" amount={null} detail="Нужен отдельный реестр обязательств перед поставщиками" muted />
            <StatementRow label="Налоги и расчёты с персоналом" amount={null} detail="Будет подключено из налогов и зарплатной ведомости" muted />
            <StatementRow label="Расчётный капитал" amount={totals?.calculatedEquity ?? null} detail="Балансирующая величина по подключённым статьям, не бухгалтерский капитал" />
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader><h2 className="font-bold text-slate-950">Индикаторы</h2></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-medium text-slate-500">Доля долга</p><p className="mt-1 text-xl font-bold text-slate-950">{percent(totals?.debtShare ?? null)}</p></div>
            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-medium text-slate-500">Расчётная автономия</p><p className="mt-1 text-xl font-bold text-slate-950">{percent(totals?.autonomy ?? null)}</p></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h2 className="font-bold text-slate-950">Готовность данных</h2></CardHeader>
          <CardContent className="space-y-3">
            {[
              { icon: Wallet, label: "Выписки, ДДС и деньги маркетплейсов", ready: cashSnapshot?.complete === true },
              { icon: Boxes, label: "4 группы товарных остатков на 1-е число", ready: inventoryReady },
              { icon: Building2, label: "Кредитные договоры и графики", ready: hydrated && !scheduleError && unassignedLoanCount === 0 },
            ].map(({ icon: Icon, label, ready }) => (
              <div key={label} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3"><Icon className="h-4 w-4 shrink-0 text-slate-500" /><span className="text-sm font-medium text-slate-700">{label}</span></div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${ready ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                  {ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}{ready ? "Подключено" : "Нет данных"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      {detailKind && companyId ? <InventoryDetails kind={detailKind} month={month} companyId={companyId} onClose={() => setDetailKind(null)} /> : null}
      {cashDetailKind && cashSnapshot ? <CashDetails kind={cashDetailKind} month={month} snapshot={cashSnapshot} onClose={() => setCashDetailKind(null)} /> : null}
    </div>
  );
}
