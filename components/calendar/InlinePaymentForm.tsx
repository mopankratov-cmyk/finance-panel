"use client";

import { PAYMENT_CATEGORIES } from "@/lib/constants";
import type { Account, Payment } from "@/lib/types";

interface InlinePaymentFormProps {
  flowType: "income" | "expense";
  date: string;
  accounts: Account[];
  payment?: Payment;
  onSubmit: (data: Omit<Payment, "id">) => void;
  onCancel: () => void;
}

const inputClass =
  "w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

export function InlinePaymentForm({
  flowType,
  date,
  accounts,
  payment,
  onSubmit,
  onCancel,
}: InlinePaymentFormProps) {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const rawAmount = Math.abs(Number(fd.get("amount")));
    const amount = flowType === "expense" ? -rawAmount : rawAmount;

    onSubmit({
      date,
      name: fd.get("name") as string,
      amount,
      category: fd.get("category") as string,
      accountId: fd.get("accountId") as string,
      status: payment?.status ?? "planned",
      counterparty: (fd.get("counterparty") as string) || "",
      comment: (fd.get("comment") as string) || undefined,
    });
  };

  const defaultAmount = payment ? Math.abs(payment.amount) : "";
  const accent =
    flowType === "income"
      ? "border-emerald-600/50 bg-emerald-950/30"
      : "border-red-600/50 bg-red-950/30";
  const submitClass =
    flowType === "income"
      ? "bg-emerald-600 hover:bg-emerald-500"
      : "bg-red-600 hover:bg-red-500";

  return (
    <form
      onSubmit={handleSubmit}
      className={`space-y-3 rounded-lg border p-3 ${accent}`}
    >
      <div>
        <label className="mb-1 block text-xs text-slate-400">Название</label>
        <input
          name="name"
          required
          defaultValue={payment?.name}
          className={inputClass}
          placeholder="Название платежа"
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
        <label className="mb-1 block text-xs text-slate-400">Категория</label>
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
        <label className="mb-1 block text-xs text-slate-400">Комментарий</label>
        <input
          name="comment"
          defaultValue={payment?.comment}
          className={inputClass}
          placeholder="Необязательно"
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-sm text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
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
