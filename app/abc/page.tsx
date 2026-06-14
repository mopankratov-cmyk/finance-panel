"use client";

import { useEffect, useState } from "react";
import { Loader2, BarChart3 } from "lucide-react";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { useActiveCabinet } from "@/lib/useActiveCabinet";

interface AbcRow {
  nm: number; art: string; name: string; img_url: string | null;
  revenue: number; profit: number; margin: number | null;
  cumPct: number | null; share: number | null; cls: "A" | "B" | "C" | "D";
}
interface AbcData {
  rows: AbcRow[]; totalProfit: number; skuTotal: number; aShareOfSku: number;
  counts: { A: number; B: number; C: number; D: number }; error?: string;
}

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const CLS: Record<string, { bg: string; text: string; label: string }> = {
  A: { bg: "bg-emerald-100", text: "text-emerald-700", label: "A — ядро прибыли" },
  B: { bg: "bg-sky-100", text: "text-sky-700", label: "B — поддержка" },
  C: { bg: "bg-amber-100", text: "text-amber-700", label: "C — хвост" },
  D: { bg: "bg-red-100", text: "text-red-700", label: "D — убыточные" },
};

export default function AbcPage() {
  const [cabId, setCabId] = useActiveCabinet("wb");
  const [data, setData] = useState<AbcData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setErr(null);
    fetch(`/api/abc${cabId ? `?cabinet=${cabId}` : ""}`, { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (d.error) setErr(d.error); else setData(d);
    }).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, [cabId]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><BarChart3 className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">ABC-анализ прибыли</h1>
            <p className="text-xs text-gray-500">Где сосредоточена чистая прибыль — за 30 дней</p>
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
            {/* Сводка-инсайт */}
            <div className="mb-5 grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs text-gray-500">Главное</div>
                <div className="mt-1 text-sm font-semibold text-gray-900"><b className="text-emerald-700">{data.counts.A} SKU</b> ({data.aShareOfSku}% ассортимента) дают <b>80%</b> прибыли</div>
              </div>
              {(["A", "B", "C", "D"] as const).map((c) => (
                <div key={c} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex items-center gap-2">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold ${CLS[c].bg} ${CLS[c].text}`}>{c}</span>
                    <span className="text-xs text-gray-500">{CLS[c].label.split("—")[1]?.trim()}</span>
                  </div>
                  <div className="mt-1 text-xl font-bold tabular-nums">{data.counts[c]}</div>
                </div>
              ))}
            </div>

            <div className="overflow-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                  <tr>{["Класс", "Товар", "Прибыль 30д ₽", "Доля %", "Накоп. %", "Маржа %", "Выручка ₽"].map((h, i) => (
                    <th key={h} className={`px-3 py-2 ${i <= 1 ? "text-left" : "text-right"}`}>{h}</th>))}</tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.nm} className={`border-t border-gray-100 hover:bg-gray-50 ${r.cls === "D" ? "bg-red-50/40" : ""}`}>
                      <td className="px-3 py-2"><span className={`inline-flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold ${CLS[r.cls].bg} ${CLS[r.cls].text}`}>{r.cls}</span></td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {r.img_url ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={r.img_url} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded border border-gray-200 object-cover" onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} /> : <div className="h-9 w-9 shrink-0 rounded bg-gray-100" />}
                          <div className="min-w-0"><div className="font-medium text-gray-800">{r.art}</div><div className="max-w-xs truncate text-[11px] text-gray-400">{r.name}</div></div>
                        </div>
                      </td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${r.profit < 0 ? "text-red-600" : "text-emerald-700"}`}>{fmt(r.profit)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.share != null ? r.share + "%" : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.cumPct != null ? r.cumPct + "%" : "—"}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${(r.margin ?? 0) < 0 ? "text-red-600" : "text-gray-600"}`}>{r.margin != null ? r.margin + "%" : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-400">{fmt(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-gray-400">Прибыль = выручка с выкупов − себес − комиссия (факт) − эквайринг − налог 7% − реклама. Класс по накопительной доле: A ≤80%, B ≤95%, C — остальное, D — убыточные.</p>
          </>
        ) : null}
      </main>
    </div>
  );
}
