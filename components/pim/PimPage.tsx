"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PackageSearch, ExternalLink } from "lucide-react";
import { AnalyticsTable, type Column } from "@/components/analytics/AnalyticsTable";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { useActiveCabinet } from "@/lib/useActiveCabinet";
import { CategoryFilter, filterByCategory } from "@/components/ui/CategoryFilter";
import { useCategoryMap } from "@/lib/useCategoryMap";
import { LoadingBanner, SkeletonKpiRow, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import type { PimRow } from "@/lib/wb/cards";

function isComplete(r: PimRow): boolean {
  return !!(r.length && r.width && r.height && r.weightBrutto && r.materials && r.photosCount > 0);
}

export function PimPage() {
  const [cabId, setCabId, cabReady] = useActiveCabinet("wb");
  const [rows, setRows] = useState<PimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const elapsed = useElapsedSeconds(loading);

  const load = useCallback(async () => {
    if (!cabReady) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/pim${cabId ? `?cabinet=${cabId}` : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.ok) setError(json.error || "Ошибка загрузки");
      else setRows(json.rows ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [cabId, cabReady]);

  useEffect(() => { load(); }, [load]);

  const { categories, byArticle } = useCategoryMap();
  const [category, setCategory] = useState("");
  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    let out = rows;
    if (s) out = out.filter((r) => r.name.toLowerCase().includes(s) || r.article.toLowerCase().includes(s) || String(r.nmId).includes(s));
    return filterByCategory(out, (r) => r.article, byArticle, category);
  }, [rows, q, category, byArticle]);

  const completeCount = filtered.filter(isComplete).length;

  const columns: Column<PimRow>[] = [
    { key: "article", label: "Товар", sortable: true, render: (r) => (
      <div className="min-w-0">
        <p className="font-medium text-slate-900">{r.article}</p>
        <p className="max-w-xs truncate text-xs text-slate-400">{r.name}</p>
      </div>
    ), csv: (r) => r.article },
    { key: "brand", label: "Бренд", sortable: true, render: (r) => r.brand || "—", csv: (r) => r.brand },
    { key: "subject", label: "Ниша", render: (r) => r.subject || "—", csv: (r) => r.subject },
    { key: "dims", label: "Размеры, см", align: "right", render: (r) => (
      r.length && r.width && r.height ? `${r.length}×${r.width}×${r.height}` : <span className="text-amber-500">—</span>
    ), csv: (r) => (r.length ? `${r.length}x${r.width}x${r.height}` : "") },
    { key: "weight", label: "Вес брутто, кг", align: "right", render: (r) => (
      r.weightBrutto ? r.weightBrutto : <span className="text-amber-500">—</span>
    ), csv: (r) => String(r.weightBrutto ?? "") },
    { key: "materials", label: "Материалы", render: (r) => r.materials || <span className="text-amber-500">не указано</span>, csv: (r) => r.materials },
    { key: "photos", label: "Фото", align: "right", sortable: true, render: (r) => (
      <span className={r.photosCount === 0 ? "font-semibold text-red-600" : r.photosCount < 3 ? "text-amber-500" : "text-emerald-600"}>{r.photosCount}</span>
    ), csv: (r) => String(r.photosCount) },
    { key: "wb", label: "", render: (r) => (
      <a href={r.wbUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-violet-600 hover:underline">
        Открыть на WB <ExternalLink className="h-3 w-3" />
      </a>
    ), csv: (r) => r.wbUrl },
  ];

  return (
    <div className="bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><PackageSearch className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">Информация по SKU</h1>
            <p className="text-xs text-gray-500">размеры, материалы и фото-комплектность карточек WB</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <CabinetSwitcher mp="wb" accent="violet" onChange={setCabId} />
            <CategoryFilter categories={categories} value={category} onChange={setCategory} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="поиск по артикулу/названию"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none sm:w-64" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-3 py-6 sm:px-6">
        {loading ? (
          <>
            <LoadingBanner seconds={elapsed} hint="карточки WB (Content API)" />
            <SkeletonKpiRow count={2} />
            <SkeletonTableRows rows={8} cols={6} />
          </>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 sm:w-fit sm:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-[11px] font-medium text-gray-500">Всего SKU</div>
                <div className="mt-0.5 text-xl font-bold tabular-nums">{filtered.length}</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-[11px] font-medium text-gray-500">Заполнено полностью</div>
                <div className="mt-0.5 text-xl font-bold tabular-nums text-emerald-700">{completeCount}/{filtered.length}</div>
              </div>
            </div>

            <AnalyticsTable columns={columns} data={filtered} filename="pim.csv" emptyMessage="Нет карточек по фильтру." />
          </>
        )}
      </main>
    </div>
  );
}
