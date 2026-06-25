"use client";

import { useMemo, useState } from "react";
import { buildDdsSummary, TECHNICAL_SECTION } from "./ddsSummary";
import { Card, CardContent } from "@/components/ui/Card";
import type { Payment } from "@/lib/types";

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const net = (n: number) => (n >= 0 ? "text-emerald-700" : "text-red-600");

export function DdsReport({ payments }: { payments: Payment[] }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const summary = useMemo(
    () => buildDdsSummary(payments, from || undefined, to || undefined),
    [payments, from, to],
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-5">
          <div>
            <label className="block text-xs text-slate-500 mb-1">С даты</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">По дату</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div className="ml-auto text-sm text-slate-400">
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
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
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
                  <div key={r.category} className="flex items-center justify-between px-5 py-2 text-sm">
                    <span className="text-slate-600">{r.category}</span>
                    <div className="flex items-center gap-4 tabular-nums">
                      {r.income > 0 && <span className="text-emerald-600">+{fmt(r.income)}</span>}
                      {r.expense > 0 && <span className="text-red-500">−{fmt(r.expense)}</span>}
                      <span className={`w-28 text-right font-medium ${net(r.net)}`}>{fmt(r.net)} ₽</span>
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
