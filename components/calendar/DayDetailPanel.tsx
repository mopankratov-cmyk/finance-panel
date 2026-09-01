"use client";

import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { InlinePaymentForm } from "./InlinePaymentForm";
import { expandRecurringPayment, type RecurrenceRule } from "./recurringPayments";
import { SlidePanel } from "@/components/ui/SlidePanel";
import { sumActivePayments, type DayInfo } from "@/lib/calculations";
import { formatDateLong, formatMoney, getDayNumber } from "@/lib/format";
import type { Payment } from "@/lib/types";
import type { Account } from "@/lib/types";
import type { DdsCompany } from "@/components/payments/ddsCompanies";
import { getPaymentPriority, PRIORITY_META, priorityRank } from "./paymentPriority";
import { originalLoanDueDate } from "./loanPaymentReschedule";

function signedMoney(amount: number, forcePlus = false): string {
  const prefix = amount > 0 && forcePlus ? "+" : "";
  return `${prefix}${formatMoney(amount)}`;
}

interface DayDetailPanelProps {
  dayInfo: DayInfo | null;
  allPayments: Payment[];
  accounts: Account[];
  companies: DdsCompany[];
  companyByPayment: Map<string, string | null>;
  onClose: () => void;
  onAddPayment: (payment: Payment, companyId?: string | null) => void;
  onUpdatePayment: (payment: Payment, companyId: string | null) => void;
  quickAddOpen?: boolean;
  onQuickAddConsumed?: () => void;
}

interface PaymentRowData {
  payment: Payment;
  runningBalance: number;
}

interface PaymentRowProps {
  row: PaymentRowData;
  companyName: string;
  onEdit: () => void;
}

