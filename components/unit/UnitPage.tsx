"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnalyticsTable, type Column } from "@/components/analytics/AnalyticsTable";
import { formatNumber, formatPct, formatRub } from "@/lib/analytics/format";
import type { UnitProduct } from "@/app/api/unit/route";

type Mode = "priceToMargin" | "marginToPrice";

interface Params {
  commissionPct: number;
  acquiringPct: number;
  taxPct: number;
  drrPct: number;
  logistics: number; // ₽ за единицу
}

const DEFAULT_PARAMS: Params = {
  commissionPct: 25,
  acquiringPct: 1.5,
  taxPct: 7,
  drrPct: 10,
  logistics: 0,
};

const STORAGE_KEY = "unit_params";

function marginColor(pct: number | null): string {
  if (pct === null) return "";
  if (pct >= 20) return "bg-emerald-50 text-emerald-700";
  if (pct >= 10) return "bg-amber-50 text-amber-700";
  return "bg-red-50 text-red-700";
}

export function UnitPage() {
  const [products, setProducts] = useState<UnitProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("priceToMargin");
  const [article, setArticle] = useState<string>("");
  const [cost, setCost] = useState<number>(0);
  const [price, setPrice] = useState<number>(1000);
  const [targetMargin, setTargetMargin] = useState<number>(20);
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setParams({ ...DEFAULT_PARAMS, ...JSON.parse(saved) });
    } catch {
      /* дефолты */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/unit", { cache: "no-store" });
      const json = await res.json();
      if (json.error) setError(json.error);
      else setProducts(json.data ?? []);
    } catch {
      setError("Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setParam = (key: keyof Params, value: number) => {
    const next = { ...params, [key]: value };
    setParams(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const onPickArticle = (a: string) => {
    setArticle(a);
    const p = products.find((x) => x.article === a);
    if (p) setCost(Math.round(p.cost * 100) / 100);
  };

  // доля удержаний от цены (комиссия + эквайринг + налог + ДРР)
  const pctShare = (params.commissionPct + params.acquiringPct + params.taxPct + params.drrPct) / 100;

  const calc = useMemo(() => {
    if (mode === "priceToMargin") {
      const profit = price * (1 - pctShare) - cost - params.logistics;
      const marginPct = price > 0 ? (profit / price) * 100 : 0;
      return { price, profit, marginPct };
    }
    // marginToPrice: price×(1 − share − margin) = cost + logistics
    const denom = 1 - pctShare - targetMargin / 100;
    const neededPrice = denom > 0 ? (cost + params.logistics) / denom : NaN;
    const profit = Number.isFinite(neededPrice)
      ? neededPrice * (1 - pctShare) - cost - params.logistics
      : 0;
    return { price: neededPrice, profit, marginPct: targetMargin };
  }, [mode, price, targetMargin, cost, pctShare, params.logistics]);

  const factRows = useMemo(() => products.filter((p) => p.units > 0), [products]);

  const columns: Column<UnitProduct>[] = [
    {
      key: "article",
      label: "Артикул",
      render: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.article}</p>
          <p className="text-xs text-slate-400">{r.name ?? r.nmId}</p>
        </div>
      ),
      csv: (r) => r.article,
    },
    { key: "units", label: "Продано", align: "right", render: (r) => formatNumber(r.units), csv: (r) => String(r.units) },
    { key: "revenue", label: "Выручка", align: "right", render: (r) => formatRub(r.revenue), csv: (r) => String(Math.round(r.revenue)) },
    { key: "forPay", label: "К перечислению", align: "right", render: (r) => formatRub(r.forPay), csv: (r) => String(Math.round(r.forPay)) },
    { key: "cost", label: "Себес/шт", align: "right", render: (r) => formatRub(r.cost), csv: (r) => String(r.cost) },
    { key: "adSpend", label: "Реклама", align: "right", render: (r) => formatRub(r.adSpend), csv: (r) => String(Math.round(r.adSpend)) },
    {
      key: "factProfit",
      label: "Прибыль",
      align: "right",
      render: (r) => (r.factProfit !== null ? formatRub(r.factProfit) : "—"),
      csv: (r) => (r.factProfit !== null ? String(Math.round(r.factProfit)) : ""),
    },
    {
      key: "factMarginPct",
      label: "Маржа %",
      align: "right",
      render: (r) => (
        <span className={`rounded px-1.5 py-0.5 ${marginColor(r.factMarginPct)}`}>
          {r.factMarginPct !== null ? formatPct(r.factMarginPct) : "—"}
        </span>
      ),
      csv: (r) => (r.factMarginPct !== null ? r.factMarginPct.toFixed(1) : ""),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Юнит-экономика</h1>
          <p className="text-sm text-slate-400 mt-1">Калькулятор цены и фактическая маржа по SKU</p>
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

      {/* Калькулятор */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-1 w-fit">
          {(
            [
              { key: "priceToMargin", label: "Цена → маржа" },
              { key: "marginToPrice", label: "Цель маржа → цена" },
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                mode === m.key ? "bg-white text-slate-900 shadow-sm font-medium" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm text-slate-600">
            Артикул
            <select
              value={article}
              onChange={(e) => onPickArticle(e.target.value)}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
            >
              <option value="">— выбрать —</option>
              {products.map((p) => (
                <option key={p.article} value={p.article}>
                  {p.article} {p.name ? `· ${p.name}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-600">
            Себестоимость ₽
            <input
              type="number"
              value={cost}
              onChange={(e) => setCost(Number(e.target.value))}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>

          {mode === "priceToMargin" ? (
            <label className="text-sm text-slate-600">
              Цена ₽
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
          ) : (
            <label className="text-sm text-slate-600">
              Целевая маржа %
              <input
                type="number"
                value={targetMargin}
                onChange={(e) => setTargetMargin(Number(e.target.value))}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
          )}

          <label className="text-sm text-slate-600">
            Логистика ₽/шт
            <input
              type="number"
              value={params.logistics}
              onChange={(e) => setParam("logistics", Number(e.target.value))}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>

          <label className="text-sm text-slate-600">
            Комиссия WB %
            <input
              type="number"
              value={params.commissionPct}
              onChange={(e) => setParam("commissionPct", Number(e.target.value))}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-sm text-slate-600">
            Налог %
            <input
              type="number"
              value={params.taxPct}
              onChange={(e) => setParam("taxPct", Number(e.target.value))}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-sm text-slate-600">
            ДРР %
            <input
              type="number"
              value={params.drrPct}
              onChange={(e) => setParam("drrPct", Number(e.target.value))}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-sm text-slate-600">
            Эквайринг %
            <input
              type="number"
              value={params.acquiringPct}
              onChange={(e) => setParam("acquiringPct", Number(e.target.value))}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-xs text-slate-400">{mode === "marginToPrice" ? "Нужная цена" : "Цена"}</p>
            <p className="text-xl font-bold text-slate-900">
              {Number.isFinite(calc.price) ? formatRub(calc.price) : "—"}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-xs text-slate-400">Прибыль с единицы</p>
            <p className={`text-xl font-bold ${calc.profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {Number.isFinite(calc.profit) ? formatRub(calc.profit) : "—"}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-xs text-slate-400">Маржа</p>
            <p className={`text-xl font-bold ${marginColor(calc.marginPct).includes("emerald") ? "text-emerald-600" : marginColor(calc.marginPct).includes("amber") ? "text-amber-500" : "text-red-600"}`}>
              {Number.isFinite(calc.marginPct) ? formatPct(calc.marginPct) : "—"}
            </p>
          </div>
        </div>
        {mode === "marginToPrice" && !Number.isFinite(calc.price) && (
          <p className="mt-2 text-xs text-red-500">
            Удержания + целевая маржа ≥ 100% — такая цена недостижима.
          </p>
        )}
      </div>

      {/* Unit-факт неделя */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Unit-факт · 7 дней</h2>
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : loading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            Загрузка...
          </div>
        ) : (
          <AnalyticsTable
            columns={columns}
            data={factRows}
            filename="unit-fact.csv"
            emptyMessage="Нет продаж за период или не заполнены себестоимости."
          />
        )}
      </div>
    </div>
  );
}
