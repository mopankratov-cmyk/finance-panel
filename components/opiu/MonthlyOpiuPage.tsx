"use client";

import { FinanceTabs } from "@/components/FinanceTabs";
import { Hint } from "@/components/ui/Hint";
import { formatPct, formatRub } from "@/lib/analytics/format";
import { buildMonthlyOpiuStatement, type MonthlyOpiuAmount, type MonthlyOpiuRow, type MonthlyOpiuStatus } from "@/lib/opiu/monthlyStatement";
import { buildMonthlyOpiuSheetPayload, exportMonthlyOpiuToGoogleSheets } from "@/lib/opiu/monthlySheetExport";
import { Check, ExternalLink, FileSpreadsheet, LineChart, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

interface MonthlyOpiuResponse {
  period: { from: string; to: string; month: string };
  wb?: Parameters<typeof buildMonthlyOpiuStatement>[0]["wb"];
  ozon?: Parameters<typeof buildMonthlyOpiuStatement>[0]["ozon"];
  error?: string;
}

interface MonthlyFactsResponse {
  shared?: Parameters<typeof buildMonthlyOpiuStatement>[0]["shared"];
  warnings?: string[];
  error?: string;
}

interface MonthlyOpiuData extends MonthlyOpiuResponse {
  shared?: MonthlyFactsResponse["shared"];
  warnings?: string[];
}

const STATUS_LABELS: Record<Exclude<MonthlyOpiuStatus, "na">, string> = {
  complete: "Полные данные",
  partial: "Частично",
  missing: "Нет данных",
};

function currentMonthParam(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date(year, monthNumber - 1, 1));
}

function visibleAmount(amount: MonthlyOpiuAmount, row: MonthlyOpiuRow): string {
  if (amount.status === "na" || amount.status === "missing") return "—";
  const value = amount.value ?? amount.known;
  return row.kind === "percent" ? formatPct(value) : formatRub(value);
}

