"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { nextSortState, sortRows, type SortState } from "@/lib/ozon/tableSort";
import { OzonModuleHeader } from "./OzonModuleHeader";
import { OzonCsvButton, EmptyState, SortableTh, Freshness, MetricCard, OzonError, OzonLoading, OzonStaleNotice, OzonWarnings, formatDateTime, formatMoney, formatNumber } from "./OzonUi";
import { csvFileName, downloadCsv } from "@/lib/ozon/csvExport";
import { useOzonCabinet } from "./OzonCabinetContext";
import { useOzonCockpit } from "./useOzonCockpit";
import { useOzonUrlFilter } from "./useOzonUrlFilter";
import { useOzonPeriod } from "./useOzonPeriod";

interface OrderProduct { offerId: string; name: string; quantity: number; price: number }
interface OrderRow { key: string; cabinet: string; scheme: "FBO" | "FBS"; postingNumber: string; status: string; statusLabel: string; stage: "shipping" | "transit" | "delivered" | "cancelled" | "problem" | "unknown"; createdAt: string | null; shipmentDate: string | null; products: OrderProduct[]; units: number; amount: number; cancelled: boolean; delivered: boolean; awaitingShipment: boolean; delayed: boolean }
interface OrdersData { generatedAt: string; scope: { label: string; count: number }; period: { days: number; from: string; to: string }; summary: { postings: number; units: number; amount: number; active: number; delivered: number; cancelled: number; delayed: number; awaitingShipment: number; refunds: number }; rows: OrderRow[]; warnings: string[] }

// Просрочка перебивает подпись статуса: менеджеру важнее «сроки горят», чем
// «ожидает отгрузки». В остальном показываем русскую подпись статуса Ozon —
// именно ту, что он увидит в кабинете.
type OrderSortKey = "postingNumber" | "statusLabel" | "createdAt" | "shipmentDate" | "units" | "amount";

const statusLabel = (row: OrderRow) => row.delayed ? `Просрочен · ${row.statusLabel}` : row.statusLabel;
const statusTone = (row: OrderRow) => row.delayed
  ? "bg-red-50 text-red-700"
  : row.cancelled
    ? "bg-amber-50 text-amber-700"
    : row.delivered
      ? "bg-emerald-50 text-emerald-700"
      : row.stage === "problem"
        ? "bg-orange-50 text-orange-700"
        : row.awaitingShipment
          ? "bg-violet-50 text-violet-700"
          : "bg-sky-50 text-sky-700";

