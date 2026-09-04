"use client";

import { AlertTriangle, FileSpreadsheet, Loader2, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { BankStatement } from "./bankStatement";
import type { BankSuggestion } from "./bankAutoClassify";
import type { DdsCompany } from "./ddsCompanies";
import { rememberBankAccount, saveBankReviewBatch } from "./bankReviewStore";
import { needsDirectUpload, uploadViaStorage } from "./uploadViaStorage";
import { DDS_CATEGORIES } from "@/lib/finance/categories";
import { formatMoney } from "@/lib/format";
import type { Account, Payment } from "@/lib/types";

// Статьи — из единого справочника; отдельного списка «для выписки» больше нет.
const BANK_CATEGORIES = DDS_CATEGORIES;

interface Props {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  companies: DdsCompany[];
  existingPayments: Array<Payment & { companyId?: string | null }>;
  onQueued: () => void;
}

export function BankStatementModal({ open, onClose, accounts, companies, onQueued }: Props) {
  const [statement, setStatement] = useState<BankStatement | null>(null);
  const [fileName, setFileName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categories, setCategories] = useState<Map<string, string>>(new Map());
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<BankSuggestion[]>([]);
  const [done, setDone] = useState<{ queued: number } | null>(null);
  const [controlMismatchAccepted, setControlMismatchAccepted] = useState(false);

  const selectedAccount = accounts.find((account) => account.id === accountId);
  const selectedCompany = companies.find((company) => company.id === companyId);

  const reset = () => {
    setStatement(null);
    setFileName("");
    setCompanyId("");
    setAccountId("");
    setCategories(new Map());
    setIncluded(new Set());
    setBulkCategory("");
    setSuggestions([]);
    setDone(null);
    setControlMismatchAccepted(false);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const handleFile = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      // Разбор и классификация — на сервере: у любого сотрудника по одному
      // файлу получается один и тот же результат.
      let response: Response;
      if (needsDirectUpload(file)) {
        const storagePath = await uploadViaStorage(file);
        response = await fetch("/api/opiu/bank-statement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storagePath, fileName: file.name, mimeType: file.type }) });
      } else {
        const body = new FormData();
        body.append("file", file);
        response = await fetch("/api/opiu/bank-statement", { method: "POST", body });
      }
      const data = await response.json().catch(() => null) as { statement?: BankStatement; suggestions?: BankSuggestion[]; error?: string } | null;
      if (!response.ok || !data?.statement || !data.suggestions) throw new Error(data?.error ?? "Не удалось распознать выписку");
      const parsed = data.statement;
      const suggestions = data.suggestions;
      setSuggestions(suggestions);
      setStatement(parsed);
      setFileName(file.name);
      setControlMismatchAccepted(false);
      setIncluded(new Set(parsed.rows.map((row) => row.id)));
      setCategories(
        new Map(
          suggestions.map((suggestion) => [suggestion.row.id, suggestion.category ?? ""]),
        ),
      );
      const suggestedCompanyId = suggestions.find((suggestion) => suggestion.companyId)?.companyId;
      const suggestedAccountId = suggestions.find((suggestion) => suggestion.accountId)?.accountId;
      if (suggestedCompanyId) setCompanyId(suggestedCompanyId);
      if (suggestedAccountId) setAccountId(suggestedAccountId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать выписку");
    } finally {
      setLoading(false);
    }
  };

  const selectedRows = useMemo(
    () => statement?.rows.filter((row) => included.has(row.id)) ?? [],
    [statement, included],
  );
  const unclassified = selectedRows.filter((row) => !categories.get(row.id)).length;

  const toggleIncluded = (id: string) => {
    setIncluded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setCategory = (id: string, category: string) => {
    setCategories((current) => new Map(current).set(id, category));
  };

  const applyBulkCategory = () => {
    if (!bulkCategory) return;
    setCategories((current) => {
      const next = new Map(current);
      for (const id of included) next.set(id, bulkCategory);
      return next;
    });
  };

  const handlePrepare = async () => {
    if (!statement) return;
    if (!selectedAccount) {
      setError("Перед отправкой выберите кошелёк / банковский счёт. Компанию можно определить отдельно для каждого платежа в разделе «На проверке». ");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const selectedSuggestions = suggestions
        .filter((suggestion) => included.has(suggestion.row.id))
        .map((suggestion) => {
          const category = categories.get(suggestion.row.id) || null;
          const rowCompanyId = companyId || suggestion.companyId;
          return {
            ...suggestion,
            companyId: rowCompanyId,
            accountId,
            category,
            needsReview: !category || !rowCompanyId || suggestion.confidence < 0.85,
          };
        });
      const queued = await saveBankReviewBatch(statement, selectedSuggestions, fileName);
      // Сопоставление счёта с компанией запоминаем только когда пользователь
      // явно выбрал одну компанию для всей выписки. Общий счёт нельзя закреплять
      // за случайной компанией из одной операции.
      if (statement.accountNumber && selectedCompany) {
        await rememberBankAccount(statement.accountNumber, statement.ownerInn, companyId, accountId);
      }
      setDone({ queued });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить операции на проверку");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;
  const hasControlMismatch = statement?.warnings.some((warning) => warning.includes("не совпала с контрольной суммой")) ?? false;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <button type="button" aria-label="Закрыть" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <div className="relative flex max-h-[94vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Импорт банковской выписки</h2>
          <button type="button" onClick={close} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
      {done ? (
        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
            Готово! В блок «На проверке» отправлено операций: <b>{done.queued}</b>. В фактические платежи они ещё не попали.
          </div>
          <button onClick={() => { close(); onQueued(); }} className="min-h-11 w-full rounded-lg bg-violet-600 px-4 font-medium text-white">
            Перейти к проверке
          </button>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <label className="flex min-h-24 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 p-4 text-slate-500 hover:border-violet-400 hover:text-violet-700">
            <FileSpreadsheet className="h-5 w-5" /> {fileName || "Выбрать выписку XLSX или PDF"}
            <input type="file" accept=".xlsx,.pdf" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }} />
          </label>

          {loading && <div className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Читаю выписку…</div>}

          {statement && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Операций" value={String(statement.rows.length)} />
                <Stat label="Счёт" value={statement.accountNumber} />
                <Stat label="Расходы" value={formatMoney(-statement.declaredDebit)} />
                <Stat label="Поступления" value={formatMoney(statement.declaredCredit)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Компания по умолчанию — необязательно</label>
                  <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="min-h-11 w-full rounded-lg border border-slate-300 px-3">
                    <option value="">Определять отдельно по платежам</option>
                    {companies.filter((company) => company.isActive).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Кошелёк / банковский счёт</label>
                  <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="min-h-11 w-full rounded-lg border border-slate-300 px-3">
                    <option value="">Выберите кошелёк</option>
                    {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
                <div className="min-w-60 flex-1">
                  <label className="mb-1 block text-xs text-slate-500">Назначить одну статью всем отмеченным</label>
                  <select value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} className="min-h-11 w-full rounded-lg border border-slate-300 px-3">
                    <option value="">Выберите статью</option>
                    {BANK_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </div>
                <button onClick={applyBulkCategory} disabled={!bulkCategory} className="min-h-11 rounded-lg border border-slate-300 px-4 font-medium text-slate-700 disabled:opacity-50">Применить</button>
              </div>
              <div className="max-h-[48vh] overflow-auto rounded-lg border border-slate-200">
                <table className="w-full table-fixed text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                    <tr><th className="w-16 p-2">Добавить</th><th className="w-24 p-2">Дата</th><th className="w-32 p-2 text-right">Сумма</th><th className="w-[18%] p-2">Контрагент</th><th className="p-2">Назначение</th><th className="w-72 p-2">Статья</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {statement.rows.map((row) => (
                      <tr key={row.id} className={!included.has(row.id) ? "opacity-40" : ""}>
                        <td className="p-2"><input type="checkbox" checked={included.has(row.id)} onChange={() => toggleIncluded(row.id)} /></td>
                        <td className="whitespace-nowrap p-2">{row.date}</td>
                        <td className={`whitespace-nowrap p-2 text-right font-semibold ${row.amount >= 0 ? "text-emerald-700" : "text-red-600"}`}>{formatMoney(row.amount)}</td>
                        <td className="max-w-48 truncate p-2" title={row.counterparty}>{row.counterparty}</td>
                        <td className="max-w-72 truncate p-2" title={row.purpose}>{row.purpose}</td>
                        <td className="p-2">
                          <select value={categories.get(row.id) ?? ""} onChange={(e) => setCategory(row.id, e.target.value)} className="min-h-10 w-full rounded border border-slate-300 px-2">
                            <option value="">Выберите статью</option>
                            {BANK_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Будет добавлено: {selectedRows.length}</span><span>Без статьи: {unclassified}</span>
              </div>
              {statement.warnings.map((warning) => <div key={warning} className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800"><AlertTriangle className="h-4 w-4" />{warning}</div>)}
              {statement.notes?.map((note) => <div key={note} className="flex gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sky-800"><FileSpreadsheet className="h-4 w-4" />{note}</div>)}
              {hasControlMismatch && (
                <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
                  <input
                    type="checkbox"
                    checked={controlMismatchAccepted}
                    onChange={(event) => setControlMismatchAccepted(event.target.checked)}
                    className="mt-0.5"
                  />
                  Я сверил выписку и подтверждаю отправку несмотря на расхождение с контрольной суммой банка.
                </label>
              )}
              {!accountId && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sky-800">
                  Выберите общий кошелёк. Компанию для каждого платежа можно проверить и изменить на следующем шаге.
                </div>
              )}
              <button onClick={handlePrepare} disabled={loading || selectedRows.length === 0 || (hasControlMismatch && !controlMismatchAccepted)} className="min-h-11 w-full rounded-lg bg-violet-600 px-4 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
                {loading ? "Отправляю…" : "Отправить на проверку"}
              </button>
            </>
          )}
          {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>}
        </div>
      )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-slate-200 p-3"><div className="text-[11px] uppercase text-slate-400">{label}</div><div className="truncate font-semibold text-slate-900" title={value}>{value}</div></div>;
}