function AmountCell({ amount, row, label }: { amount: MonthlyOpiuAmount; row: MonthlyOpiuRow; label: string }) {
  const incomplete = amount.status === "partial";
  return (
    <td data-label={label} className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums ${incomplete ? "text-amber-700" : "text-slate-800"}`}>
      <span>{visibleAmount(amount, row)}</span>
      {incomplete && amount.note ? (
        <Hint label={`${row.label}: данные учтены частично`} className="ml-1 align-middle text-amber-500">
          {amount.note}
        </Hint>
      ) : null}
    </td>
  );
}

function KpiValue({ amount, percent = false }: { amount: MonthlyOpiuAmount; percent?: boolean }) {
  if (amount.value != null) return <>{percent ? formatPct(amount.value) : formatRub(amount.value)}</>;
  return (
    <>
      <span>—</span>
      {amount.known !== 0 ? (
        <span className="mt-1 block text-xs font-medium text-amber-700">По известным статьям: {percent ? formatPct(amount.known) : formatRub(amount.known)}</span>
      ) : null}
    </>
  );
}

export function MonthlyOpiuPage() {
  const [month, setMonth] = useState(currentMonthParam);
  const [data, setData] = useState<MonthlyOpiuData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportedUrl, setExportedUrl] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ month });
    setLoading(true);
    setError(null);
    setExportedUrl(null);
    Promise.all([
      fetch(`/api/opiu/mp?${params}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const json = await response.json() as MonthlyOpiuResponse;
          if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
          return json;
        }),
      fetch(`/api/opiu/monthly-facts?month=${encodeURIComponent(month)}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const json = await response.json() as MonthlyFactsResponse;
          if (!response.ok) return { shared: {}, warnings: [json.error ?? `HTTP ${response.status}`] } satisfies MonthlyFactsResponse;
          return json;
        }),
    ])
      .then(([marketplaces, facts]) => ({ ...marketplaces, shared: facts.shared, warnings: facts.warnings }))
      .then(setData)
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setData(null);
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить ОПиУ");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [month]);

  const statement = useMemo(() => data ? buildMonthlyOpiuStatement({ wb: data.wb, ozon: data.ozon, shared: data.shared }) : null, [data]);

  const handleExport = async () => {
    if (!statement) return;
    setExporting(true);
    setExportError(null);
    setExportedUrl(null);
    try {
      const payload = buildMonthlyOpiuSheetPayload(statement, {
        monthLabel: monthLabel(month),
        generatedAt: new Date().toLocaleString("ru-RU"),
      });
      const result = await exportMonthlyOpiuToGoogleSheets(payload);
      setExportedUrl(result.spreadsheetUrl ?? null);
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : "Не удалось выгрузить ОПиУ");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:py-8">
      <FinanceTabs />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
          <LineChart className="h-5 w-5" />
        </div>
        <div className="min-w-[180px] flex-1">
          <h1 className="text-2xl font-bold text-slate-900">ОПиУ</h1>
          <p className="text-sm text-slate-500">Управленческий отчёт о доходах и расходах за месяц</p>
        </div>
        <label className="flex min-w-40 flex-col gap-1 text-sm font-medium text-slate-500">
          Месяц
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value || currentMonthParam())}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={!statement || exporting}
          className="flex min-h-11 items-center gap-2 rounded-lg border border-emerald-300 bg-white px-4 text-sm font-semibold text-emerald-700 shadow-sm transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
          Google Таблица
        </button>
      </div>

      {exportError ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{exportError}</div> : null}
      {data?.warnings?.length ? <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Часть общих расходов не загружена: {data.warnings.join("; ")}</div> : null}
      {exportedUrl ? (
        <a href={exportedUrl} target="_blank" rel="noreferrer" className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <Check className="h-4 w-4" /> ОПиУ выгружен в Google Таблицу <ExternalLink className="ml-auto h-4 w-4" />
        </a>
      ) : null}

      {statement ? (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Выручка</div><div className="mt-1 text-2xl font-extrabold text-slate-900"><KpiValue amount={statement.revenue} /></div></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">EBITDA</div><div className="mt-1 text-2xl font-extrabold text-slate-900"><KpiValue amount={statement.ebitda} /></div></div>
          <div className="rounded-xl border border-red-200 bg-red-50/40 p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Чистая прибыль</div><div className="mt-1 text-2xl font-extrabold text-slate-900"><KpiValue amount={statement.netProfit} /></div></div>
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Полнота статей</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{statement.coverage.complete} из {statement.coverage.total}</div><div className="mt-1 text-xs text-amber-800">Частично: {statement.coverage.partial} · нет данных: {statement.coverage.missing}</div></div>
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white py-20 text-center text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-8 text-center text-sm text-red-700">{error}</div>
      ) : statement ? (
        <div className="scroll-x rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-[1120px] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300 bg-[#434343] text-[#ffd966]">
                <th className="sticky left-0 z-20 min-w-[290px] bg-[#434343] px-4 py-3 text-left font-bold">Статья</th>
                <th className="w-[120px] px-3 py-3 text-right">WB</th>
                <th className="w-[120px] px-3 py-3 text-right">Ozon</th>
                <th className="w-[120px] px-3 py-3 text-right">Общие</th>
                <th className="w-[145px] px-3 py-3 text-right">Итого</th>
                <th className="w-[220px] px-3 py-3 text-left">Источник</th>
                <th className="w-[120px] px-3 py-3 text-left">Полнота</th>
              </tr>
            </thead>
            <tbody>
              {statement.rows.map((row, index) => {
                if (row.kind === "section") return (
                  <tr key={row.id} className="border-y border-amber-400 bg-amber-300 text-slate-900">
                    <td colSpan={7} className="bg-amber-300 px-4 py-2 font-bold uppercase tracking-wide"><span className="sticky left-4 inline-block">{row.label}</span></td>
                  </tr>
                );
                const resultRow = row.kind === "result";
                const subtotalRow = row.kind === "subtotal";
                const percentRow = row.kind === "percent";
                const background = resultRow ? "bg-red-100" : subtotalRow ? "bg-amber-50" : index % 2 ? "bg-slate-50" : "bg-white";
                const total = row.amounts.total;
                return (
                  <tr key={row.id} className={`border-b border-slate-100 ${background} ${resultRow ? "font-bold" : subtotalRow ? "font-semibold" : ""}`}>
                    <td data-cell="title" className={`sticky left-0 z-10 min-w-[290px] px-4 ${percentRow ? "py-1.5 text-xs text-slate-500" : "py-2.5"} ${background}`}>
                      <span>{row.label}</span>
                      {row.description ? <Hint label={`Описание статьи «${row.label}»`} className="ml-1">{row.description}</Hint> : null}
                    </td>
                    <AmountCell amount={row.amounts.wb} row={row} label="WB" />
                    <AmountCell amount={row.amounts.ozon} row={row} label="Ozon" />
                    <AmountCell amount={row.amounts.shared} row={row} label="Общие" />
                    <td data-label="Итого" className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums ${total.status === "partial" ? "text-amber-700" : "text-slate-900"}`}>
                      {total.value != null ? visibleAmount(total, row) : "—"}
                      {total.status === "partial" && total.known !== 0 ? <span className="block text-[10px] font-medium text-amber-700">известно: {percentRow ? formatPct(total.known) : formatRub(total.known)}</span> : null}
                    </td>
                    <td data-label="Источник" className="px-3 py-2.5 text-xs text-slate-500">{row.source ?? "Расчёт"}</td>
                    <td data-label="Полнота" className="px-3 py-2.5 text-xs">
                      {total.status === "na" ? "—" : (
                        <span className={`inline-flex rounded-full px-2 py-1 font-medium ${total.status === "complete" ? "bg-emerald-100 text-emerald-700" : total.status === "partial" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500"}`}>
                          {STATUS_LABELS[total.status]}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-slate-500">Пустая сумма означает, что источник не подключён или не дал полный факт. Числа с пометкой «частично» не используются как окончательный финансовый результат.</p>
    </div>
  );
}
