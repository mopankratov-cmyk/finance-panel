"use client";

import { FinanceTabs } from "@/components/FinanceTabs";
import { ActionableError } from "@/components/ui/ActionableError";
import { Hint } from "@/components/ui/Hint";
import { LoadingBanner, useElapsedSeconds } from "@/components/ui/LoadingState";
import { formatPct, formatRub } from "@/lib/analytics/format";
import { buildMonthlyOpiuStatement, type MonthlyOpiuAmount, type MonthlyOpiuRow } from "@/lib/opiu/monthlyStatement";
import type { OpiuCompanyOption } from "@/lib/opiu/companyScope";
import { buildMonthlyOpiuSheetPayload, exportMonthlyOpiuToGoogleSheets } from "@/lib/opiu/monthlySheetExport";
import type { MonthlySourceResult } from "@/lib/opiu/monthlySourceFallback";
import { aggregateOzonSources, aggregateWbSources, filterMonthlySources, monthlyBrandOptions, type MonthlyMarketplaceSource } from "@/lib/opiu/monthlyMarketplaceSources";
import { combineMonthlyCompanyFacts, monthlyTaxSettingGaps, withCalculatedMonthlyTaxes } from "@/lib/opiu/monthlyTaxFacts";
import { AlertTriangle, Check, ExternalLink, FileSpreadsheet, LineChart, Loader2, RefreshCw, Settings } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface MonthlyOpiuResponse {
  period: { from: string; to: string; month: string };
  wb?: Parameters<typeof buildMonthlyOpiuStatement>[0]["wb"];
  ozon?: Parameters<typeof buildMonthlyOpiuStatement>[0]["ozon"];
  sources?: MonthlyMarketplaceSource[];
  warnings?: string[];
  error?: string;
}

interface MonthlyFactsResponse {
  shared?: Parameters<typeof buildMonthlyOpiuStatement>[0]["shared"];
  companies?: OpiuCompanyOption[];
  warnings?: string[];
  byCompany?: Record<string, NonNullable<MonthlyFactsResponse["shared"]>>;
  error?: string;
}

interface MonthlyOpiuData extends Omit<MonthlyOpiuResponse, "period"> {
  shared?: MonthlyFactsResponse["shared"];
  companies?: OpiuCompanyOption[];
  warnings?: string[];
  byCompany?: MonthlyFactsResponse["byCompany"];
}

const MONTH_CACHE_TTL_MS = 5 * 60 * 1000;
const monthlyOpiuMemoryCache = new Map<string, { savedAt: number; data: MonthlyOpiuData }>();

function cachedMonth(month: string): MonthlyOpiuData | null {
  const cached = monthlyOpiuMemoryCache.get(month);
  if (!cached || Date.now() - cached.savedAt > MONTH_CACHE_TTL_MS) {
    monthlyOpiuMemoryCache.delete(month);
    return null;
  }
  return cached.data;
}

function combineMonthlyData(
  marketplace: MonthlyOpiuResponse | null,
  facts: MonthlyFactsResponse | null,
  fallback: MonthlyOpiuData | null,
  extraWarnings: readonly string[] = [],
): MonthlyOpiuData | null {
  if (!marketplace && !facts && !fallback) return null;
  return {
    ...(fallback ?? {}),
    ...(marketplace ?? {}),
    shared: facts?.shared ?? fallback?.shared,
    companies: facts?.companies ?? fallback?.companies,
    byCompany: facts?.byCompany ?? fallback?.byCompany,
    warnings: [...new Set([
      ...(marketplace?.warnings ?? fallback?.warnings ?? []),
      ...(facts?.warnings ?? []),
      ...extraWarnings,
    ])],
  };
}

async function loadSource<T>(url: string, signal: AbortSignal): Promise<MonthlySourceResult<T>> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    const json = await response.json().catch(() => null) as (T & { error?: string }) | null;
    if (!response.ok || !json) return { data: null, error: json?.error ?? `HTTP ${response.status}` };
    return { data: json, error: null };
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "AbortError") throw reason;
    return { data: null, error: reason instanceof Error ? reason.message : "Источник временно недоступен" };
  }
}

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
  const value = amount.value ?? (amount.status === "partial" ? amount.known : null);
  if (value == null) return "—";
  return row.kind === "percent" ? formatPct(value) : formatRub(value);
}

