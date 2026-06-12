"use client";

import { Pencil, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AnalyticsTable, type Column } from "@/components/analytics/AnalyticsTable";
import { formatNumber, formatPct, formatRub } from "@/lib/analytics/format";
import type { FunnelRow } from "@/app/api/funnel/route";

type PeriodKey = "week" | "yesterday";

interface Benchmarks {
  cartRate: number;
  orderRate: number;
  buyoutRate: number;
}

const DEFAULT_BENCHMARKS: Benchmarks = {
  cartRate: 8,
  orderRate: 30,
  buyoutRate: 30,
};

const STORAGE_KEY = "funnel_benchmarks";

function benchClass(value: number | null, bench: number): string {
  if (value === null) return "";
  if (value >= bench) return "bg-emerald-50 text-emerald-700";
  if (value >= bench * 0.8) return "bg-amber-50 text-amber-700";
  return "bg-red-50 text-red-700";
}

export function FunnelPage() {
  const [rows, setRows] = useState<FunnelRow[]>([]);
  const [period, setPeriod] = useState<PeriodKey>("week");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [benchmarks, setBenchmarks] = useState<Benchmarks>(DEFAULT_BENCHMARKS);
  const [editingBench, setEditingBench] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setBenchmarks({ ...DEFAULT_BENCHMARKS, ...JSON.parse(saved) });
    } catch {
      // повреждённое значение — остаются дефолты
    }
  }, []);

  const saveBenchmarks = (b: Benchmarks) => {
    setBenchmarks(b);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
  };

  const load = useCallback(async (p: PeriodKey) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/funnel?period=${p === "yesterday" ? "yesterday" : "week"}`);
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
    load(period);
  }, [load, period]);

  const columns: Column<FunnelRow>[] = [
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
      key: "openCard",
      label: "Показы",
      align: "right",
      render: (r) => formatNumber(r.openCard),
      csv: (r) => String(r.openCard),
    },
    {
      key: "addToCart",
      label: "Корзина",
      align: "right",
      render: (r) => formatNumber(r.addToCart),
      csv: (r) => String(r.addToCart),
    },
    {
      key: "cartRate",
      label: "CV корзина",
      align: "right",
      render: (r) => (
        <span className={`rounded px-1.5 py-0.5 ${benchClass(r.cartRate, benchmarks.cartRate)}`}>
          {r.cartRate !== null ? formatPct(r.cartRate) : "—"}
        </span>
      ),
      csv: (r) => (r.cartRate !== null ? r.cartRate.toFixed(1) : ""),
    },
    {
      key: "orders",
      label: "Заказы",
      align: "right",
      render: (r) => (
        <div>
          <p>{formatNumber(r.orders)}</p>
          <p className="text-xs text-slate-400">{formatRub(r.ordersSum)}</p>
        </div>
      ),
      csv: (r) => String(r.orders),
    },
    {
      key: "orderRate",
      label: "CR заказ",
      align: "right",
      render: (r) => (
        <span className={`rounded px-1.5 py-0.5 ${benchClass(r.orderRate, benchmarks.orderRate)}`}>
          {r.orderRate !== null ? formatPct(r.orderRate) : "—"}
        </span>
      ),
      csv: (r) => (r.orderRate !== null ? r.orderRate.toFixed(1) : ""),
    },
    {
      key: "buyouts",
      label: "Выкупы",
      align: "right",
      render: (r) => (
        <div>
          <p>{formatNumber(r.buyouts)}</p>
          <p className="text-xs text-slate-400">{formatRub(r.buyoutSum)}</p>
        </div>
      ),
      csv: (r) => String(r.buyouts),
    },
    {
      key: "buyoutRate",
      label: "% выкупа",
      align: "right",
      render: (r) => (
        <span className={`rounded px-1.5 py-0.5 ${benchClass(r.buyoutRate, benchmarks.buyoutRate)}`}>
          {r.buyoutRate !== null ? formatPct(r.buyoutRate) : "—"}
        </span>
      ),
      csv: (r) => (r.buyoutRate !== null ? r.buyoutRate.toFixed(1) : ""),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Воронка</h1>
          <p className="text-sm text-slate-400 mt-1">
            Показы → Корзина → Заказы → Выкупы по SKU
          </p>
        </div>
        <button
          onClick={() => load(period)}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Обновить
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 w-fit">
          {(
            [
              { key: "week", label: "7 дней" },
              { key: "yesterday", label: "Вчера" },
            ] as const
          ).map((p) => (
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

        <button
          onClick={() => setEditingBench((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          <Pencil className="h-3.5 w-3.5" />
          Бенчмарки
        </button>

        {editingBench && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
            {(
              [
                { key: "cartRate", label: "CV корзина %" },
                { key: "orderRate", label: "CR заказ %" },
                { key: "buyoutRate", label: "% выкупа" },
              ] as const
            ).map((b) => (
              <label key={b.key} className="flex items-center gap-1.5 text-sm text-slate-600">
                {b.label}
                <input
                  type="number"
                  value={benchmarks[b.key]}
                  min={0}
                  max={100}
                  onChange={(e) =>
                    saveBenchmarks({ ...benchmarks, [b.key]: Number(e.target.value) })
                  }
                  className="w-16 rounded border border-slate-200 px-2 py-1 text-sm"
                />
              </label>
            ))}
          </div>
        )}
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
          filename="funnel.csv"
          emptyMessage="Нет данных. Запустите /api/sync/funnel"
        />
      )}
    </div>
  );
}