function PaymentRow({ row, companyName, onEdit }: PaymentRowProps) {
  const { payment, runningBalance } = row;
  const isIncome = payment.amount > 0;
  const isCancelled = payment.status === "cancelled";
  const originalDueDate = originalLoanDueDate(payment);

  const rowStyle = isCancelled
    ? { backgroundColor: "#f8fafc" }
    : isIncome
      ? { backgroundColor: "#f0fdf4" }
      : { backgroundColor: "#fff1f2" };

  const amountClass = isCancelled
    ? "text-slate-400 line-through"
    : isIncome
      ? "text-emerald-700"
      : "text-red-600";

  return (
    <li
      className="group relative border-b border-slate-200/80"
      style={rowStyle}
    >
      <div className="grid min-h-[52px] grid-cols-[110px_170px_minmax(220px,1fr)_150px_110px] items-center gap-3 px-4 py-2">
        <button
          type="button"
          onClick={onEdit}
          className="contents text-left"
        >
          <span
            className={`text-right text-sm font-bold tabular-nums ${amountClass}`}
          >
            {formatMoney(payment.amount)}
          </span>
          <span className={`flex min-w-0 items-center gap-2 truncate text-sm font-semibold ${isCancelled ? "text-slate-400 line-through" : "text-slate-900"}`}><span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold ${PRIORITY_META[getPaymentPriority(payment)].badge}`}>{getPaymentPriority(payment)}</span><span className="truncate">{payment.category}</span></span>
          <span className={`truncate text-sm ${isCancelled ? "text-slate-400 line-through" : "text-slate-600"}`} title={payment.name}>{payment.name}{originalDueDate && <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">перенесён с {originalDueDate}</span>}</span>
          <span className={`truncate text-sm ${companyName === "Не назначена" ? "text-slate-400" : "text-slate-700"}`}>{companyName}</span>
          <span className={`text-right text-sm font-semibold tabular-nums ${runningBalance < 0 ? "text-red-600" : "text-slate-700"}`}>{formatMoney(runningBalance)}</span>
        </button>
      </div>
    </li>
  );
}

export function DayDetailPanel({
  dayInfo,
  allPayments,
  accounts,
  companies,
  companyByPayment,
  onClose,
  onAddPayment,
  onUpdatePayment,
  quickAddOpen = false,
  onQuickAddConsumed,
}: DayDetailPanelProps) {
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [showQuickAddChooser, setShowQuickAddChooser] = useState(false);

  const open = !!dayInfo;
  const date = dayInfo?.date ?? "";

  const dayPayments = useMemo(
    () =>
      date
        ? allPayments
            .filter((p) => p.date === date)
            .sort((a, b) => {
              if (a.amount > 0 && b.amount < 0) return -1;
              if (a.amount < 0 && b.amount > 0) return 1;
              return priorityRank(a) - priorityRank(b) || Math.abs(b.amount) - Math.abs(a.amount);
            })
        : [],
    [allPayments, date],
  );

  const dayTotals = useMemo(
    () => sumActivePayments(allPayments, (p) => p.date === date),
    [allPayments, date],
  );

  const paymentRows = useMemo((): PaymentRowData[] => {
    if (!dayInfo) return [];
    const startBalance = dayInfo.balance - dayTotals.net;
    let running = startBalance;

    return dayPayments.map((payment) => {
      let runningBalance = running;
      if (payment.status !== "cancelled") {
        running += payment.amount;
        runningBalance = running;
      }
      return { payment, runningBalance };
    });
  }, [dayPayments, dayInfo, dayTotals.net]);

  const resetForms = () => {
    setShowIncomeForm(false);
    setShowExpenseForm(false);
    setEditingPayment(null);
    setShowQuickAddChooser(false);
  };

  useEffect(() => {
    if (!open) {
      const timer = window.setTimeout(resetForms, 0);
      return () => window.clearTimeout(timer);
    }
  }, [open, date]);

  useEffect(() => {
    if (open && quickAddOpen) {
      const timer = window.setTimeout(() => {
        setShowQuickAddChooser(true);
        setShowIncomeForm(false);
        setShowExpenseForm(false);
        setEditingPayment(null);
        onQuickAddConsumed?.();
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [open, quickAddOpen, onQuickAddConsumed]);

  const handleAdd =
    (flowType: "income" | "expense") => (data: Omit<Payment, "id">, recurrence?: RecurrenceRule, companyId?: string | null) => {
      for (const payment of expandRecurringPayment(data, recurrence)) onAddPayment(payment, companyId);
      if (flowType === "income") setShowIncomeForm(false);
      else setShowExpenseForm(false);
      setShowQuickAddChooser(false);
    };

  const handleEditSubmit = (data: Omit<Payment, "id">, _recurrence?: RecurrenceRule, companyId?: string | null) => {
    if (!editingPayment) return;
    onUpdatePayment({ ...editingPayment, ...data }, companyId ?? null);
    setEditingPayment(null);
  };

  if (!dayInfo) {
    return (
      <SlidePanel open={false} onClose={onClose} bare fixedWidth={980}>
        {null}
      </SlidePanel>
    );
  }

  const dayNum = getDayNumber(dayInfo.date);
  const netClass =
    dayTotals.net > 0
      ? "text-emerald-600"
      : dayTotals.net < 0
        ? "text-red-600"
        : "text-slate-500";

  const editingFlowType =
    editingPayment && editingPayment.amount < 0 ? "expense" : "income";

  const openIncomeForm = () => {
    setShowExpenseForm(false);
    setEditingPayment(null);
    setShowQuickAddChooser(false);
    setShowIncomeForm(true);
  };

  const openExpenseForm = () => {
    setShowIncomeForm(false);
    setEditingPayment(null);
    setShowQuickAddChooser(false);
    setShowExpenseForm(true);
  };

  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      bare
      fixedWidth={980}
      title={formatDateLong(dayInfo.date)}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 pr-12">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">
              {formatDateLong(dayInfo.date).split(",")[0]}
            </p>
            <p className="text-4xl font-bold leading-none text-slate-900">{dayNum}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-500">Сальдо за день</p>
            <p className={`text-lg font-bold tabular-nums sm:text-xl ${netClass}`}>
              {signedMoney(dayTotals.net, true)}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between border-b border-emerald-100 bg-emerald-50 px-3 py-2 sm:px-4">
          <span className="text-xs text-emerald-700 sm:text-sm">поступление</span>
          <span className="text-sm font-bold tabular-nums text-emerald-600 sm:text-base">
            {formatMoney(dayTotals.income)}
          </span>
        </div>
        <div className="flex items-center justify-between border-b border-red-100 bg-red-50 px-3 py-2 sm:px-4">
          <span className="text-xs text-red-700 sm:text-sm">выбытие</span>
          <span className="text-sm font-bold tabular-nums text-red-600 sm:text-base">
            {formatMoney(dayTotals.expense)}
          </span>
        </div>

        {showQuickAddChooser && (
          <div className="border-b border-slate-200 bg-violet-50 p-3">
            <p className="mb-2 text-xs font-medium text-slate-700">
              Быстрое добавление
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={openIncomeForm}
                className="rounded-lg border border-emerald-200 bg-white px-2 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
              >
                + Поступление
              </button>
              <button
                type="button"
                onClick={openExpenseForm}
                className="rounded-lg border border-red-200 bg-white px-2 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
              >
                + Списание
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-[110px_170px_minmax(220px,1fr)_150px_110px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          <span className="text-right">Сумма</span>
          <span>Название</span>
          <span>Назначение платежа</span>
          <span>Компания</span>
          <span className="text-right">Остаток</span>
        </div>

        <ul className="flex-1 overflow-y-auto bg-white">
          {paymentRows.length === 0 &&
          !showIncomeForm &&
          !showExpenseForm &&
          !editingPayment ? (
            <li className="px-4 py-8 text-center text-xs text-slate-500">
              Нет платежей
            </li>
          ) : (
            paymentRows.map((row) =>
              editingPayment?.id === row.payment.id ? (
                <li
                  key={row.payment.id}
                  className="border-b border-slate-200 bg-slate-50 p-3"
                >
                  <InlinePaymentForm
                    flowType={editingFlowType}
                    date={date}
                    accounts={accounts}
                    companies={companies}
                    companyId={companyByPayment.get(row.payment.id) ?? null}
                    payment={row.payment}
                    onSubmit={handleEditSubmit}
                    onCancel={() => setEditingPayment(null)}
                  />
                </li>
              ) : (
                <PaymentRow
                  key={row.payment.id}
                  row={row}
                  companyName={companyByPayment.get(row.payment.id) ? companies.find((company) => company.id === companyByPayment.get(row.payment.id))?.name ?? "Неизвестная компания" : "Не назначена"}
                  onEdit={() => {
                    setShowIncomeForm(false);
                    setShowExpenseForm(false);
                    setShowQuickAddChooser(false);
                    setEditingPayment(row.payment);
                  }}
                />
              ),
            )
          )}

          {showIncomeForm && (
            <li className="border-b border-slate-200 bg-slate-50 p-3">
              <InlinePaymentForm
                flowType="income"
                date={date}
                accounts={accounts}
                onSubmit={handleAdd("income")}
                onCancel={() => setShowIncomeForm(false)}
              />
            </li>
          )}
          {showExpenseForm && (
            <li className="border-b border-slate-200 bg-slate-50 p-3">
              <InlinePaymentForm
                flowType="expense"
                date={date}
                accounts={accounts}
                onSubmit={handleAdd("expense")}
                onCancel={() => setShowExpenseForm(false)}
              />
            </li>
          )}
        </ul>

        <div className="mt-auto space-y-2 border-t border-slate-200 bg-slate-50 p-3">
          {!showIncomeForm && !showExpenseForm && !editingPayment && (
            <>
              <button
                type="button"
                onClick={openIncomeForm}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 sm:text-sm"
              >
                <Plus className="h-4 w-4" />
                Добавить поступление
              </button>
              <button
                type="button"
                onClick={openExpenseForm}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 sm:text-sm"
              >
                <Plus className="h-4 w-4" />
                Добавить списание
              </button>
            </>
          )}
        </div>
      </div>
    </SlidePanel>
  );
}
