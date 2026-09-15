"use client";

import { useState, type FormEvent } from "react";
import { Check, Loader2, Plus, Save } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useFinance } from "@/components/providers/FinanceProvider";
import { DDS_OPIU_EXPENSE_TARGETS } from "@/lib/finance/expenseCategories";
import type { DdsExpenseCategory } from "@/lib/finance/expenseCategories";

function CategoryMappingRow({ category, onSaved }: { category: DdsExpenseCategory; onSaved: () => Promise<void> }) {
  const [target, setTarget] = useState(category.opiuArticleId ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const changed = target !== (category.opiuArticleId ?? "");
  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/finance/expense-categories", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: category.id, opiuArticleId: target || null }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Связь с ОПиУ не сохранилась");
      await onSaved();
      setMessage("Сохранено");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Связь с ОПиУ не сохранилась"); }
    finally { setSaving(false); }
  };
  return <div className="rounded-lg border border-slate-200 p-3">
    <div className="font-medium text-slate-900">{category.name}</div>
    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
      <label className="min-w-0 flex-1 text-sm font-medium text-slate-600">Статья ОПиУ
        <select value={target} onChange={(event) => { setTarget(event.target.value); setMessage(null); }} disabled={saving} className="mt-1 min-h-11 w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-50">
          <option value="">Не включать в ОПиУ</option>
          {DDS_OPIU_EXPENSE_TARGETS.map((article) => <option key={article.id} value={article.id}>{article.label}</option>)}
        </select>
      </label>
      <button type="button" onClick={() => void save()} disabled={!changed || saving} className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-violet-300 px-4 text-sm font-semibold text-violet-700 hover:bg-violet-50 focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-50">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Сохранить
      </button>
    </div>
    {message ? <p role="status" className={`mt-2 flex items-center gap-1 text-sm ${message === "Сохранено" ? "text-emerald-700" : "text-red-700"}`}>{message === "Сохранено" ? <Check className="h-4 w-4" /> : null}{message}</p> : null}
  </div>;
}

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
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">Изменение связи пересчитает эту статью в ОПиУ за все месяцы. Сами платежи и их суммы не изменятся.</p>
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
      <div className="space-y-2 border-t border-slate-200 pt-4"><h3 className="font-semibold text-slate-900">Добавленные статьи</h3>{expenseCategories.length ? expenseCategories.map((category) => <CategoryMappingRow key={category.id} category={category} onSaved={refreshExpenseCategories} />) : <p className="text-sm text-slate-500">Дополнительных статей пока нет</p>}</div>
    </div>
  </Modal>;
}
