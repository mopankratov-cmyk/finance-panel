"use client";

import { Bot, Eye, FileSpreadsheet } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { formatMoney } from "@/lib/format";
import type { Account } from "@/lib/types";

export function BankReconciliationPanel({
  accounts,
  onImportStatement,
  onOpenReview,
}: {
  accounts: Account[];
  onImportStatement: () => void;
  onOpenReview: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatusAction icon={FileSpreadsheet} label="Выписка" value="Загрузить файл" detail="XLSX или PDF" onClick={onImportStatement}/>
        <StatusAction icon={Eye} label="Страница банка" value="Работает через экспорт" detail="Скачайте выписку на странице банка и загрузите её сюда" onClick={onImportStatement}/>
        <StatusAction icon={Bot} label="ИИ-сверка" value="Включена" detail="Определяет компанию, кошелёк, статью и встречные переводы" onClick={onOpenReview}/>
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Кошельки в ДДС</h2>
            <p className="mt-1 text-sm text-slate-500">Здесь показан расчётный баланс панели. Банковский остаток появится после подключения банка.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={onImportStatement} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700">
              <FileSpreadsheet className="h-4 w-4" /> Загрузить выписку
            </button>
          </div>
        </div>
        <div className="scroll-x">
          <table className="w-full min-w-[420px] text-sm">
            {/* Фон шапки непрозрачный: как только она станет липкой, строки
                начнут просвечивать сквозь неё. */}
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Кошелёк</th>
                <th className="px-5 py-3 text-right font-medium">Расчётный баланс ДДС</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accounts.map((account) => (
                <tr key={account.id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3 font-medium text-slate-900">{account.name}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatMoney(account.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

    </div>
  );
}

function StatusAction({icon:Icon,label,value,detail,onClick}:{icon:typeof FileSpreadsheet;label:string;value:string;detail:string;onClick:()=>void}) {
  return <button type="button" onClick={onClick} className="min-h-28 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-violet-300 hover:bg-violet-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
    <div className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><Icon className="h-5 w-5"/></span><span><span className="block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span><span className="mt-0.5 block font-semibold text-slate-900">{value}</span></span></div>
    <span className="mt-2 block text-xs leading-5 text-slate-500">{detail}</span>
  </button>;
}
