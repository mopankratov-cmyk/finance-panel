"use client";

import { Check, HelpCircle, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DdsCompany } from "./ddsCompanies";
import type { DdsDraft, DdsParseResult } from "./ddsCsv";
import { commitImport, planImport } from "./ddsImport";
import {
  loadBankReviewItems,
  markReviewItems,
  askManagerAboutBankReviewItem,
  updateBankReviewItem,
  type BankReviewItem,
} from "./bankReviewStore";
import { parseManagerInstruction } from "./managerInstruction";
import {
  decodeBankSplits,
  encodeBankSplits,
  parseBankInstructionList,
  splitTotal,
  splitsAreReady,
  type BankInstructionSplit,
} from "./bankInstructionSplits";
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
  const [queueFilter, setQueueFilter] = useState<"review" | "waiting" | "answered">("review");
  const [askItem, setAskItem] = useState<BankReviewItem | null>(null);
  const [askText, setAskText] = useState("");

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
  const invalidSelected = readySelected.filter((item) => {
    const splits = decodeBankSplits(item.managerAnswer);
    return splits ? !item.accountId || !splitsAreReady(item, splits) : !item.companyId || !item.accountId || !item.category;
  });

  const approve = async () => {
    if (readySelected.length === 0 || invalidSelected.length > 0) return;
    setSaving(true);
    setError(null);
    try {
      const drafts: DdsDraft[] = readySelected.flatMap((item) => {
        const splits = decodeBankSplits(item.managerAnswer);
        if (!splits) return [{
          date: item.date, amount: item.amount, name: item.purpose, category: item.category!,
          wallet: accountById.get(item.accountId!) ?? "", counterparty: item.counterparty, activity: "",
          company: companyById.get(item.companyId!) ?? "", comment: `Банковская выписка · ${item.sourceFileName}`,
          importSource: `bank-review:${item.id}`,
        }];
        return splits.filter((split) => !split.excluded).map((split, index) => ({
          date: item.date,
          amount: item.amount < 0 ? -split.amount : split.amount,
          name: split.description,
          category: split.category!,
          wallet: accountById.get(item.accountId!) ?? "",
          counterparty: item.counterparty,
          activity: "",
          company: companyById.get(split.companyId!) ?? "",
          comment: `Часть банковской операции ${formatMoney(Math.abs(item.amount))} · ${item.sourceFileName}`,
          importSource: index === 0 ? `bank-review:${item.id}` : `bank-review:${item.id}:split:${index}`,
        }));
      });
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

  const openManagerQuestion = (item: BankReviewItem) => {
    setAskItem(item);
    setAskText("Что это за платёж и к какой статье его отнести?");
  };

  const askManager = async () => {
    if (!askItem || !askText.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await askManagerAboutBankReviewItem(askItem.id, askText.trim());
      setAskItem(null);
      setAskText("");
      await refresh();
      setQueueFilter("waiting");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить вопрос руководителю");
    } finally {
      setSaving(false);
    }
  };

  const applyManagerText = async () => {
    if (managerText.includes("\n")) {
      const parsed = parseBankInstructionList(managerText, items, companies);
      const matched = parsed.filter((instruction) => instruction.itemId);
      const unresolved = parsed.filter((instruction) => !instruction.itemId);
      setSaving(true);
      setError(null);
      try {
        await Promise.all(matched.map(async (instruction) => {
          const item = items.find((candidate) => candidate.id === instruction.itemId)!;
          const managerAnswer = encodeBankSplits(instruction.splits);
          const status = item.accountId && splitsAreReady(item, instruction.splits) ? "ready" : "needs_info";
          await updateBankReviewItem(item.id, { managerAnswer, status });
        }));
        await refresh();
        setInstructionResult(`Обработано строк: ${parsed.length}. Найдено операций: ${matched.length}. Требуют ручного сопоставления: ${unresolved.length}.`);
        if (matched.length) setManagerText("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить разбор пояснений");
      } finally {
        setSaving(false);
      }
      return;
    }
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

  const updateSplitsLocal = (itemId: string, splits: BankInstructionSplit[]) => {
    setItems((current) => current.map((item) => item.id === itemId ? { ...item, managerAnswer: encodeBankSplits(splits) } : item));
  };

  const saveSplits = async (item: BankReviewItem, splits: BankInstructionSplit[]) => {
    const status = item.accountId && splitsAreReady(item, splits) ? "ready" : "needs_info";
    await updateLocal(item.id, { managerAnswer: encodeBankSplits(splits), status });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-5">
          <div>
            <h2 className="font-semibold text-slate-900">Пояснения к платежам</h2>
            <p className="mt-1 text-xs text-slate-400">Можно вставить список с датами и суммами. Составной платёж будет разбит на отдельные статьи.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <textarea value={managerText} onChange={(e) => setManagerText(e.target.value)} rows={7} className="min-h-28 flex-1 rounded-lg border border-slate-300 px-3 py-2" placeholder="Вставьте пояснения списком: дата, затем суммы и назначения" />
            <button onClick={applyManagerText} disabled={!managerText.trim()} className="min-h-11 rounded-lg bg-slate-800 px-4 font-medium text-white disabled:opacity-50">Разобрать текст</button>
          </div>
          {instructionResult && <p className="text-sm text-slate-600">{instructionResult}</p>}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setQueueFilter("review")} className={`min-h-11 rounded-lg px-3 text-sm ${queueFilter === "review" ? "bg-violet-600 text-white" : "border border-slate-300"}`}>На проверке ({items.filter((item) => item.status !== "waiting_manager" && !(item.managerAnswer && !decodeBankSplits(item.managerAnswer))).length})</button>
        <button onClick={() => setQueueFilter("waiting")} className={`min-h-11 rounded-lg px-3 text-sm ${queueFilter === "waiting" ? "bg-amber-500 text-white" : "border border-amber-300 text-amber-800"}`}>Ждут ответа ({items.filter((item) => item.status === "waiting_manager").length})</button>
        <button onClick={() => setQueueFilter("answered")} className={`min-h-11 rounded-lg px-3 text-sm ${queueFilter === "answered" ? "bg-emerald-600 text-white" : "border border-emerald-300 text-emerald-800"}`}>Ответ получен ({items.filter((item) => item.status !== "waiting_manager" && item.managerAnswer && !decodeBankSplits(item.managerAnswer)).length})</button>
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
          {items.filter((item) => {
            const hasManagerAnswer = Boolean(item.managerAnswer && !decodeBankSplits(item.managerAnswer));
            if (queueFilter === "waiting") return item.status === "waiting_manager";
            if (queueFilter === "answered") return item.status !== "waiting_manager" && hasManagerAnswer;
            return item.status !== "waiting_manager" && !hasManagerAnswer;
          }).map((item) => (
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
                    {item.reasons.filter((reason) => !reason.startsWith("__")).length > 0 && <p className="mt-1 text-xs text-violet-700">{item.reasons.filter((reason) => !reason.startsWith("__")).join(" · ")}</p>}
                    {item.matchedTransferId && <p className="mt-1 text-xs font-medium text-emerald-700">Найдена встречная операция в другой выписке — платежи связаны</p>}
                  </div>
                  <button onClick={() => openManagerQuestion(item)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs text-slate-600"><HelpCircle className="h-4 w-4" /> Спросить</button>
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
                {(() => {
                  const splits = decodeBankSplits(item.managerAnswer);
                  if (!splits) return (
                    <button type="button" onClick={() => updateSplitsLocal(item.id, [{
                      id: crypto.randomUUID(), amount: Math.abs(item.amount), description: item.purpose || "Часть платежа",
                      category: item.category, companyId: item.companyId, excluded: false, needsClarification: false,
                    }])} className="rounded-lg border border-violet-200 px-3 py-2 text-xs font-medium text-violet-700">
                      Разбить сумму на несколько статей
                    </button>
                  );
                  const total = splitTotal(splits);
                  const matches = Math.abs(total - Math.abs(item.amount)) < 0.01;
                  return (
                    <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <b>Разбиение операции</b>
                        <span className={matches ? "text-emerald-700" : "font-semibold text-red-600"}>
                          Части: {formatMoney(total)} · Банк: {formatMoney(Math.abs(item.amount))}{matches ? " · сумма сошлась" : " · есть расхождение"}
                        </span>
                      </div>
                      {splits.map((split, index) => (
                        <div key={split.id} className="grid gap-2 rounded-lg bg-white p-2 lg:grid-cols-[130px_1fr_220px_250px_auto]">
                          <input type="number" min="0" step="0.01" value={split.amount} onChange={(event) => updateSplitsLocal(item.id, splits.map((part, partIndex) => partIndex === index ? { ...part, amount: Number(event.target.value) } : part))} className="min-h-10 rounded border border-slate-300 px-2" />
                          <input value={split.description} onChange={(event) => updateSplitsLocal(item.id, splits.map((part, partIndex) => partIndex === index ? { ...part, description: event.target.value } : part))} className="min-h-10 rounded border border-slate-300 px-2" />
                          <select value={split.companyId ?? ""} disabled={split.excluded} onChange={(event) => updateSplitsLocal(item.id, splits.map((part, partIndex) => partIndex === index ? { ...part, companyId: event.target.value || null } : part))} className="min-h-10 rounded border border-slate-300 px-2 disabled:opacity-50">
                            <option value="">Компания не определена</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
                          </select>
                          <select value={split.category ?? ""} disabled={split.excluded} onChange={(event) => updateSplitsLocal(item.id, splits.map((part, partIndex) => partIndex === index ? { ...part, category: event.target.value || null, needsClarification: false } : part))} className="min-h-10 rounded border border-slate-300 px-2 disabled:opacity-50">
                            <option value="">Статья не определена</option>{REVIEW_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                          </select>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 whitespace-nowrap text-xs"><input type="checkbox" checked={split.excluded} onChange={(event) => updateSplitsLocal(item.id, splits.map((part, partIndex) => partIndex === index ? { ...part, excluded: event.target.checked } : part))} /> Не в ДДС</label>
                            <button type="button" onClick={() => updateSplitsLocal(item.id, splits.filter((_, partIndex) => partIndex !== index))} className="text-red-500">×</button>
                          </div>
                        </div>
                      ))}
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => updateSplitsLocal(item.id, [...splits, { id: crypto.randomUUID(), amount: 0, description: "", category: null, companyId: null, excluded: false, needsClarification: false }])} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">+ Добавить часть</button>
                        <button type="button" onClick={() => void saveSplits(item, splits)} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white">Сохранить разбиение</button>
                      </div>
                      {splits.some((split) => split.needsClarification) && <p className="text-xs text-amber-700">Есть части с пометкой «уточнить» — выберите статью после получения ответа.</p>}
                    </div>
                  );
                })()}
                {item.managerQuestion && <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Вопрос: {item.managerQuestion}{item.managerAnswer && !decodeBankSplits(item.managerAnswer) ? ` · Ответ: ${item.managerAnswer}` : " · ждём ответа"}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {askItem && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-lg font-semibold text-slate-900">Вопрос руководителю</h3><p className="text-sm text-slate-500">В Telegram уйдёт вся известная информация о платеже.</p></div>
              <button onClick={() => setAskItem(null)} className="text-2xl text-slate-400">×</button>
            </div>
            <dl className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-slate-400">Дата и сумма</dt><dd className="font-medium">{formatDate(askItem.date)} · {formatMoney(askItem.amount)}</dd></div>
              <div><dt className="text-xs text-slate-400">Юрлицо</dt><dd>{askItem.companyId ? companyById.get(askItem.companyId) ?? "Неизвестное юрлицо" : "Ещё не определено"}</dd></div>
              <div><dt className="text-xs text-slate-400">Банк / кошелёк</dt><dd>{askItem.accountId ? accountById.get(askItem.accountId) ?? "Неизвестный кошелёк" : "Ещё не определён"}</dd></div>
              <div><dt className="text-xs text-slate-400">Расчётный счёт</dt><dd>{askItem.bankAccountNumber || "Не указан"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-slate-400">Файл выписки</dt><dd>{askItem.sourceFileName}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-slate-400">Контрагент</dt><dd>{askItem.counterparty || "Не указан"}{askItem.counterpartyInn ? ` · ИНН ${askItem.counterpartyInn}` : ""}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-slate-400">Комментарий банка</dt><dd className="whitespace-pre-wrap">{askItem.purpose || "Не указан"}</dd></div>
            </dl>
            <label className="mt-4 block text-sm font-medium text-slate-700">Что спросить</label>
            <textarea value={askText} onChange={(event) => setAskText(event.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-slate-300 p-3" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setAskItem(null)} className="rounded-lg border border-slate-300 px-4 py-2">Отмена</button>
              <button onClick={() => void askManager()} disabled={saving || !askText.trim()} className="rounded-lg bg-violet-600 px-4 py-2 font-medium text-white disabled:opacity-50">Отправить в Telegram</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
