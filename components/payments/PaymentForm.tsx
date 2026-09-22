"use client";

import { useDdsCategories } from "@/components/providers/FinanceProvider";
import { useMemo, useState } from "react";
import type { Loan, Payment } from "@/lib/types";
import type { Account } from "@/lib/types";
import type { ScheduleRowRecord } from "@/lib/loans/scheduleRows";
import type { DdsCompany } from "./ddsCompanies";
import { cashLoanScheduleOptions, closestCashLoanScheduleOption, isLoanRepaymentCategory, loanPaymentNeedsConfirmation } from "./cashLoanScheduleLink";

export interface PaymentLoanLink {
  loanId: string;
  dueDate: string;
  rowIds: string[];
  legacyPaymentIds: string[];
  scheduledAmount: number;
  confirmed: boolean;
}

interface PaymentFormProps {
  payment?: Payment;
  accounts: Account[];
  counterparties?: string[];
  companies: DdsCompany[];
  companyId?: string | null;
  loans?: Loan[];
  payments?: Payment[];
  paymentCompanies?: ReadonlyMap<string, string | null>;
  scheduleRows?: ScheduleRowRecord[];
  scheduleLoading?: boolean;
  scheduleError?: string;
  onSubmit: (data: Omit<Payment, "id">, companyId: string, loanLink?: PaymentLoanLink) => void | Promise<void>;
  onCancel: () => void;
}

