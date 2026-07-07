"use client";

import { useEffect, useState } from "react";
import { Loader2, Layers } from "lucide-react";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { useActiveCabinet } from "@/lib/useActiveCabinet";

interface GSku {
  nm: number; art: string; name: string; img_url: string; shop: string;
  shows_7d: number; orders_sum_7d: number; adv_spend_7d: number;
  drr_7d: number | null; margin_before_drr: number | null; stock: number; signal: string | null;
}
interface Group { imt_id: number; shop_label: string; category_label: string; skus: GSku[] }
interface SklData { groups_multi: Group[]; groups_solo: Group[]; total_sku: number; multi_groups: number; solo_skus: number; covered: number; error?: string }

const num = (v: number) => Math.round(v).toLocaleString("ru-RU");
const pc = (v: number | null) => (v == null ? "—" : v + "%");
const toneDrr = (v: number | null) => (v == null ? "text-gray-400" : v <= 10 ? "text-emerald-600" : v <= 20 ? "text-amber-600" : "text-rose-600");

function GroupCard({ g }: { g: Group }) {
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
              <th className="px-4 py-1.5 font-medium">Артикул</th>
              <th className="px-3 py-1.5 text-right font-medium">Показы</th>
              <th className="px-3 py-1.5 text-right font-medium">Выручка ₽</th>
              <th className="px-3 py-1.5 text-right font-medium">Реклама ₽</th>
              <th className="px-3 py-1.5 text-right font-medium">ДРР</th>
              <th className="px-3 py-1.5 text-right font-medium">Маржа</th>
              <th className="px-3 py-1.5 text-right font-medium">Остаток</th>
            </tr>
          </thead>
          <tbody>
            {g.skus.map((s) => (
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
                <td className={`px-3 py-1.5 text-right tabular-nums ${toneDrr(s.drr_7d)}`}>{pc(s.drr_7d)}</td>
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

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Layers className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">Склейки</h1>
            <p className="text-xs text-gray-500">объединённые карточки по imtID · воронка за 7 дней</p>
          </div>
          <div className="ml-auto"><CabinetSwitcher mp="wb" accent="violet" onChange={setCabId} /></div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {loading ? (
          <div className="py-20 text-center text-gray-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
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
            {data.groups_multi.length ? (
              <div className="space-y-3">{data.groups_multi.map((g) => <GroupCard key={g.imt_id} g={g} />)}</div>
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
