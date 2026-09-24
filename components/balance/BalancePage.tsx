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
} from "lucide-react";
import { FinanceTabs } from "@/components/FinanceTabs";
import { useFinance } from "@/components/providers/FinanceProvider";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { accountBalance, rubAccounts } from "@/lib/finance/balance";
import { connectedBalanceTotals, loanLiabilitySnapshot } from "@/lib/finance/statementBalance";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import type { ScheduleRowRecord } from "@/lib/loans/scheduleRows";

type Entity = { id: string; name: string };
type StockResponse = { data?: { totals?: { amount?: number }; computedAt?: string }; error?: string };
type InventoryDetail = { id: string; name: string; amount: number };

const money = (value: number | null) => value === null ? "—" : formatMoney(value);
const percent = (value: number | null) => value === null
  ? "—"
  : new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 1 }).format(value);

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
  return body;
}

async function loadInventory(): Promise<{ amount: number; details: InventoryDetail[]; computedAt: string | null }> {
  const entityBody = await fetch("/api/warehouse/entities", { cache: "no-store" })
    .then((response) => responseJson<{ data?: Entity[]; error?: string }>(response));
  const entities = entityBody.data ?? [];
  if (!entities.length) throw new Error("В панели не настроены юрлица склада");

  const results = await Promise.allSettled(entities.map(async (entity) => {
    const body = await fetch(`/api/warehouse/balances?entity=${encodeURIComponent(entity.id)}`, { cache: "no-store" })
      .then((response) => responseJson<StockResponse>(response));
    return {
      id: entity.id,
      name: entity.name,
      amount: Number(body.data?.totals?.amount ?? 0),
      computedAt: body.data?.computedAt ?? null,
    };
  }));
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length) throw new Error(`Не удалось прочитать складские остатки по ${failed.length} из ${entities.length} юрлиц`);
  const loaded = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  return {
    amount: loaded.reduce((sum, item) => sum + item.amount, 0),
    details: loaded.map(({ id, name, amount }) => ({ id, name, amount })).sort((a, b) => b.amount - a.amount),
    computedAt: loaded.map((item) => item.computedAt).filter(Boolean).sort().at(0) ?? null,
  };
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

function StatementRow({ label, amount, detail, muted = false, href }: { label: string; amount: number | null; detail?: string; muted?: boolean; href?: string }) {
  const content = (
    <div className={`grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 sm:px-5 ${href ? "transition-colors hover:bg-slate-50" : ""}`}>
      <div className="min-w-0">
        <p className={`text-sm font-medium ${muted ? "text-slate-500" : "text-slate-800"}`}>{label}</p>
        {detail ? <p className="mt-0.5 text-xs leading-5 text-slate-500">{detail}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-sm font-semibold tabular-nums ${amount === null ? "text-slate-400" : "text-slate-950"}`}>{money(amount)}</span>
        {href ? <ChevronRight className="h-4 w-4 text-slate-400" /> : null}
      </div>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export function BalancePage() {
  const { state, hydrated, loadError } = useFinance();
  const asOf = todayISO();
  const [scheduleRows, setScheduleRows] = useState<ScheduleRowRecord[]>([]);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [inventory, setInventory] = useState<{ amount: number; details: InventoryDetail[]; computedAt: string | null } | null>(null);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refreshExternal = useCallback(async () => {
    setRefreshing(true);
    const [schedules, stocks] = await Promise.allSettled([
      fetch("/api/finance/loans/schedule", { cache: "no-store" })
        .then((response) => responseJson<{ rows?: ScheduleRowRecord[]; error?: string }>(response)),
      loadInventory(),
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
      setInventoryError(stocks.reason instanceof Error ? stocks.reason.message : "Не удалось загрузить складские остатки");
    }
    setRefreshing(false);
  }, []);

  useEffect(() => { void refreshExternal(); }, [refreshExternal]);

  const accountDetails = useMemo(() => rubAccounts(state.accounts)
    .map((account) => ({ id: account.id, name: account.name, amount: accountBalance(account, state.payments, asOf) }))
    .sort((a, b) => b.amount - a.amount), [asOf, state.accounts, state.payments]);
  const cash = accountDetails.reduce((sum, account) => sum + account.amount, 0);
  const loanSnapshot = useMemo(() => loanLiabilitySnapshot(state.loans, scheduleRows, asOf), [asOf, scheduleRows, state.loans]);
  const complete = hydrated && !loadError && state.accounts.length > 0 && inventory !== null && !scheduleError;
  const totals = complete ? connectedBalanceTotals({ cash, inventory: inventory.amount, loans: loanSnapshot.amount }) : null;
  const sourcesReady = [hydrated && !loadError && state.accounts.length > 0, inventory !== null, !scheduleError && hydrated].filter(Boolean).length;

  return (
    <div className="mx-auto w-full max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <FinanceTabs />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-violet-700"><Scale className="h-4 w-4" /> Финрезультат</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Баланс</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Управленческий снимок на {formatDate(asOf)}. Цифры собираются из счетов ДДС, склада и кредитных графиков панели.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshExternal()}
          disabled={refreshing}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Обновить
        </button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Подключённые активы" value={money(totals?.assets ?? null)} note="Деньги + товар на складах" tone="emerald" />
        <Metric label="Обязательства" value={money(totals?.liabilities ?? null)} note="Остаток тела кредитов" tone="amber" />
        <Metric label="Расчётный капитал" value={money(totals?.calculatedEquity ?? null)} note="Активы минус обязательства" tone="violet" />
        <Metric label="Покрытие источников" value={`${sourcesReady} из 3`} note={complete ? "Все источники обновлены" : "Часть данных недоступна"} />
      </div>

      {(loadError || inventoryError || scheduleError || loanSnapshot.estimatedCount > 0) ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div className="space-y-1">
            {loadError ? <p>Счета ДДС: {loadError}</p> : null}
            {inventoryError ? <p>Склад: {inventoryError}</p> : null}
            {scheduleError ? <p>Кредиты: {scheduleError}</p> : null}
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
            <StatementRow label="Денежные средства" amount={hydrated && !loadError && state.accounts.length ? cash : null} detail={`${accountDetails.length} рублёвых счетов`} href="/accounts" />
            {accountDetails.slice(0, 5).map((account) => <StatementRow key={account.id} label={`↳ ${account.name}`} amount={account.amount} muted />)}
            <StatementRow label="Товары на складах" amount={inventory?.amount ?? null} detail={inventory?.computedAt ? `Снимок не старше ${new Date(inventory.computedAt).toLocaleString("ru-RU")}` : inventoryError ?? "Загрузка…"} href="/warehouse?tab=balances" />
            {inventory?.details.map((entity) => <StatementRow key={entity.id} label={`↳ ${entity.name}`} amount={entity.amount} muted />)}
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
              { icon: Wallet, label: "Счета и факты ДДС", ready: hydrated && !loadError && state.accounts.length > 0 },
              { icon: Boxes, label: "Складские остатки по себестоимости", ready: inventory !== null },
              { icon: Building2, label: "Кредитные договоры и графики", ready: hydrated && !scheduleError },
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
    </div>
  );
}
