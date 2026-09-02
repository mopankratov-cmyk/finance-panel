"use client";

import { useMemo, useState } from "react";
import { AnalyticsTable, type Column } from "@/components/analytics/AnalyticsTable";
import { formatNumber } from "@/lib/analytics/format";
import { CategoryFilter, categoriesOnScreen, filterByCategory } from "@/components/ui/CategoryFilter";
import { useCategoryMap } from "@/lib/useCategoryMap";
import { WbProductImage } from "@/components/wb/WbProductImage";
import type { StockCatalogRow } from "@/app/api/supplies/route";

function daysColor(d: number | null): string {
  if (d === null) return "text-slate-400";
  if (d <= 14) return "text-red-600";
  if (d <= 30) return "text-amber-500";
  return "text-emerald-600";
}

export function StockCatalogTab({ rows }: { rows: StockCatalogRow[] }) {
  const { categories, byArticle } = useCategoryMap();
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [hideEmpty, setHideEmpty] = useState(false);

  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    let out = rows;
    if (s) out = out.filter((r) => (r.name ?? "").toLowerCase().includes(s) || r.article.toLowerCase().includes(s) || String(r.nmId).includes(s));
    if (hideEmpty) out = out.filter((r) => r.quantity > 0 || r.inWayToClient > 0 || r.inWayFromClient > 0);
    return filterByCategory(out, (r) => r.article, byArticle, category);
  }, [rows, q, hideEmpty, category, byArticle]);
  const catOptions = useMemo(
    () => categoriesOnScreen(rows, (r) => r.article, byArticle, categories),
    [rows, byArticle, categories],
  );

  const totalQuantity = filtered.reduce((s, r) => s + r.quantity, 0);
  const totalToClient = filtered.reduce((s, r) => s + r.inWayToClient, 0);

  const columns: Column<StockCatalogRow>[] = [
    { key: "article", label: "Товар", sortable: true, render: (r) => (
      <div className="flex items-center gap-2">
        <WbProductImage nm={r.nmId} className="h-9 w-9 shrink-0 rounded border border-slate-200 bg-slate-100 object-cover" />
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{r.article || r.nmId}</p>
          {r.name && <p className="max-w-xs truncate text-xs text-slate-400">{r.name}</p>}
        </div>
      </div>
    ), csv: (r) => r.article || String(r.nmId) },
    { key: "quantity", label: "Остаток", align: "right", sortable: true, render: (r) => (
      <span className={r.quantity < 10 ? "font-semibold text-red-600" : ""}>{formatNumber(r.quantity)}</span>
    ), csv: (r) => String(r.quantity) },
    { key: "inWayToClient", label: "В пути к клиенту", align: "right", sortable: true, render: (r) => formatNumber(r.inWayToClient), csv: (r) => String(r.inWayToClient) },
    { key: "inWayFromClient", label: "В пути от клиента", align: "right", sortable: true, render: (r) => (
      <span className="text-slate-500">{formatNumber(r.inWayFromClient)}</span>
    ), csv: (r) => String(r.inWayFromClient) },
    { key: "daysLeft", label: "Хватит дней", align: "right", sortable: true, render: (r) => (
      <span className={daysColor(r.daysLeft)}>{r.daysLeft ?? "∞"}</span>
    ), csv: (r) => (r.daysLeft != null ? String(r.daysLeft) : "") },
    { key: "topWarehouses", label: "Топ складов", render: (r) => (
      <span className="text-xs text-slate-500">{r.topWarehouses.map((w) => `${w.warehouse} ${formatNumber(w.quantity)}`).join(" · ") || "—"}</span>
    ), csv: (r) => r.topWarehouses.map((w) => `${w.warehouse} ${w.quantity}`).join("; ") },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Всего на складах (по фильтру)</p>
          <p className="text-xl font-bold text-slate-900">{formatNumber(totalQuantity)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">В пути к клиенту</p>
          <p className="text-xl font-bold text-slate-900">{formatNumber(totalToClient)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CategoryFilter categories={catOptions.categories} hasUncategorized={catOptions.hasUncategorized} value={category} onChange={setCategory} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="поиск по артикулу/названию"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none sm:w-64" />
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          Скрыть нулевые
        </label>
      </div>

      <AnalyticsTable
        columns={columns}
        data={filtered}
        filename="stock-catalog.csv"
        emptyMessage="Нет остатков по выбранному фильтру."
      />
    </div>
  );
}
