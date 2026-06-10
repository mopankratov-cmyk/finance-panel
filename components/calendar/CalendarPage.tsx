"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDayCell } from "./CalendarDayCell";
import { CashFlowSparkline } from "./CashFlowSparkline";
import { DayDetailPanel } from "./DayDetailPanel";
import { WeekSummaryCell } from "./WeekSummaryCell";
import { useFinance } from "@/components/providers/FinanceProvider";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import {
  getDailyBalancesForMonth,
  getTotalBalance,
  type DayInfo,
} from "@/lib/calculations";
import { todayISO } from "@/lib/format";
import type { Payment } from "@/lib/types";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

interface CalendarDay {
  dateStr: string;
  day: number;
  info: DayInfo | undefined;
}

interface CalendarWeekRow {
  days: (CalendarDay | null)[];
  referenceDate: string;
}

function buildMonthWeeks(
  year: number,
  month: number,
  dailyMap: Map<string, DayInfo>,
): CalendarWeekRow[] {
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const rows: CalendarWeekRow[] = [];
  let week: (CalendarDay | null)[] = Array(7).fill(null);
  let dow = startOffset;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    week[dow] = { dateStr, day: d, info: dailyMap.get(dateStr) };
    dow++;

    if (dow === 7) {
      const ref = week.find((c) => c)?.dateStr ?? dateStr;
      rows.push({ days: week, referenceDate: ref });
      week = Array(7).fill(null);
      dow = 0;
    }
  }

  if (dow > 0) {
    const ref =
      week.find((c) => c)?.dateStr ??
      `${year}-${String(month + 1).padStart(2, "0")}-01`;
    rows.push({ days: week, referenceDate: ref });
  }

  return rows;
}

export function CalendarPage() {
  const { state, dispatch } = useFinance();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [quickAddPending, setQuickAddPending] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = todayISO();

  const totalBalance = getTotalBalance(state.accounts);

  const dailyMap = useMemo(
    () => getDailyBalancesForMonth(year, month, totalBalance, state.payments),
    [year, month, totalBalance, state.payments],
  );

  const paymentsByDate = useMemo(() => {
    const map = new Map<string, Payment[]>();
    for (const p of state.payments) {
      const list = map.get(p.date) ?? [];
      list.push(p);
      map.set(p.date, list);
    }
    return map;
  }, [state.payments]);

  const weeks = useMemo(
    () => buildMonthWeeks(year, month, dailyMap),
    [year, month, dailyMap],
  );

  const selectedDay: DayInfo | null = selectedDate
    ? (dailyMap.get(selectedDate) ?? null)
    : null;

  useEffect(() => {
    if (selectedDate && !dailyMap.has(selectedDate)) {
      setSelectedDate(null);
      setQuickAddPending(false);
    }
  }, [dailyMap, selectedDate]);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const handleClosePanel = () => {
    setSelectedDate(null);
    setQuickAddPending(false);
  };

  const handleQuickAdd = useCallback((dateStr: string) => {
    setSelectedDate(dateStr);
    setQuickAddPending(true);
  }, []);

  const handleAddPayment = (payment: Payment) => {
    dispatch({ type: "ADD_PAYMENT", payload: payment });
  };

  const handleUpdatePayment = (payment: Payment) => {
    dispatch({ type: "UPDATE_PAYMENT", payload: payment });
  };

  const handleDeletePayment = (id: string) => {
    dispatch({ type: "DELETE_PAYMENT", payload: id });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Календарь платежей</h1>
        <p className="text-sm text-slate-400 mt-1">
          Прогноз денежного потока по дням
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <button
              onClick={prevMonth}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h2 className="text-lg font-semibold text-slate-900">
              {MONTHS[month]} {year}
            </h2>
            <button
              onClick={nextMonth}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 transition-colors"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <CashFlowSparkline year={year} month={month} dailyMap={dailyMap} />

          <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-emerald-100 border border-emerald-300" />
              Поступления
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-red-100 border border-red-300" />
              Расходы
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-slate-100 border border-slate-300" />
              Нейтральный
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-red-500 border border-red-600" />
              Отрицательный баланс
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-white border border-violet-300 border-l-violet-600 border-l-[3px]" />
              Итог недели
            </span>
          </div>

          <div className="grid grid-cols-8 gap-1 sm:gap-2">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="text-center text-xs font-medium text-slate-400 py-2"
              >
                {d}
              </div>
            ))}
            <div className="text-center text-xs font-medium text-slate-400 py-2">
              Неделя
            </div>

            {weeks.map((week, weekIdx) => (
              <Fragment key={weekIdx}>
                {week.days.map((cell, dayIdx) => {
                  if (!cell) {
                    return (
                      <div
                        key={`${weekIdx}-empty-${dayIdx}`}
                        className="min-h-[72px] sm:min-h-[88px]"
                      />
                    );
                  }

                  const { dateStr, day, info } = cell;

                  return (
                    <CalendarDayCell
                      key={dateStr}
                      dateStr={dateStr}
                      day={day}
                      info={info}
                      dayPayments={paymentsByDate.get(dateStr) ?? []}
                      isToday={dateStr === today}
                      isSelected={selectedDate === dateStr}
                      onSelect={() => {
                        setQuickAddPending(false);
                        setSelectedDate(dateStr);
                      }}
                      onQuickAdd={() => handleQuickAdd(dateStr)}
                    />
                  );
                })}
                <WeekSummaryCell
                  referenceDate={week.referenceDate}
                  totalBalance={totalBalance}
                  payments={state.payments}
                />
              </Fragment>
            ))}
          </div>
        </CardContent>
      </Card>

      <DayDetailPanel
        dayInfo={selectedDay}
        allPayments={state.payments}
        accounts={state.accounts}
        onClose={handleClosePanel}
        onAddPayment={handleAddPayment}
        onUpdatePayment={handleUpdatePayment}
        onDeletePayment={handleDeletePayment}
        quickAddOpen={quickAddPending}
        onQuickAddConsumed={() => setQuickAddPending(false)}
      />
    </div>
  );
}
