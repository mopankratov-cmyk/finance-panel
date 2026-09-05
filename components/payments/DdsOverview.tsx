"use client";

import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Building2, CheckCircle2, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";
import type { DdsCompany } from "./ddsCompanies";
import { Card, CardContent } from "@/components/ui/Card";
import { formatMoney } from "@/lib/format";
import type { Account, Payment } from "@/lib/types";

type PaymentWithCompany = Payment & { companyId?: string | null };

export function DdsOverview({
  payments,
  accounts,
  companies,
  onOpenLedger,
  onOpenReview,
  onOpenReconciliation,
}: {
  payments: PaymentWithCompany[];
  accounts: Account[];
  companies: DdsCompany[];
  onOpenLedger: () => void;
  onOpenReview: () => void;
  onOpenReconciliation: () => void;
}) {
  const [companyScope, setCompanyScope] = useState("all");
  const groups = useMemo(
    () => [...new Set(companies.filter((company) => company.isActive).map((company) => company.groupName))].sort(),
    [companies],
  );
  const companyById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const scopedPayments = useMemo(() => {
    if (companyScope === "all") return payments;
    if (companyScope === "unassigned") return payments.filter((payment) => !payment.companyId);
    if (companyScope.startsWith("group:")) {
      const group = companyScope.slice(6);
      return payments.filter((payment) => payment.companyId && companyById.get(payment.companyId)?.groupName === group);
    }
    return payments.filter((payment) => payment.companyId === companyScope);
  }, [payments, companyScope, companyById]);
  const facts = useMemo(() => scopedPayments.filter((payment) => payment.status === "done"), [scopedPayments]);
  const income = facts.reduce((sum, payment) => sum + Math.max(0, payment.amount), 0);
  const expense = facts.reduce((sum, payment) => sum + Math.max(0, -payment.amount), 0);
  const unassigned = facts.filter((payment) => !payment.companyId).length;
  const balance = accounts.reduce((sum, account) => sum + account.balance, 0);

  const companyRows = useMemo(() => {
    const totals = new Map<string, { income: number; expense: number }>();
    for (const company of companies) totals.set(company.id, { income: 0, expense: 0 });
    for (const payment of facts) {
      if (!payment.companyId) continue;
      const row = totals.get(payment.companyId);
      if (!row) continue;
      if (payment.amount >= 0) row.income += payment.amount;
      else row.expense += -payment.amount;
    }
    return companies
      .filter((company) => company.isActive)
      .map((company) => ({ company, ...(totals.get(company.id) ?? { income: 0, expense: 0 }) }))
      .filter((row) => companyScope === "all" || companyScope.startsWith("group:") ? row.income > 0 || row.expense > 0 : row.company.id === companyScope)
      .sort((a, b) => b.expense - a.expense)
      .slice(0, 6);
  }, [companies, facts, companyScope]);

  const maxExpense = Math.max(...companyRows.map((row) => row.expense), 1);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-slate-900">Область отчёта</p>
          <p className="text-sm text-slate-500">Все показатели ниже пересчитываются по выбранной компании или группе.</p>
        </div>
        <select
          value={companyScope}
          onChange={(event) => setCompanyScope(event.target.value)}
          aria-label="Компания для обзора ДДС"
          className="min-h-11 min-w-64 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800"
        >
          <option value="all">Все компании</option>
          <option value="unassigned">Без назначенной компании</option>
          {groups.map((group) => <option key={group} value={`group:${group}`}>Группа: {group}</option>)}
          {companies.filter((company) => company.isActive).map((company) => (
            <option key={company.id} value={company.id}>{company.name}</option>
          ))}
        </select>
      </div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={ArrowDownLeft} label="Поступления" value={formatMoney(income)} tone="emerald" />
        <Metric icon={ArrowUpRight} label="Расходы" value={formatMoney(expense)} tone="rose" />
        <Metric icon={WalletCards} label="Остаток по счетам" value={formatMoney(balance)} tone="violet" />
        <Metric
          icon={income - expense >= 0 ? CheckCircle2 : AlertTriangle}
          label="Чистый денежный поток"
          value={formatMoney(income - expense)}
          tone={income - expense >= 0 ? "blue" : "amber"}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.45fr_0.8fr]">
        <Card>
          <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Расходы по компаниям</h2>
              <p className="mt-1 text-xs text-slate-500">Быстро показывает, где сосредоточен денежный отток.</p>
            </div>
            <button onClick={onOpenLedger} className="min-h-11 rounded-lg px-3 text-sm font-medium text-violet-700 hover:bg-violet-50">
              Открыть платежи
            </button>
          </div>
          <CardContent className="space-y-4 pt-5">
            {companyRows.map(({ company, income: companyIncome, expense: companyExpense }) => (
              <div key={company.id}>
                <div className="mb-1.5 flex items-center justify-between gap-4 text-sm">
                  <span className="truncate font-medium text-slate-700">{company.name}</span>
                  <span className="shrink-0 tabular-nums text-slate-900">{formatMoney(companyExpense)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                    style={{ width: `${Math.max(2, (companyExpense / maxExpense) * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs tabular-nums text-emerald-700">Поступления: {formatMoney(companyIncome)}</p>
              </div>
            ))}
            {companyRows.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Нет данных по компаниям</p>}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <ActionCard
            icon={AlertTriangle}
            title="Операции на проверке"
            text="Неизвестные статьи, новые контрагенты и ответы руководителя."
            value="Открыть очередь"
            tone="amber"
            onClick={onOpenReview}
          />
          <ActionCard
            icon={WalletCards}
            title="Сверка с банком"
            text="Выписка, операции в обработке, остатки и найденные расхождения."
            value="Перейти к сверке"
            tone="blue"
            onClick={onOpenReconciliation}
          />
          {unassigned > 0 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <div className="flex items-center gap-2 font-semibold text-rose-900">
                <Building2 className="h-5 w-5" /> Без компании: {unassigned}
              </div>
              <p className="mt-1 text-sm text-rose-700">Эти фактические платежи нужно распределить по юрлицам.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof ArrowDownLeft;
  label: string;
  value: string;
  tone: "emerald" | "rose" | "violet" | "blue" | "amber";
}) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-50 text-rose-700",
    violet: "bg-violet-50 text-violet-700",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <Card>
      <CardContent className="pt-5">
        <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        {/* Сумму не обрезаем: раньше в узкой колонке она молча превращалась в
            «1 234…», и полного числа было негде взять — на денежном экране это
            дезинформация. Длинное значение переносится и мельчает. */}
        <p className="mt-1 text-lg font-bold tabular-nums break-anywhere text-slate-950 sm:text-xl">{value}</p>
      </CardContent>
    </Card>
  );
}

function ActionCard({
  icon: Icon,
  title,
  text,
  value,
  tone,
  onClick,
}: {
  icon: typeof AlertTriangle;
  title: string;
  text: string;
  value: string;
  tone: "amber" | "blue";
  onClick: () => void;
}) {
  const colors = tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-blue-200 bg-blue-50 text-blue-900";
  return (
    <button onClick={onClick} className={`w-full rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${colors}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <div className="font-semibold">{title}</div>
          <p className="mt-1 text-sm opacity-80">{text}</p>
          <span className="mt-3 inline-block text-sm font-semibold underline underline-offset-4">{value}</span>
        </div>
      </div>
    </button>
  );
}
