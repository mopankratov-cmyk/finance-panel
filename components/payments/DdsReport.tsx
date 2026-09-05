"use client";

import { useMemo, useState } from "react";
import type { DdsCompany } from "./ddsCompanies";
import { buildDdsSummary, sectionForCategory, TECHNICAL_SECTION } from "./ddsSummary";
import { Card, CardContent } from "@/components/ui/Card";
import type { Payment } from "@/lib/types";

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const net = (n: number) => (n >= 0 ? "text-emerald-700" : "text-red-600");

type PaymentWithCompany = Payment & { companyId?: string | null };

export function DdsReport({
  payments,
  companies,
}: {
  payments: PaymentWithCompany[];
  companies: DdsCompany[];
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [scope, setScope] = useState("all");

  const companyById = useMemo(
    () => new Map(companies.map((company) => [company.id, company] as const)),
    [companies],
  );
  const groups = useMemo(
    () => Array.from(new Set(companies.filter((company) => company.isActive).map((company) => company.groupName))).sort(),
    [companies],
  );

  const scopedPayments = useMemo(() => {
    if (scope === "all") return payments;
    if (scope === "unassigned") return payments.filter((payment) => !payment.companyId);
    if (scope.startsWith("group:")) {
      const groupName = scope.slice("group:".length);
      return payments.filter((payment) =>
        payment.companyId ? companyById.get(payment.companyId)?.groupName === groupName : false,
      );
    }
    return payments.filter((payment) => payment.companyId === scope);
  }, [payments, scope, companyById]);

  const summary = useMemo(
    () => buildDdsSummary(scopedPayments, from || undefined, to || undefined),
    [scopedPayments, from, to],
  );

  const expenseRows = useMemo(() => {
    const rows = new Map<string, { label: string; operating: number; financial: number; investing: number; other: number }>();
    const ensure = (key: string, label: string) => {
      const existing = rows.get(key);
      if (existing) return existing;
      const row = { label, operating: 0, financial: 0, investing: 0, other: 0 };
      rows.set(key, row);
      return row;
    };

    for (const payment of payments) {
      if (payment.status !== "done" || payment.amount >= 0) continue;
      if (from && payment.date < from) continue;
      if (to && payment.date > to) continue;
      const company = payment.companyId ? companyById.get(payment.companyId) : undefined;
      const row = ensure(payment.companyId ?? "unassigned", company?.name ?? "Общее по группе");
      const amount = -payment.amount;
      const section = sectionForCategory(payment.category);
      if (section === "Операционная") row.operating += amount;
      else if (section === "Финансовая") row.financial += amount;
      else if (section === "Инвестиционная") row.investing += amount;
      else if (section !== TECHNICAL_SECTION) row.other += amount;
    }

    return [...rows.values()]
      .map((row) => ({ ...row, total: row.operating + row.financial + row.investing + row.other }))
      .sort((a, b) => b.total - a.total);
  }, [payments, from, to, companyById]);

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">С даты</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">По дату</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="dds-scope" className="block text-xs text-slate-500 mb-1">Компания или группа</label>
            <select
              id="dds-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            >
              <option value="all">Все компании</option>
              <option value="unassigned">Общее по группе</option>
              {groups.map((group) => <option key={group} value={`group:${group}`}>Группа: {group}</option>)}
              {companies.filter((company) => company.isActive).map((company) => (
                <option key={company.id} value={company.id}>{company.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end text-sm text-slate-400">
            Операций: <b className="text-slate-700">{fmt(summary.count)}</b>
          </div>
        </CardContent>
      </Card>

      {/* Итоги без технических переводов */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile label="Приходы" value={`${fmt(summary.realIncome)} ₽`} cls="text-emerald-700" />
        <Tile label="Расходы" value={`${fmt(summary.realExpense)} ₽`} cls="text-red-600" />
        <Tile label="Чистый поток" value={`${fmt(summary.realNet)} ₽`} cls={net(summary.realNet)} accent />
      </div>
      <p className="-mt-2 text-[11px] text-slate-400">
        Итоги — без технических переводов между своими счетами (они показаны отдельным разделом ниже).
      </p>

      <Card>
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Расходы по компаниям</h2>
          <p className="mt-1 text-xs text-slate-400">Только фактические расходы; технические переводы между счетами исключены.</p>
        </div>
        <div className="scroll-x">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                <th className="px-5 py-3 font-medium">Компания</th>
                <th className="px-5 py-3 text-right font-medium">Операционные</th>
                <th className="px-5 py-3 text-right font-medium">Финансовые</th>
                <th className="px-5 py-3 text-right font-medium">Инвестиционные</th>
                <th className="px-5 py-3 text-right font-medium">Всего расходов</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {expenseRows.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">Нет расходов за выбранный период</td></tr>
              ) : expenseRows.map((row) => (
                <tr key={row.label} className="hover:bg-slate-50/50">
                  <td className="px-5 py-3 font-medium text-slate-800">{row.label}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{fmt(row.operating)} ₽</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{fmt(row.financial)} ₽</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{fmt(row.investing)} ₽</td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums text-red-600">{fmt(row.total)} ₽</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {summary.groups.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-slate-400">
            Нет данных за выбранный период. Загрузите ДДС кнопкой «Импорт ДДС».
          </CardContent>
        </Card>
      ) : (
        summary.groups.map((g) => {
          const technical = g.section === TECHNICAL_SECTION;
          return (
            <Card key={g.section} className={technical ? "opacity-80" : ""}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-3 sm:px-5">
                <span className="font-semibold text-slate-900">
                  {g.section}
                  {technical && (
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      не входит в чистый поток
                    </span>
                  )}
                </span>
                <span className={`tabular-nums font-bold ${net(g.net)}`}>{fmt(g.net)} ₽</span>
              </div>
              <div className="divide-y divide-slate-50">
                {g.rows.map((r) => (
                  <div key={r.category} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 text-sm sm:px-5">
                    <span className="min-w-0 text-slate-600">{r.category}</span>
                    <div className="flex flex-1 flex-wrap items-center justify-end gap-x-4 tabular-nums">
                      {r.income > 0 && <span className="text-emerald-600">+{fmt(r.income)}</span>}
                      {r.expense > 0 && <span className="text-red-500">−{fmt(r.expense)}</span>}
                      <span className={`min-w-0 text-right font-medium sm:w-28 ${net(r.net)}`}>{fmt(r.net)} ₽</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}

function Tile({ label, value, cls, accent }: { label: string; value: string; cls: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 text-center ${accent ? "border-violet-200 bg-violet-50/40" : "border-slate-200 bg-white"}`}>
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-2xl font-extrabold ${cls}`}>{value}</div>
    </div>
  );
}
