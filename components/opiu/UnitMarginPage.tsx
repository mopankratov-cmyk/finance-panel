"use client";

import { useEffect, useRef, useState } from "react";
import { Sigma } from "lucide-react";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { useActiveCabinet } from "@/lib/useActiveCabinet";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { CategoryFilter, categoriesOnScreen } from "@/components/ui/CategoryFilter";
import { useCategoryMap } from "@/lib/useCategoryMap";
import { useSort, sortGlyph } from "@/lib/useSort";
import { WbProductImage } from "@/components/wb/WbProductImage";
import { createLatestRequestGuard } from "@/lib/unit/latestRequest";

interface UnitData {
  headers: string[];
  rows: (string | number)[][];
  img_urls: string[];
  names: string[];
  meta_text: string;
  error?: string;
}

const FIRST_DATA_COL = 3;
const show = (value: string | number) =>
  value === "" || value == null ? "—" : typeof value === "number" ? value.toLocaleString("ru-RU") : value;

export function UnitMarginPage() {
  const [cabId, setCabId, cabReady] = useActiveCabinet("wb");
  const [data, setData] = useState<UnitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const requestGuard = useRef(createLatestRequestGuard());
  const elapsed = useElapsedSeconds(loading);

  useEffect(() => {
    if (!cabReady) return;
    const controller = new AbortController();
    const guard = requestGuard.current;
    const generation = guard.begin();
    setData(null);
    setLoading(true);
    setErr(null);
    const query = cabId ? `?cabinet=${encodeURIComponent(cabId)}` : "";
    fetch(`/api/unit/table${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as UnitData;
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        return payload;
      })
      .then((payload) => {
        if (!guard.isCurrent(generation)) return;
        if (payload.error) throw new Error(payload.error);
        setData(payload);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!guard.isCurrent(generation)) return;
        setErr(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted && guard.isCurrent(generation)) setLoading(false);
      });
    return () => {
      guard.invalidate(generation);
      controller.abort();
    };
  }, [cabId, cabReady]);

  const { categories, byArticle } = useCategoryMap();
  const [category, setCategory] = useState("");
  const filteredIndices = (data?.rows ?? []).map((_, index) => index).filter((index) => {
    if (!category) return true;
    const article = String(data!.rows[index][2]);
    return category === "__none" ? !byArticle[article] : byArticle[article] === category;
  });
  const catOptions = categoriesOnScreen(data?.rows ?? [], (row) => String(row[2]), byArticle, categories);
  const { sorted: indices, sortField, sortDir, toggleSort } = useSort(filteredIndices, (rowIndex, field) => {
    const value = data?.rows[rowIndex]?.[Number(field)];
    if (value == null || value === "") return null;
    return typeof value === "number" ? value : (isFinite(Number(value)) ? Number(value) : String(value));
  });

  return (
    <div className="bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-[110rem] flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
            <Sigma className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-extrabold tracking-tight">Юнит-экономика WB</h1>
            <p className="text-xs text-gray-500">
              {data?.meta_text || "прибыль/ед: цена до СПП − себес − комиссия − эквайринг − ДРР − налог"}
            </p>
          </div>
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            <CabinetSwitcher mp="wb" accent="violet" onChange={setCabId} />
            <CategoryFilter categories={catOptions.categories} hasUncategorized={catOptions.hasUncategorized} value={category} onChange={setCategory} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[110rem] px-3 py-6 sm:px-6">
        {loading ? (
          <>
            <LoadingBanner seconds={elapsed} hint="юнит-экономика WB" />
            <SkeletonTableRows rows={10} cols={10} />
          </>
        ) : err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>
        ) : data && indices.length ? (
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th onClick={() => toggleSort("2")} className="sticky left-0 z-10 cursor-pointer select-none bg-white px-3 py-2 font-semibold shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] hover:text-violet-700">
                    Артикул{sortGlyph(sortField === "2", sortDir)}
                  </th>
                  {data.headers.slice(FIRST_DATA_COL).map((header, index) => {
                    const field = String(FIRST_DATA_COL + index);
                    return (
                      <th key={field} onClick={() => toggleSort(field)} className="tap-hit cursor-pointer select-none px-3 py-2 text-right font-semibold whitespace-nowrap hover:text-violet-700">
                        {header}{sortGlyph(sortField === field, sortDir)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {indices.map((rowIndex) => {
                  const row = data.rows[rowIndex];
                  return (
                    <tr key={String(row[4])} className="group border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] group-hover:bg-gray-50">
                        <div className="flex max-w-[9.5rem] items-center gap-2 sm:max-w-none">
                          <WbProductImage nm={Number(row[4])} src={data.img_urls[rowIndex]} className="h-8 w-8 shrink-0 rounded bg-gray-100 object-cover" />
                          <div className="min-w-0">
                            <div className="truncate text-xs font-semibold">{show(row[2])}</div>
                            <div className="truncate text-[10px] text-gray-400">{data.names[rowIndex]}</div>
                          </div>
                        </div>
                      </td>
                      {row.slice(FIRST_DATA_COL).map((value, columnIndex) => (
                        <td key={columnIndex} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{show(value)}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
            Нет данных. Проверьте синхронизацию и себестоимость.
          </div>
        )}
      </main>
    </div>
  );
}
