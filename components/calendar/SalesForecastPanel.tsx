"use client";

import { BarChart3, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { formatMoney } from "@/lib/format";
import { readForecastJson } from "@/lib/opiu/forecastRequest";

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

type WbPlanSource = "approved_sales_plan" | "working_sales_plan" | "none";

interface ForecastResponse {
  historyFrom: string;
  historyTo: string;
  cabinetId: string;
  cabinetName: string;
  cabinets: { id: string; name: string }[];
  planSource: WbPlanSource;
  items: ForecastItem[];
  planRowsCount: number;
  availablePlanPeriods: { year: number; month: number }[];
  planRevenue: number;
  forecastPayout: number;
  articlesWithoutHistory: number;
  actualRevenue: number;
  projectedRevenue: number;
  adaptiveRevenue: number;
  elapsedDays: number;
  daysInMonth: number;
  payoutSchedule: { date: string; amount: number }[];
  actualPayout: number | null;
  reportAccruedPayout: number;
  remainingPayout: number;
  weatherWarnings: { article: string; adjustmentPercent: number; reason: string | null }[];
  stableDeviationDays: number;
  automaticAdjustmentApplied: boolean;
  error?: string;
}

const PLAN_SOURCE_LABEL: Record<WbPlanSource, string> = {
  approved_sales_plan: "Утверждённый план",
  working_sales_plan: "Рабочий план",
  none: "План не найден",
};

export function SalesForecastPanel({ year, month }: {
  year: number;
  month: number;
}) {
  const [cabinetId, setCabinetId] = useState("");
  const [cabinetOptions, setCabinetOptions] = useState<ForecastResponse["cabinets"]>([]);
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adjustment, setAdjustment] = useState(0);
  const [changeDate, setChangeDate] = useState("");
  const [changeReason, setChangeReason] = useState("");

  useEffect(() => {
    const query = new URLSearchParams({ year: String(year), month: String(month + 1) });
    if (cabinetId) query.set("cabinet", cabinetId);
    const requestedCabinetId = cabinetId;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 55_000);
    let cancelled = false;

    setData(null);
    setError("");
    setLoading(true);
    fetch(`/api/opiu/forecast?${query}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await readForecastJson<ForecastResponse>(
          response,
          "Не удалось рассчитать прогноз WB",
        );
        if (cancelled) return;
        setCabinetOptions(result.cabinets ?? []);
        // Первый заход без выбранного кабинета — сервер вернул дефолтный, фиксируем его.
        if (!requestedCabinetId && result.cabinetId) {
          setCabinetId(result.cabinetId);
          return;
        }
        // §19: показываем данные только если ответ строго про запрошенный кабинет.
        if (result.cabinetId === requestedCabinetId) {
          setData(result);
          setError("");
          setLoading(false);
          return;
        }
        throw new Error("Ответ API не соответствует выбранному кабинету");
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(
            requestError instanceof DOMException && requestError.name === "AbortError"
              ? "Расчёт занял слишком много времени. Повторите запрос через минуту."
              : requestError instanceof Error
                ? requestError.message
                : "Не удалось рассчитать прогноз",
          );
          setLoading(false);
        }
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [year, month, cabinetId]);

  const expectedPayout = (data?.forecastPayout ?? 0) + adjustment;
  const articleRows = useMemo(() => data?.items.slice().sort((a, b) => b.planRevenue - a.planRevenue) ?? [], [data]);

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
        <p className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm font-semibold text-violet-950">Только просмотр: прогноз не публикуется в платёжный календарь.</p>
        {cabinetOptions.length > 0 && (
          <label className="flex flex-col gap-1 text-sm text-slate-600 sm:max-w-xs">
            Кабинет WB
            <select
              value={cabinetId}
              onChange={(event) => setCabinetId(event.target.value)}
              className="min-h-11 rounded-lg border border-slate-200 px-3"
            >
              {cabinetOptions.map((cabinet) => (
                <option key={cabinet.id} value={cabinet.id}>{cabinet.name}</option>
              ))}
            </select>
          </label>
        )}
        {loading ? <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Считаю по отчётам…</div>
          : error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
          : data && <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Плановая выручка" value={data.planRevenue} />
              <Metric label={`Факт за ${data.elapsedDays} дн.`} value={data.actualRevenue} />
              <Metric label="Прогноз продаж по темпу" value={data.projectedRevenue} />
              <Metric label="Прогноз выплаты" value={data.forecastPayout} green />
              <Metric label="Подтверждено отчётом WB" value={data.reportAccruedPayout} />
              {adjustment !== 0 && <Metric label="После изменений МП" value={expectedPayout} green={expectedPayout >= data.forecastPayout} />}
            </div>
            <p className="text-sm text-slate-600">
              Кабинет: <b>{data.cabinetName || data.cabinetId}</b> · Источник плана: <b>{PLAN_SOURCE_LABEL[data.planSource]}</b>
              {data.planSource === "working_sales_plan" && " — план не утверждён, используется только для предварительного просмотра"}
            </p>
            {data.planRowsCount === 0 && (
              <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="font-semibold">План продаж за {String(month + 1).padStart(2, "0")}.{year} не найден</p>
                <p className="mt-1 text-amber-800">
                  Прогноз читает план из раздела «План» (рабочая или утверждённая версия выбранного кабинета).
                  Для этого месяца заказов в плане нет.
                  {data.availablePlanPeriods.length > 0
                    ? ` В плане этого кабинета заполнены периоды: ${data.availablePlanPeriods.map((period) => `${String(period.month).padStart(2, "0")}.${period.year}`).join(", ")}.`
                    : " В плане этого кабинета за год нет ни одного заполненного месяца — проверьте, что план сохранён для нужного кабинета."}
                </p>
              </div>
            )}
            {data.planRowsCount > 0 && data.planRevenue === 0 && (
              <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="font-semibold">План найден, но плановая выручка равна нулю</p>
                <p className="mt-1 text-amber-800">В разделе «План» у артикулов этого месяца заполните заказы, цену и процент выкупа.</p>
              </div>
            )}
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              Адаптивный план продаж: <b>{formatMoney(data.adaptiveRevenue)}</b>. Банковский факт: недоступен — сверка с ДДС ещё не подключена. Осталось запланировать: <b>{formatMoney(data.remainingPayout)}</b>. Чем больше дней месяца прошло, тем сильнее прогноз опирается на фактический темп.
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
          </>}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, green }: { label: string; value: number; green?: boolean }) {
  return <div className={`rounded-xl p-4 ${green ? "bg-emerald-50" : "bg-slate-50"}`}><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 text-xl font-bold tabular-nums ${green ? "text-emerald-800" : "text-slate-950"}`}>{formatMoney(value)}</p></div>;
}
