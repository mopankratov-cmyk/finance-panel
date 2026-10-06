"use client";

import { useMemo } from "react";
import { formatDate, formatMoney } from "@/lib/format";
import { ledgerTransferBalances } from "@/lib/finance/paymentTransferBalance";
import type { Account, Payment } from "@/lib/types";

export function TransferBalancePanel({ payments, accounts, onEdit }: { payments: Payment[]; accounts: Account[]; onEdit: (payment: Payment) => void }) {
  const rubPayments = useMemo(() => payments.filter(p => accounts.find(a => a.id === p.accountId)?.currency === "RUB"), [payments, accounts]);
  const result = useMemo(() => ledgerTransferBalances(rubPayments), [rubPayments]);
  const issues = result.linked.filter(group => !group.balanced);
  const accountName = (id: string) => accounts.find(a => a.id === id)?.name ?? "Кошелёк не определён";
  const row = (payment: Payment) => <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2 text-sm"><span>{formatDate(payment.date)} · {accountName(payment.accountId)} · {payment.category} · {payment.name}</span><div className="flex items-center gap-2"><b>{formatMoney(payment.amount)}</b><button type="button" className="min-h-11 rounded-lg px-3 text-violet-700 hover:bg-violet-50" onClick={() => onEdit(payment)}>Открыть</button></div></div>;
  // A standalone transfer category is not proof of a missing pair: historical
  // DDS imports contain withdrawals, deposits and final expenses with the same
  // wording. Only explicit chain/pair markers are safe to reconcile here.
  if (!issues.length) return null;
  return <section className="rounded-xl border border-red-200 bg-red-50 p-4" aria-label="Сверка связанных переводов">
    <p className="font-medium text-red-800">В сохранённой цепочке не сходятся суммы</p>
    <p className="mt-1 text-xs text-slate-600">Проверяются только операции, которые уже связаны системой как две стороны одного перевода или займа.</p>
    {issues.map(group => <details key={group.id} open className="mt-3 rounded-lg border border-red-200 p-3"><summary className="min-h-11 cursor-pointer text-sm font-medium">{group.label} · расхождение {formatMoney(group.net)}{group.net === 0 ? " · нет полной пары записей" : ""}</summary><div className="space-y-2">{group.entries.map(entry => row(entry.payment))}</div></details>)}
  </section>;
}
