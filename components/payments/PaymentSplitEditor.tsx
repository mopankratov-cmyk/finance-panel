"use client";

import { useState } from "react";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import { balanceLast, splitEvenly } from "@/lib/finance/paymentSplitAmounts";
import { allocationTotal, chainRemainder, requiresKorovkinLoan, type ChainAllocation, type PaymentChainDraft } from "@/lib/finance/paymentChains";
import { TRANSFER_CATEGORIES } from "@/lib/finance/categories";
import type { Account } from "@/lib/types";
import type { DdsCompany } from "./ddsCompanies";

const field = "min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-2 text-base md:text-sm disabled:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400";
const columns = "md:grid-cols-[1fr_1.2fr_96px_64px_1fr_128px_44px]";

export function PaymentSplitEditor({ draft, accounts, companies, categories, busy, patch }: {
  draft: PaymentChainDraft; accounts: Account[]; companies: DdsCompany[]; categories: readonly string[];
  busy: boolean; patch: (change: Partial<PaymentChainDraft>) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [autoLast, setAutoLast] = useState(false);
  const remainder = chainRemainder(draft);
  const source = companies.find(c => c.id === draft.sourceCompanyId);
  const cashAccounts = accounts.filter(a => a.type === "cash" && a.currency === "RUB");
  const updateParts = (parts: ChainAllocation[]) => {
    if (parts.length < 2) setAutoLast(false);
    patch({ allocations: autoLast && parts.length > 1 ? balanceLast(parts, draft.sourceAmount) : parts });
  };
  const change = (id: string, value: Partial<ChainAllocation>) => updateParts(draft.allocations.map(a => a.id === id ? { ...a, ...value } : a));
  const add = () => {
    const id = crypto.randomUUID();
    patch({ allocations: [...draft.allocations, { id, amount: Math.max(0, remainder), date: draft.sourceDate, name: "", category: "", companyId: draft.sourceCompanyId, accountId: draft.throughCash ? draft.cashAccountId : draft.sourceAccountId, counterparty: "", excluded: false }] });
    setExpanded(id);
  };
  const changeCompany = (a: ChainAllocation, companyId: string) => {
    const loan = requiresKorovkinLoan(source, companies.find(c => c.id === companyId));
    if (loan) {
      const recipientCash = cashAccounts.filter(acc => acc.id !== draft.cashAccountId);
      patch({ throughCash: true, allocations: draft.allocations.map(p => p.id === a.id ? { ...p, companyId, accountId: recipientCash.length === 1 ? recipientCash[0].id : "" } : { ...p, accountId: requiresKorovkinLoan(source, companies.find(c => c.id === p.companyId)) ? p.accountId : draft.cashAccountId }) });
      setExpanded(a.id);
    } else change(a.id, { companyId, accountId: draft.throughCash ? draft.cashAccountId : draft.sourceAccountId });
  };

  return <fieldset disabled={busy} className="min-w-0 space-y-5">
    <legend className="sr-only">Разбиение операции</legend>
    <div className="space-y-2 border-b border-slate-200 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-xs text-slate-500">Исходная операция · {formatDate(draft.sourceDate)}</p><p className="text-3xl font-semibold tracking-tight text-slate-900">{formatMoney(-draft.sourceAmount)}</p></div>
        <span className="rounded-full bg-violet-50 px-3 py-1 text-sm text-violet-800">Частей: {draft.allocations.length}</span>
      </div>
      <label className="block text-xs text-slate-500">Описание операции<input className={field} value={draft.label} onChange={e => patch({ label: e.target.value })}/></label>
    </div>

    <section aria-label="Части одной операции" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Разбивка суммы</h3><button type="button" disabled={!draft.allocations.length} onClick={() => { const amounts = splitEvenly(draft.sourceAmount, draft.allocations.length); patch({ allocations: draft.allocations.map((a, i) => ({ ...a, amount: amounts[i] })) }); }} className="min-h-11 rounded-lg px-3 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-40">Поровну</button></div>
      <div className={`hidden gap-2 px-2 text-xs text-slate-500 md:grid ${columns}`} aria-hidden="true"><span>Получатель</span><span>Статья</span><span>Сумма, ₽</span><span>%</span><span>Компания</span><span>Дата расхода</span><span/></div>
      <div className="divide-y divide-slate-200 rounded-xl border border-slate-200">
        {draft.allocations.map((a, i) => {
          const loan = !a.excluded && requiresKorovkinLoan(source, companies.find(c => c.id === a.companyId));
          const open = expanded === a.id;
          return <div key={a.id} className={a.excluded ? "bg-slate-50 p-2" : "p-2"}>
            <div className={`grid grid-cols-2 items-start gap-2 ${columns}`}>
              <label className="min-w-0"><span className="mb-1 block text-xs text-slate-500 md:sr-only">Получатель части {i + 1}</span><input aria-label={`Получатель части ${i + 1}`} className={field} value={a.counterparty} onChange={e => change(a.id, { counterparty: e.target.value, ...(!a.name ? { name: e.target.value } : {}) })}/></label>
              <label className="min-w-0"><span className="mb-1 block text-xs text-slate-500 md:sr-only">Статья части {i + 1}</span><select aria-label={`Статья части ${i + 1}`} className={field} value={a.category} disabled={a.excluded} onChange={e => change(a.id, { category: e.target.value, ...(!a.name ? { name: e.target.value } : {}) })}><option value="">Выберите статью</option>{[...new Set([...categories, a.category].filter(Boolean))].map(c => <option key={c}>{c}</option>)}</select></label>
              <label className="min-w-0"><span className="mb-1 block text-xs text-slate-500 md:sr-only">Сумма части {i + 1}</span><input aria-label={`Сумма части ${i + 1}`} type="number" inputMode="decimal" min="0.01" step="0.01" className={field} value={a.amount} readOnly={autoLast && i === draft.allocations.length - 1} onChange={e => change(a.id, { amount: Number(e.target.value) })}/></label>
              <label className="min-w-0"><span className="mb-1 block text-xs text-slate-500 md:sr-only">Доля части {i + 1}, %</span><input aria-label={`Доля части ${i + 1}, %`} type="number" inputMode="decimal" min="0" max="100" step="0.01" className={field} value={draft.sourceAmount ? Math.round(a.amount / draft.sourceAmount * 10000) / 100 : 0} readOnly={autoLast && i === draft.allocations.length - 1} onChange={e => change(a.id, { amount: Math.round(draft.sourceAmount * Number(e.target.value)) / 100 })}/></label>
              <label className="min-w-0"><span className="mb-1 block text-xs text-slate-500 md:sr-only">Компания части {i + 1}</span><select aria-label={`Компания части ${i + 1}`} className={field} value={a.companyId} disabled={a.excluded} onChange={e => changeCompany(a, e.target.value)}><option value="">Выберите компанию</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label className="min-w-0"><span className="mb-1 block text-xs text-slate-500 md:sr-only">Дата части {i + 1}</span><input aria-label={`Дата части ${i + 1}`} type="date" min={draft.sourceDate} className={field} value={a.date} onChange={e => change(a.id, { date: e.target.value })}/></label>
              <button type="button" aria-label={`Подробности части ${i + 1}`} aria-expanded={open} onClick={() => setExpanded(open ? null : a.id)} className="flex min-h-11 items-center justify-center gap-2 rounded-lg text-slate-600 hover:bg-slate-100"><MoreHorizontal className="h-5 w-5"/><span className="text-sm md:hidden">Подробнее</span></button>
            </div>
            {(loan || a.excluded) && <p className="mt-1 text-xs text-slate-600">{a.excluded ? "Исключена из ДДС" : "Займ через наличные — создаётся автоматически"}</p>}
            {open && <div className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3">
              <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Назначение части<input className={field} value={a.name} onChange={e => change(a.id, { name: e.target.value })}/></label><label className="text-sm">{loan ? "Наличные получателя займа" : "Кошелёк расхода"}<select className={field} value={a.accountId} onChange={e => change(a.id, { accountId: e.target.value })}><option value="">Выберите кошелёк</option>{accounts.filter(acc => !loan || acc.type === "cash").map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}</select></label></div>
              {a.category === TRANSFER_CATEGORIES.outgoing && !a.excluded && <label className="block text-sm">Кошелёк поступления<select className={field} value={a.targetAccountId ?? ""} onChange={e => change(a.id, { targetAccountId: e.target.value })}><option value="">Куда переведены деньги</option>{accounts.filter(acc => acc.id !== a.accountId && acc.currency === "RUB").map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}</select></label>}
              {loan && <p className="text-sm text-slate-600">Из наличных основной группы будет выдан займ, в наличных {companies.find(c => c.id === a.companyId)?.name} — получен. Затем расход пройдёт {formatDate(a.date)}.</p>}
              <div className="flex flex-wrap items-center justify-between gap-2"><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={a.excluded} onChange={e => change(a.id, { excluded: e.target.checked })}/>Не включать часть в ДДС</label><button type="button" onClick={() => updateParts(draft.allocations.filter(p => p.id !== a.id))} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4"/>Убрать часть</button></div>
            </div>}
          </div>;
        })}
        {remainder > 0 && <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-50/60 px-3 py-2"><div><p className="text-sm font-medium">{draft.throughCash ? "Остаток в наличных" : "Ещё не распределено"}</p><p className="text-xs text-slate-600">Из этой же операции на {formatMoney(draft.sourceAmount)}</p></div><b className="text-sm">{formatMoney(remainder)}</b><button type="button" onClick={add} className="min-h-11 rounded-lg px-3 text-sm text-violet-700 hover:bg-white">Разнести остаток</button></div>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" disabled={draft.allocations.length >= 100} onClick={add} className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-violet-700 hover:bg-violet-50"><Plus className="h-4 w-4"/>Разбить ещё</button><p aria-live="polite" className={`text-sm ${remainder < 0 ? "font-medium text-red-700" : "text-slate-600"}`}>Итого: {formatMoney(allocationTotal(draft))} · {remainder < 0 ? "Превышение: " + formatMoney(-remainder) : "Остаток: " + formatMoney(remainder)}</p></div>
      {draft.allocations.length > 1 && <label className="flex min-h-11 items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={autoLast} onChange={e => { setAutoLast(e.target.checked); if (e.target.checked) patch({ allocations: balanceLast(draft.allocations, draft.sourceAmount) }); }}/>Автоматически пересчитывать последнюю часть</label>}
    </section>

    <div className="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-3">
      <label className="text-sm">Счёт списания<select className={field} disabled={Boolean(draft.bankReviewId)} value={draft.sourceAccountId} onChange={e => patch({ sourceAccountId: e.target.value })}><option value="">Выберите счёт</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="text-sm">Дата операции<input type="date" className={field} disabled={Boolean(draft.bankReviewId)} value={draft.sourceDate} onChange={e => patch({ sourceDate: e.target.value })}/></label>
      <label className="text-sm">Компания источника<select className={field} value={draft.sourceCompanyId} onChange={e => patch({ sourceCompanyId: e.target.value })}><option value="">Выберите компанию</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    </div>
    <details open={draft.throughCash || undefined} className="rounded-lg border border-slate-200 px-3"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Перевод через наличные{draft.throughCash ? " · включён" : ""}</summary><div className="space-y-2 pb-3"><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.throughCash} onChange={e => patch({ throughCash: e.target.checked, allocations: draft.allocations.map(a => ({ ...a, accountId: e.target.checked ? draft.cashAccountId : draft.sourceAccountId })) })}/>Сначала перевести исходную сумму в наличные</label>{draft.throughCash && <label className="block text-sm">Наличные основной группы<select className={field} value={draft.cashAccountId} onChange={e => patch({ cashAccountId: e.target.value, allocations: draft.allocations.map(a => requiresKorovkinLoan(source, companies.find(c => c.id === a.companyId)) ? a : { ...a, accountId: e.target.value }) })}><option value="">Выберите наличные</option>{cashAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}</div></details>
    {!draft.bankReviewId && <details className="rounded-lg border border-slate-200 px-3"><summary className="min-h-11 cursor-pointer py-3 text-sm">Изменить исходную сумму</summary><label className="mb-3 block text-sm">Сумма операции<input type="number" min="0.01" step="0.01" className={field} value={draft.sourceAmount} onChange={e => { const sourceAmount = Number(e.target.value); patch({ sourceAmount, ...(autoLast ? { allocations: balanceLast(draft.allocations, sourceAmount) } : {}) }); }}/></label></details>}
  </fieldset>;
}
