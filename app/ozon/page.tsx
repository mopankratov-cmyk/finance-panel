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

// Условное форматирование (пороги в стиле infernoff): тёмно-зел/зел/жёлт/красный
const HEAT = { dg: "#22c55e", g: "#86efac", y: "#fef08a", r: "#fca5a5" };
function heat(field: string, v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "";
  switch (field) {
    case "drr": // ниже — лучше
      if (v <= 0) return ""; if (v < 10) return HEAT.dg; if (v < 20) return HEAT.g; if (v < 30) return HEAT.y; return HEAT.r;
    case "margin": // чистая маржа (после ДРР+налог)
      if (v < 0) return HEAT.r; if (v < 10) return HEAT.y; if (v < 25) return HEAT.g; return HEAT.dg;
    case "cr_cart": // показы(охват)→корзина на Ozon мал по природе
      if (v <= 0) return ""; if (v < 0.3) return HEAT.r; if (v < 0.8) return HEAT.y; if (v < 1.5) return HEAT.g; return HEAT.dg;
    case "cr_order":
      if (v <= 0) return ""; if (v < 5) return HEAT.r; if (v < 15) return HEAT.y; if (v < 30) return HEAT.g; return HEAT.dg;
    default: return "";
  }
}

interface Metric { field: string; label: string; kind: string; daily: number[]; total: number; group_start?: boolean }
interface RnpSku { sku: string; name: string; img_url: string | null; metrics: Metric[] }
interface FunnelRow { sku: string; name: string; img_url: string | null; hits_view: number; hits_tocart: number; ordered_units: number; revenue: number; cr_cart: number | null; cr_order: number | null }
interface UnitRow { art: string; name: string; img_url: string | null; price: number; cost: number; units: number; commission_pct: number; commission_rub: number; logistics: number; acquiring: number; ad: number; drr: number; tax: number; profit: number; margin: number | null }
interface StockRow { art: string; name: string; img_url: string | null; free: number; reserved: number; byWh: Record<string, number> }

