"use client";

import { useEffect, useState } from "react";
import { Loader2, Scale } from "lucide-react";
import { FinanceTabs } from "@/components/FinanceTabs";
import { useActiveCabinet } from "@/lib/useActiveCabinet";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";

interface LossItem { key: string; label: string; rub: number }
interface Loss { retail: number; payout: number; totalDeductions: number; items: LossItem[]; error?: string; noCabinet?: boolean }

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const M = (n: number) => (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + "М" : fmt(n));

function MpCard({ title, color, data }: { title: string; color: string; data: Loss | null }) {
  const dedPct = data && data.retail > 0 ? Math.round((data.totalDeductions / data.retail) * 100) : 0;
  const netPct = data && data.retail > 0 ? Math.round((data.payout / data.retail) * 100) : 0;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-xs font-extrabold text-white ${color}`}>{title}</span>
      </div>
      {!data ? <div className="py-8 text-center text-gray-300"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
        : data.noCabinet ? <div className="py-6 text-sm text-gray-400">Кабинет не подключён</div>
        : data.error ? <div className="py-6 text-sm text-red-500 break-words">{data.error}</div>
        : (
          <>
            <div className="mb-3 grid grid-cols-3 gap-2 text-center">
              <div><div className="text-[10px] uppercase text-gray-400">Выручка</div><div className="text-lg font-bold">{M(data.retail)}</div></div>
              <div><div className="text-[10px] uppercase text-gray-400">Удержано</div><div className="text-lg font-bold text-red-600">{M(data.totalDeductions)}</div><div className="text-[10px] text-red-400">{dedPct}%</div></div>
              <div><div className="text-[10px] uppercase text-gray-400">К выплате</div><div className="text-lg font-bold text-emerald-700">{M(data.payout)}</div><div className="text-[10px] text-emerald-500">{netPct}%</div></div>
            </div>
            <div className="space-y-1.5">
              {data.items.slice(0, 5).map((it) => {
                const max = data.items[0]?.rub || 1;
                return (
                  <div key={it.key} className="flex items-center gap-2 text-xs">
                    <span className="w-40 shrink-0 truncate text-gray-600">{it.label}</span>
                    <div className="h-3 flex-1 overflow-hidden rounded bg-gray-100"><div className={color} style={{ width: `${Math.max(3, (it.rub / max) * 100)}%`, height: "100%" }} /></div>
                    <span className="w-20 shrink-0 text-right tabular-nums font-medium">{fmt(it.rub)}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
    </div>
  );
}

export default function SummaryPage() {
  const [weeks, setWeeks] = useState(4);
  const [wb, setWb] = useState<Loss | null>(null);
  const [oz, setOz] = useState<Loss | null>(null);
  const [ozonCab, setOzonCab, ozonReady] = useActiveCabinet("ozon");
  const [wbCab, setWbCab, wbReady] = useActiveCabinet("wb");

  useEffect(() => {
    if (!ozonReady || !wbReady) return;
    setWb(null); setOz(null);
    fetch(`/api/wb/losses?weeks=${weeks}${wbCab ? `&cabinet=${wbCab}` : ""}`, { cache: "no-store" }).then((r) => r.json()).then(setWb).catch(() => setWb({ retail: 0, payout: 0, totalDeductions: 0, items: [], error: "сеть" }));
    fetch(`/api/ozon/losses?weeks=${weeks}${ozonCab ? `&cabinet=${ozonCab}` : ""}`, { cache: "no-store" }).then((r) => r.json()).then(setOz).catch(() => setOz({ retail: 0, payout: 0, totalDeductions: 0, items: [], error: "сеть" }));
  }, [weeks, wbCab, ozonCab, wbReady, ozonReady]);

  const both = wb && oz && !wb.error && !oz.error && !wb.noCabinet && !oz.noCabinet;
  const totRetail = (wb?.retail ?? 0) + (oz?.retail ?? 0);
  const totDed = (wb?.totalDeductions ?? 0) + (oz?.totalDeductions ?? 0);
  const totPayout = (wb?.payout ?? 0) + (oz?.payout ?? 0);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <FinanceTabs />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 text-violet-700"><Scale className="h-5 w-5" /></div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Сводка по маркетплейсам</h1>
          <p className="text-sm text-gray-500">WB и Ozon рядом: выручка, удержания, к перечислению</p>
        </div>
        <CabinetSwitcher mp="wb" accent="violet" onChange={setWbCab} />
        <CabinetSwitcher mp="ozon" accent="sky" onChange={setOzonCab} />
        <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
          {[2, 4, 8].map((w) => (
            <button key={w} onClick={() => setWeeks(w)} className={`rounded px-3 py-1 text-xs font-semibold ${weeks === w ? "bg-white text-violet-700 shadow" : "text-gray-500"}`}>{w} нед</button>
          ))}
        </div>
      </div>

      {/* Объединённый итог */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center"><div className="text-[11px] uppercase text-gray-400">Выручка WB+Ozon</div><div className="text-2xl font-extrabold">{M(totRetail)} ₽</div></div>
        <div className="rounded-xl border border-red-200 bg-red-50/40 p-4 text-center"><div className="text-[11px] uppercase text-gray-400">Удержано всего</div><div className="text-2xl font-extrabold text-red-600">{M(totDed)} ₽</div><div className="text-[11px] text-red-400">{totRetail > 0 ? Math.round((totDed / totRetail) * 100) : 0}% от выручки</div></div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 text-center"><div className="text-[11px] uppercase text-gray-400">К перечислению</div><div className="text-2xl font-extrabold text-emerald-700">{M(totPayout)} ₽</div></div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <MpCard title="WB" color="bg-violet-600" data={wb} />
        <MpCard title="OZON" color="bg-sky-600" data={oz} />
      </div>

      {both && (
        <div className="mt-5 rounded-xl border border-gray-200 bg-white p-5 text-sm">
          <div className="mb-2 font-semibold text-gray-700">Сравнение нагрузки маркетплейсов</div>
          <div className="text-gray-600">
            WB удерживает <b className="text-red-600">{wb!.retail > 0 ? Math.round((wb!.totalDeductions / wb!.retail) * 100) : 0}%</b> выручки,
            Ozon — <b className="text-red-600">{oz!.retail > 0 ? Math.round((oz!.totalDeductions / oz!.retail) * 100) : 0}%</b>.
            {" "}Выгоднее по чистому выходу: <b>{(wb!.payout / Math.max(1, wb!.retail)) >= (oz!.payout / Math.max(1, oz!.retail)) ? "Wildberries" : "Ozon"}</b>.
          </div>
        </div>
      )}
    </div>
  );
}
