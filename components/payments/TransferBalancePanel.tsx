"use client";

import { useMemo } from "react";
import { formatDate, formatMoney } from "@/lib/format";
import { ledgerTransferBalances } from "@/lib/finance/paymentTransferBalance";
import type { Account, Payment } from "@/lib/types";

export function TransferBalancePanel({ payments, accounts, onEdit }: { payments: Payment[]; accounts: Account[]; onEdit: (payment: Payment) => void }) {
  const rubPayments = useMemo(() => payments.filter(p => accounts.find(a => a.id === p.accountId)?.currency === "RUB"), [payments, accounts]);
  const result = useMemo(() => ledgerTransferBalances(rubPayments), [rubPayments]);
  const issues = result.linked.filter(group => !group.balanced);
  const bad = issues.length > 0 || result.unlinkedNet !== 0;
  const accountName = (id: string) => accounts.find(a => a.id === id)?.name ?? "Кошелёк не определён";
  const row = (payment: Payment) => <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2 text-sm"><span>{formatDate(payment.date)} · {accountName(payment.accountId)} · {payment.category} · {payment.name}</span><div className="flex items-center gap-2"><b>{formatMoney(payment.amount)}</b><button type="button" className="min-h-11 rounded-lg px-3 text-violet-700 hover:bg-violet-50" onClick={() => onEdit(payment)}>Открыть</button></div></div>;
  return <section className={`rounded-xl border p-4 ${bad ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50/50"}`} aria-label="Сверка выбытий и поступлений">
    <p className={`font-medium ${bad ? "text-red-800" : "text-emerald-900"}`}>{bad ? "Выбытия и поступления не сходятся" : "Сверка связанных переводов: 0 ₽"}</p>
    <p className="mt-1 text-xs text-slate-600">Парные переводы и займы проверяются по всей истории фактических операций в рублях, независимо от фильтров дат. Обычные доходы и расходы в эту сверку не входят.</p>
    {issues.map(group => <details key={group.id} open className="mt-3 rounded-lg border border-red-200 p-3"><summary className="min-h-11 cursor-pointer text-sm font-medium">{group.label} · расхождение {formatMoney(group.net)}{group.net === 0 ? " · нет полной пары записей" : ""}</summary><div className="space-y-2">{group.entries.map(entry => row(entry.payment))}</div></details>)}
    {result.unlinked.length > 0 && <details open={result.unlinkedNet !== 0 || undefined} className="mt-3 rounded-lg border border-slate-200 p-3"><summary className="min-h-11 cursor-pointer text-sm">Переводы без сохранённой связи · {result.unlinked.length} записей · итог {formatMoney(result.unlinkedNet)}</summary><p className="mb-2 text-xs text-slate-600">{result.unlinkedNet !== 0 ? "В этих записях выбытия и поступления отличаются. Проверьте исходные суммы и недостающие поступления." : "Общий итог равен нулю, но парность отдельных несвязанных переводов ещё не подтверждена."}</p><div className="space-y-2">{result.unlinked.map(row)}</div></details>}
  </section>;
}
