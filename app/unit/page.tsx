"use client";

import { useEffect, useState } from "react";
import { Loader2, Sigma } from "lucide-react";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { useActiveCabinet } from "@/lib/useActiveCabinet";

interface UnitData {
  headers: string[];
  rows: (string | number)[][];
  img_urls: string[];
  names: string[];
  meta_text: string;
  error?: string;
}

// колонки 0(чекбокс) и 1(фото) — служебные; 2 (Артикул) рендерим в первой ячейке.
const FIRST_DATA_COL = 3;

const show = (v: string | number) => (v === "" || v == null ? "—" : typeof v === "number" ? v.toLocaleString("ru-RU") : v);

export default function UnitPage() {
  const [cabId, setCabId] = useActiveCabinet("wb");
  const [data, setData] = useState<UnitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setErr(null);
    fetch(`/api/unit/table${cabId ? `?cabinet=${cabId}` : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: UnitData) => { if (d.error) setErr(d.error); else setData(d); })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [cabId]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-[110rem] items-center gap-3 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Sigma className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">Юнит-экономика WB</h1>
            <p className="text-xs text-gray-500">{data?.meta_text || "прибыль/ед: цена до СПП − себес − комиссия − эквайринг − ДРР − налог"}</p>
          </div>
          <div className="ml-auto"><CabinetSwitcher mp="wb" accent="violet" onChange={setCabId} /></div>
        </div>
      </header>

      <main className="mx-auto max-w-[110rem] px-6 py-6">
        {loading ? (
          <div className="py-20 text-center text-gray-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
        ) : err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>
        ) : data && data.rows.length ? (
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold">Артикул</th>
                  {data.headers.slice(FIRST_DATA_COL).map((h, i) => (
                    <th key={i} className="px-3 py-2 text-right font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2">
                      <div className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={data.img_urls[ri]} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded bg-gray-100 object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
                        <div className="min-w-0"><div className="truncate text-xs font-semibold">{show(row[2])}</div><div className="truncate text-[10px] text-gray-400">{data.names[ri]}</div></div>
                      </div>
                    </td>
                    {row.slice(FIRST_DATA_COL).map((v, ci) => (
                      <td key={ci} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{show(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">Нет данных. Проверьте синхронизацию и себестоимость.</div>
        )}
      </main>
    </div>
  );
}