export function OzonOrdersPage() {
  const { noCabinets } = useOzonCabinet();
  const { period, preset, applyPreset, applyRange } = useOzonPeriod();
  const [query, setQuery] = useOzonUrlFilter<string>("q", "");
  const [scheme, setScheme] = useState<"all" | "FBO" | "FBS">("all");
  const [state, setState] = useOzonUrlFilter<"all" | "active" | "awaiting" | "delayed" | "delivered" | "cancelled">("state", "all", ["all", "active", "awaiting", "delayed", "delivered", "cancelled"]);
  const [sort, setSort] = useState<SortState<OrderSortKey> | null>(null);
  const { data, loading, error, updating, refresh, reload } = useOzonCockpit<OrdersData>("orders", period);
  const rows = useMemo(() => { const needle = query.trim().toLocaleLowerCase("ru-RU"); const filtered = (data?.rows ?? []).filter((row) => (scheme === "all" || row.scheme === scheme) && (state === "all" || (state === "active" && !row.cancelled && !row.delivered) || (state === "awaiting" && row.awaitingShipment) || (state === "delayed" && row.delayed) || (state === "delivered" && row.delivered) || (state === "cancelled" && row.cancelled)) && (!needle || `${row.postingNumber} ${row.status} ${row.statusLabel} ${row.cabinet} ${row.products.map((product) => `${product.name} ${product.offerId}`).join(" ")}`.toLocaleLowerCase("ru-RU").includes(needle)));
    // Порядок сервера — новые сверху; он же возвращается третьим кликом.
    return sortRows(filtered, sort, (row, key) => row[key]); }, [data?.rows, query, scheme, sort, state]);
  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      csvFileName(["ozon-заказы", data.scope.label, data.period.from, data.period.to]),
      [
        { header: "Отправление", value: (row: OrderRow) => row.postingNumber },
        { header: "Кабинет", value: (row: OrderRow) => row.cabinet },
        { header: "Схема", value: (row: OrderRow) => row.scheme },
        { header: "Статус", value: (row: OrderRow) => row.statusLabel },
        { header: "Статус Ozon", value: (row: OrderRow) => row.status },
        { header: "Просрочен", value: (row: OrderRow) => row.delayed ? "да" : "нет" },
        { header: "Создан", value: (row: OrderRow) => row.createdAt },
        { header: "Отгрузка до", value: (row: OrderRow) => row.shipmentDate },
        { header: "Товары", value: (row: OrderRow) => row.products.map((p) => `${p.offerId || p.name} x${p.quantity}`).join(", ") },
        { header: "Штук", value: (row: OrderRow) => row.units },
        { header: "Сумма, ₽", value: (row: OrderRow) => row.amount },
      ],
      rows,
    );
  };
  return <div>
    <OzonModuleHeader eyebrow="Ozon · Операции" title="Заказы и возвраты" subtitle="FBO и FBS отправления, активные статусы, просрочки, отмены и сумма возвратов по финансовым транзакциям." period={period} preset={preset} onApplyPreset={applyPreset} onApplyRange={applyRange} onRefresh={refresh} refreshing={loading} />
    <div className={`mx-auto max-w-[1600px] space-y-4 px-4 py-4 transition-opacity sm:px-5 ${updating ? "opacity-60" : ""}`}>
      {loading && !data ? <OzonLoading rows={10} /> : noCabinets ? <EmptyState title="Кабинет Ozon не подключён" detail="Добавьте кабинет с ключами Seller API и Performance API — после этого экраны наполнятся данными." href="/cabinets" /> : error && !data ? <OzonError message={error} onRetry={reload} /> : !data ? <EmptyState title="Нет заказов" detail="Проверьте период и Seller API." /> : <>
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-semibold text-slate-600">{data.scope.label} · {data.period.from} — {data.period.to}</div><Freshness generatedAt={data.generatedAt} /></div>{error ? <OzonStaleNotice message={error} onRetry={reload} /> : null}<OzonWarnings warnings={data.warnings} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8"><MetricCard label="Отправления" value={formatNumber(data.summary.postings)} /><MetricCard label="Товаров" value={formatNumber(data.summary.units)} /><MetricCard label="Сумма" value={formatMoney(data.summary.amount)} /><MetricCard label="В работе" value={formatNumber(data.summary.active)} detail={`${formatNumber(data.summary.awaitingShipment)} ждут отгрузки`} tone={data.summary.awaitingShipment ? "amber" : "sky"} /><MetricCard label="Доставлено" value={formatNumber(data.summary.delivered)} tone="emerald" /><MetricCard label="Отменено" value={formatNumber(data.summary.cancelled)} tone={data.summary.cancelled ? "amber" : "emerald"} /><MetricCard label="Просрочено" value={formatNumber(data.summary.delayed)} tone={data.summary.delayed ? "red" : "emerald"} /><MetricCard label="Возвраты" value={formatMoney(data.summary.refunds)} tone={data.summary.refunds ? "amber" : "emerald"} /></div>
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-col gap-2 border-b border-slate-100 p-3 xl:flex-row xl:items-center"><div className="flex gap-1">{(["all", "FBO", "FBS"] as const).map((value) => <button key={value} onClick={() => setScheme(value)} className={`min-h-11 rounded-lg px-3 text-xs font-semibold sm:min-h-8 ${scheme === value ? "bg-sky-700 text-white" : "bg-slate-50 text-slate-600"}`}>{value === "all" ? "Все схемы" : value}</button>)}</div><select value={state} onChange={(event) => setState(event.target.value as typeof state)} className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 sm:h-8"><option value="all">Все статусы</option><option value="active">В работе</option><option value="awaiting">Ждут отгрузки</option><option value="delayed">Просроченные</option><option value="delivered">Доставленные</option><option value="cancelled">Отменённые</option></select><div className="xl:ml-auto"><OzonCsvButton count={rows.length} onExport={exportCsv} /></div><label className="relative flex-1 xl:max-w-sm"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} type="search" enterKeyHint="search" placeholder="Номер, товар, артикул, кабинет" className="h-11 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-xs outline-none focus:border-sky-400 sm:h-8" /></label></div>
          {rows.length === 0 ? <div className="p-4"><EmptyState title="Заказы не найдены" detail="Измените фильтр, поиск или период." /></div> : <div className="scroll-x"><table className="w-full min-w-[1120px] text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr>
            <SortableTh label="Отправление" align="left" sticky active={sort?.key === "postingNumber"} dir={sort?.dir ?? "desc"} onToggle={() => setSort((c) => nextSortState(c, "postingNumber"))} />
            <th className="px-3 py-2 text-left">Кабинет</th><th className="px-3 py-2 text-left">Схема</th>
            <SortableTh label="Статус" align="left" active={sort?.key === "statusLabel"} dir={sort?.dir ?? "desc"} onToggle={() => setSort((c) => nextSortState(c, "statusLabel"))} />
            <SortableTh label="Создан" align="left" active={sort?.key === "createdAt"} dir={sort?.dir ?? "desc"} onToggle={() => setSort((c) => nextSortState(c, "createdAt"))} />
            <SortableTh label="Отгрузка" align="left" active={sort?.key === "shipmentDate"} dir={sort?.dir ?? "desc"} onToggle={() => setSort((c) => nextSortState(c, "shipmentDate"))} hint="Просроченные видно фильтром «Просроченные»" />
            <th className="px-3 py-2 text-left">Товары</th>
            <SortableTh label="Шт." active={sort?.key === "units"} dir={sort?.dir ?? "desc"} onToggle={() => setSort((c) => nextSortState(c, "units"))} />
            <SortableTh label="Сумма" active={sort?.key === "amount"} dir={sort?.dir ?? "desc"} onToggle={() => setSort((c) => nextSortState(c, "amount"))} />
            </tr></thead><tbody>{rows.map((row) => <tr key={row.key} className="group border-t border-slate-100 align-top hover:bg-sky-50/40"><td className="sticky left-0 z-10 bg-white px-4 py-3 font-mono text-[11px] font-semibold text-slate-800 group-hover:bg-[#f9fdff]">{row.postingNumber}</td><td className="px-3 py-3 text-slate-600">{row.cabinet}</td><td className="px-3 py-3"><span className="rounded bg-slate-100 px-1.5 py-1 text-[10px] font-bold text-slate-600">{row.scheme}</span></td><td className="px-3 py-3"><span title={row.status} className={`rounded-md px-1.5 py-1 text-[10px] font-semibold ${statusTone(row)}`}>{statusLabel(row)}</span></td><td className="px-3 py-3 text-slate-500">{formatDateTime(row.createdAt)}</td><td className="px-3 py-3 text-slate-500">{formatDateTime(row.shipmentDate)}</td><td className="max-w-sm px-3 py-3 text-[11px] text-slate-600">{row.products.slice(0, 3).map((product) => `${product.offerId || product.name} × ${product.quantity}`).join(" · ")}{row.products.length > 3 ? ` · ещё ${row.products.length - 3}` : ""}</td><td className="px-3 py-3 text-right tabular-nums">{formatNumber(row.units)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{formatMoney(row.amount)}</td></tr>)}</tbody></table></div>}
        </section>
      </>}
    </div>
  </div>;
}
