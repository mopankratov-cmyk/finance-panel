"use client";

import { useEffect, useState } from "react";
import { Loader2, LineChart } from "lucide-react";
import { useActiveCabinet } from "@/lib/useActiveCabinet";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { FinanceTabs } from "@/components/FinanceTabs";

type WB = { revenue_before_spp: number; coinvest: number | null; revenue: number; commission: number; logistics: number | null; storage: number | null; penalty: number | null; notComputed?: string[]; acquiring: number; ad: number; other: number; cogs: number; tax: number; profit: number; margin: number; error?: string };
type OZ = { revenue: number; commission: number; delivery: number; services: number; cogs: number; tax: number; profit: number; margin: number; error?: string; noCabinet?: boolean };

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");

function Line({ label, v, kind }: { label: string; v: number | null | undefined; kind?: "minus" | "sum" | "head" }) {
  if (v == null) return null;
  return (
    <div className={`flex items-center justify-between px-4 py-1.5 ${kind === "sum" ? "border-t-2 border-gray-300 bg-gray-50 font-bold" : "border-t border-gray-100"}`}>
      <span className={kind === "head" ? "font-semibold text-gray-800" : "text-gray-600"}>{label}</span>
      <span className={`tabular-nums ${kind === "minus" ? "text-red-500" : kind === "sum" ? (v >= 0 ? "text-emerald-700" : "text-red-600") : "text-gray-900"}`}>
        {kind === "minus" ? "−" : ""}{fmt(Math.abs(v))} ₽
      </span>
    </div>
  );
}

export default function PnlPage() {
  const [weeks, setWeeks] = useState(4);
  const [tax, setTax] = useState(7);
  const [data, setData] = useState<{ wb: WB; ozon: OZ } | null>(null);
  const [loading, setLoading] = useState(true);
  const [ozonCab, setOzonCab, ozonReady] = useActiveCabinet("ozon");
  const [wbCab, setWbCab, wbReady] = useActiveCabinet("wb");

  useEffect(() => {
    if (!ozonReady || !wbReady) return;
    let ignore = false;
    setLoading(true);
    const q = `weeks=${weeks}&tax=${tax}${ozonCab ? `&cabinet=${ozonCab}` : ""}${wbCab ? `&wb_cabinet=${wbCab}` : ""}`;
    fetch(`/api/opiu/mp?${q}`, { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (!ignore) setData({ wb: d.wb, ozon: d.ozon }); })
      .catch(() => { if (!ignore) setData(null); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [weeks, tax, ozonCab, wbCab, ozonReady, wbReady]);

  const wb = data?.wb, oz = data?.ozon;
  const totProfit = (wb && !wb.error ? wb.profit : 0) + (oz && !oz.error ? oz.profit : 0);
  const totRev = (wb && !wb.error ? wb.revenue : 0) + (oz && !oz.error ? oz.revenue : 0);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <FinanceTabs />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><LineChart className="h-5 w-5" /></div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">ОПиУ маркетплейсов</h1>
          <p className="text-sm text-gray-500">P&L от выручки до СПП + соинвест · WB и Ozon</p>
        </div>
        <CabinetSwitcher mp="wb" accent="violet" onChange={setWbCab} />
        <CabinetSwitcher mp="ozon" accent="sky" onChange={setOzonCab} />
        <label className="flex items-center gap-1.5 text-sm text-gray-500">Налог
          <input type="number" value={tax} onChange={(e) => setTax(Number(e.target.value))} className="w-16 rounded border border-gray-300 px-2 py-1 text-right text-sm" />%
        </label>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
          {[2, 4, 8].map((w) => <button key={w} onClick={() => setWeeks(w)} className={`rounded px-3 py-1 text-xs font-semibold ${weeks === w ? "bg-white text-emerald-700 shadow" : "text-gray-500"}`}>{w} нед</button>)}
        </div>
      </div>

      {/* объединённая прибыль */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center"><div className="text-[11px] uppercase text-gray-400">Выручка WB+Ozon</div><div className="text-2xl font-extrabold">{fmt(totRev)} ₽</div></div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 text-center"><div className="text-[11px] uppercase text-gray-400">Чистая прибыль</div><div className={`text-2xl font-extrabold ${totProfit >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt(totProfit)} ₽</div></div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center"><div className="text-[11px] uppercase text-gray-400">Маржа общая</div><div className="text-2xl font-extrabold">{totRev > 0 ? Math.round((totProfit / totRev) * 1000) / 10 : 0}%</div></div>
      </div>

      {loading ? <div className="py-16 text-center text-gray-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div> : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* WB */}
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between bg-violet-600 px-4 py-2 text-white"><span className="font-bold">WB</span>{wb && !wb.error && <span className="text-sm">маржа {wb.margin}%</span>}</div>
            {!wb ? null : wb.error ? <div className="p-4 text-sm text-red-500">{wb.error}</div> : (
              <>
                <Line label="Выручка до СПП" v={wb.revenue_before_spp} kind="head" />
                <Line label="+ Соинвест" v={wb.coinvest} />
                <Line label="Себестоимость" v={wb.cogs} kind="minus" />
                <Line label="Комиссия WB" v={wb.commission} kind="minus" />
                <Line label="Логистика" v={wb.logistics} kind="minus" />
                <Line label="Хранение" v={wb.storage} kind="minus" />
                <Line label="Реклама" v={wb.ad} kind="minus" />
                <Line label="Эквайринг" v={wb.acquiring} kind="minus" />
                <Line label="Штрафы" v={wb.penalty} kind="minus" />
                <Line label="Прочие удержания" v={wb.other} kind="minus" />
                <Line label={`Налог ${tax}%`} v={wb.tax} kind="minus" />
                <Line label="Чистая прибыль" v={wb.profit} kind="sum" />
                {wb.notComputed?.length ? (
                  <p className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
                    В этой сводке не учтены: {wb.notComputed.join(", ")} — прибыль без них завышена. Полный разбор с логистикой и хранением — на вкладке «WB недельный».
                  </p>
                ) : null}
              </>
            )}
          </div>
          {/* Ozon */}
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between bg-sky-600 px-4 py-2 text-white"><span className="font-bold">OZON</span>{oz && !oz.error && <span className="text-sm">маржа {oz.margin}%</span>}</div>
            {!oz ? null : oz.noCabinet ? <div className="p-4 text-sm text-gray-400">Кабинет не подключён</div> : oz.error ? <div className="p-4 text-sm text-red-500">{oz.error}</div> : (
              <>
                <Line label="Выручка (начислено)" v={oz.revenue} kind="head" />
                <Line label="Себестоимость" v={oz.cogs} kind="minus" />
                <Line label="Комиссия Ozon" v={oz.commission} kind="minus" />
                <Line label="Логистика и обработка" v={oz.delivery} kind="minus" />
                <Line label="Услуги (реклама/хранение)" v={oz.services} kind="minus" />
                <Line label={`Налог ${tax}%`} v={oz.tax} kind="minus" />
                <Line label="Чистая прибыль" v={oz.profit} kind="sum" />
              </>
            )}
          </div>
        </div>
      )}
      <p className="mt-3 text-[11px] text-gray-400">WB: выручка считается от цены до СПП (retail_price_withdisc_rub) по кэшу продаж; логистика, хранение, штрафы и соинвест в эту сводку не входят. Ozon: от начисленного (accruals_for_sale). Налог — % от выручки, настраивается.</p>
    </div>
  );
}
