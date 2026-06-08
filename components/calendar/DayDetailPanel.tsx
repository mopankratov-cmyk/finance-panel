"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { InlinePaymentForm } from "./InlinePaymentForm";
import { SlidePanel } from "@/components/ui/SlidePanel";
import { sumActivePayments, type DayInfo } from "@/lib/calculations";
import { formatDateLong, formatMoney, generateId, getDayNumber } from "@/lib/format";
import type { Payment, PaymentStatus } from "@/lib/types";
import type { Account } from "@/lib/types";

const STATUS_CONFIG: Record<
  PaymentStatus,
  { label: string; className: string }
> = {
  planned: {
    label: "Запланировано",
    className: "bg-slate-200 text-slate-600",
  },
  done: {
    label: "Выполнено",
    className: "bg-emerald-100 text-emerald-700",
  },
  cancelled: {
    label: "Отменено",
    className: "bg-red-100 text-red-600",
  },
};

function signedMoney(amount: number, forcePlus = false): string {
  const prefix = amount > 0 && forcePlus ? "+" : "";
  return `${prefix}${formatMoney(amount)}`;
}

interface DayDetailPanelProps {
  dayInfo: DayInfo | null;
  allPayments: Payment[];
  accounts: Account[];
  onClose: () => void;
  onAddPayment: (payment: Payment) => void;
  onUpdatePayment: (payment: Payment) => void;
  onDeletePayment: (id: string) => void;
  quickAddOpen?: boolean;
  onQuickAddConsumed?: () => void;
}

interface PaymentRowData {
  payment: Payment;
  runningBalance: number;
}

interface PaymentRowProps {
  row: PaymentRowData;
  onEdit: () => void;
  onDelete: () => void;
}

