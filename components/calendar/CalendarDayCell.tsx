"use client";

import { Plus } from "lucide-react";
import type { DayInfo } from "@/lib/calculations";
import { formatMoney } from "@/lib/format";
import type { Payment } from "@/lib/types";
import { displayPaymentComment, getPaymentPriority, PRIORITY_META, priorityRank } from "./paymentPriority";

interface CalendarDayCellProps {
  dateStr: string;
  day: number;
  info: DayInfo | undefined;
  dayPayments: Payment[];
  isToday: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onQuickAdd: () => void;
}

const compactMoney = (amount: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.abs(amount));

export function CalendarDayCell({
  dateStr,
  day,
  info,
  dayPayments,
  isToday,
  isSelected,
  onSelect,
  onQuickAdd,
}: CalendarDayCellProps) {
  const paymentCount = dayPayments.length;
  const activePayments = dayPayments.filter((payment) => payment.status !== "cancelled");
  const income = activePayments.filter((payment) => payment.amount > 0).reduce((sum, payment) => sum + payment.amount, 0);
  const expense = activePayments.filter((payment) => payment.amount < 0).reduce((sum, payment) => sum - payment.amount, 0);
  const expenseRows = activePayments.filter((payment) => payment.amount < 0).sort((a, b) => priorityRank(a) - priorityRank(b) || a.amount - b.amount).slice(0, 3);
  const hiddenExpenses = activePayments.filter((payment) => payment.amount < 0).length - expenseRows.length;
  const compactLabel = (payment: Payment) => displayPaymentComment(payment.comment) || payment.name || payment.counterparty || payment.category || "Без комментария";

  const negative = info?.isNegative;

  return (
    <div
      className={`group relative min-h-[210px] overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow hover:shadow-md ${
        isToday
          ? "border-violet-400 ring-2 ring-violet-200"
          : negative ? "border-rose-300 border-t-4" : "border-slate-200"
      } ${isSelected ? "ring-2 ring-violet-500" : ""}`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-h-[210px] w-full flex-col items-stretch p-3 text-left"
      >
        <div className="flex items-center justify-between gap-2">
          <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${isToday ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-800"}`}>
            {day}
          </span>
          {paymentCount > 0 && (
            <span className="rounded-full bg-slate-100 px-2 py-1 text-[12px] font-medium text-slate-600 lg:text-[11px]">{paymentCount} опер.</span>
          )}
        </div>

        {(income > 0 || expense > 0) && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-emerald-50 px-2 py-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700 lg:text-[10px]">Поступления</p>
              <p className="mt-0.5 truncate text-sm font-bold tabular-nums text-emerald-800">+{compactMoney(income)}</p>
            </div>
            <div className="rounded-lg bg-rose-50 px-2 py-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-rose-700 lg:text-[10px]">Расходы</p>
              <p className="mt-0.5 truncate text-sm font-bold tabular-nums text-rose-800">−{compactMoney(expense)}</p>
            </div>
          </div>
        )}

        {expenseRows.length > 0 && (
          <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-hidden">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 lg:text-[10px]">Расходы за день</p>
            {expenseRows.map((payment) => (
              <div key={payment.id} title={compactLabel(payment)} className="flex min-w-0 items-center gap-1.5 text-xs leading-tight text-slate-700 lg:text-[11px]">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${payment.status === "done" ? "bg-emerald-500" : "bg-amber-500"}`} />
                <span className={`shrink-0 rounded border px-1 text-[10px] font-bold lg:text-[9px] ${PRIORITY_META[getPaymentPriority(payment)].badge}`}>{getPaymentPriority(payment)}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{compactLabel(payment)}</span>
                <span className="shrink-0 font-semibold tabular-nums">−{compactMoney(payment.amount)}</span>
              </div>
            ))}
            {hiddenExpenses > 0 && <p className="text-[11px] text-slate-400 lg:text-[10px]">Ещё расходов: {hiddenExpenses}</p>}
          </div>
        )}

        {info && (
          <div className={`mt-auto border-t border-slate-100 pt-2 text-xs ${info.balance >= 0 ? "text-slate-600" : "text-rose-700"}`}>
            Остаток: <b className="tabular-nums">{formatMoney(info.balance).replace(" ₽", "")}</b>
          </div>
        )}
      </button>

      {/* Пальцем наведения не бывает: без `.hover-actions` кнопка так и осталась
          бы невидимой, и добавить платёж в день с телефона можно было бы только
          через панель дня. `.tap-hit` растягивает область нажатия до 44px, не
          раздувая сам кружок — на мыши вид и размер прежние. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onQuickAdd();
        }}
        className="hover-actions tap-hit absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:bg-violet-700 focus:opacity-100"
        aria-label={`Быстро добавить платёж на ${dateStr}`}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
