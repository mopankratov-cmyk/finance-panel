"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AnalyticsTable, type Column } from "@/components/analytics/AnalyticsTable";
import { formatNumber, formatPct, formatRub } from "@/lib/analytics/format";
import type { RnpRow } from "@/lib/rnp/buildRnp";

type PeriodKey = "today" | "yesterday" | "week" | "month";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Сегодня" },
  { key: "yesterday", label: "Вчера" },
  { key: "week", label: "7 дней" },
  { key: "month", label: "30 дней" },
];

function turnoverColor(days: number | null): string {
  if (days === null) return "text-slate-400";
  if (days <= 30) return "text-emerald-600";
  if (days <= 60) return "text-amber-600";
  return "text-red-600";
}

function drrColor(drr: number | null): string {
  if (drr === null) return "text-slate-400";
  if (drr <= 10) return "text-emerald-600";
  if (drr <= 20) return "text-amber-600";
  return "text-red-600";
}

export function RnpPage() {
  const [rows, setRows] = useState<RnpRow[]>([]);
  const [period, setPeriod] = useState<PeriodKey>("week");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rnp");
      const json = await res.json();
      if (json.error) setError(json.error);
      else setRows(json.data ?? []);
    } catch {
      setError("Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const columns: Column<RnpRow>[] = [
    {
      key: "article",
      label: "Артикул",
      render: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.article || "—"}</p>
          <p className="text-xs text-slate-400">{r.nmId}</p>
        </div>
      ),
      csv: (r) => r.article || String(r.nmId),
    },
    {
      key: "ordersCount",
      label: "Заказы, шт",
      align: "right",
      render: (r) => formatNumber(r.periods[period].ordersCount),
      csv: (r) => String(r.periods[period].ordersCount),
    },
    {
      key: "ordersSum",
      label: "Заказы, ₽",
      align: "right",
      render: (r) => formatRub(r.periods[period].ordersSum),
      csv: (r) => String(Math.round(r.periods[period].ordersSum)),
    },
    {
      key: "buyoutsCount",
      label: "Выкупы, шт",
      align: "right",
      render: (r) => formatNumber(r.periods[period].buyoutsCount),
      csv: (r) => String(r.periods[period].buyoutsCount),
    },
    {
      key: "buyoutsSum",
      label: "Выкупы, ₽",
      align: "right",
      render: (r) => formatRub(r.periods[period].buyoutsSum),
      csv: (r) => String(Math.round(r.periods[period].buyoutsSum)),
    },
    {
      key: "stock",
      label: "Остаток",
      align: "right",
      render: (r) => (
        <div>
          <p>{formatNumber(r.stock)}</p>
          {r.inWayToClient > 0 && (
            <p className="text-xs text-slate-400">+{r.inWayToClient} в пути</p>
          )}
        </div>
      ),
      csv: (r) => String(r.stock),
    },
    {
      key: "turnoverDays",
      label: "Оборач., дн",
      align: "right",
      render: (r) => (
        <span className={turnoverColor(r.turnoverDays)}>
          {r.turnoverDays !== null ? formatNumber(r.turnoverDays) : "—"}
        </span>
      ),
      csv: (r) => (r.turnoverDays !== null ? String(r.turnoverDays) : ""),
    },
    {
      key: "stockMoney",
      label: "Деньги в остатках",
      align: "right",
      render: (r) => (r.stockMoney !== null ? formatRub(r.stockMoney) : "—"),
      csv: (r) => (r.stockMoney !== null ? String(Math.round(r.stockMoney)) : ""),
    },
    {
      key: "drr",
      label: "ДРР",
      align: "right",
      render: (r) => (
        <span className={drrColor(r.drr)}>
          {r.drr !== null ? formatPct(r.drr) : "—"}
        </span>
      ),
      csv: (r) => (r.drr !== null ? r.drr.toFixed(1) : ""),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">РНП</h1>
          <p className="text-sm text-slate-400 mt-1">
            Репорт-навигатор продаж по SKU
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Обновить
        </button>
      </div>

      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 w-fit">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              period === p.key
                ? "bg-white text-slate-900 shadow-sm font-medium"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : loading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          Загрузка...
        </div>
      ) : (
        <AnalyticsTable
          columns={columns}
          data={rows}
          filename="rnp.csv"
          emptyMessage="Нет данных. Запустите синхронизацию /api/sync/*"
        />
      )}
    </div>
  );
}
