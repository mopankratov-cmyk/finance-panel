"use client";

import { PAYMENT_CATEGORIES } from "@/lib/constants";
import type { Account, Payment } from "@/lib/types";
import type { DdsCompany } from "@/components/payments/ddsCompanies";
import { cleanPaymentComment, getPaymentPriority, PRIORITY_META, setPaymentPriorityComment, suggestPaymentPriority, type PaymentPriority } from "./paymentPriority";
import type { RecurrenceRule } from "./recurringPayments";

interface InlinePaymentFormProps {
  flowType: "income" | "expense";
  date: string;
  accounts: Account[];
  companies?: DdsCompany[];
  companyId?: string | null;
  payment?: Payment;
  onSubmit: (data: Omit<Payment, "id">, recurrence?: RecurrenceRule, companyId?: string | null) => void;
  onCancel: () => void;
}

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500";

export function InlinePaymentForm({
  flowType,
  date,
  accounts,
  companies = [],
  companyId = null,
  payment,
  onSubmit,
  onCancel,
}: InlinePaymentFormProps) {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const rawAmount = Math.abs(Number(fd.get("amount")));
    const amount = flowType === "expense" ? -rawAmount : rawAmount;
    const recurrence = fd.get("recurrence") as RecurrenceRule["frequency"];
    const recurrenceUntil = fd.get("recurrenceUntil") as string;
    if (!payment && recurrence !== "none" && !recurrenceUntil) {
      alert("Укажите, до какой даты повторять платёж");
      return;
    }

    onSubmit({
      date: (fd.get("date") as string) || date,
      name: fd.get("name") as string,
      amount,
      category: fd.get("category") as string,
      accountId: fd.get("accountId") as string,
      status: fd.get("status") as Payment["status"],
      counterparty: (fd.get("counterparty") as string) || "",
      comment: setPaymentPriorityComment((fd.get("comment") as string) || undefined, fd.get("priority") as PaymentPriority),
    }, payment ? undefined : {
      frequency: recurrence,
      until: recurrenceUntil,
    }, (fd.get("companyId") as string) || null);
  };

  const defaultAmount = payment ? Math.abs(payment.amount) : "";
  const accent =
    flowType === "income"
      ? "border-emerald-200 bg-emerald-50"
      : "border-red-200 bg-red-50";
  const submitClass =
    flowType === "income"
      ? "bg-violet-600 hover:bg-violet-500"
      : "bg-red-600 hover:bg-red-500";

  return (
    <form
      onSubmit={handleSubmit}
      className={`space-y-3 rounded-lg border p-3 ${accent}`}
    >
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Дата платежа</label>
        <input
          name="date"
          type="date"
          required
          defaultValue={payment?.date ?? date}
          className={inputClass}
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Назначение платежа</label>
        <input
          name="name"
          required
          defaultValue={payment?.name}
          className={inputClass}
          placeholder="Текст из выписки или введите назначение самостоятельно"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs text-slate-400">Сумма</label>
        <input
          name="amount"
          type="number"
          step="0.01"
          min="0"
          required
          defaultValue={defaultAmount}
          className={inputClass}
          placeholder="0"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Название</label>
        <select
          name="category"
          required
          defaultValue={payment?.category ?? PAYMENT_CATEGORIES[0]}
          className={inputClass}
        >
          {PAYMENT_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {companies.length > 0 && <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Компания</label>
        <select
          name="companyId"
          defaultValue={companyId ?? ""}
          className={inputClass}
        >
          <option value="">Не назначена</option>
          {companies.filter((company) => company.isActive).map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </div>}

      <div>
        <label className="mb-1 block text-xs text-slate-400">Счёт</label>
        <select
          name="accountId"
          required
          defaultValue={payment?.accountId ?? accounts[0]?.id}
          className={inputClass}
        >
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Приоритет платежа</label>
        <select
          name="priority"
          defaultValue={payment ? getPaymentPriority(payment) : suggestPaymentPriority(PAYMENT_CATEGORIES[0])}
          className={inputClass}
        >
          {(Object.keys(PRIORITY_META) as PaymentPriority[]).map((priority) => (
            <option key={priority} value={priority}>{PRIORITY_META[priority].label}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">Можно изменить в любое время. A показывается первым.</p>
      </div>

      <div>
        <label className="mb-1 block text-xs text-slate-500">Состояние</label>
        <select
          name="status"
          defaultValue={payment?.status ?? "planned"}
          className={inputClass}
        >
          <option value="planned">План</option>
          <option value="done">Оплачено / получено</option>
          <option value="cancelled">Отменено</option>
        </select>
      </div>

      {!payment && (
        <div className="grid gap-3 rounded-lg border border-violet-200 bg-violet-50/70 p-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-violet-900">
            Повторять
            <select name="recurrence" defaultValue="none" className={`${inputClass} mt-1`}>
              <option value="none">Не повторять</option>
              <option value="weekly">Каждую неделю</option>
              <option value="monthly">Каждый месяц</option>
              <option value="quarterly">Каждый квартал</option>
              <option value="yearly">Каждый год</option>
            </select>
          </label>
          <label className="text-xs font-medium text-violet-900">
            Повторять до
            <input name="recurrenceUntil" type="date" min={date} className={`${inputClass} mt-1`} />
          </label>
          <p className="text-xs text-violet-700 sm:col-span-2">Для регулярного платежа будут созданы отдельные плановые строки. Каждую из них можно изменить или отменить отдельно.</p>
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs text-slate-400">
          Контрагент
        </label>
        <input
          name="counterparty"
          defaultValue={payment?.counterparty}
          className={inputClass}
          placeholder="Необязательно"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Ваш комментарий</label>
        <input
          name="comment"
          defaultValue={cleanPaymentComment(payment?.comment)}
          className={inputClass}
          placeholder="Любое пояснение для себя или руководителя"
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-sm text-slate-400 transition-colors hover:bg-white hover:text-slate-200"
        >
          Отмена
        </button>
        <button
          type="submit"
          className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors ${submitClass}`}
        >
          {payment ? "Сохранить" : "Добавить"}
        </button>
      </div>
    </form>
  );
}