function hasVisibleAmount(amount: MonthlyOpiuAmount): boolean {
  return amount.value != null || (amount.status === "partial" && amount.known != null);
}

function AmountCell({ amount, row, label }: { amount: MonthlyOpiuAmount; row: MonthlyOpiuRow; label: string }) {
  const showCalculationHint = amount.note && ["taxes", "vat", "loan_interest"].includes(row.id);
  return (
    <td data-label={label} className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums text-slate-800">
      <span className="inline-flex items-center justify-end gap-1">
        {visibleAmount(amount, row)}
        {showCalculationHint ? <Hint label={`Пояснение к сумме «${row.label}», ${label}`}>{amount.note}</Hint> : null}
      </span>
    </td>
  );
}

function KpiValue({ amount, percent = false }: { amount: MonthlyOpiuAmount; percent?: boolean }) {
  const value = amount.value ?? (amount.status === "partial" ? amount.known : null);
  return <>{value == null ? "—" : percent ? formatPct(value) : formatRub(value)}</>;
}

export function MonthlyOpiuPage() {
  const [month, setMonth] = useState(currentMonthParam);
  const [companyId, setCompanyId] = useState("");
  const [brand, setBrand] = useState("");
  const [data, setData] = useState<MonthlyOpiuData | null>(null);
  const [marketplaceLoading, setMarketplaceLoading] = useState(true);
  const [factsLoading, setFactsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportedUrl, setExportedUrl] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const loading = marketplaceLoading || factsLoading;
  const elapsed = useElapsedSeconds(loading);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const params = new URLSearchParams({ month });
    const fallback = cachedMonth(month);
    let marketplaceResult: MonthlyOpiuResponse | null = null;
    let factsResult: MonthlyFactsResponse | null = null;
    let marketplaceError: string | null = null;
    let factsError: string | null = null;
    let settled = 0;

    setData(fallback);
    setMarketplaceLoading(true);
    setFactsLoading(true);
    setError(null);
    setExportedUrl(null);

    const publish = () => {
      if (!active) return;
      const warnings = [marketplaceError, factsError].filter((value): value is string => Boolean(value));
      const next = combineMonthlyData(marketplaceResult, factsResult, fallback, warnings);
      if (next) setData(next);
      if (settled !== 2) return;
      if (!marketplaceResult && !factsResult && !fallback) {
        setError(warnings.join(". ") || "Не удалось загрузить ОПиУ");
        return;
      }
      if (next && marketplaceResult && factsResult) {
        monthlyOpiuMemoryCache.set(month, { savedAt: Date.now(), data: next });
      }
    };

    void loadSource<MonthlyOpiuResponse>(`/api/opiu/mp?${params}`, controller.signal)
      .then((result) => {
        marketplaceResult = result.data;
        marketplaceError = result.error;
        settled += 1;
        if (active) setMarketplaceLoading(false);
        publish();
      })
      .catch((reason) => {
        if (!active || (reason instanceof DOMException && reason.name === "AbortError")) return;
        marketplaceError = reason instanceof Error ? reason.message : "Источник маркетплейсов временно недоступен";
        settled += 1;
        setMarketplaceLoading(false);
        publish();
      });

    void loadSource<MonthlyFactsResponse>(`/api/opiu/monthly-facts?${params}`, controller.signal)
      .then((result) => {
        factsResult = result.data;
        factsError = result.error;
        settled += 1;
        if (active) setFactsLoading(false);
        publish();
      })
      .catch((reason) => {
        if (!active || (reason instanceof DOMException && reason.name === "AbortError")) return;
        factsError = reason instanceof Error ? reason.message : "Общие расходы временно недоступны";
        settled += 1;
        setFactsLoading(false);
        publish();
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [month, reloadKey]);

  const selectedData = useMemo<MonthlyOpiuData | null>(() => {
    if (!data) return null;
    const selectedSources = filterMonthlySources(data.sources ?? [], { companyId, brand });
    const wbSources = selectedSources.filter((source) => source.marketplace === "wb");
    const ozonSources = selectedSources.filter((source) => source.marketplace === "ozon");
    const wb = wbSources.length ? aggregateWbSources(wbSources) : undefined;
    const ozon = ozonSources.length ? aggregateOzonSources(ozonSources) : undefined;
    // Общие расходы нельзя честно приписать отдельному бренду без правила распределения.
    let shared = brand ? undefined : companyId ? data.byCompany?.[companyId] : data.shared;
    const company = data.companies?.find((item) => item.id === companyId);
    const preliminary = buildMonthlyOpiuStatement({ wb, ozon, shared });
    if (!companyId && !brand) {
      const perCompany = (data.companies ?? []).map((item) => {
        const companySources = (data.sources ?? []).filter((source) => source.companyId === item.id);
        const companyWbSources = companySources.filter((source) => source.marketplace === "wb");
        const companyOzonSources = companySources.filter((source) => source.marketplace === "ozon");
        const companyWb = companyWbSources.length ? aggregateWbSources(companyWbSources) : undefined;
        const companyOzon = companyOzonSources.length ? aggregateOzonSources(companyOzonSources) : undefined;
        const companyShared = data.byCompany?.[item.id];
        const companyStatement = buildMonthlyOpiuStatement({ wb: companyWb, ozon: companyOzon, shared: companyShared });
        return withCalculatedMonthlyTaxes({
          company: item,
          marketplaceTaxBase: (companyWb?.revenue_after_spp ?? 0) + (companyOzon?.revenue ?? 0),
          ebitda: companyStatement.ebitda.known,
          shared: companyShared,
        });
      });
      const combined = { ...(shared ?? {}) };
      for (const id of ["taxes", "vat"] as const) {
        const fact = combineMonthlyCompanyFacts(perCompany.map((facts) => facts?.[id]));
        if (fact) combined[id] = fact;
      }
      shared = combined;
    }
    const calculatedShared = companyId && !brand ? withCalculatedMonthlyTaxes({
      company,
      marketplaceTaxBase: (wb?.revenue_after_spp ?? 0) + (ozon?.revenue ?? 0),
      ebitda: preliminary.ebitda.known,
      shared,
    }) : shared;
    return { ...data, wb, ozon, shared: calculatedShared, sources: selectedSources };
  }, [brand, companyId, data]);
  const statement = useMemo(() => selectedData ? buildMonthlyOpiuStatement({ wb: selectedData.wb, ozon: selectedData.ozon, shared: selectedData.shared }) : null, [selectedData]);
  const sourceColumns = useMemo(() => {
    if (!selectedData) return [];
    const sources: MonthlyMarketplaceSource[] = selectedData.sources?.length ? [...selectedData.sources] : [];
    if (!selectedData.sources?.length && selectedData.wb) sources.push({ id: "wb", label: "WB", marketplace: "wb", wb: selectedData.wb });
    if (!selectedData.sources?.length && selectedData.ozon) sources.push({ id: "ozon", label: "Ozon", marketplace: "ozon", ozon: selectedData.ozon });
    return sources.map((source) => ({
      id: source.id,
      label: source.label,
      direction: source.marketplace,
      statement: buildMonthlyOpiuStatement(source.marketplace === "wb" ? { wb: source.wb } : { ozon: source.ozon }),
    }));
  }, [selectedData]);
  const companies = useMemo(() => data?.companies ?? [], [data?.companies]);
  const brandOptions = useMemo(() => monthlyBrandOptions(data?.sources ?? [], companyId), [companyId, data?.sources]);
  const selectedCompanyLabel = companies.find((company) => company.id === companyId)?.name ?? "Все компании";
  const selectedScopeLabel = brand ? `${selectedCompanyLabel} · ${brand}` : selectedCompanyLabel;

  useEffect(() => {
    if (brand && !brandOptions.includes(brand)) setBrand("");
  }, [brand, brandOptions]);
  const companiesWithTaxGaps = useMemo(() => {
    const relevant = companyId ? companies.filter((company) => company.id === companyId) : companies;
    return relevant
      .map((company) => ({ company, gaps: monthlyTaxSettingGaps(company) }))
      .filter((item) => item.gaps.length > 0);
  }, [companies, companyId]);

  const handleExport = async () => {
    if (!statement) return;
    setExporting(true);
    setExportError(null);
    setExportedUrl(null);
    try {
      const payload = buildMonthlyOpiuSheetPayload(statement, {
        monthKey: month,
        monthLabel: monthLabel(month),
        generatedAt: new Date().toLocaleString("ru-RU"),
        companyKey: `${companyId || "all"}:${brand || "all"}`,
        companyLabel: selectedScopeLabel,
        columns: sourceColumns,
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
    <div className="mx-auto max-w-[1600px] px-3 py-4 sm:px-4 lg:py-5">
      <FinanceTabs />
      <div className="mb-4 flex flex-wrap items-end gap-2.5">
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
        <label className="flex min-w-56 flex-col gap-1 text-sm font-medium text-slate-500">
          Компания
          <select
            value={companyId}
            onChange={(event) => {
              setCompanyId(event.target.value);
              setBrand("");
            }}
            className="min-h-11 cursor-pointer rounded-lg border border-slate-300 bg-white px-3 text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="">Все компании</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
        </label>
        <label className="flex min-w-44 flex-col gap-1 text-sm font-medium text-slate-500">
          Бренд
          <select
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
            disabled={brandOptions.length === 0}
            className="min-h-11 cursor-pointer rounded-lg border border-slate-300 bg-white px-3 text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">Все бренды</option>
            {brandOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={!statement || loading || exporting}
          className="flex min-h-11 items-center gap-2 rounded-lg border border-emerald-300 bg-white px-4 text-sm font-semibold text-emerald-700 shadow-sm transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
          Google Таблица
        </button>
      </div>

      {loading ? <LoadingBanner seconds={elapsed} hint={marketplaceLoading ? "продажи маркетплейсов" : "общие расходы"} /> : null}

      {brand ? (
        <div role="status" className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          Показан бренд <b>{brand}</b>. Общие расходы не распределены по брендам и в этот срез не включены.
        </div>
      ) : null}

      {exportError ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{exportError}</div> : null}
      {exportedUrl ? (
        <a href={exportedUrl} target="_blank" rel="noreferrer" className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <Check className="h-4 w-4" /> ОПиУ выгружен в Google Таблицу <ExternalLink className="ml-auto h-4 w-4" />
        </a>
      ) : null}

      {!loading && (data?.warnings ?? []).map((warning) => (
        <ActionableError
          key={warning}
          message={warning}
          label="ОПиУ"
          onRetry={() => setReloadKey((value) => value + 1)}
          compact
          tone="amber"
          className="mb-3"
        />
      ))}

      {!factsLoading && companiesWithTaxGaps.length > 0 ? (
        <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Налог и НДС рассчитаны не полностью</p>
              <ul className="mt-1 space-y-0.5 text-xs leading-5 text-amber-900/80">
                {companiesWithTaxGaps.map(({ company, gaps }) => (
                  <li key={company.id}><span className="font-semibold">{company.name}:</span> не настроены {gaps.join(", ")}.</li>
                ))}
              </ul>
            </div>
            <Link href="/payments?companies=1" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
              <Settings className="h-4 w-4" /> Настройки компаний
            </Link>
          </div>
        </div>
      ) : null}

      {statement ? (
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Выручка</div><div className="mt-0.5 text-xl font-extrabold text-slate-900"><KpiValue amount={statement.revenue} /></div></div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">EBITDA</div><div className="mt-0.5 text-xl font-extrabold text-slate-900"><KpiValue amount={statement.ebitda} /></div></div>
          <div className="rounded-lg border border-red-200 bg-red-50/40 px-3 py-2.5 shadow-sm"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Чистая прибыль</div><div className="mt-0.5 text-xl font-extrabold text-slate-900"><KpiValue amount={statement.netProfit} /></div></div>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="rounded-xl border border-slate-200 bg-white py-20 text-center text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
      ) : error ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-8 text-center text-sm text-red-700">
          <p>{error}</p>
          <button type="button" onClick={() => setReloadKey((value) => value + 1)} className="mx-auto mt-4 inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-red-300 bg-white px-4 font-semibold text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
            <RefreshCw className="h-4 w-4" />Повторить
          </button>
        </div>
      ) : statement ? (
        <div className="scroll-x rounded-xl border border-slate-200 bg-white shadow-sm">
          <table
            className="w-full table-fixed border-collapse text-xs"
            style={{ minWidth: `${Math.max(620, 180 + Math.max(sourceColumns.length, 1) * 82 + 96)}px` }}
          >
            <colgroup>
              <col className="w-[180px]" />
              {sourceColumns.length
                ? sourceColumns.map((source) => <col key={source.id} className="w-[82px]" />)
                : <col className="w-[82px]" />}
              <col className="w-[96px]" />
            </colgroup>
            <thead>
              <tr className="border-b border-slate-300 bg-[#434343] text-[#ffd966]">
                <th className="sticky left-0 z-20 w-[180px] bg-[#434343] px-2.5 py-2 text-left text-xs font-bold">Статья</th>
                {sourceColumns.length
                  ? sourceColumns.map((source) => <th key={source.id} className="w-[82px] break-words px-1 py-2 text-right text-[10px] leading-3.5">{source.label}</th>)
                  : <th className="w-[82px] px-1 py-2 text-center text-[10px]">Направления</th>}
                <th className="w-[96px] px-1.5 py-2 text-right text-[11px]">Итого</th>
              </tr>
            </thead>
            <tbody>
              {statement.rows.map((row, index) => {
                if (row.kind === "section") return (
                  <tr key={row.id} className="border-y border-amber-400 bg-amber-300 text-slate-900">
                    <td colSpan={Math.max(sourceColumns.length, 1) + 2} className="bg-amber-300 px-3 py-1.5 font-bold uppercase tracking-wide"><span className="sticky left-3 inline-block">{row.label}</span></td>
                  </tr>
                );
                const resultRow = row.kind === "result";
                const subtotalRow = row.kind === "subtotal";
                const percentRow = row.kind === "percent";
                const background = resultRow ? "bg-red-100" : subtotalRow ? "bg-amber-50" : index % 2 ? "bg-slate-50" : "bg-white";
                const total = row.amounts.total;
                const sourceRows = sourceColumns.map((source) => ({
                  source,
                  row: source.statement.rows.find((candidate) => candidate.id === row.id),
                }));
                const sharedOnly = hasVisibleAmount(row.amounts.shared) && !sourceRows.some((item) => (
                  item.row ? hasVisibleAmount(item.row.amounts[item.source.direction]) : false
                ));
                return (
                  <tr key={row.id} className={`border-b border-slate-100 ${background} ${resultRow ? "font-bold" : subtotalRow ? "font-semibold" : ""}`}>
                    <td data-cell="title" className={`sticky left-0 z-10 w-[180px] px-2.5 ${percentRow ? "py-1 text-[11px] text-slate-500" : "py-1.5"} ${background}`}>
                      <span>{row.label}</span>
                      {row.description ? <Hint label={`Описание статьи «${row.label}»`} className="ml-1">{row.description}</Hint> : null}
                    </td>
                    {sharedOnly ? (
                      <td colSpan={Math.max(sourceColumns.length, 1)} data-label="Общие расходы" className="px-2 py-1.5 text-center tabular-nums text-slate-700">
                        <span className="inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-100 px-2 py-1">
                          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Общие расходы</span>
                          <b>{visibleAmount(row.amounts.shared, row)}</b>
                          {row.amounts.shared.note && ["taxes", "vat", "loan_interest"].includes(row.id)
                            ? <Hint label={`Пояснение к сумме «${row.label}»`}>{row.amounts.shared.note}</Hint>
                            : null}
                        </span>
                      </td>
                    ) : sourceRows.length ? sourceRows.map(({ source, row: sourceRow }) => (
                      sourceRow
                        ? <AmountCell key={source.id} amount={sourceRow.amounts[source.direction]} row={sourceRow} label={source.label} />
                        : <td key={source.id} data-label={source.label} className="px-1.5 py-1.5 text-right text-slate-400">—</td>
                    )) : (
                      <td data-label="Направления" className="px-1.5 py-1.5 text-center text-slate-400">—</td>
                    )}
                    <AmountCell amount={total} row={row} label="Итого" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
