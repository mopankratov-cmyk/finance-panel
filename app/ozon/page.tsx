"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { ModuleMenu } from "@/components/ModuleMenu";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { useActiveCabinet } from "@/lib/useActiveCabinet";

type Tab = "rnp" | "funnel" | "unit" | "stocks";
const fmt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("ru-RU"));
const fmtMoney = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString("ru-RU") : String(Math.round(n)));
const pct = (n: number | null | undefined) => (n == null ? "—" : n + "%");

interface Metric { field: string; label: string; kind: string; daily: number[]; total: number; group_start?: boolean }
interface RnpSku { sku: string; name: string; img_url: string | null; metrics: Metric[] }
interface FunnelRow { sku: string; name: string; img_url: string | null; hits_view: number; hits_tocart: number; ordered_units: number; revenue: number; cr_cart: number | null; cr_order: number | null }
interface UnitRow { art: string; name: string; img_url: string | null; price: number; cost: number; commission_pct: number; commission_rub: number; logistics: number; acquiring: number; profit: number; margin: number | null }
interface StockRow { art: string; name: string; img_url: string | null; free: number; reserved: number; byWh: Record<string, number> }

function Thumb({ src }: { src: string | null }) {
  if (!src) return <div className="h-9 w-9 shrink-0 rounded bg-gray-100" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded object-cover" onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />;
}

