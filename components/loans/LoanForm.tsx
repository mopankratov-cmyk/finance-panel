"use client";

import type { Loan, LoanStatus } from "@/lib/types";

interface LoanFormProps {
  loan?: Loan;
  onSubmit: (data: Omit<Loan, "id">) => void;
  onCancel: () => void;
}

export function LoanForm({ loan, onSubmit, onCancel }: LoanFormProps) {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    onSubmit({
      creditorName: fd.get("creditorName") as string,
      principalAmount: Number(fd.get("principalAmount")),
      interestRatePerDay: Number(fd.get("interestRatePerDay")),
      startDate: fd.get("startDate") as string,
      dueDate: fd.get("dueDate") as string,
      status: fd.get("status") as LoanStatus,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Кредитор
        </label>
        <input
          name="creditorName"
          required
          defaultValue={loan?.creditorName}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          placeholder="ООО Микрофинанс"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Сумма займа
          </label>
          <input
            name="principalAmount"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={loan?.principalAmount}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Ставка % в день
          </label>
          <input
            name="interestRatePerDay"
            type="number"
            step="0.001"
            min="0"
            required
            defaultValue={loan?.interestRatePerDay}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Дата начала
          </label>
          <input
            name="startDate"
            type="date"
            required
            defaultValue={loan?.startDate}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Дата погашения
          </label>
          <input
            name="dueDate"
            type="date"
            required
            defaultValue={loan?.dueDate}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Статус
        </label>
        <select
          name="status"
          defaultValue={loan?.status ?? "active"}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        >
          <option value="active">Активен</option>
          <option value="closed">Закрыт</option>
        </select>
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
          {loan ? "Сохранить" : "Добавить"}
        </button>
      </div>
    </form>
  );
}