function Thumb({ src, size = 36 }: { src: string | null; size?: number }) {
  const s = { width: size, height: size };
  if (!src) return <div className="shrink-0 rounded bg-gray-100" style={s} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" style={s} className="shrink-0 rounded border border-gray-200 object-cover" onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />;
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
  const [funnelAvail, setFunnelAvail] = useState(true);
  const [unit, setUnit] = useState<UnitRow[]>([]);
  const [unitTax, setUnitTax] = useState(7);
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
      else if (tab === "funnel") { setFunnel(d.rows ?? []); setFunnelAvail(d.funnel !== false); }
      else if (tab === "unit") { setUnit(d.rows ?? []); setUnitTax(d.taxPct ?? 7); }
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
          <div>
            <div className="mb-2 flex items-center gap-3 text-[11px] text-gray-500">
              <span>ДРР / конверсии:</span><Legend />
            </div>
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
          </div>
        ) : tab === "funnel" ? (
          <div>
            {!funnelAvail && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
                Воронка показов и корзины (показы → в корзину → CR) доступна только в подписке <b>Ozon Premium Plus</b> — без неё Ozon эти метрики не отдаёт. Показаны реальные <b>заказы и выручка</b>.
              </div>
            )}
            <FunnelSummary rows={flt(funnel)} avail={funnelAvail} />
            <div className="mb-2 flex items-center gap-3 text-[11px] text-gray-500">
              <span>Конверсии:</span><Legend />
            </div>
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
                    <td className="px-3 py-2 text-right tabular-nums text-gray-400">{funnelAvail ? fmt(r.hits_view) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-400">{funnelAvail ? fmt(r.hits_tocart) : "—"}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums" style={{ background: funnelAvail ? heat("cr_cart", r.cr_cart) : undefined }}>{funnelAvail ? pct(r.cr_cart) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt(r.ordered_units)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums" style={{ background: funnelAvail ? heat("cr_order", r.cr_order) : undefined }}>{funnelAvail ? pct(r.cr_order) : "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        ) : tab === "unit" ? (
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
              <span><b className="text-gray-700">Чистая маржа</b> = цена − себес − комиссия − логистика − эквайринг − реклама − налог</span>
              <Legend />
              <span>Цена = выручка/заказы (реальная за 14 дн), налог {unitTax}%</span>
            </div>
            <div className="overflow-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                <tr>{["Артикул", "Цена ₽", "Себес ₽", "Комиссия ₽", "Логистика ₽", "Эквайринг ₽", "Реклама ₽", "Налог ₽", "Прибыль/ед ₽", "Маржа %"].map((h, i) => (
                  <th key={h} className={`px-3 py-2 ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>))}</tr>
              </thead>
              <tbody>
                {flt(unit).map((r) => (
                  <tr key={r.art} className={`border-t border-gray-100 hover:bg-gray-50 ${(r.margin ?? 0) < 0 ? "bg-red-50/50" : ""}`}>
                    <td className="px-3 py-2"><div className="flex items-center gap-2"><Thumb src={r.img_url} size={40} /><div className="min-w-0"><div className="font-medium text-gray-800">{r.art}</div><div className="max-w-xs truncate text-[11px] text-gray-400">{r.name}</div></div></div></td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.price)}{r.units > 0 && <div className="text-[10px] font-normal text-gray-400">{r.units} зак.</div>}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.cost === 0 ? "text-amber-500" : ""}`}>{r.cost === 0 ? "нет" : fmt(r.cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmt(r.commission_rub)}<div className="text-[10px] text-gray-400">{r.commission_pct}%</div></td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmt(r.logistics)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmt(r.acquiring)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.ad ? fmt(r.ad) : "—"}{r.drr > 0 && <div className="text-[10px] text-gray-400">ДРР {r.drr}%</div>}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmt(r.tax)}</td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums ${r.profit < 0 ? "text-red-600" : "text-emerald-700"}`}>{fmt(r.profit)}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums" style={{ background: heat("margin", r.margin) }}>{pct(r.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
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

function Legend() {
  const items: [string, string][] = [[HEAT.r, "плохо"], [HEAT.y, "ниже нормы"], [HEAT.g, "норма"], [HEAT.dg, "отлично"]];
  return (
    <span className="flex items-center gap-2">
      {items.map(([c, l]) => (
        <span key={l} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: c }} />{l}</span>
      ))}
    </span>
  );
}

function FunnelSummary({ rows, avail }: { rows: FunnelRow[]; avail: boolean }) {
  const views = rows.reduce((s, r) => s + r.hits_view, 0);
  const cart = rows.reduce((s, r) => s + r.hits_tocart, 0);
  const orders = rows.reduce((s, r) => s + r.ordered_units, 0);
  const revenue = rows.reduce((s, r) => s + r.revenue, 0);
  // воронка недоступна (нет Premium Plus) → показываем только реальные заказы/выручку
  if (!avail) {
    if (!orders && !revenue) return null;
    return (
      <div className="mb-3 grid gap-2 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-2">
        {[{ label: "Заказы, шт", val: orders }, { label: "Выручка, ₽", val: revenue }].map((c) => (
          <div key={c.label}>
            <span className="text-xs font-medium text-gray-500">{c.label}</span>
            <div className="mt-1 text-lg font-bold tabular-nums text-gray-900">{fmt(c.val)}</div>
          </div>
        ))}
      </div>
    );
  }
  if (!views) return null;
  const crCart = views ? Math.round((cart / views) * 1000) / 10 : 0;
  const crOrder = cart ? Math.round((orders / cart) * 1000) / 10 : 0;
  const stages = [
    { label: "Показы", val: views, w: 100, color: "bg-sky-500" },
    { label: "В корзину", val: cart, w: views ? Math.max(8, (cart / views) * 100) : 0, color: "bg-indigo-500", cr: crCart, crField: "cr_cart" },
    { label: "Заказы", val: orders, w: views ? Math.max(6, (orders / views) * 100) : 0, color: "bg-emerald-500", cr: crOrder, crField: "cr_order" },
  ];
  return (
    <div className="mb-3 grid gap-2 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-3">
      {stages.map((s) => (
        <div key={s.label}>
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-gray-500">{s.label}</span>
            {"cr" in s && <span className="rounded px-1.5 text-[11px] font-semibold tabular-nums" style={{ background: heat(s.crField as string, s.cr as number) || "#f1f5f9" }}>CR {s.cr}%</span>}
          </div>
          <div className="mt-1 text-lg font-bold tabular-nums text-gray-900">{fmt(s.val)}</div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100"><div className={`h-full rounded-full ${s.color}`} style={{ width: `${s.w}%` }} /></div>
        </div>
      ))}
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
          <span className="flex items-center gap-2.5">
            {img !== undefined && <Thumb src={img ?? null} size={44} />}
            <span className="flex flex-col leading-tight"><span>{title}</span>{sub && <span className="text-[10px] font-normal text-gray-400">{sub}</span>}</span>
          </span>
        </td>
      </tr>
      {metrics.map((m) => (
        <tr key={m.field} className={`border-t hover:bg-gray-50/50 ${m.group_start ? "border-gray-300" : "border-gray-100"}`}>
          <td className="sticky left-0 z-10 bg-white px-3 py-1 text-gray-500" style={{ minWidth: 240 }}>{m.label}</td>
          {m.daily.map((v, i) => (
            <td key={i} className={`px-2 py-1 text-center tabular-nums ${v ? "text-gray-800" : "text-gray-300"}`} style={{ background: heat(m.field, v) }}>{cell(m, v) || "·"}</td>
          ))}
          <td className="px-3 py-1 text-right font-semibold tabular-nums text-gray-900" style={{ background: heat(m.field, m.total) }}>{cell(m, m.total) || "0"}</td>
        </tr>
      ))}
    </>
  );
}