export function PaymentForm({
  payment,
  accounts,
  counterparties = [],
  companies,
  companyId,
  loans = [],
  payments = [],
  paymentCompanies = new Map(),
  scheduleRows = [],
  scheduleLoading = false,
  scheduleError = "",
  onSubmit,
  onCancel,
}: PaymentFormProps) {
  const { categoryOptions } = useDdsCategories();
  const categories = categoryOptions(payment?.category);
  const [flowType, setFlowType] = useState(payment && payment.amount < 0 ? "expense" : "income");
  const [date, setDate] = useState(payment?.date ?? "");
  const [amountText, setAmountText] = useState(payment ? String(Math.abs(payment.amount)) : "0");
  const [selectedCompanyId, setSelectedCompanyId] = useState(companyId ?? (payment ? "" : companies[0]?.id ?? ""));
  const [category, setCategory] = useState(payment?.category ?? categories[0]);
  const [selectedLoanId, setSelectedLoanId] = useState("");
  const [selectedScheduleKey, setSelectedScheduleKey] = useState("");
  const [confirmedDifference, setConfirmedDifference] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const loanMode = !payment && flowType === "expense" && isLoanRepaymentCategory(category);
  const allLoanSchedules = useMemo(() => cashLoanScheduleOptions({ loans, payments, paymentCompanies, scheduleRows, category }), [loans, payments, paymentCompanies, scheduleRows, category]);
  const companyLoanSchedules = useMemo(() => allLoanSchedules.filter((item) => item.companyId === (selectedCompanyId || null)), [allLoanSchedules, selectedCompanyId]);
  const loanOptions = useMemo(() => [...new Map(companyLoanSchedules.map((item) => [item.loanId, item.loanName])).entries()], [companyLoanSchedules]);
  const selectedLoanSchedules = companyLoanSchedules.filter((item) => item.loanId === selectedLoanId);
  const selectedSchedule = selectedLoanSchedules.find((item) => item.key === selectedScheduleKey);
  const numericAmount = Math.abs(Number(amountText));
  const confirmationRequired = Boolean(selectedSchedule && loanPaymentNeedsConfirmation(numericAmount, selectedSchedule.amount));

  const resetLoanLink = () => {
    setSelectedLoanId("");
    setSelectedScheduleKey("");
    setConfirmedDifference(false);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const rawAmount = Math.abs(Number(fd.get("amount")));
    const amount = flowType === "expense" ? -rawAmount : rawAmount;
    if (loanMode && scheduleLoading) return;
    if (loanMode && loanOptions.length && !selectedSchedule) return;
    if (confirmationRequired && !confirmedDifference) return;

    // Комментарий формой не редактируется, но в нём живут служебные метки
    // ([loan:…], [calendar-fact:…], [priority:…]) — их нельзя терять при сохранении.
    setSubmitting(true);
    try {
      await onSubmit({
        date,
        name: fd.get("name") as string,
        amount,
        category,
        accountId: fd.get("accountId") as string,
        status: payment?.status ?? "done",
        counterparty: fd.get("counterparty") as string,
        comment: payment?.comment,
      }, selectedCompanyId, selectedSchedule ? {
        loanId: selectedSchedule.loanId,
        dueDate: selectedSchedule.dueDate,
        rowIds: selectedSchedule.rowIds,
        legacyPaymentIds: selectedSchedule.legacyPaymentIds,
        scheduledAmount: selectedSchedule.amount,
        confirmed: confirmedDifference,
      } : undefined);
    } finally {
      setSubmitting(false);
    }
  };

  // Текущая статья платежа остаётся в списке, даже если её нет в справочнике —
  // иначе браузер молча подставит первую опцию.
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Название
        </label>
        <input
          name="name"
          required
          defaultValue={payment?.name}
          className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
      </div>

      {/* Две колонки только с sm: на 320px поле даты обрезало «дд.мм.гггг». */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Дата
          </label>
          <input
            name="date"
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Тип
          </label>
          <select
            name="flowType"
            value={flowType}
            onChange={(event) => { setFlowType(event.target.value); resetLoanLink(); }}
            className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          >
            <option value="income">Поступление</option>
            <option value="expense">Расход</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Сумма
        </label>
        <input
          name="amount"
          type="number"
          step="0.01"
          min="0"
          required
          value={amountText}
          onChange={(event) => { setAmountText(event.target.value); setConfirmedDifference(false); }}
          className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Компания
        </label>
        <select
          name="companyId"
          value={selectedCompanyId}
          onChange={(event) => { setSelectedCompanyId(event.target.value); resetLoanLink(); }}
          className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        >
          <option value="">Общее по группе</option>
          {companies.filter((company) => company.isActive).map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Категория
        </label>
        <select
          name="category"
          required
          value={category}
          onChange={(event) => { setCategory(event.target.value); resetLoanLink(); }}
          className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        >
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {loanMode && <section className="rounded-xl border border-violet-200 bg-violet-50/60 p-4">
        <h3 className="font-bold text-violet-950">Связь с графиком кредита</h3>
        <p className="mt-1 text-sm text-slate-600">После сохранения выбранная часть графика сразу станет оплаченной.</p>
        {scheduleLoading ? <p className="mt-3 text-sm text-slate-600">Загружаю графики…</p> : <>
          <label className="mt-3 block text-sm font-semibold text-slate-700">Кредит
            <select required={loanOptions.length > 0} value={selectedLoanId} onChange={(event) => { const loanId = event.target.value; setSelectedLoanId(loanId); setSelectedScheduleKey(closestCashLoanScheduleOption(companyLoanSchedules.filter((item) => item.loanId === loanId), date, numericAmount)?.key ?? ""); setConfirmedDifference(false); }} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">
              <option value="">Выберите кредит</option>
              {loanOptions.map(([loanId, loanName]) => <option key={loanId} value={loanId}>{loanName}</option>)}
            </select>
          </label>
          {selectedLoanId && <label className="mt-3 block text-sm font-semibold text-slate-700">Платёж графика
            <select required value={selectedScheduleKey} onChange={(event) => { setSelectedScheduleKey(event.target.value); setConfirmedDifference(false); }} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">
              <option value="">Выберите дату и сумму</option>
              {selectedLoanSchedules.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>}
          {!loanOptions.length && !scheduleError && <p className="mt-3 rounded-lg bg-white p-3 text-sm text-amber-800">Для выбранной компании нет неоплаченных строк этой статьи. Операцию можно сохранить без связи, а затем проверить график кредита.</p>}
          {scheduleError && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">График недоступен: {scheduleError}. Операция сохранится без связи.</p>}
          {selectedSchedule && <div className="mt-3 rounded-lg bg-white p-3 text-sm text-slate-700">По графику: <b>{selectedSchedule.amount.toLocaleString("ru-RU")} ₽</b> · операция: <b>{numericAmount.toLocaleString("ru-RU")} ₽</b></div>}
          {confirmationRequired && <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><input type="checkbox" checked={confirmedDifference} onChange={(event) => setConfirmedDifference(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" /><span>Сумма отличается от графика. Подтверждаю привязку к выбранному платежу.</span></label>}
        </>}
      </section>}

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          {payment?.importSource?.startsWith("bank-review:") ? "Банк / кошелёк" : "Счёт"}
        </label>
        <select
          name="accountId"
          required
          defaultValue={payment?.accountId ?? accounts[0]?.id}
          className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        >
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-400">
          {payment?.importSource?.startsWith("bank-review:")
            ? "Выберите банковский кошелёк, к которому относится операция из выписки."
            : "Здесь сохраняются только фактические операции. Плановые добавляются в платёжном календаре."}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Контрагент
        </label>
        <input
          name="counterparty"
          list="counterparty-options"
          defaultValue={payment?.counterparty}
          className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          placeholder="Выберите из списка или впишите нового"
        />
        <datalist id="counterparty-options">
          {counterparties.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <p className="mt-1 text-xs text-slate-400">
          Начните вводить — подскажем из ранее добавленных. Нового контрагента просто впишите.
        </p>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
        >
          Отмена
        </button>
        <button
          type="submit"
          disabled={submitting || (loanMode && scheduleLoading) || (confirmationRequired && !confirmedDifference)}
          className="min-h-11 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Сохраняю…" : payment ? "Сохранить" : selectedSchedule ? "Добавить и отметить оплату" : "Добавить"}
        </button>
      </div>
    </form>
  );
}
