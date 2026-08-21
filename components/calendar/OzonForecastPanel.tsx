"use client";

import { BarChart3, CalendarPlus, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { formatMoney } from "@/lib/format";
import type { PayoutReport } from "@/lib/opiu/payoutReconciliation";
import { readForecastJson } from "@/lib/opiu/forecastRequest";
import type { Account } from "@/lib/types";
import type { DdsCompany } from "@/components/payments/ddsCompanies";
import { publishForecastToCalendar } from "./forecastPublication";
import { BrowserPayoutSnapshotsPanel } from "./BrowserPayoutSnapshotsPanel";
import { browserPayoutsByScheduleId, resolveBrowserPayoutReportId, type BrowserPayoutSnapshot } from "@/lib/opiu/browserPayoutSnapshots";
import { payoutReportKey } from "@/lib/opiu/payoutReconciliation";

type PayoutMode = "standard" | "weekly";

interface ForecastData {
  cabinetId: string;
  companyId: string;
  companyName: string;
  receivingAccountId: string;
  cabinets: { id: string; name: string }[];
  planRows: number;
  planSource: "approved_sales_plan" | "working_sales_plan" | "none";
  planRevenue: number;
  plannedOrders: number;
  actualOrders: number;
  actualRevenue: number;
  actualDataStatus: "available" | "not_started" | "degraded";
  expectedPayout: number | null;
  actualPayout: number | null;
  remainingPayout: number | null;
  unallocatedForecastPayout: number | null;
  reportDataStatus: "available" | "degraded" | "not_selected";
  reconciliationDataStatus: "available" | "degraded" | "not_selected";
  forecastDataStatus: "available" | "degraded";
  plannedPositiveRevenueRows: number;
  plannedPositiveRevenue: number;
  coveredPositiveRevenueRows: number;
  coveredPositiveRevenue: number;
  unitEconomyFallbackUsed: boolean;
  unitEconomySnapshotAt: string | null;
  preliminaryOnly: boolean;
  confirmedPayouts: PayoutReport[];
  payoutSchedule: {
    id: string;
    date: string;
    amount: number;
    source: "forecast" | "financial_report";
  }[];
  reconciliationQueue: {
    bankReceiptId: string;
    reason: "ambiguous" | "partial" | "unlinked" | "over_allocation";
    amount?: number;
    date: string;
    name: string;
    paymentAmount: number;
  }[];
  warnings: string[];
  dataNotices: string[];
  error?: string;
}

export function OzonForecastPanel({
  year,
  month,
  accounts,
  companies,
}: {
  year: number;
  month: number;
  accounts: Account[];
  companies: DdsCompany[];
}) {
  const [cabinetId, setCabinetId] = useState("");
  const [calculatedCabinetId, setCalculatedCabinetId] = useState("");
  const [calculationVersion, setCalculationVersion] = useState(0);
  const [mode, setMode] = useState<PayoutMode>("standard");
  const [data, setData] = useState<ForecastData | null>(null);
  const [cabinetOptions, setCabinetOptions] = useState<ForecastData["cabinets"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accountId, setAccountId] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [browserPayouts, setBrowserPayouts] = useState<BrowserPayoutSnapshot[]>([]);

  useEffect(() => {
    if (!data?.receivingAccountId) return;
    if (accounts.some((account) => account.id === data.receivingAccountId)) {
      setAccountId(data.receivingAccountId);
    }
  }, [accounts, data?.receivingAccountId]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setCabinetOptions([]);
    setData(null);
    setError("");
    setLoading(true);
    const query = new URLSearchParams({
      year: String(year),
      month: String(month + 1),
      mode,
    });
    fetch(`/api/opiu/ozon-forecast?${query}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => readForecastJson<{ cabinets: ForecastData["cabinets"] }>(
        response,
        "Не удалось загрузить список магазинов Ozon",
      ))
      .then((result) => {
        if (cancelled) return;
        setCabinetOptions(result.cabinets);
        setLoading(false);
      })
      .catch((requestError) => {
        if (cancelled || requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить список магазинов Ozon");
        setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [year, month, mode]);

  useEffect(() => {
    if (!calculatedCabinetId) return;
    const query = new URLSearchParams({
      year: String(year),
      month: String(month + 1),
      mode,
      cabinet: calculatedCabinetId,
    });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 55_000);
    let cancelled = false;

    setData(null);
    setError("");
    setLoading(true);
    fetch(`/api/opiu/ozon-forecast?${query}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await readForecastJson<ForecastData>(
          response,
          "Не удалось рассчитать прогноз Ozon",
        );
        if (cancelled) return;
        setCabinetOptions(result.cabinets);
        if (result.cabinetId === calculatedCabinetId) {
          setData(result);
          setLoading(false);
          return;
        }
        throw new Error(
          "Ответ API не соответствует выбранному кабинету или компании",
        );
      })
      .catch((requestError) => {
        if (
          requestError instanceof DOMException
          && requestError.name === "AbortError"
        ) {
          if (!cancelled) {
            setError("Расчёт занял слишком много времени. Повторите запрос через минуту.");
            setLoading(false);
          }
          return;
        }
        if (cancelled) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Не удалось рассчитать прогноз Ozon",
        );
        setLoading(false);
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [year, month, mode, calculatedCabinetId, calculationVersion]);

  const actualMetricsUnavailable = data?.actualDataStatus !== "available";
  const providerDataUnavailable = data
    ? data.forecastDataStatus === "degraded"
      || data.reportDataStatus === "degraded"
      || data.actualDataStatus === "degraded"
    : false;

  return (
    <Card>
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
          <BarChart3 className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-semibold text-slate-900">Прогноз поступлений Ozon</h2>
          <p className="text-sm text-slate-500">Отчёты, расчётный график и сверка банковских фактов.</p>
        </div>
      </div>
      <CardContent className="space-y-4 pt-5">
        <p className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
          Проверьте кабинет, компанию, счёт и суммы. Календарь изменится только после отдельного подтверждения.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm text-slate-700">
            Кабинет
            <select
              value={cabinetId}
              onChange={(event) => {
                setCabinetId(event.target.value);
                setCalculatedCabinetId("");
                setData(null);
                setError("");
              }}
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3"
            >
              <option value="">Выберите магазин</option>
              {cabinetOptions.map((cabinet) => (
                <option key={cabinet.id} value={cabinet.id}>{cabinet.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Компания-получатель
            <div className="mt-1 flex min-h-11 w-full items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-slate-900">
              {data?.companyName ?? "Определяется по кабинету"}
            </div>
          </label>
          <label className="text-sm text-slate-700">
            Правило preview
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as PayoutMode)}
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3"
            >
              <option value="standard">Стандартный график</option>
              <option value="weekly">Еженедельный график</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          disabled={!cabinetId || loading}
          onClick={() => {
            setError("");
            setData(null);
            setCalculatedCabinetId(cabinetId);
            setCalculationVersion((value) => value + 1);
          }}
          className="min-h-11 rounded-xl bg-violet-600 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {loading && calculatedCabinetId ? "Рассчитываем…" : "Рассчитать прогноз"}
        </button>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> {calculatedCabinetId ? "Считаю прогноз Ozon…" : "Загружаю список магазинов…"}
          </div>
        ) : error ? (
          <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{error}</p>
        ) : data ? (
          <>
            {providerDataUnavailable && (
              <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="font-semibold">Ozon временно не передал все живые данные магазина.</p>
                <p className="mt-1 text-amber-900">
                  {data.preliminaryOnly
                    ? "Предварительный график рассчитан по сохранённой юнит-экономике. Подтверждённые отчёты и банковский факт появятся после восстановления API."
                    : "План заказов сохранён, но выплата и график не рассчитываются по неполным данным."}
                  {" "}Нужно проверить API-ключ этого магазина и права «Товары», «Аналитика» и «Финансы».
                </p>
              </div>
            )}
            {data.unitEconomyFallbackUsed && (
              <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                Предварительная выплата рассчитана по последнему сохранённому снимку раздела «Юнит-экономика Ozon»
                {data.unitEconomySnapshotAt ? ` от ${new Date(data.unitEconomySnapshotAt).toLocaleString("ru-RU")}` : ""}.
                {" "}После восстановления живого API расчёт обновится автоматически.
              </p>
            )}
            {data.reconciliationDataStatus === "degraded" && data.reconciliationQueue.length > 0 && (
              <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm font-bold text-rose-950">
                Итоговые суммы и расчётный график недоступны: есть поступления Ozon с неразрешённой, частичной или неоднозначной связью с отчётами.
              </p>
            )}
            {data.forecastDataStatus === "degraded" && (
              <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                Прогноз выплаты недоступен: тарифами покрыто {data.coveredPositiveRevenueRows} из {data.plannedPositiveRevenueRows} строк
                {" "}и {formatMoney(data.coveredPositiveRevenue)} из {formatMoney(data.plannedPositiveRevenue)} плановой выручки.
                Неполная сумма намеренно не показывается как итог.
              </p>
            )}
            {data.actualDataStatus === "degraded" && (
              <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                Фактические заказы и выручка пока недоступны; вместо ложного нуля показан прочерк.
              </p>
            )}
            {data.actualDataStatus === "not_started" && (
              <p className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
                Будущий месяц ещё не начался: фактические показатели пока неприменимы.
              </p>
            )}
            {data.unallocatedForecastPayout !== null && data.unallocatedForecastPayout > 0 && (
              <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
                Не распределено по будущим датам: {formatMoney(data.unallocatedForecastPayout)}. Сумма включена в остаток.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Плановая выручка" value={formatMoney(data.planRevenue)} />
              <Metric label="Фактическая выручка" value={actualMetricsUnavailable ? "—" : formatMoney(data.actualRevenue)} />
              <Metric label="Ожидаемая выплата" value={formatNullableMoney(data.expectedPayout)} />
              <Metric label="Банковский факт" value={formatNullableMoney(data.actualPayout)} />
              <Metric label="Осталось" value={formatNullableMoney(data.remainingPayout)} green />
              <Metric label="План заказов" value={`${Math.round(data.plannedOrders).toLocaleString("ru-RU")} шт.`} />
              <Metric label="Факт заказов" value={actualMetricsUnavailable ? "—" : `${Math.round(data.actualOrders).toLocaleString("ru-RU")} шт.`} />
            </div>
            {data.planRows === 0 && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                В плане Ozon нет строк за выбранный месяц.
              </p>
            )}
            <ReadOnlyTable
              title="Подтверждённые отчёты Ozon"
              headers={["Отчёт", "Период", "Расчётная дата", "Сумма"]}
              rows={data.confirmedPayouts.map((report) => [
                report.reportId,
                `${report.periodFrom}—${report.periodTo}`,
                report.estimatedReceiptDate,
                formatMoney(report.amount),
              ])}
            />
            <BrowserPayoutSnapshotsPanel marketplace="ozon" cabinetId={data.cabinetId} year={year} month={month + 1} onChange={setBrowserPayouts} />
            {browserPayouts.some((snapshot) => !resolveBrowserPayoutReportId(snapshot, data.confirmedPayouts)) && (
              <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Часть кабинетных выплат пока не удалось однозначно связать с отчётом Ozon. Они показаны для проверки, но не будут записаны в календарь.
              </p>
            )}
            {data.payoutSchedule.length > 0 && (
              <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4">
                <h3 className="font-semibold text-sky-950">Перенести прогноз Ozon в календарь</h3>
                <p className="mt-1 text-sm text-sky-800">Компания: <b>{companies.find((company) => company.id === data.companyId)?.name ?? data.companyName}</b></p>
                <label className="mt-3 block text-sm text-sky-950">Счёт получения<select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="mt-1 min-h-11 w-full max-w-md rounded-lg border border-sky-200 bg-white px-3"><option value="">Выберите счёт</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
                <button disabled={publishing || !accountId || data.planSource !== "approved_sales_plan" || !data.preliminaryOnly && (data.reportDataStatus === "degraded" || data.reconciliationDataStatus === "degraded") || data.unallocatedForecastPayout !== null && data.unallocatedForecastPayout > 0} onClick={async () => {
                  if (!confirm(`Перенести ${data.payoutSchedule.length} поступлений Ozon в платёжный календарь? Подтверждённые отчёты заменят расчётные строки.`)) return;
                  setPublishing(true);
                  try {
                    // Ключ строки графика Ozon — payoutReportKey, а не голый reportId.
                    const authoritative = browserPayoutsByScheduleId(
                      browserPayouts.filter((snapshot) => snapshot.companyId === data.companyId && snapshot.accountId === accountId),
                      data.confirmedPayouts,
                      (report) => payoutReportKey(report),
                    );
                    const result = await publishForecastToCalendar(
                      { marketplace: "ozon", cabinetId: data.cabinetId, companyId: data.companyId, accountId, year, month: month + 1 },
                      data.payoutSchedule.map((row) => {
                        const snapshot = authoritative.get(row.id);
                        return snapshot ? { key: row.id, date: snapshot.plannedDate, amount: snapshot.amount, source: "financial_report" as const, reportId: row.id, state: snapshot.state }
                          : { key: row.id || `forecast:${row.date}`, date: row.date, amount: row.amount, source: row.source, reportId: row.source === "financial_report" ? row.id : undefined };
                      }),
                    );
                    alert(`Календарь обновлён: ${result.published} строк.`);
                    window.location.reload();
                  } catch (publishError) { alert(publishError instanceof Error ? publishError.message : "Не удалось обновить календарь"); }
                  finally { setPublishing(false); }
                }} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><CalendarPlus className="h-4 w-4" />{publishing ? "Сохраняю…" : "Утвердить и перенести в календарь"}</button>
                {data.planSource !== "approved_sales_plan" && <p className="mt-2 text-xs text-amber-800">Кнопка станет доступна после утверждения плана Ozon.</p>}
              </div>
            )}
            <ReadOnlyTable
              title="Расчётный график"
              headers={["Дата", "Источник", "Сумма"]}
              rows={data.payoutSchedule.map((row) => [
                row.date,
                row.source === "financial_report" ? "Подтверждённый отчёт" : "Прогноз",
                formatMoney(row.amount),
              ])}
            />
            <ReadOnlyTable
              title="Очередь сверки"
              headers={["Платёж", "Дата", "Сумма", "Причина"]}
              rows={data.reconciliationQueue.map((row) => [
                row.name || row.bankReceiptId,
                row.date,
                formatMoney(row.paymentAmount),
                reconciliationReason(row.reason),
              ])}
            />
            {data.warnings.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <h3 className="font-semibold"><TriangleAlert className="mr-2 inline h-4 w-4" />Предупреждения</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {data.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ReadOnlyTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200">
      <h3 className="bg-slate-50 px-4 py-3 font-semibold text-slate-900">{title}</h3>
      {rows.length === 0 ? (
        <p className="border-t border-slate-200 px-4 py-3 text-sm text-slate-500">Нет данных</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-t border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>{headers.map((header) => <th key={header} className="px-4 py-2 text-left">{header}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, rowIndex) => (
                <tr key={`${title}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`} className="px-4 py-2">{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function reconciliationReason(
  reason: ForecastData["reconciliationQueue"][number]["reason"],
) {
  if (reason === "ambiguous") return "подходит несколько отчётов";
  if (reason === "partial") return "сумма распределена частично";
  if (reason === "over_allocation") return "связь превышает допустимую сумму";
  return "связь с отчётом не записана";
}

function formatNullableMoney(value: number | null) {
  return value === null ? "—" : formatMoney(value);
}

function Metric({
  label,
  value,
  green,
}: {
  label: string;
  value: string;
  green?: boolean;
}) {
  return (
    <div className={`rounded-xl p-4 ${green ? "bg-emerald-50" : "bg-slate-50"}`}>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${green ? "text-emerald-800" : "text-slate-950"}`}>{value}</p>
    </div>
  );
}
