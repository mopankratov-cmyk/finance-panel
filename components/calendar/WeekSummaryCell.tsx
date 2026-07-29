"use client";

import { useMemo } from "react";
import { getWeekSummary } from "@/lib/calculations";
import { formatDayMonth, formatMoney } from "@/lib/format";
import type { Payment } from "@/lib/types";

interface WeekSummaryCellProps {
  referenceDate: string;
  totalBalance: number;
  payments: Payment[];
}

function signedMoney(amount: number): string {
  const prefix = amount > 0 ? "+" : "";
  return `${prefix}${formatMoney(amount)}`;
}

interface MetricProps {
  label: string;
  value: string;
  valueClass: string;
}

function Metric({ label, value, valueClass }: MetricProps) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] leading-snug text-slate-400 sm:text-xs">
        {label}
      </p>
      <p
        className={`truncate text-xs font-bold tabular-nums leading-snug sm:text-sm ${valueClass}`}
      >
        {value}
      </p>
    </div>
  );
}

export function WeekSummaryCell({
  referenceDate,
  totalBalance,
  payments,
}: WeekSummaryCellProps) {
  const summary = useMemo(
    () => getWeekSummary(referenceDate, totalBalance, payments),
    [referenceDate, totalBalance, payments],
  );

  const isPositiveWeek = summary.netFlow >= 0;
  const borderClass = isPositiveWeek ? "border-l-emerald-500" : "border-l-red-500";

  const netClass =
    summary.netFlow > 0
      ? "text-emerald-600"
      : summary.netFlow < 0
        ? "text-red-600"
        : "text-slate-500";

  const balanceClass =
    summary.runningBalance < 0 ? "text-red-600" : "text-slate-900";

  return (
    <div className={`rounded-lg border border-slate-200 border-l-[3px] bg-slate-50/70 p-3 ${borderClass}`}>
      <p className="mb-2 truncate text-xs font-semibold text-slate-700">
        Неделя {summary.weekNumber}
        <span className="mx-1.5 font-normal text-slate-600">|</span>
        <span className="font-normal text-slate-400">
          {formatDayMonth(summary.startDate)}–{formatDayMonth(summary.endDate)}
        </span>
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label="Сальдо за неделю"
          value={signedMoney(summary.netFlow)}
          valueClass={netClass}
        />
        <Metric
          label="Поступления за неделю"
          value={formatMoney(summary.totalIncome)}
          valueClass="text-emerald-600"
        />
        <Metric
          label="Выбытия за неделю"
          value={formatMoney(summary.totalExpense)}
          valueClass="text-red-600"
        />
        <Metric
          label="Остаток с учётом прошлой недели"
          value={formatMoney(summary.runningBalance)}
          valueClass={balanceClass}
        />
      </div>
    </div>
  );
}
