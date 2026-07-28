"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { formatRub, formatNumber, formatPct as formatPctBase, exportCsv, addDays, toISODate } from "@/lib/analytics/format";
import type { MarginByNmRow } from "@/lib/opiu/metricsByNm";

interface MarginResponse {
  period: { from: string; to: string };
  taxRate: number;
  rows: MarginByNmRow[];
  totals: MarginByNmRow;
  timestamp: string;
  meta?: { salesRows: number; nmCount: number; storageRows: number; acceptanceRows: number; incomesRows: number };
  error?: string;
}

type Fmt = "rub" | "num" | "pct" | "text";

interface Col {
  key: keyof MarginByNmRow;
  label: string;
  fmt: Fmt;
  expense?: boolean;
  result?: boolean;
}

const COLUMNS: Col[] = [
  { key: "nmId", label: "Артикул WB", fmt: "num" },
  { key: "vendorCode", label: "Артикул поставщика", fmt: "text" },
  { key: "ordersQty", label: "Заказы, шт", fmt: "num" },
  { key: "ordersRub", label: "Заказы, руб", fmt: "rub" },
  { key: "salesQty", label: "Продажи, шт.", fmt: "num" },
  { key: "returnsQty", label: "Возвраты, шт.", fmt: "num" },
  { key: "refusalsQty", label: "Отказы, шт.", fmt: "num" },
  { key: "salesTotalQty", label: "Итого продаж", fmt: "num" },
  { key: "buyoutPct", label: "% выкупа", fmt: "pct" },
  { key: "salesRub", label: "Продажи, руб.", fmt: "rub" },
  { key: "returnsRub", label: "Возвраты, руб.", fmt: "rub" },
  { key: "revenueWithoutSpp", label: "Выручка без СПП", fmt: "rub", result: true },
  { key: "revenueAfterSpp", label: "Выручка после СПП", fmt: "rub" },
  { key: "forPay", label: "К перечислению продавцу", fmt: "rub" },
  { key: "commission", label: "Комиссия, руб", fmt: "rub", expense: true },
  { key: "commissionPct", label: "Комиссия, %", fmt: "pct" },
  { key: "deliveriesQty", label: "Доставок, шт", fmt: "num" },
  { key: "logistics", label: "Логистика, руб", fmt: "rub", expense: true },
  { key: "logisticsPerUnit", label: "Логистика на 1 ед., руб", fmt: "rub" },
  { key: "penalties", label: "Штрафы, руб.", fmt: "rub", expense: true },
  { key: "additionalPayments", label: "Доплаты, руб.", fmt: "rub", expense: true },
  { key: "storage", label: "Хранение, руб.", fmt: "rub", expense: true },
  { key: "storagePerUnit", label: "Хранение на 1 ед, руб", fmt: "rub" },
  { key: "storagePct", label: "% хранения", fmt: "pct" },
  { key: "acceptance", label: "Платная приёмка, руб.", fmt: "rub", expense: true },
  { key: "acceptancePerUnit", label: "Приёмка на 1 ед., руб", fmt: "rub" },
  { key: "transit", label: "Транзит", fmt: "rub", expense: true },
  { key: "totalToPay", label: "Итого к оплате, руб.", fmt: "rub" },
  { key: "cogs", label: "Себестоимость, руб.", fmt: "rub", expense: true },
  { key: "packaging", label: "Подготовка (упаковка/маркировка/отгрузка), руб", fmt: "rub", expense: true },
  { key: "marginalProfit", label: "Маржинальная прибыль, руб.", fmt: "rub", result: true },
  { key: "marginalPct", label: "Маржинальность, %", fmt: "pct", result: true },
  { key: "tax", label: "Налог, руб.", fmt: "rub", expense: true },
  { key: "netProfit", label: "Чистая прибыль", fmt: "rub", result: true },
  { key: "netProfitPerUnit", label: "Чистая прибыль на ед., руб.", fmt: "rub" },
  { key: "marginWithTaxPct", label: "Маржа с налогом, %", fmt: "pct", result: true },
  { key: "adsSpend", label: "Реклама", fmt: "rub", expense: true },
  { key: "marginExStoragePct", label: "Маржа без учёта хранения, %", fmt: "pct" },
];

function fmtCell(value: unknown, col: Col): string {
  if (value == null) return "—";
  if (col.fmt === "text") return String(value) || "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (col.fmt === "pct") return formatPctBase(n);
  if (col.fmt === "num") return formatNumber(n);
  return formatRub(col.expense ? Math.abs(n) : n);
}

function cellColor(value: unknown, col: Col): string {
  if (value == null || col.fmt === "text") return "text-[#1a2138]";
  const n = Number(value);
  if (!Number.isFinite(n)) return "text-[#6b7390]";
  if (col.fmt === "pct") return "text-[#6b7390]";
  if (col.expense) return n > 0 ? "text-[#d4423b]" : "text-[#1a2138]";
  if (col.result) return n > 0 ? "text-[#1f9d55] font-semibold" : n < 0 ? "text-[#d4423b] font-semibold" : "text-[#6b7390]";
  return "text-[#1a2138]";
}

function defaultPeriod() {
  const today = new Date();
  return { from: toISODate(addDays(today, -6)), to: toISODate(today) };
}

