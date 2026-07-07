"use client";

import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { useActiveCabinet } from "@/lib/useActiveCabinet";
import { LoadingBanner, SkeletonKpiRow, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { CategoryFilter, filterByCategory } from "@/components/ui/CategoryFilter";
import { useCategoryMap } from "@/lib/useCategoryMap";
import { useSort, sortGlyph } from "@/lib/useSort";

interface GSku {
  nm: number; art: string; name: string; img_url: string; shop: string;
  shows_7d: number; orders_sum_7d: number; adv_spend_7d: number;
  drr_7d: number | null; margin_before_drr: number | null; stock: number; signal: string | null;
}
interface Group { imt_id: number; shop_label: string; category_label: string; skus: GSku[] }
interface SklData { groups_multi: Group[]; groups_solo: Group[]; total_sku: number; multi_groups: number; solo_skus: number; covered: number; error?: string }

const num = (v: number) => Math.round(v).toLocaleString("ru-RU");
const pc = (v: number | null) => (v == null ? "—" : v + "%");
// [className, glyph] — глиф даёт сигнал не только цветом (важно для дальтоников/ч-б экранов).
const toneDrr = (v: number | null): [string, string] => (v == null ? ["text-gray-400", ""] : v <= 10 ? ["text-emerald-600", ""] : v <= 20 ? ["text-amber-600", "△ "] : ["text-rose-600", "▲ "]);

function GroupCard({ g }: { g: Group }) {
  const { sorted: skus, sortField, sortDir, toggleSort } = useSort(g.skus, (s, field) =>
    field === "art" ? s.art : (s[field as keyof GSku] as number | null));
  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
        <Layers className="h-4 w-4 text-violet-600" />
        <span className="text-sm font-semibold">Склейка {g.imt_id}</span>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">{g.skus.length} SKU</span>
        {g.category_label && <span className="text-xs text-gray-400">{g.category_label}</span>}
        <span className="ml-auto text-xs text-gray-400">{g.shop_label}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-gray-400">
              <th onClick={() => toggleSort("art")} className="cursor-pointer select-none px-4 py-1.5 font-medium hover:text-violet-600">Артикул{sortGlyph(sortField === "art", sortDir)}</th>
              {([["shows_7d", "Показы"], ["orders_sum_7d", "Выручка ₽"], ["adv_spend_7d", "Реклама ₽"], ["drr_7d", "ДРР"], ["margin_before_drr", "Маржа"], ["stock", "Остаток"]] as const).map(([field, label]) => (
                <th key={field} onClick={() => toggleSort(field)} className="cursor-pointer select-none px-3 py-1.5 text-right font-medium hover:text-violet-600">{label}{sortGlyph(sortField === field, sortDir)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skus.map((s) => (
              <tr key={s.nm} className="border-t border-gray-50">
                <td className="px-4 py-1.5">
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.img_url} alt="" loading="lazy" className="h-7 w-7 shrink-0 rounded bg-gray-100 object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
                    <span className="truncate text-xs font-medium">{s.art}</span>
                    {s.signal && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-600">{s.signal}</span>}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{num(s.shows_7d)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{num(s.orders_sum_7d)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{num(s.adv_spend_7d)}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${toneDrr(s.drr_7d)[0]}`}>{toneDrr(s.drr_7d)[1]}{pc(s.drr_7d)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{pc(s.margin_before_drr)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{num(s.stock)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SklejkiPage() {
  const [cabId, setCabId, cabReady] = useActiveCabinet("wb");
  const [data, setData] = useState<SklData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const elapsed = useElapsedSeconds(loading);

  useEffect(() => {
    if (!cabReady) return;
    let ignore = false;
    setLoading(true); setErr(null);
    fetch(`/api/sklejki${cabId ? `?cabinet=${cabId}` : ""}`, { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: SklData) => { if (ignore) return; if (d.error) setErr(d.error); else setData(d); })
      .catch((e) => { if (!ignore) setErr(String(e)); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [cabId, cabReady]);

  // фильтруем SKU внутри каждой группы; группы, у которых после фильтра не осталось
  // ни одного SKU, скрываем целиком.
  const { categories, byArticle } = useCategoryMap();
  const [category, setCategory] = useState("");
  const groupsMulti = (data?.groups_multi ?? [])
    .map((g) => ({ ...g, skus: filterByCategory(g.skus, (s) => s.art, byArticle, category) }))
    .filter((g) => g.skus.length > 0);

  return (
    <div className="bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Layers className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">Склейки</h1>
            <p className="text-xs text-gray-500">объединённые карточки по imtID · воронка за 7 дней</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <CabinetSwitcher mp="wb" accent="violet" onChange={setCabId} />
            <CategoryFilter categories={categories} value={category} onChange={setCategory} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-3 py-6 sm:px-6">
        {loading ? (
          <>
            <LoadingBanner seconds={elapsed} hint="карточки WB по каждому кабинету" />
            <SkeletonKpiRow count={4} />
            <SkeletonTableRows rows={6} cols={6} />
          </>
        ) : err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>
        ) : data ? (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { l: "Всего карточек", v: data.total_sku },
                { l: "Склеек (2+ SKU)", v: data.multi_groups },
                { l: "Одиночных SKU", v: data.solo_skus },
                { l: "Покрыто данными", v: data.covered },
              ].map((s) => (
                <div key={s.l} className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="text-[11px] font-medium text-gray-500">{s.l}</div>
                  <div className="mt-0.5 text-xl font-bold tabular-nums">{s.v.toLocaleString("ru-RU")}</div>
                </div>
              ))}
            </div>
            {groupsMulti.length ? (
              <div className="space-y-3">{groupsMulti.map((g) => <GroupCard key={g.imt_id} g={g} />)}</div>
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
                Нет объединённых карточек (2+ SKU). Одиночных: {data.solo_skus}.
              </div>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