function PaymentRow({ row, onEdit, onDelete }: PaymentRowProps) {
  const { payment, runningBalance } = row;
  const isIncome = payment.amount > 0;
  const isCancelled = payment.status === "cancelled";

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
      <div className="flex min-h-[40px] items-center gap-1.5 px-2 py-1.5 sm:px-3">
        <button
          type="button"
          onClick={onEdit}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span
            className={`w-[72px] shrink-0 text-right text-xs font-bold tabular-nums sm:w-[80px] sm:text-sm ${amountClass}`}
          >
            {formatMoney(payment.amount)}
          </span>
          <span
            className={`min-w-0 flex-1 truncate text-xs font-medium sm:text-sm ${
              isCancelled
                ? "text-slate-400 line-through"
                : "text-slate-900"
            }`}
          >
            {payment.name}
          </span>
          {payment.counterparty && (
            <span
              className={`hidden max-w-[80px] truncate text-[10px] sm:inline sm:max-w-[100px] sm:text-xs ${
                isCancelled ? "text-slate-400 line-through" : "text-slate-500"
              }`}
            >
              {payment.counterparty}
            </span>
          )}
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium sm:text-[10px] ${STATUS_CONFIG[payment.status].className}`}
          >
            {STATUS_CONFIG[payment.status].label}
          </span>
        </button>

        <span className="w-[56px] shrink-0 text-right text-[10px] tabular-nums text-slate-500 sm:w-[64px] sm:text-xs">
          {formatMoney(runningBalance).replace(" ₽", "")}
        </span>

        <div className="flex w-14 shrink-0 justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={onEdit}
            className="rounded p-1 text-slate-500 hover:bg-white/60 hover:text-slate-800"
            aria-label="Изменить"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-1 text-slate-500 hover:bg-white/60 hover:text-red-600"
            aria-label="Удалить"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}

export function DayDetailPanel({
  dayInfo,
  allPayments,
  accounts,
  onClose,
  onAddPayment,
  onUpdatePayment,
  onDeletePayment,
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
              return Math.abs(b.amount) - Math.abs(a.amount);
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
    if (!open) resetForms();
  }, [open, date]);

  useEffect(() => {
    if (open && quickAddOpen) {
      setShowQuickAddChooser(true);
      setShowIncomeForm(false);
      setShowExpenseForm(false);
      setEditingPayment(null);
      onQuickAddConsumed?.();
    }
  }, [open, quickAddOpen, onQuickAddConsumed]);

  const handleAdd =
    (flowType: "income" | "expense") => (data: Omit<Payment, "id">) => {
      onAddPayment({ id: generateId("pay"), ...data });
      if (flowType === "income") setShowIncomeForm(false);
      else setShowExpenseForm(false);
      setShowQuickAddChooser(false);
    };

  const handleEditSubmit = (data: Omit<Payment, "id">) => {
    if (!editingPayment) return;
    onUpdatePayment({ ...editingPayment, ...data });
    setEditingPayment(null);
  };

  const handleDelete = (id: string) => {
    if (confirm("Удалить этот платёж?")) {
      onDeletePayment(id);
      if (editingPayment?.id === id) setEditingPayment(null);
    }
  };

  if (!dayInfo) {
    return (
      <SlidePanel open={false} onClose={onClose} bare fixedWidth={480}>
        {null}
      </SlidePanel>
    );
  }

  const dayNum = getDayNumber(dayInfo.date);
  const netClass =
    dayTotals.net > 0
      ? "text-emerald-400"
      : dayTotals.net < 0
        ? "text-red-400"
        : "text-slate-300";

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
      fixedWidth={480}
      title={formatDateLong(dayInfo.date)}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800/90 px-4 py-3 pr-12">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">
              {formatDateLong(dayInfo.date).split(",")[0]}
            </p>
            <p className="text-4xl font-bold leading-none text-white">{dayNum}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-500">Сальдо за день</p>
            <p className={`text-lg font-bold tabular-nums sm:text-xl ${netClass}`}>
              {signedMoney(dayTotals.net, true)}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between border-b border-emerald-800/40 bg-emerald-950/50 px-3 py-2 sm:px-4">
          <span className="text-xs text-emerald-300/80 sm:text-sm">поступление</span>
          <span className="text-sm font-bold tabular-nums text-emerald-400 sm:text-base">
            {formatMoney(dayTotals.income)}
          </span>
        </div>
        <div className="flex items-center justify-between border-b border-red-800/40 bg-red-950/45 px-3 py-2 sm:px-4">
          <span className="text-xs text-red-300/80 sm:text-sm">выбытие</span>
          <span className="text-sm font-bold tabular-nums text-red-400 sm:text-base">
            {formatMoney(dayTotals.expense)}
          </span>
        </div>

        {showQuickAddChooser && (
          <div className="border-b border-slate-700 bg-slate-800/60 p-3">
            <p className="mb-2 text-xs font-medium text-slate-300">
              Быстрое добавление
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={openIncomeForm}
                className="rounded border border-emerald-700/50 bg-emerald-950/40 px-2 py-2 text-xs font-medium text-emerald-400 hover:bg-emerald-950/60"
              >
                + Поступление
              </button>
              <button
                type="button"
                onClick={openExpenseForm}
                className="rounded border border-red-700/50 bg-red-950/40 px-2 py-2 text-xs font-medium text-red-400 hover:bg-red-950/60"
              >
                + Списание
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center border-b border-slate-600 bg-slate-800/40 px-2 py-1 text-[9px] font-medium uppercase tracking-wide text-slate-500 sm:px-3 sm:text-[10px]">
          <span className="w-[72px] shrink-0 text-right sm:w-[80px]">Сумма</span>
          <span className="min-w-0 flex-1 pl-2">Название</span>
          <span className="w-[56px] shrink-0 text-right sm:w-[64px]">Остаток</span>
          <span className="w-14 shrink-0" />
        </div>

        <ul className="flex-1 overflow-y-auto bg-slate-100/5">
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
                  className="border-b border-slate-700/50 bg-slate-800 p-3"
                >
                  <InlinePaymentForm
                    flowType={editingFlowType}
                    date={date}
                    accounts={accounts}
                    payment={row.payment}
                    onSubmit={handleEditSubmit}
                    onCancel={() => setEditingPayment(null)}
                  />
                </li>
              ) : (
                <PaymentRow
                  key={row.payment.id}
                  row={row}
                  onEdit={() => {
                    setShowIncomeForm(false);
                    setShowExpenseForm(false);
                    setShowQuickAddChooser(false);
                    setEditingPayment(row.payment);
                  }}
                  onDelete={() => handleDelete(row.payment.id)}
                />
              ),
            )
          )}

          {showIncomeForm && (
            <li className="border-b border-slate-700/50 bg-slate-800 p-3">
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
            <li className="border-b border-slate-700/50 bg-slate-800 p-3">
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

        <div className="mt-auto space-y-2 border-t border-slate-700/80 bg-slate-900 p-3">
          {!showIncomeForm && !showExpenseForm && !editingPayment && (
            <>
              <button
                type="button"
                onClick={openIncomeForm}
                className="flex w-full items-center justify-center gap-1.5 rounded border border-emerald-700/50 bg-emerald-950/30 px-3 py-2 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-950/50 sm:text-sm"
              >
                <Plus className="h-4 w-4" />
                Добавить поступление
              </button>
              <button
                type="button"
                onClick={openExpenseForm}
                className="flex w-full items-center justify-center gap-1.5 rounded border border-red-700/50 bg-red-950/30 px-3 py-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-950/50 sm:text-sm"
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