export default function OzonPage() {
  const [tab, setTab] = useState<Tab>("rnp");
  const [days, setDays] = useState(14);
  const [cabId, setCabId] = useActiveCabinet("ozon");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [noCab, setNoCab] = useState(false);
  const [q, setQ] = useState("");
  const [rnp, setRnp] = useState<{ period: { label: string; period_type: string }[]; summary: Metric[]; skus: RnpSku[] }>({ period: [], summary: [], skus: [] });
  const [funnel, setFunnel] = useState<FunnelRow[]>([]);
  const [unit, setUnit] = useState<UnitRow[]>([]);
  const [stocks, setStocks] = useState<{ rows: StockRow[]; warehouses: string[]; totalFree: number }>({ rows: [], warehouses: [], totalFree: 0 });

  const [reload, setReload] = useState(0);
  const [adWarmed, setAdWarmed] = useState<Set<number>>(new Set());

  // подогрев кэша per-SKU рекламы при заходе на РНП (фоном)
  useEffect(() => {
    if (tab !== "rnp" || adWarmed.has(days)) return;
    setAdWarmed((s) => new Set(s).add(days));
    fetch(`/api/ozon/ad-sku?days=${days}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d.refreshed && Object.keys(d.bySku || {}).length) setReload((n) => n + 1); })
      .catch(() => {});
  }, [tab, days, adWarmed]);

  useEffect(() => {
    setLoading(true); setErr(null); setNoCab(false);
    const cab = cabId ? `${tab === "unit" || tab === "stocks" ? "?" : "&"}cabinet=${cabId}` : "";
    const url = (tab === "rnp" ? `/api/ozon/rnp?days=${days}` : tab === "funnel" ? `/api/ozon/analytics?days=${days}` : tab === "unit" ? "/api/ozon/unit" : "/api/ozon/stocks") + cab;
    fetch(url, { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (d.noCabinet) { setNoCab(true); return; }
      if (d.error) { setErr(d.error); return; }
      if (tab === "rnp") setRnp({ period: d.period ?? [], summary: d.summary ?? [], skus: d.skus ?? [] });
      else if (tab === "funnel") setFunnel(d.rows ?? []);
      else if (tab === "unit") setUnit(d.rows ?? []);
      else setStocks({ rows: d.rows ?? [], warehouses: d.warehouses ?? [], totalFree: d.totalFree ?? 0 });
    }).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, [tab, days, reload, cabId]);

  const flt = <T extends { name: string; art?: string; sku?: string }>(rows: T[]) => {
    const s = q.toLowerCase().trim();
    return s ? rows.filter((r) => r.name.toLowerCase().includes(s) || (r.art || r.sku || "").toLowerCase().includes(s)) : rows;
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: "rnp", label: "РНП" }, { key: "funnel", label: "Воронка" },
    { key: "unit", label: "Юнит-экономика" }, { key: "stocks", label: "Остатки" },
  ];

  // ячейка метрики РНП
  const cell = (m: Metric, v: number) => {
    if (m.kind === "pct") return v ? v + "%" : "";
    if (m.kind === "money") return v ? fmtMoney(v) : "";
    return v ? fmt(v) : "";
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Шапка в стиле inferno */}
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-5 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-sky-500 to-blue-700 text-xs font-extrabold text-white">OZ</div>
          <div className="text-base font-extrabold tracking-tight">Ozon Аналитика</div>
          <span className="ml-1 flex items-center gap-1.5 text-xs text-gray-500"><span className="h-2 w-2 rounded-full bg-green-400" /> система работает</span>
          <div className="ml-auto"><CabinetSwitcher mp="ozon" accent="sky" onChange={setCabId} /></div>
          <Link href="/losses" className="text-xs font-semibold text-red-600 hover:text-red-700">↘ Где теряем</Link>
          <ModuleMenu accent="sky" />
        </div>
        {/* Таб-бар */}
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-5 pb-2">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`shrink-0 whitespace-nowrap rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors ${tab === t.key ? "bg-sky-600 text-white shadow" : "text-gray-600 hover:bg-gray-100"}`}>
              {t.label}
            </button>
          ))}
          {(tab === "rnp" || tab === "funnel") && (
            <div className="ml-2 flex gap-1 rounded-md bg-gray-100 p-0.5">
              {[7, 14, 30].map((d) => (
                <button key={d} onClick={() => setDays(d)} className={`rounded px-2.5 py-1 text-xs font-semibold ${days === d ? "bg-white text-sky-700 shadow" : "text-gray-500"}`}>{d} дн</button>
              ))}
            </div>
          )}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="поиск по артикулу/названию"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-sky-500 focus:outline-none sm:ml-auto sm:w-64" />
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-5 py-4">
        {noCab ? (
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">Нет подключённого Ozon-кабинета → <Link href="/cabinets" className="font-semibold underline">добавить</Link></div>
        ) : loading ? (
          <div className="py-20 text-center text-gray-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
        ) : err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">Ozon: {err}</div>
        ) : tab === "rnp" ? (
          <div className="overflow-auto rounded-xl border border-gray-200 bg-white">
            <table className="border-collapse text-xs">
              <thead>
                <tr className="bg-gray-800 text-gray-100">
                  <th className="sticky left-0 z-20 bg-gray-800 px-3 py-2 text-left font-semibold" style={{ minWidth: 240 }}>Товар / Метрика</th>
                  {rnp.period.map((p, i) => (
                    <th key={i} className="px-2 py-1 text-center font-medium" style={{ minWidth: 52 }}>
                      <div>{p.label}</div><div className="text-[9px] font-normal text-gray-400">{p.period_type}</div>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold">Итого</th>
                </tr>
              </thead>
              <tbody>
                {/* сводка */}
                <RnpGroup title="ОБЩЕЕ ПО КАБИНЕТУ" metrics={rnp.summary} period={rnp.period} cell={cell} highlight />
                {flt(rnp.skus).map((s) => (
                  <RnpGroup key={s.sku} title={s.name} sub={`sku ${s.sku}`} img={s.img_url} metrics={s.metrics} period={rnp.period} cell={cell} />
                ))}
              </tbody>
            </table>
          </div>
        ) : tab === "funnel" ? (
          <div className="overflow-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                <tr>{["Товар", "Показы", "В корзину", "CR корзина", "Заказы шт", "CR заказ", "Выручка ₽"].map((h, i) => (
                  <th key={h} className={`px-3 py-2 ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>))}</tr>
              </thead>
              <tbody>
                {flt(funnel).map((r) => (
                  <tr key={r.sku} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2"><div className="flex items-center gap-2"><Thumb src={r.img_url} /><div className="min-w-0"><div className="max-w-md truncate text-gray-800">{r.name}</div><div className="text-[11px] text-gray-400">sku {r.sku}</div></div></div></td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.hits_view)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.hits_tocart)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{pct(r.cr_cart)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt(r.ordered_units)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{pct(r.cr_order)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : tab === "unit" ? (
          <div className="overflow-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                <tr>{["Артикул", "Цена ₽", "Себес ₽", "Комиссия %", "Комиссия ₽", "Логистика ₽", "Эквайринг ₽", "Прибыль/ед ₽", "Маржа %"].map((h, i) => (
                  <th key={h} className={`px-3 py-2 ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>))}</tr>
              </thead>
              <tbody>
                {flt(unit).map((r) => (
                  <tr key={r.art} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2"><div className="flex items-center gap-2"><Thumb src={r.img_url} /><div className="min-w-0"><div className="font-medium text-gray-800">{r.art}</div><div className="max-w-xs truncate text-[11px] text-gray-400">{r.name}</div></div></div></td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.price)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.cost === 0 ? "text-amber-500" : ""}`}>{r.cost === 0 ? "нет" : fmt(r.cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.commission_pct}%</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmt(r.commission_rub)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmt(r.logistics)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmt(r.acquiring)}</td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums ${r.profit < 0 ? "text-red-600" : "text-emerald-700"}`}>{fmt(r.profit)}</td>
                    <td className={`px-3 py-2 text-right font-bold tabular-nums ${(r.margin ?? 0) < 0 ? "text-red-600" : (r.margin ?? 0) < 15 ? "text-amber-600" : "text-emerald-700"}`}>{pct(r.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                <tr><th className="px-3 py-2 text-left">Товар</th><th className="px-3 py-2 text-right">Свободно</th><th className="px-3 py-2 text-right">Резерв</th><th className="px-3 py-2 text-left">Топ складов</th></tr>
              </thead>
              <tbody>
                {flt(stocks.rows).map((r) => {
                  const top = Object.entries(r.byWh).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
                  return (
                    <tr key={r.art} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2"><div className="flex items-center gap-2"><Thumb src={r.img_url} /><div className="min-w-0"><div className="font-medium text-gray-800">{r.art}</div><div className="max-w-xs truncate text-[11px] text-gray-400">{r.name}</div></div></div></td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${r.free < 10 ? "text-red-600" : ""}`}>{fmt(r.free)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmt(r.reserved)}</td>
                      <td className="px-3 py-2 text-[11px] text-gray-500">{top.map(([w, v]) => `${w.replace(/_РФЦ$/, "")} ${v}`).join(" · ") || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function RnpGroup({ title, sub, img, metrics, period, cell, highlight }: {
  title: string; sub?: string; img?: string | null; metrics: Metric[]; period: { label: string }[]; cell: (m: Metric, v: number) => string; highlight?: boolean;
}) {
  return (
    <>
      <tr className={highlight ? "bg-sky-50" : "bg-gray-50/60"}>
        <td className={`sticky left-0 z-10 px-3 py-1.5 font-semibold ${highlight ? "bg-sky-50 text-sky-800" : "bg-gray-50 text-gray-700"}`} colSpan={period.length + 2}>
          <span className="flex items-center gap-2">
            {img !== undefined && <Thumb src={img ?? null} />}
            <span>{title}{sub && <span className="ml-2 text-[10px] font-normal text-gray-400">{sub}</span>}</span>
          </span>
        </td>
      </tr>
      {metrics.map((m) => (
        <tr key={m.field} className="border-t border-gray-100 hover:bg-gray-50/50">
          <td className="sticky left-0 z-10 bg-white px-3 py-1 text-gray-500" style={{ minWidth: 240 }}>{m.label}</td>
          {m.daily.map((v, i) => (
            <td key={i} className={`px-2 py-1 text-center tabular-nums ${v ? "text-gray-800" : "text-gray-300"}`}>{cell(m, v) || "·"}</td>
          ))}
          <td className="px-3 py-1 text-right font-semibold tabular-nums text-gray-900">{cell(m, m.total) || "0"}</td>
        </tr>
      ))}
    </>
  );
}
