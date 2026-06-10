"use client";

import { PAYMENT_CATEGORIES } from "@/lib/constants";
import type { Payment, PaymentStatus } from "@/lib/types";
import type { Account } from "@/lib/types";

interface PaymentFormProps {
  payment?: Payment;
  accounts: Account[];
  onSubmit: (data: Omit<Payment, "id">) => void;
  onCancel: () => void;
}

export function PaymentForm({
  payment,
  accounts,
  onSubmit,
  onCancel,
}: PaymentFormProps) {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const type = fd.get("flowType") as string;
    const rawAmount = Math.abs(Number(fd.get("amount")));
    const amount = type === "expense" ? -rawAmount : rawAmount;

    onSubmit({
      date: fd.get("date") as string,
      name: fd.get("name") as string,
      amount,
      category: fd.get("category") as string,
      accountId: fd.get("accountId") as string,
      status: fd.get("status") as PaymentStatus,
      counterparty: fd.get("counterparty") as string,
    });
  };

  const defaultAmount = payment ? Math.abs(payment.amount) : 0;
  const defaultFlow = payment && payment.amount < 0 ? "expense" : "income";

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
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Дата
          </label>
          <input
            name="date"
            type="date"
            required
            defaultValue={payment?.date}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Тип
          </label>
          <select
            name="flowType"
            defaultValue={defaultFlow}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
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
          defaultValue={defaultAmount}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Категория
        </label>
        <select
          name="category"
          required
          defaultValue={payment?.category ?? PAYMENT_CATEGORIES[0]}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        >
          {PAYMENT_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Счёт
          </label>
          <select
            name="accountId"
            required
            defaultValue={payment?.accountId ?? accounts[0]?.id}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          >
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Статус
          </label>
          <select
            name="status"
            defaultValue={payment?.status ?? "planned"}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          >
            <option value="planned">Запланирован</option>
            <option value="done">Выполнен</option>
            <option value="cancelled">Отменён</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Контрагент
        </label>
        <input
          name="counterparty"
          defaultValue={payment?.counterparty}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          placeholder="Название контрагента"
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
        >
          Отмена
        </button>
        <button
          type="submit"
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
        >
          {payment ? "Сохранить" : "Добавить"}
        </button>
      </div>
    </form>
  );
}