export function MarginByArticlePage() {
  const initial = defaultPeriod();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [taxPct, setTaxPct] = useState(6);
  const [data, setData] = useState<MarginResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<keyof MarginByNmRow>("revenueWithoutSpp");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const fetchReport = useCallback(async (f: string, t: string, tax: number, refresh = false) => {
    const params = new URLSearchParams({ from: f, to: t, tax: String(tax) });
    if (refresh) params.set("refresh", "1");
    const res = await fetch(`/api/opiu/margin?${params.toString()}`);
    const json = (await res.json()) as MarginResponse;
    if (!res.ok) throw new Error(json.error ?? "Ошибка загрузки");
    return json;
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchReport(from, to, taxPct)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleApply() {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchReport(from, to, taxPct));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      setData(await fetchReport(from, to, taxPct, true));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setRefreshing(false);
    }
  }

  const sortedRows = useMemo(() => {
    if (!data) return [];
    const rows = [...data.rows];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const an = typeof av === "number" ? av : String(av ?? "");
      const bn = typeof bv === "number" ? bv : String(bv ?? "");
      if (an < bn) return -1 * sortDir;
      if (an > bn) return 1 * sortDir;
      return 0;
    });
    return rows;
  }, [data, sortKey, sortDir]);

  function handleSort(key: keyof MarginByNmRow) {
    if (key === sortKey) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(-1);
    }
  }

  function handleExport() {
    if (!data) return;
    const headers = COLUMNS.map((c) => c.label);
    const rowsCsv = [
      COLUMNS.map((c) => String(data.totals[c.key] ?? "")),
      ...sortedRows.map((r) => COLUMNS.map((c) => String(r[c.key] ?? ""))),
    ];
    exportCsv(`marzha-po-artikulam_${data.period.from}_${data.period.to}.csv`, headers, rowsCsv);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[#e6e9f2] bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1 text-xs font-semibold text-[#6b7390]">
          Период с
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-[#e6e9f2] px-3 py-1.5 text-sm text-[#1a2138]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-[#6b7390]">
          по
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-[#e6e9f2] px-3 py-1.5 text-sm text-[#1a2138]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-[#6b7390]">
          Налог, %
          <input
            type="number"
            step="0.1"
            min="0"
            value={taxPct}
            onChange={(e) => setTaxPct(Number(e.target.value) || 0)}
            className="w-24 rounded-lg border border-[#e6e9f2] px-3 py-1.5 text-sm text-[#1a2138]"
          />
        </label>
        <button
          onClick={handleApply}
          disabled={loading}
          className="rounded-lg bg-[#4a3aff] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3b2ee0] disabled:opacity-60"
        >
          Показать
        </button>
        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="flex items-center gap-1.5 rounded-lg border border-[#e6e9f2] px-4 py-2 text-sm font-semibold text-[#1a2138] transition-colors hover:bg-[#fafbff] disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Обновить
        </button>
        <button
          onClick={handleExport}
          disabled={!data}
          className="rounded-lg border border-[#e6e9f2] px-4 py-2 text-sm font-semibold text-[#1a2138] transition-colors hover:bg-[#fafbff] disabled:opacity-40"
        >
          Экспорт CSV
        </button>
        {data?.meta && (
          <div className="ml-auto text-xs text-[#6b7390]">
            Артикулов: {data.meta.nmCount} · строк финотчёта: {data.meta.salesRows}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-[#fca5a5] bg-[#fff5f5] px-4 py-3 text-sm text-[#d4423b]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-24 text-[#6b7390]">
          <Loader2 className="h-5 w-5 animate-spin" />
          Загрузка…
        </div>
      ) : data ? (
        <div className="overflow-x-auto rounded-xl border border-[#e6e9f2] bg-white shadow-sm">
          <table className="w-full min-w-[3200px] border-collapse text-sm">
            <thead>
              <tr className="bg-[#fafbfd] border-b border-[#e6e9f2]">
                {COLUMNS.map((col, i) => (
                  <th
                    key={String(col.key)}
                    onClick={() => handleSort(col.key)}
                    className={`cursor-pointer select-none whitespace-nowrap px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#6b7390] hover:text-[#1a2138] ${
                      i === 0 ? "sticky left-0 z-10 bg-[#fafbfd] text-left min-w-[110px]" : ""
                    }`}
                  >
                    {col.label}
                    {sortKey === col.key ? (sortDir === 1 ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[#e6e9f2] bg-[#f8f9ff] font-bold">
                {COLUMNS.map((col, i) => (
                  <td
                    key={String(col.key)}
                    className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums ${cellColor(data.totals[col.key], col)} ${
                      i === 0 ? "sticky left-0 z-10 bg-[#f8f9ff] text-left" : ""
                    }`}
                  >
                    {i === 0 ? "Итого" : fmtCell(data.totals[col.key], col)}
                  </td>
                ))}
              </tr>
              {sortedRows.map((row) => (
                <tr key={row.nmId} className="border-b border-[#e6e9f2] transition-colors hover:bg-[#fafbff]">
                  {COLUMNS.map((col, i) => (
                    <td
                      key={String(col.key)}
                      className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums ${cellColor(row[col.key], col)} ${
                        i === 0 ? "sticky left-0 z-10 bg-inherit text-left" : ""
                      }`}
                    >
                      {fmtCell(row[col.key], col)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
