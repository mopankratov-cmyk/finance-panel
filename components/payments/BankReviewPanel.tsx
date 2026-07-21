"use client";

import { Check, HelpCircle, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DdsCompany } from "./ddsCompanies";
import type { DdsDraft, DdsParseResult } from "./ddsCsv";
import { commitImport, planImport } from "./ddsImport";
import {
  loadBankReviewItems,
  markReviewItems,
  updateBankReviewItem,
  type BankReviewItem,
} from "./bankReviewStore";
import { parseManagerInstruction } from "./managerInstruction";
import { Card, CardContent } from "@/components/ui/Card";
import { PAYMENT_CATEGORIES } from "@/lib/constants";
import { formatDate, formatMoney } from "@/lib/format";
import type { Account } from "@/lib/types";

const REVIEW_CATEGORIES = [
  ...PAYMENT_CATEGORIES,
  "Поступление — Перевод между счетами",
  "Выбытие — Перевод между счетами",
  "Вклады от собственников",
  "Выдача кредитов и займов",
  "Получение кредитов и займов",
  "Возврат кредитов и займов",
] as const;

export function BankReviewPanel({ accounts, companies }: { accounts: Account[]; companies: DdsCompany[] }) {
  const [items, setItems] = useState<BankReviewItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managerText, setManagerText] = useState("");
  const [instructionResult, setInstructionResult] = useState("");

  const companyById = useMemo(() => new Map(companies.map((company) => [company.id, company.name])), [companies]);
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account.name])), [accounts]);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await loadBankReviewItems());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить очередь");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    loadBankReviewItems()
      .then((loaded) => {
        if (!cancelled) setItems(loaded);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось загрузить очередь");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateLocal = async (id: string, patch: Partial<BankReviewItem>) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
    try {
      await updateBankReviewItem(id, patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить изменение");
      await refresh();
    }
  };

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const readySelected = items.filter((item) => selected.has(item.id));
  const invalidSelected = readySelected.filter((item) => !item.companyId || !item.accountId || !item.category);

  const approve = async () => {
    if (readySelected.length === 0 || invalidSelected.length > 0) return;
    setSaving(true);
    setError(null);
    try {
      const drafts: DdsDraft[] = readySelected.map((item) => ({
        date: item.date,
        amount: item.amount,
        name: item.purpose,
        category: item.category!,
        wallet: accountById.get(item.accountId!) ?? "",
        counterparty: item.counterparty,
        activity: "",
        company: companyById.get(item.companyId!) ?? "",
        comment: `Банковская выписка · ${item.sourceFileName}`,
      }));
      const result: DdsParseResult = {
        drafts,
        wallets: [...new Set(drafts.map((draft) => draft.wallet))],
        walletDirectory: [...new Set(drafts.map((draft) => draft.wallet))],
        categories: [...new Set(drafts.map((draft) => draft.category))],
        totalIncome: drafts.reduce((sum, draft) => sum + Math.max(0, draft.amount), 0),
        totalExpense: drafts.reduce((sum, draft) => sum + Math.max(0, -draft.amount), 0),
        skipped: 0,
        warnings: [],
      };
      const plan = await planImport(result, { companies });
      const acceptSuspected =
        plan.suspectedRows.length > 0 &&
        confirm(
          `${plan.suspectedRows.length} платеж(а) совпали по дате, сумме и кошельку с уже сохранёнными. Всё равно добавить их как новые?`,
        );
      await commitImport(
        plan,
        acceptSuspected ? new Set(plan.suspectedRows.map((row) => row.row.id)) : new Set(),
      );
      await markReviewItems(readySelected.map((item) => item.id), "approved");
      setSelected(new Set());
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось подтвердить операции");
    } finally {
      setSaving(false);
    }
  };

  const reject = async () => {
    if (selected.size === 0 || !confirm(`Исключить выбранные операции (${selected.size})?`)) return;
    setSaving(true);
    try {
      await markReviewItems([...selected], "rejected");
      setSelected(new Set());
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось исключить операции");
    } finally {
      setSaving(false);
    }
  };

  const askManager = async (item: BankReviewItem) => {
    const question = prompt("Что спросить у руководителя?", `${formatMoney(item.amount)} ${formatDate(item.date)} — что это за платёж?`);
    if (!question) return;
    await updateLocal(item.id, { managerQuestion: question, status: "waiting_manager" });
  };

  const applyManagerText = async () => {
    const parsed = parseManagerInstruction(managerText, items);
    setInstructionResult(parsed.explanation);
    if (!parsed.itemId) return;
    const item = items.find((candidate) => candidate.id === parsed.itemId);
    if (!item) return;
    const patch: Partial<BankReviewItem> = {
      managerAnswer: managerText,
      status: item.companyId && item.accountId && parsed.category ? "ready" : "needs_info",
    };
    if (parsed.category) patch.category = parsed.category;
    if (parsed.counterparty) patch.counterparty = parsed.counterparty;
    await updateLocal(item.id, patch);
    setManagerText("");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-5">
          <div>
            <h2 className="font-semibold text-slate-900">Ответ или пояснение руководителя</h2>
            <p className="mt-1 text-xs text-slate-400">Например: «333т 28 июня — займ Михайлову»</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={managerText} onChange={(e) => setManagerText(e.target.value)} className="min-h-11 flex-1 rounded-lg border border-slate-300 px-3" placeholder="Введите пояснение свободным текстом" />
            <button onClick={applyManagerText} disabled={!managerText.trim()} className="min-h-11 rounded-lg bg-slate-800 px-4 font-medium text-white disabled:opacity-50">Разобрать текст</button>
          </div>
          {instructionResult && <p className="text-sm text-slate-600">{instructionResult}</p>}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void refresh()} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm"><RefreshCw className="h-4 w-4" /> Обновить</button>
        <button onClick={approve} disabled={saving || selected.size === 0 || invalidSelected.length > 0} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50"><Check className="h-4 w-4" /> Подтвердить ({selected.size})</button>
        <button onClick={reject} disabled={saving || selected.size === 0} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-red-200 px-3 text-sm text-red-600 disabled:opacity-50"><Trash2 className="h-4 w-4" /> Исключить</button>
        {invalidSelected.length > 0 && <span className="text-xs text-amber-700">У {invalidSelected.length} выбранных строк не заполнены компания, кошелёк или статья</span>}
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading ? (
        <div className="flex items-center gap-2 py-10 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> Загружаю очередь…</div>
      ) : items.length === 0 && !error ? (
        <Card><CardContent className="py-10 text-center text-slate-400">Операций на проверке нет</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id} className={item.status === "waiting_manager" ? "border-amber-300" : ""}>
              <CardContent className="space-y-3 pt-4">
                <div className="flex items-start gap-3">
                  <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} className="mt-1 h-4 w-4" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium text-slate-900">{formatDate(item.date)}</span>
                      <span className={`font-bold ${item.amount >= 0 ? "text-emerald-700" : "text-red-600"}`}>{formatMoney(item.amount)}</span>
                      <span className="text-slate-600">{item.counterparty || "Без контрагента"}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">уверенность {Math.round(item.confidence * 100)}%</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{item.purpose}</p>
                    {item.reasons.length > 0 && <p className="mt-1 text-xs text-violet-700">{item.reasons.join(" · ")}</p>}
                  </div>
                  <button onClick={() => void askManager(item)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs text-slate-600"><HelpCircle className="h-4 w-4" /> Спросить</button>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <select value={item.companyId ?? ""} onChange={(e) => void updateLocal(item.id, { companyId: e.target.value || null })} className="min-h-11 rounded-lg border border-slate-300 px-2">
                    <option value="">Компания не определена</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
                  </select>
                  <select value={item.accountId ?? ""} onChange={(e) => void updateLocal(item.id, { accountId: e.target.value || null })} className="min-h-11 rounded-lg border border-slate-300 px-2">
                    <option value="">Кошелёк не определён</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                  </select>
                  <select value={item.category ?? ""} onChange={(e) => void updateLocal(item.id, { category: e.target.value || null, status: e.target.value && item.companyId && item.accountId ? "ready" : "needs_info" })} className="min-h-11 rounded-lg border border-slate-300 px-2">
                    <option value="">Статья не определена</option>{REVIEW_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </div>
                {item.managerQuestion && <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Вопрос: {item.managerQuestion}{item.managerAnswer ? ` · Ответ: ${item.managerAnswer}` : " · ждём ответа"}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
