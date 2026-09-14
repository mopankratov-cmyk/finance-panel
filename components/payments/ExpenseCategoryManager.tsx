"use client";

import { useState, type FormEvent } from "react";
import { Loader2, Plus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useFinance } from "@/components/providers/FinanceProvider";
import { DDS_OPIU_EXPENSE_TARGETS } from "@/lib/finance/expenseCategories";

export function ExpenseCategoryManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { expenseCategories, expenseCategoriesReady, expenseCategoriesLoading, expenseCategoriesError, refreshExpenseCategories } = useFinance();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setError(null); setSuccess(null);
    try {
      const response = await fetch("/api/finance/expense-categories", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, opiuArticleId: target || null }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Статья не сохранилась");
      setSuccess(`Статья «${name.trim()}» сохранена`);
      setName(""); setTarget("");
      await refreshExpenseCategories();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Статья не сохранилась"); }
    finally { setSaving(false); }
  };
  return <Modal open={open} onClose={onClose} title="Статьи расходов ДДС">
    <div className="space-y-5">
      <p className="text-sm leading-6 text-slate-600">Добавленная статья появится в платежах, календаре и разборе выписок. Подтверждённые расходы за месяц попадут в выбранную строку ОПиУ, в колонку «Общие» выбранной компании.</p>
      {expenseCategoriesLoading ? <p role="status" className="text-sm text-slate-500">Загрузка справочника…</p> : null}
      {expenseCategoriesError ? <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{expenseCategoriesError}<button type="button" onClick={() => void refreshExpenseCategories()} className="ml-2 min-h-11 cursor-pointer underline">Повторить</button></div> : null}
      {!expenseCategoriesLoading && !expenseCategoriesError && !expenseCategoriesReady ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Добавление ещё не включено: владельцу нужно применить миграцию справочника статей ДДС.</p> : null}
      <form onSubmit={(event) => void submit(event)} className="space-y-3">
        <label className="block text-sm font-medium text-slate-700">Название статьи<input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 focus:outline-none focus:ring-2 focus:ring-violet-300" /></label>
        <label className="block text-sm font-medium text-slate-700">Статья ОПиУ<select value={target} onChange={(event) => setTarget(event.target.value)} className="mt-1 min-h-11 w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-3 focus:outline-none focus:ring-2 focus:ring-violet-300"><option value="">Не включать в ОПиУ</option>{DDS_OPIU_EXPENSE_TARGETS.map((article) => <option key={article.id} value={article.id}>{article.label}</option>)}</select></label>
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        {success ? <p role="status" className="text-sm text-emerald-700">{success}</p> : null}
        <button type="submit" disabled={saving || !expenseCategoriesReady || expenseCategoriesLoading || !name.trim()} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Добавить статью</button>
      </form>
      <div className="space-y-2 border-t border-slate-200 pt-4"><h3 className="font-semibold text-slate-900">Добавленные статьи</h3>{expenseCategories.length ? expenseCategories.map((category) => <div key={category.id} className="rounded-lg border border-slate-200 p-3"><div className="font-medium text-slate-900">{category.name}</div><div className="mt-1 text-sm text-slate-600">ОПиУ: {DDS_OPIU_EXPENSE_TARGETS.find((article) => article.id === category.opiuArticleId)?.label ?? "Не включать в ОПиУ"}</div></div>) : <p className="text-sm text-slate-500">Дополнительных статей пока нет</p>}</div>
    </div>
  </Modal>;
}
