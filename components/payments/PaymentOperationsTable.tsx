"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import { groupPaymentOperations } from "@/lib/finance/paymentOperationGroups";
import { chainIdForPayment, chainMetadata, type PaymentChainSummary } from "@/lib/finance/paymentChains";
import type { Account, Payment } from "@/lib/types";
import type { DdsCompany } from "./ddsCompanies";
import type { PaymentChainSeed } from "./PaymentChainModal";

export function PaymentOperationsTable({ visible, all, accounts, companies, highlightedPaymentId, onEdit, onDelete, onOpen }: {
  visible: Payment[]; all: Payment[]; accounts: Account[]; companies: DdsCompany[];
  highlightedPaymentId?: string | null;
  onEdit: (payment: Payment) => void; onDelete: (id: string) => void; onOpen: (seed: PaymentChainSeed) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [summaries, setSummaries] = useState<PaymentChainSummary[]>([]);
  const legacyKey = useMemo(() => [...new Set(all.filter(p => p.status === "done" && !chainMetadata(p.comment)).map(chainIdForPayment).filter(Boolean))].sort().join(","), [all]);
  useEffect(() => {
    if (!legacyKey) return;
    let cancelled = false;
    fetch("/api/finance/companies?resource=payment-chain-index", { cache: "no-store" }).then(async r => {
      if (!r.ok) return [];
      return (await r.json()).chains as PaymentChainSummary[];
    }).then(rows => { if (!cancelled) setSummaries(rows); }).catch(() => { /* Ordinary rows remain available if original bank sources cannot load. */ });
    return () => { cancelled = true; };
  }, [legacyKey]);
  const groups = useMemo(() => groupPaymentOperations(visible, all, summaries), [visible, all, summaries]);
  const accountName = (id: string) => accounts.find(a => a.id === id)?.name ?? "—";
  const companyName = (id: string | null | undefined) => companies.find(c => c.id === id)?.name ?? "Общее по группе";
  const toggle = (id: string) => setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return <div className="table-cards-lg overflow-x-auto p-3 lg:overflow-x-visible lg:p-0">
    <table className="w-full text-sm lg:table-fixed">
      <colgroup>
        <col className="lg:w-[7rem]" />
        <col className="lg:w-[7.5rem]" />
        <col className="lg:w-[8.25rem]" />
        <col className="lg:w-[7.5rem]" />
        <col className="lg:w-[11rem]" />
        <col />
        <col className="lg:w-[10.5rem]" />
        <col className="lg:w-[10rem]" />
      </colgroup>
      <thead><tr className="border-b border-slate-100 text-left text-xs text-slate-500">
        <th className="px-3 py-3 font-medium">Дата</th>
        <th className="px-3 py-3 text-right font-medium">Сумма</th>
        <th className="px-3 py-3 font-medium">Кошелёк</th>
        <th className="px-3 py-3 font-medium" title="Направление бизнеса">Компания</th>
        <th className="px-3 py-3 font-medium">Контрагент</th>
        <th className="px-3 py-3 font-medium" title="Назначение платежа">Назначение</th>
        <th className="px-3 py-3 font-medium">Статья</th>
        <th className="px-2 py-3 text-right font-medium">Действия</th>
      </tr></thead>
      <tbody className="divide-y divide-slate-50">
        {!groups.length && <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-400">Нет фактических платежей по выбранным фильтрам</td></tr>}
        {groups.map(group => {
          const p = group.source;
          const open = expanded.has(group.key);
          return <Fragment key={group.key}>
            <tr id={`payment-${p.id}`} className={p.id === highlightedPaymentId ? "bg-emerald-100/70 ring-2 ring-inset ring-emerald-400" : group.chainId ? "bg-violet-50/30" : "hover:bg-slate-50/50"}>
              <td data-label="Дата" className="whitespace-nowrap px-3 py-3 text-slate-600">{formatDate(p.date)}</td>
              <td data-label="Сумма" className={`whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums ${p.amount < 0 ? "text-red-600" : "text-emerald-600"}`}>{formatMoney(p.amount)}</td>
              <td data-label="Кошелёк" className="px-3 py-3 text-slate-600" title={accountName(p.accountId)}><span className="lg:line-clamp-2">{accountName(p.accountId)}</span></td>
              <td data-label="Компания" className="px-3 py-3 text-slate-600" title={companyName(p.companyId)}><span className="lg:line-clamp-2">{companyName(p.companyId)}</span></td>
              <td data-label="Контрагент" className="break-anywhere px-3 py-3 text-slate-600" title={p.counterparty || undefined}><span className="lg:line-clamp-2">{p.counterparty || "—"}</span></td>
              <td data-label="Назначение" className="break-anywhere px-3 py-3 text-slate-500 lg:truncate" title={p.name}>{p.name}</td>
              <td data-label="Статья" className="px-3 py-3 font-medium" title={group.chainId ? undefined : p.category}>{group.chainId ? <button type="button" aria-expanded={open} aria-controls={`parts-${group.key}`} onClick={() => toggle(group.key)} className="flex min-h-11 items-center gap-1 rounded-lg px-1 text-left text-violet-700 hover:bg-violet-50">{open ? <ChevronDown className="h-4 w-4 shrink-0"/> : <ChevronRight className="h-4 w-4 shrink-0"/>}<span>Частей: {group.parts.length}</span></button> : <span className="lg:line-clamp-2">{p.category}</span>}</td>
              <td data-cell="actions" className="px-2 py-3"><div className="flex items-center justify-end gap-1">{!group.chainId && p.amount < 0 && <button type="button" onClick={() => onOpen({ paymentId: p.id })} className="min-h-11 rounded-lg border border-violet-200 px-2 text-xs text-violet-700">Разбить</button>}<button type="button" aria-label="Редактировать операцию" title="Редактировать" onClick={() => group.chainId ? onOpen({ paymentId: p.id }) : onEdit(p)} className="tap rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><Pencil className="h-4 w-4"/></button><button type="button" aria-label={group.chainId ? "Отменить операцию" : "Удалить платёж"} title={group.chainId ? "Отменить операцию" : "Удалить платёж"} onClick={() => group.chainId ? onOpen({ paymentId: p.id }) : onDelete(p.id)} className="tap rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4"/></button></div></td>
            </tr>
            {group.chainId && open && <tr id={`parts-${group.key}`}><td colSpan={8} className="px-5 py-3"><div className="w-full space-y-2 rounded-lg border border-violet-100 bg-slate-50 p-3 text-left">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Части операции на {formatMoney(-p.amount)}</p><button type="button" onClick={() => onOpen({ paymentId: p.id })} className="min-h-11 rounded-lg px-3 text-sm text-violet-700 hover:bg-white">Изменить разбивку</button></div>
              <p className="text-xs text-slate-500">Все части по своим датам. Фильтры выбрали исходную операцию; здесь показана вся разбивка.</p>
              {group.parts.map(part => <div key={part.id} className="grid gap-1 rounded-lg bg-white p-3 text-sm sm:grid-cols-[100px_1fr_1fr_110px]"><span className="text-slate-500">{formatDate(part.date)}</span><div><p>{part.category}</p><p className="text-xs text-slate-500">{part.counterparty || part.name}</p></div><div><p>{companyName(part.companyId)}</p><p className="text-xs text-slate-500">{accountName(part.accountId)}</p></div><b className="text-red-600 sm:text-right">{formatMoney(part.amount)}</b></div>)}
              {Boolean(group.remainder && group.remainder > 0) && <div className="flex flex-wrap justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm"><span>Остаток исходной суммы, включая исключённые части</span><b>{formatMoney(group.remainder!)}</b></div>}
              {!group.parts.length && <p className="text-sm text-slate-500">Расходов из этой суммы пока нет.</p>}
              <button type="button" onClick={() => onOpen({ paymentId: p.id })} className="min-h-11 rounded-lg px-3 text-sm text-slate-600 hover:bg-white">Связанные займы, переводы и история</button>
            </div></td></tr>}
          </Fragment>;
        })}
      </tbody>
    </table>
  </div>;
}
