"use client";

import { Plus } from "lucide-react";
import type { DayInfo } from "@/lib/calculations";
import { formatMoney } from "@/lib/format";
import type { Payment } from "@/lib/types";

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

function formatPreviewAmount(amount: number): string {
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));
  const sign = amount >= 0 ? "+" : "−";
  return `${sign}${formatted} ₽`;
}

function previewAmountClass(amount: number, onDark: boolean): string {
  if (amount >= 0) {
    return onDark ? "text-emerald-200" : "text-emerald-600";
  }
  return onDark ? "text-red-200" : "text-red-600";
}

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
  const previewPayments = dayPayments.slice(0, 2);

  let bgClass = "bg-slate-50 border-slate-200";
  if (info?.isNegative) {
    bgClass = "bg-red-500 border-red-600 text-white";
  } else if (info?.dayType === "income") {
    bgClass = "bg-emerald-50 border-emerald-200";
  } else if (info?.dayType === "expense") {
    bgClass = "bg-red-50 border-red-200";
  }

  const onDark = info?.isNegative;

  return (
    <div
      className={`group relative min-h-[72px] rounded-lg border sm:min-h-[88px] ${
        isToday
          ? "ring-2 ring-emerald-500 ring-offset-1 ring-offset-white"
          : ""
      } ${isSelected ? "ring-2 ring-emerald-400" : ""} ${bgClass}`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex h-full w-full flex-col items-stretch rounded-lg p-1.5 text-left transition-colors hover:ring-2 hover:ring-emerald-500/30 sm:p-2"
      >
        <div className="flex items-start justify-between gap-1">
          <span
            className={`text-xs font-semibold sm:text-sm ${
              onDark ? "text-white" : "text-slate-700"
            }`}
          >
            {day}
          </span>
          {paymentCount > 0 && (
            <span
              className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none ${
                onDark
                  ? "bg-white/20 text-white"
                  : "bg-slate-700 text-white"
              }`}
            >
              {paymentCount}
            </span>
          )}
        </div>

        {previewPayments.length > 0 && (
          <div className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-hidden">
            {previewPayments.map((payment) => (
              <div
                key={payment.id}
                className="flex min-w-0 items-baseline gap-1 text-[8px] leading-tight sm:text-[9px]"
              >
                <span
                  className={`shrink-0 font-bold tabular-nums ${previewAmountClass(payment.amount, onDark ?? false)}`}
                >
                  {formatPreviewAmount(payment.amount)}
                </span>
                <span
                  className={`min-w-0 truncate ${
                    onDark ? "text-white/80" : "text-slate-600"
                  }`}
                >
                  {payment.name}
                </span>
              </div>
            ))}
            {paymentCount > 2 && (
              <p
                className={`text-[8px] sm:text-[9px] ${onDark ? "text-white/60" : "text-slate-400"}`}
              >
                +{paymentCount - 2} ещё
              </p>
            )}
          </div>
        )}

        {info && (
          <span
            className={`mt-auto text-[9px] font-medium leading-tight sm:text-[10px] ${
              onDark
                ? "text-white/90"
                : info.balance >= 0
                  ? "text-slate-600"
                  : "text-red-600"
            }`}
          >
            {formatMoney(info.balance).replace(" ₽", "")}
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onQuickAdd();
        }}
        className={`absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full opacity-0 shadow-sm transition-opacity group-hover:opacity-100 ${
          onDark
            ? "bg-white/90 text-slate-800 hover:bg-white"
            : "bg-emerald-600 text-white hover:bg-emerald-500"
        }`}
        aria-label={`Быстро добавить платёж на ${dateStr}`}
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}
