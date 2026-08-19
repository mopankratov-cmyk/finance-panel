"use client";

import { BarChart3, CalendarPlus, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { formatMoney } from "@/lib/format";
import { readForecastJson } from "@/lib/opiu/forecastRequest";
import type { Account, Payment } from "@/lib/types";
import type { DdsCompany } from "@/components/payments/ddsCompanies";
import { publishForecastToCalendar } from "./forecastPublication";
import { recommendWbDestination } from "./marketplaceDestination";

interface ForecastGap {
  field: string;
  source: string;
  impact: "payout" | "profit";
}

interface ArticleBreakdown {
  revenue: number;
  withholdings: number | null;
  payout: number | null;
  cost: number | null;
  profit: number | null;
}

interface ForecastItem {
  article: string;
  externalId: string;
  model: string;
  planBuyouts: number;
  costPerUnit: number | null;
  breakdown: ArticleBreakdown;
  planRevenue: number;
  historicalRevenue: number;
  historicalPayout: number;
  historicalPayoutRate: number | null;
  payoutRate: number | null;
  payoutRateSource: "financial_report" | "unit_economics" | "unavailable";
  forecastPayout: number | null;
  actualRevenue: number;
  projectedRevenue: number;
  adaptiveRevenue: number;
  weatherAdjustmentPercent: number;
  weatherReason: string | null;
  gaps: ForecastGap[];
  affectsPayout: boolean;
  includedInForecast: boolean;
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
  articlesAffectingPayout: number;
  breakdownTotals: {
    revenue: number;
    withholdings: number;
    payout: number;
    cost: number;
    profit: number;
    costComplete: boolean;
    payoutComplete: boolean;
  };
  actualRevenue: number;
  projectedRevenue: number;
  adaptiveRevenue: number;
  elapsedDays: number;
  daysInMonth: number;
  payoutSchedule: { id: string; date: string; amount: number; source: "forecast" | "financial_report" }[];
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

export function SalesForecastPanel({ year, month, accounts, companies, payments, companyByPayment }: {
  year: number;
  month: number;
  accounts: Account[];
  companies: DdsCompany[];
  payments: Payment[];
  companyByPayment: Map<string, string | null>;
}) {
  const [cabinetId, setCabinetId] = useState("");
  const [calculatedCabinetId, setCalculatedCabinetId] = useState("");
  const [calculationVersion, setCalculationVersion] = useState(0);
  const [cabinetOptions, setCabinetOptions] = useState<ForecastResponse["cabinets"]>([]);
  const [forceRecalc, setForceRecalc] = useState(false);
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adjustment, setAdjustment] = useState(0);
  const [changeDate, setChangeDate] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (!data?.cabinetId) return;
    const recommendation = recommendWbDestination(data.cabinetId, payments, companyByPayment);
    if (!recommendation) return;
    if (companies.some((company) => company.id === recommendation.companyId)) setCompanyId(recommendation.companyId);
    if (accounts.some((account) => account.id === recommendation.accountId)) setAccountId(recommendation.accountId);
  }, [accounts, companies, companyByPayment, data?.cabinetId, payments]);

  useEffect(() => {
    const query = new URLSearchParams({ year: String(year), month: String(month + 1) });
    const controller = new AbortController();
    let cancelled = false;
    setCabinetOptions([]);
    setData(null);
    setError("");
    setLoading(true);
    fetch(`/api/opiu/forecast?${query}`, { cache: "no-store", signal: controller.signal })
      .then((response) => readForecastJson<{ cabinets: ForecastResponse["cabinets"] }>(
        response,
        "Не удалось загрузить список кабинетов WB",
      ))
      .then((result) => {
        if (cancelled) return;
        setCabinetOptions(result.cabinets);
        setLoading(false);
      })
      .catch((requestError) => {
        if (cancelled || requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить список кабинетов WB");
        setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [year, month]);

  useEffect(() => {
    if (!calculatedCabinetId) return;
    const query = new URLSearchParams({
      year: String(year),
      month: String(month + 1),
      cabinet: calculatedCabinetId,
    });
    if (forceRecalc) query.set("force", "1");
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
        // §19: показываем данные только если ответ строго про запрошенный кабинет.
        if (result.cabinetId === calculatedCabinetId) {
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
  }, [year, month, calculatedCabinetId, calculationVersion, forceRecalc]);

  const expectedPayout = (data?.forecastPayout ?? 0) + adjustment;
  const articleRows = useMemo(() => data?.items.slice().sort((a, b) => b.planRevenue - a.planRevenue) ?? [], [data]);
  const gapRows = useMemo(
    () => data?.items.filter((item) => item.gaps.length > 0).sort((a, b) => Number(b.affectsPayout) - Number(a.affectsPayout)) ?? [],
    [data],
  );

  return (
    <Card>
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><BarChart3 className="h-5 w-5" /></div>
        <div>
          <h2 className="font-semibold text-slate-900">Прогноз поступлений по ОПиУ</h2>
          <p className="text-sm text-slate-500">План продаж × доля выплаты из отчётов или актуальной юнит-экономики.</p>
        </div>
      </div>
      <CardContent className="space-y-4 pt-5">
        <p className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950">Сначала проверьте кабинет, компанию, счёт и суммы. Календарь изменится только после отдельного подтверждения.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-64 flex-col gap-1 text-sm text-slate-600">
            Кабинет WB
            <select
              value={cabinetId}
              onChange={(event) => {
                setCabinetId(event.target.value);
                setCalculatedCabinetId("");
                setForceRecalc(false);
                setData(null);
                setError("");
              }}
              className="min-h-11 rounded-lg border border-slate-200 px-3"
            >
              <option value="">Выберите кабинет</option>
              {cabinetOptions.map((cabinet) => (
                <option key={cabinet.id} value={cabinet.id}>{cabinet.name}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!cabinetId || loading}
            onClick={() => {
              setData(null);
              setError("");
              setForceRecalc(false);
              setCalculatedCabinetId(cabinetId);
              setCalculationVersion((value) => value + 1);
            }}
            className="min-h-11 rounded-xl bg-violet-600 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {loading && calculatedCabinetId ? "Рассчитываем…" : "Рассчитать прогноз"}
          </button>
        </div>
        {loading ? <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> {calculatedCabinetId ? "Считаю прогноз WB…" : "Загружаю список кабинетов…"}</div>
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
            {data.planRowsCount > 0 && (
              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="font-semibold text-slate-900">Экономика прогноза</h3>
                <p className="mt-1 text-xs text-slate-500">Сначала используется фактическая доля выплаты из финансовых отчётов. Если истории нет — выплата рассчитывается по актуальным удержаниям из юнит-экономики. Себестоимость влияет на прибыль, но не вычитается из выплаты маркетплейса.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <Metric label="Плановая выручка" value={data.breakdownTotals.revenue} />
                  <Metric label="Ожидаемые удержания МП" value={data.breakdownTotals.withholdings} />
                  <Metric label="Ожидаемая выплата" value={data.breakdownTotals.payout} green />
                  <Metric label="Себестоимость" value={data.breakdownTotals.cost} />
                  <Metric label="Ожидаемая прибыль" value={data.breakdownTotals.profit} green={data.breakdownTotals.profit >= 0} />
                </div>
                {(!data.breakdownTotals.payoutComplete || !data.breakdownTotals.costComplete) && (
                  <p className="mt-2 text-xs text-amber-700">
                    Итог неполный:{" "}
                    {!data.breakdownTotals.payoutComplete && "у части артикулов неизвестна выплата"}
                    {!data.breakdownTotals.payoutComplete && !data.breakdownTotals.costComplete && "; "}
                    {!data.breakdownTotals.costComplete && "у части артикулов нет себестоимости (см. список нехватки данных)"}.
                  </p>
                )}
              </div>
            )}
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
              Адаптивный прогноз продаж: <b>{formatMoney(data.adaptiveRevenue)}</b>. Подтверждённые отчётом суммы заменяют расчётную часть, а поступление в ДДС автоматически отмечает план фактическим. Осталось рассчитать: <b>{formatMoney(data.remainingPayout)}</b>.
            </p>
            {data.payoutSchedule.length > 0 && (
              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="font-semibold text-slate-900">Расчётные даты поступлений</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Это <b>расчётные</b> даты, а не подтверждённые. Подтверждённая дата появится из финансового отчёта или кабинета маркетплейса, фактическая — после поступления в ДДС.
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[320px] text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500"><tr>
                      <th className="px-3 py-2 text-left">Дата поступления</th>
                      <th className="px-3 py-2 text-left">Источник</th>
                      <th className="px-3 py-2 text-right">Сумма</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.payoutSchedule.map((row) => (
                        <tr key={row.id}>
                          <td className="px-3 py-2">{new Date(row.date).toLocaleDateString("ru-RU")}</td>
                          <td className="px-3 py-2">{row.source === "financial_report" ? "Подтверждено отчётом" : "Предварительный расчёт"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Для предварительного расчёта используется консервативный срок: 14 календарных дней до доступности вывода и ещё 7 рабочих дней банка. Для строки отчёта дата считается от даты отчёта; это ещё не банковский факт.
                </p>
              </div>
            )}
            {data.payoutSchedule.length > 0 && (
              <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4">
                <h3 className="font-semibold text-violet-950">Перенести прогноз WB в календарь</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-violet-950">Компания<select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-violet-200 bg-white px-3"><option value="">Выберите компанию</option>{companies.filter((company) => company.isActive).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
                  <label className="text-sm text-violet-950">Счёт получения<select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-violet-200 bg-white px-3"><option value="">Выберите счёт</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
                </div>
                <button disabled={publishing || !companyId || !accountId || data.planSource !== "approved_sales_plan"} onClick={async () => {
                  if (!confirm(`Перенести ${data.payoutSchedule.length} поступлений WB в платёжный календарь? Существующие строки этого прогноза будут обновлены.`)) return;
                  setPublishing(true);
                  try {
                    const result = await publishForecastToCalendar(
                      { marketplace: "wb", cabinetId: data.cabinetId, companyId, accountId, year, month: month + 1 },
                      data.payoutSchedule.map((row) => ({
                        key: row.id,
                        date: row.date,
                        amount: row.amount,
                        source: row.source,
                        reportId: row.source === "financial_report" ? row.id : undefined,
                      })),
                    );
                    alert(`Календарь обновлён: ${result.published} строк.`);
                    window.location.reload();
                  } catch (publishError) { alert(publishError instanceof Error ? publishError.message : "Не удалось обновить календарь"); }
                  finally { setPublishing(false); }
                }} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><CalendarPlus className="h-4 w-4" />{publishing ? "Сохраняю…" : "Утвердить и перенести в календарь"}</button>
                {data.planSource !== "approved_sales_plan" && <p className="mt-2 text-xs text-amber-800">Кнопка станет доступна после утверждения плана продаж выбранного кабинета.</p>}
              </div>
            )}
            {!data.automaticAdjustmentApplied && data.stableDeviationDays > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p>Отклонение продаж держится {data.stableDeviationDays} дн. Автоматический пересчёт будет применён после трёх последовательных дней либо сразу по команде руководителя.</p>
                <button
                  type="button"
                  onClick={() => setForceRecalc(true)}
                  className="mt-2 inline-flex min-h-9 items-center rounded-lg border border-amber-300 bg-white px-3 font-medium text-amber-900 hover:bg-amber-100"
                >
                  Пересчитать сейчас по фактическому темпу
                </button>
              </div>
            )}
            {data.automaticAdjustmentApplied && forceRecalc && (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                Пересчёт по фактическому темпу применён вручную. План менеджера при этом не изменяется — пересчитан только финансовый прогноз.
              </p>
            )}
            {gapRows.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50">
                <div className="flex gap-2 px-4 py-3 text-sm text-amber-900">
                  <TriangleAlert className="h-5 w-5 shrink-0" />
                  <span>
                    По <b>{gapRows.length}</b> артикулам не хватает данных
                    {data.articlesAffectingPayout > 0
                      ? <> · из них <b>{data.articlesAffectingPayout}</b> влияют на сумму выплаты — итог показан как неполный.</>
                      : <> · влияют только на расчёт прибыли, сумма выплаты полная.</>}
                  </span>
                </div>
                <details className="border-t border-amber-200">
                  <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-amber-900">Показать, чего не хватает</summary>
                  <div className="max-h-72 overflow-auto border-t border-amber-200 bg-white">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead className="bg-amber-50 text-xs text-amber-800"><tr>
                        <th className="px-3 py-2 text-left">Артикул</th>
                        <th className="px-3 py-2 text-left">Внешний ID</th>
                        <th className="px-3 py-2 text-left">Модель</th>
                        <th className="px-3 py-2 text-left">Чего не хватает</th>
                        <th className="px-3 py-2 text-left">Источник</th>
                        <th className="px-3 py-2 text-left">Влияет на</th>
                        <th className="px-3 py-2 text-center">В итоге</th>
                      </tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {gapRows.flatMap((item) => item.gaps.map((gap, index) => (
                          <tr key={`${item.article}-${gap.field}`}>
                            {index === 0 && <td rowSpan={item.gaps.length} className="px-3 py-2 align-top font-medium">{item.article}</td>}
                            {index === 0 && <td rowSpan={item.gaps.length} className="px-3 py-2 align-top tabular-nums text-slate-500">{item.externalId || "—"}</td>}
                            {index === 0 && <td rowSpan={item.gaps.length} className="px-3 py-2 align-top text-slate-500">{item.model || "—"}</td>}
                            <td className="px-3 py-2">{gap.field}</td>
                            <td className="px-3 py-2 text-slate-500">{gap.source}</td>
                            <td className="px-3 py-2">{gap.impact === "payout" ? "выплату" : "прибыль"}</td>
                            {index === 0 && <td rowSpan={item.gaps.length} className="px-3 py-2 text-center align-top">{item.includedInForecast ? "да" : "нет"}</td>}
                          </tr>
                        )))}
                      </tbody>
                    </table>
                  </div>
                </details>
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
                    <tr key={item.article}><td className="px-4 py-2 font-medium">{item.article}</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(item.planRevenue)}</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(item.actualRevenue)}</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(item.projectedRevenue)}</td><td className="px-4 py-2 text-right tabular-nums">{item.payoutRate === null ? "Нет данных" : <>{(item.payoutRate * 100).toFixed(1)}%<span className="block text-[10px] text-slate-400">{item.payoutRateSource === "financial_report" ? "по отчётам" : "по юнит-экономике"}</span></>}</td><td className="px-4 py-2 text-right font-semibold tabular-nums">{item.forecastPayout === null ? "—" : formatMoney(item.forecastPayout)}</td></tr>
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
