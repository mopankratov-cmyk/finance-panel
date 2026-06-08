"use client";

import type { Account, AccountType, Currency } from "@/lib/types";
import { ACCOUNT_TYPE_LABELS } from "@/lib/constants";

interface AccountFormProps {
  account?: Account;
  onSubmit: (data: Omit<Account, "id">) => void;
  onCancel: () => void;
}

export function AccountForm({ account, onSubmit, onCancel }: AccountFormProps) {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    onSubmit({
      name: fd.get("name") as string,
      type: fd.get("type") as AccountType,
      currency: fd.get("currency") as Currency,
      balance: Number(fd.get("balance")),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Название
        </label>
        <input
          name="name"
          required
          defaultValue={account?.name}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          placeholder="WB Счёт 1"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Тип
          </label>
          <select
            name="type"
            defaultValue={account?.type ?? "marketplace"}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            {Object.entries(ACCOUNT_TYPE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Валюта
          </label>
          <select
            name="currency"
            defaultValue={account?.currency ?? "RUB"}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="RUB">RUB (₽)</option>
            <option value="USD">USD ($)</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Текущий баланс
        </label>
        <input
          name="balance"
          type="number"
          step="0.01"
          required
          defaultValue={account?.balance ?? 0}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
        >
          {account ? "Сохранить" : "Добавить"}
        </button>
      </div>
    </form>
  );
}
