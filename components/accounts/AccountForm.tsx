"use client";

import type { Account, AccountType, Currency } from "@/lib/types";
import { ACCOUNT_TYPE_LABELS } from "@/lib/constants";
import { todayISO } from "@/lib/format";

interface AccountFormProps {
  account?: Account;
  onSubmit: (data: Omit<Account, "id">) => void;
  onCancel: () => void;
}

export function AccountForm({ account, onSubmit, onCancel }: AccountFormProps) {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const openingBalance = Number(fd.get("openingBalance"));
    onSubmit({
      name: fd.get("name") as string,
      type: fd.get("type") as AccountType,
      currency: fd.get("currency") as Currency,
      balance: openingBalance,
      openingBalance,
      openingDate: (fd.get("openingDate") as string) || todayISO(),
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
          className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          placeholder="WB Счёт 1"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Тип
          </label>
          <select
            name="type"
            defaultValue={account?.type ?? "marketplace"}
            className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
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
            className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          >
            <option value="RUB">RUB (₽)</option>
            <option value="USD">USD ($)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Остаток на дату
          </label>
          <input
            name="openingBalance"
            type="number"
            step="0.01"
            required
            defaultValue={account?.openingBalance ?? account?.balance ?? 0}
            className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Дата остатка
          </label>
          <input
            name="openingDate"
            type="date"
            required
            defaultValue={account?.openingDate ?? todayISO()}
            className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>
        <p className="text-xs text-slate-400 sm:col-span-2">
          Дальше остаток считается по платежам: открытие плюс все фактические операции с этой даты. Корректировка — платежом, а не правкой числа.
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
          className="min-h-11 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
        >
          {account ? "Сохранить" : "Добавить"}
        </button>
      </div>
    </form>
  );
}
