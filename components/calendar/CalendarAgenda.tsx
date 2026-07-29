"use client";

import { CalendarPlus, CheckCircle2, Clock3 } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import type { DayInfo } from "@/lib/calculations";
import type { Payment } from "@/lib/types";
import { getPaymentPriority, PRIORITY_META, priorityRank } from "./paymentPriority";

export function CalendarAgenda({
  days,
  paymentsByDate,
  today,
  onSelect,
  onQuickAdd,
}: {
  days: DayInfo[];
  paymentsByDate: Map<string, Payment[]>;
  today: string;
  onSelect: (date: string) => void;
  onQuickAdd: (date: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="hidden grid-cols-[112px_145px_145px_minmax(260px,1fr)_150px_48px] gap-3 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:grid">
        <span>Дата</span><span className="text-right">Поступления</span><span className="text-right">Расходы</span><span>Расходы за день</span><span className="text-right">Остаток</span><span />
      </div>
      <div className="divide-y divide-slate-100">
        {days.map((day) => {
          const payments = (paymentsByDate.get(day.date) ?? []).filter((payment) => payment.status !== "cancelled");
          const income = payments.filter((payment) => payment.amount > 0).reduce((sum, payment) => sum + payment.amount, 0);
          const expenses = payments.filter((payment) => payment.amount < 0).sort((a, b) => priorityRank(a) - priorityRank(b) || a.amount - b.amount);
          const expense = expenses.reduce((sum, payment) => sum - payment.amount, 0);
          const isToday = day.date === today;
          return (
            <div key={day.date} className={`group grid gap-3 px-4 py-3 transition-colors lg:grid-cols-[112px_145px_145px_minmax(260px,1fr)_150px_48px] lg:items-center ${isToday ? "bg-violet-50/70" : payments.length ? "bg-white hover:bg-slate-50" : "bg-slate-50/30 hover:bg-slate-50"}`}>
              <button onClick={() => onSelect(day.date)} className="text-left">
                <span className={`block text-sm font-bold ${isToday ? "text-violet-800" : "text-slate-900"}`}>{formatDate(day.date)}</span>
                <span className="text-xs text-slate-500">{isToday ? "Сегодня" : new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(new Date(`${day.date}T00:00:00`))}</span>
              </button>
              <div className="flex items-center justify-between lg:block lg:text-right">
                <span className="text-xs text-slate-500 lg:hidden">Поступления</span>
                <span className={`font-bold tabular-nums ${income > 0 ? "text-emerald-700" : "text-slate-300"}`}>{income > 0 ? `+${formatMoney(income)}` : "—"}</span>
              </div>
              <div className="flex items-center justify-between lg:block lg:text-right">
                <span className="text-xs text-slate-500 lg:hidden">Расходы</span>
                <span className={`font-bold tabular-nums ${expense > 0 ? "text-rose-700" : "text-slate-300"}`}>{expense > 0 ? `−${formatMoney(expense)}` : "—"}</span>
              </div>
              <button onClick={() => onSelect(day.date)} className="min-w-0 text-left">
                {expenses.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {expenses.slice(0, 4).map((payment) => (
                      <span key={payment.id} title={payment.name} className="inline-flex max-w-56 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
                        {payment.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <Clock3 className="h-3.5 w-3.5 shrink-0 text-amber-600" />}
                        <span className={`rounded border px-1 text-[9px] font-bold ${PRIORITY_META[getPaymentPriority(payment)].badge}`}>{getPaymentPriority(payment)}</span>
                        <span className="truncate">{payment.category}</span>
                        <b className="shrink-0 tabular-nums">{formatMoney(Math.abs(payment.amount))}</b>
                      </span>
                    ))}
                    {expenses.length > 4 && <span className="px-2 py-1 text-xs text-slate-500">ещё {expenses.length - 4}</span>}
                  </div>
                ) : <span className="text-sm text-slate-400">Расходов нет</span>}
              </button>
              <div className="flex items-center justify-between lg:block lg:text-right">
                <span className="text-xs text-slate-500 lg:hidden">Остаток</span>
                <span className={`font-semibold tabular-nums ${day.balance < 0 ? "text-rose-700" : "text-slate-800"}`}>{formatMoney(day.balance)}</span>
              </div>
              <button onClick={() => onQuickAdd(day.date)} aria-label={`Добавить на ${day.date}`} className="flex h-11 w-11 items-center justify-center rounded-lg text-violet-700 hover:bg-violet-100">
                <CalendarPlus className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
