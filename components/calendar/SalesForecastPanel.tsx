"use client";

import { BarChart3, CalendarPlus, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { formatMoney, generateId } from "@/lib/format";
import type { Account, Payment } from "@/lib/types";

interface ForecastItem {
  article: string;
  planRevenue: number;
  historicalRevenue: number;
  historicalPayout: number;
  payoutRate: number | null;
  forecastPayout: number | null;
  actualRevenue: number;
  projectedRevenue: number;
  adaptiveRevenue: number;
  weatherAdjustmentPercent: number;
  weatherReason: string | null;
}

interface ForecastResponse {
  historyFrom: string;
  historyTo: string;
  items: ForecastItem[];
  planRevenue: number;
  forecastPayout: number;
  articlesWithoutHistory: number;
  actualRevenue: number;
  projectedRevenue: number;
  adaptiveRevenue: number;
  elapsedDays: number;
  daysInMonth: number;
  payoutSchedule: { date: string; amount: number }[];
  actualPayout: number;
  remainingPayout: number;
  weatherWarnings: { article: string; adjustmentPercent: number; reason: string | null }[];
  stableDeviationDays: number;
  automaticAdjustmentApplied: boolean;
  error?: string;
}

export function SalesForecastPanel({ year, month, accounts, onAddPayment }: {
  year: number;
  month: number;
  accounts: Account[];
  onAddPayment: (payment: Payment) => void;
}) {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [paymentDate, setPaymentDate] = useState(`${year}-${String(month + 1).padStart(2, "0")}-28`);
  const [adjustment, setAdjustment] = useState(0);
  const [changeDate, setChangeDate] = useState("");
  const [changeReason, setChangeReason] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/opiu/forecast?year=${year}&month=${month + 1}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as ForecastResponse;
        if (!response.ok) throw new Error(result.error ?? "Ошибка расчёта");
        if (!cancelled) {
          setData(result);
          setError("");
          setLoading(false);
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "Не удалось рассчитать прогноз");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [year, month]);

  const expectedPayout = (data?.forecastPayout ?? 0) + adjustment;
  const articleRows = useMemo(() => data?.items.slice().sort((a, b) => b.planRevenue - a.planRevenue) ?? [], [data]);

  const addForecast = () => {
    if (!accountId || !paymentDate || expectedPayout <= 0 || !data) return;
    const changeComment = adjustment
      ? ` Изменение МП с ${changeDate || "неуказанной даты"}: ${changeReason || "без пояснения"}, ${formatMoney(adjustment)}.`
      : "";
    onAddPayment({
      id: generateId("sales-plan"),
      date: paymentDate,
      name: "Плановое поступление от маркетплейсов по ОПиУ",
      amount: expectedPayout,
      category: "Поступления от маркетплейсов",
      accountId,
      status: "planned",
      counterparty: "Маркетплейсы",
      comment: `Расчёт по фактической экономике артикулов за ${data.historyFrom}—${data.historyTo}.${changeComment}`,
    });
  };

  const addForecastSchedule = () => {
    if (!accountId || !data?.payoutSchedule.length) return;
    for (const item of data.payoutSchedule) {
      onAddPayment({
        id: generateId("sales-plan"),
        date: item.date,
        name: "Плановое поступление от маркетплейсов по адаптивному прогнозу",
        amount: item.amount,
        category: "Поступления от маркетплейсов",
        accountId,
        status: "planned",
        counterparty: "Маркетплейсы",
        comment: `Недельная часть прогноза. План ${formatMoney(data.planRevenue)}, темп продаж ${formatMoney(data.projectedRevenue)}, адаптивный план ${formatMoney(data.adaptiveRevenue)}.`,
      });
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><BarChart3 className="h-5 w-5" /></div>
        <div>
          <h2 className="font-semibold text-slate-900">Прогноз поступлений по ОПиУ</h2>
          <p className="text-sm text-slate-500">План продаж × фактическая доля выплаты каждого артикула.</p>
        </div>
      </div>
      <CardContent className="space-y-4 pt-5">
        {loading ? <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Считаю по отчётам…</div>
          : error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
          : data && <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Плановая выручка" value={data.planRevenue} />
              <Metric label={`Факт за ${data.elapsedDays} дн.`} value={data.actualRevenue} />
              <Metric label="Прогноз продаж по темпу" value={data.projectedRevenue} />
              <Metric label="Прогноз выплаты" value={data.forecastPayout} green />
              {adjustment !== 0 && <Metric label="После изменений МП" value={expectedPayout} green={expectedPayout >= data.forecastPayout} />}
            </div>
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              Адаптивный план продаж: <b>{formatMoney(data.adaptiveRevenue)}</b>. Уже отражено выплат: <b>{formatMoney(data.actualPayout)}</b>, осталось запланировать: <b>{formatMoney(data.remainingPayout)}</b>. Чем больше дней месяца прошло, тем сильнее прогноз опирается на фактический темп.
            </p>
            {!data.automaticAdjustmentApplied && data.stableDeviationDays > 0 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Отклонение продаж держится {data.stableDeviationDays} дн. Автоматический пересчёт будет применён после трёх последовательных дней либо сразу по команде руководителя.
              </p>
            )}
            {data.articlesWithoutHistory > 0 && (
              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <TriangleAlert className="h-5 w-5 shrink-0" />
                Для {data.articlesWithoutHistory} артикулов нет достаточной истории. Они не включены в прогноз и требуют ручной оценки.
              </div>
            )}
            {data.weatherWarnings.length > 0 && (
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
                <h3 className="font-semibold text-sky-950">Погода влияет на сезонные товары</h3>
                <div className="mt-2 space-y-1 text-sm text-sky-900">
                  {data.weatherWarnings.map((warning) => (
                    <p key={warning.article}><b>{warning.article}</b>: прогноз увеличен на {warning.adjustmentPercent.toFixed(1)}% · {warning.reason}</p>
                  ))}
                </div>
              </div>
            )}
            <details className="rounded-xl border border-slate-200">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">Показать расчёт по артикулам ({articleRows.length})</summary>
              <div className="max-h-72 overflow-auto border-t border-slate-100">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-2 text-left">Артикул</th><th className="px-4 py-2 text-right">План</th><th className="px-4 py-2 text-right">Факт продаж</th><th className="px-4 py-2 text-right">Темп месяца</th><th className="px-4 py-2 text-right">Доля выплаты</th><th className="px-4 py-2 text-right">Прогноз</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">{articleRows.map((item) => (
                    <tr key={item.article}><td className="px-4 py-2 font-medium">{item.article}</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(item.planRevenue)}</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(item.actualRevenue)}</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(item.projectedRevenue)}</td><td className="px-4 py-2 text-right tabular-nums">{item.payoutRate === null ? "Нет истории" : `${(item.payoutRate * 100).toFixed(1)}%`}</td><td className="px-4 py-2 text-right font-semibold tabular-nums">{item.forecastPayout === null ? "—" : formatMoney(item.forecastPayout)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </details>
            <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
              <h3 className="font-semibold text-blue-950">Известное изменение маркетплейса</h3>
              <p className="mt-1 text-sm text-blue-800">Заполняется только если маркетплейс заранее сообщил об изменении тарифа, комиссии или графика.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="text-sm text-blue-950">Действует с<input type="date" value={changeDate} onChange={(event) => setChangeDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-blue-200 px-3" /></label>
                <label className="text-sm text-blue-950">Корректировка выплаты, ₽<input type="number" value={adjustment} onChange={(event) => setAdjustment(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-blue-200 px-3" /></label>
                <label className="text-sm text-blue-950">Причина<input value={changeReason} onChange={(event) => setChangeReason(event.target.value)} placeholder="Например, комиссия +2%" className="mt-1 min-h-11 w-full rounded-lg border border-blue-200 px-3" /></label>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
              <label className="text-sm font-medium text-slate-700">Ожидаемая дата выплаты<input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
              <label className="text-sm font-medium text-slate-700">Кошелёк<select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3">{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
              <button onClick={addForecast} disabled={!accountId || !paymentDate || expectedPayout <= 0} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50"><CalendarPlus className="h-4 w-4" /> Добавить план</button>
              <button onClick={addForecastSchedule} disabled={!accountId || !data.payoutSchedule.length} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-violet-200 bg-white px-4 text-sm font-semibold text-violet-700 disabled:opacity-50"><CalendarPlus className="h-4 w-4" /> По неделям</button>
            </div>
          </>}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, green }: { label: string; value: number; green?: boolean }) {
  return <div className={`rounded-xl p-4 ${green ? "bg-emerald-50" : "bg-slate-50"}`}><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 text-xl font-bold tabular-nums ${green ? "text-emerald-800" : "text-slate-950"}`}>{formatMoney(value)}</p></div>;
}
