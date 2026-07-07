"use client";

import { useEffect, useState } from "react";
import { MousePointerClick } from "lucide-react";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { useActiveCabinet } from "@/lib/useActiveCabinet";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";

interface Item { nm: number; art: string; views: number; spend: number; ctr: number | null; cpc: number | null; drr: number | null; stock: number }
interface AdvData { items: Item[]; count: number; days: number }

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
const pc = (v: number | null) => (v == null ? "—" : v + "%");
const rub = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString("ru-RU"));
const toneCtr = (v: number | null) => (v == null ? "" : v >= 5 ? "text-emerald-600" : v >= 2 ? "text-amber-600" : "text-rose-600");
const toneDrr = (v: number | null) => (v == null ? "" : v <= 10 ? "text-emerald-600" : v <= 20 ? "text-amber-600" : "text-rose-600");

export default function CtrTestPage() {
  const [cabId, setCabId, cabReady] = useActiveCabinet("wb");
  const [days, setDays] = useState(7);
  const [data, setData] = useState<AdvData | null>(null);
  const [testsCount, setTestsCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const elapsed = useElapsedSeconds(loading);

  useEffect(() => {
    if (!cabReady) return;
    let ignore = false;
    setLoading(true); setErr(null);
    Promise.all([
      fetch(`/api/ctrtest/adv-analysis?days=${days}${cabId ? `&cabinet=${cabId}` : ""}`, { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      fetch(`/api/ctrtest/list`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({ tests: [] })),
    ]).then(([d, l]: [AdvData & { error?: string }, { tests: unknown[] }]) => {
      if (ignore) return;
      if (d.error) setErr(d.error); else setData(d);
      setTestsCount(Array.isArray(l.tests) ? l.tests.length : 0);
    }).catch((e) => { if (!ignore) setErr(String(e)); }).finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [cabId, days, cabReady]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><MousePointerClick className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">CTR / Реклама по SKU</h1>
            <p className="text-xs text-gray-500">{data ? `${data.count} SKU · ${data.days} дней` : "CTR, CPC и ДРР по артикулам"}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <CabinetSwitcher mp="wb" accent="violet" onChange={setCabId} />
            <div className="flex gap-1 rounded-md bg-gray-100 p-0.5">
              {[7, 14, 30].map((d) => (
                <button key={d} onClick={() => setDays(d)} className={`rounded px-3 py-1 text-xs font-semibold ${days === d ? "bg-white text-violet-700 shadow" : "text-gray-500"}`}>{d}д</button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {loading ? (
          <>
            <LoadingBanner seconds={elapsed} hint="CTR по SKU" />
            <SkeletonTableRows rows={8} cols={6} />
          </>
        ) : err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>
        ) : data ? (
          <>
            {!testsCount && (
              <div className="mb-4 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-xs text-gray-500">
                Сохранённых A/B-тестов нет (per-variant замер отложен). Ниже — фактическая рекламная эффективность по SKU за период.
              </div>
            )}
            {data.items.length ? (
              <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                      <th className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold">Артикул</th>
                      <th className="px-3 py-2 text-right font-semibold">Показы</th>
                      <th className="px-3 py-2 text-right font-semibold">Расход, ₽</th>
                      <th className="px-3 py-2 text-right font-semibold">CTR</th>
                      <th className="px-3 py-2 text-right font-semibold">CPC, ₽</th>
                      <th className="px-3 py-2 text-right font-semibold">ДРР</th>
                      <th className="px-3 py-2 text-right font-semibold">Остаток</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((it) => (
                      <tr key={it.nm} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                        <td className="sticky left-0 z-10 bg-white px-3 py-2 text-xs font-semibold">{it.art}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{nf(it.views)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{nf(it.spend)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${toneCtr(it.ctr)}`}>{pc(it.ctr)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{rub(it.cpc)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${toneDrr(it.drr)}`}>{pc(it.drr)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{nf(it.stock)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">Нет рекламных данных за период.</div>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
