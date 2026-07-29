"use client";

import { Ban, CheckCircle2, Download, Info, Loader2, RotateCcw, Save, Search, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RestrictionRow } from "@/app/api/supplies/check-restrictions/route";
import { RestrictionsPanel } from "@/components/supplies/RestrictionsPanel";
import { exportCsv } from "@/lib/analytics/format";
import { allocateByWarehouse, normalizeDistributionSettingsPayload, withoutClosedWarehouses, type DistributionWarehouseShare, type SupplyDistributionSettings } from "@/lib/supplies/distribution";
import { WbEmptyState } from "./WbModuleHeader";

export interface DistributionWarehouseInput { name: string; pct: string }
export interface DistributionSkuInput {
  nm: number;
  art: string;
  shk: string;
  wb_stock: number;
  available: number;
  qty: number[];
  excl: number[];
  wb_wh: string | null;
}

interface Props {
  cabinetId: string;
  cabinetName: string;
  canWrite: boolean;
  recommendedWarehouses: DistributionWarehouseInput[];
  skus: DistributionSkuInput[];
  defaultMinBatch: number;
  defaultPalletLiters: number;
  volumeKnown: number;
  volumeTotal: number;
}

interface SettingsResponse {
  meta?: { warnings?: string[] };
  data: { settings: SupplyDistributionSettings | null } | null;
  error: string | null;
}

const ROW_HEIGHT = 42;
const format = (value: number) => Math.round(value).toLocaleString("ru-RU");

function sameWarehouses(left: DistributionWarehouseShare[], right: DistributionWarehouseShare[]) {
  return left.length === right.length && left.map((row) => row.name).sort().join("\u0000") === right.map((row) => row.name).sort().join("\u0000");
}

export function WbSupplyDistributionPlanner({ cabinetId, cabinetName, canWrite, recommendedWarehouses, skus, defaultMinBatch, defaultPalletLiters, volumeKnown, volumeTotal }: Props) {
  const recommendation = useMemo<DistributionWarehouseShare[]>(() => recommendedWarehouses.map((warehouse) => ({ name: warehouse.name, pct: Number.parseFloat(warehouse.pct) || 0 })), [recommendedWarehouses]);
  const currentNmIds = useMemo(() => new Set(skus.map((sku) => sku.nm)), [skus]);
  const [warehouses, setWarehouses] = useState<DistributionWarehouseShare[]>(recommendation);
  const [excludedNmIds, setExcludedNmIds] = useState<Set<number>>(new Set());
  const [minBatch, setMinBatch] = useState(defaultMinBatch);
  const [palletLiters, setPalletLiters] = useState(defaultPalletLiters);
  const [query, setQuery] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restrictions, setRestrictions] = useState<RestrictionRow[]>([]);
  const [rowWindow, setRowWindow] = useState({ start: 0, end: 18 });
  const requestId = useRef(0);

  useEffect(() => {
    const current = ++requestId.current;
    setWarehouses(recommendation);
    setExcludedNmIds(new Set());
    setMinBatch(defaultMinBatch);
    setPalletLiters(defaultPalletLiters);
    setDirty(false);
    setError(null);
    setMessage(null);
    setRestrictions([]);
    if (!canWrite || !cabinetId || cabinetId === "all") return;
    const controller = new AbortController();
    setSettingsLoading(true);
    fetch(`/api/supplies/distribution-settings?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as SettingsResponse;
        if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then((body) => {
        if (current !== requestId.current) return;
        const settings = body.data?.settings;
        if (settings && sameWarehouses(settings.warehouses, recommendation)) {
          setWarehouses(settings.warehouses);
          setExcludedNmIds(new Set(settings.excludedNmIds.filter((nmId) => currentNmIds.has(nmId))));
          setMinBatch(settings.minBatch);
          setPalletLiters(settings.palletLiters);
          setMessage("Загружен сохранённый сценарий кабинета");
        } else if (settings) {
          setMessage("Состав складов изменился — показана свежая рекомендация WB");
        } else if (body.meta?.warnings?.length) {
          setMessage(body.meta.warnings[0]);
        }
      })
      .catch((cause: unknown) => { if (current === requestId.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить сценарий"); })
      .finally(() => { if (current === requestId.current) setSettingsLoading(false); });
    return () => controller.abort();
  }, [cabinetId, canWrite, currentNmIds, defaultMinBatch, defaultPalletLiters, recommendation]);

  const sumPct = useMemo(() => Math.round(warehouses.reduce((sum, warehouse) => sum + warehouse.pct, 0) * 100) / 100, [warehouses]);
  const validPct = warehouses.length > 0 && Math.abs(sumPct - 100) <= 0.01;

  const distributionRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return skus.filter((row) => !needle || `${row.nm} ${row.art} ${row.shk}`.toLocaleLowerCase("ru-RU").includes(needle)).map((row) => {
      const excluded = excludedNmIds.has(row.nm);
      const available = excluded ? 0 : minBatch > 0 ? Math.ceil(row.available / minBatch) * minBatch : row.available;
      return { ...row, excluded, available, qty: validPct ? allocateByWarehouse(available, warehouses) : warehouses.map(() => 0) };
    });
  }, [excludedNmIds, minBatch, query, skus, validPct, warehouses]);

  useEffect(() => setRowWindow({ start: 0, end: Math.min(18, distributionRows.length) }), [distributionRows.length, query]);

  const displayedTotals = useMemo(() => ({
    available: distributionRows.reduce((sum, row) => sum + row.available, 0),
    wb: distributionRows.reduce((sum, row) => sum + row.wb_stock, 0),
    qty: warehouses.map((_, index) => distributionRows.reduce((sum, row) => sum + (row.qty[index] || 0), 0)),
  }), [distributionRows, warehouses]);

  const updateWindow = (element: HTMLDivElement) => {
    const first = Math.floor(Math.max(0, element.scrollTop - 36) / ROW_HEIGHT);
    const visible = Math.ceil(element.clientHeight / ROW_HEIGHT);
    const start = Math.max(0, first - 5);
    const end = Math.min(distributionRows.length, first + visible + 6);
    setRowWindow((current) => current.start === start && current.end === end ? current : { start, end });
  };

  const markDirty = () => { setDirty(true); setError(null); setMessage(null); };
  const setShare = (index: number, pct: number) => {
    setWarehouses((current) => current.map((warehouse, rowIndex) => rowIndex === index ? { ...warehouse, pct } : warehouse));
    markDirty();
  };

  const toggleExcluded = (nmId: number) => {
    setExcludedNmIds((current) => {
      const next = new Set(current);
      if (next.has(nmId)) next.delete(nmId); else next.add(nmId);
      return next;
    });
    markDirty();
  };

  const resetRecommendation = () => {
    setWarehouses(recommendation);
    setExcludedNmIds(new Set());
    setMinBatch(defaultMinBatch);
    setPalletLiters(defaultPalletLiters);
    markDirty();
  };

  const applyRestrictions = () => {
    const closed = new Set(restrictions.filter((row) => row.status === "closed").map((row) => row.warehouse));
    if (!closed.size) { setMessage("Закрытых складов в проверке WB нет"); return; }
    const matched = warehouses.filter((warehouse) => closed.has(warehouse.name));
    if (!matched.length) { setMessage("Среди складов сценария нет закрытых"); return; }
    if (matched.length === warehouses.length) { setError("Все склады сценария закрыты для приёмки — автоматическое распределение невозможно"); return; }
    setWarehouses((current) => withoutClosedWarehouses(current, closed));
    markDirty();
  };

  const save = async () => {
    const payload = { cabinetId, warehouses, excludedNmIds: [...excludedNmIds], minBatch, palletLiters };
    const normalized = normalizeDistributionSettingsPayload(payload, cabinetId);
    if (!normalized.ok) { setError(normalized.error); return; }
    setSaving(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/supplies/distribution-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(normalized.value) });
      const body = await response.json() as SettingsResponse;
      if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
      setDirty(false);
      setMessage("Сценарий сохранён для выбранного кабинета");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить сценарий");
    } finally {
      setSaving(false);
    }
  };

  const download = () => {
    if (!validPct) { setError("Перед экспортом сумма долей должна быть 100%"); return; }
    const headers = ["Артикул", "nmId", "WB остаток", "К поставке", "Исключён", ...warehouses.map((warehouse) => `${warehouse.name}, ${warehouse.pct}%`), "Итого"];
    const rows = distributionRows.map((row) => [row.art, String(row.nm), String(row.wb_stock), String(row.available), row.excluded ? "да" : "нет", ...row.qty.map(String), String(row.qty.reduce((sum, value) => sum + value, 0))]);
    exportCsv(`wb-distribution-${cabinetName.replace(/[^a-zа-я0-9]+/gi, "-").toLocaleLowerCase("ru-RU")}-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">{warehouses.map((warehouse, index) => {
            const restriction = restrictions.find((row) => row.warehouse === warehouse.name);
            return <label key={warehouse.name} className={`rounded-xl border p-3 transition ${restriction?.status === "closed" ? "border-rose-200 bg-rose-50" : "border-violet-200 bg-violet-50/30"}`}><div className="truncate text-[10px] font-medium text-slate-600">{warehouse.name}</div><div className="mt-2 flex items-end gap-1"><input aria-label={`Доля ${warehouse.name}`} type="number" min={0} max={100} step={0.01} value={warehouse.pct} onChange={(event) => setShare(index, Number(event.target.value))} disabled={!canWrite} className="min-w-0 flex-1 border-0 bg-transparent text-xl font-bold tabular-nums text-slate-800 outline-none disabled:cursor-default" /><span className="pb-0.5 text-xs text-slate-400">%</span></div><div className={`mt-1 text-[9px] ${restriction?.status === "closed" ? "text-rose-600" : restriction?.status === "paid" ? "text-amber-600" : "text-slate-400"}`}>{restriction?.status === "closed" ? "приёмка закрыта" : restriction?.status === "paid" ? `приёмка ×${restriction.coefficient}` : `${format(displayedTotals.qty[index] || 0)} шт`}</div></label>;
          })}</div>
          <div className="grid shrink-0 grid-cols-2 gap-2 xl:w-64"><label className="text-[10px] font-medium text-slate-500">Мин. партия, шт<input type="number" min={0} step={10} value={minBatch} onChange={(event) => { setMinBatch(Math.max(0, Number(event.target.value) || 0)); markDirty(); }} disabled={!canWrite} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-right text-xs tabular-nums outline-none focus:border-violet-400" /></label><label className="text-[10px] font-medium text-slate-500">Паллета, литров<input type="number" min={0} value={palletLiters} onChange={(event) => { setPalletLiters(Math.max(0, Number(event.target.value) || 0)); markDirty(); }} disabled={!canWrite} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-right text-xs tabular-nums outline-none focus:border-violet-400" /></label></div>
        </div>
        <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3 lg:flex-row lg:items-center">
          <label className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 lg:max-w-sm"><Search className="h-3.5 w-3.5 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="артикул, nmId или ШК" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label>
          <div className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-[11px] font-semibold ${validPct ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{validPct ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />} Σ долей {sumPct}%</div>
          <button type="button" onClick={resetRecommendation} disabled={!canWrite} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[11px] font-semibold text-slate-600 hover:border-violet-300 hover:text-violet-700 disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" /> Рекомендация WB</button>
          <button type="button" onClick={applyRestrictions} disabled={!canWrite || restrictions.length === 0} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"><ShieldCheck className="h-3.5 w-3.5" /> Учесть ограничения</button>
          <button type="button" onClick={download} disabled={!validPct || distributionRows.length === 0} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[11px] font-semibold text-slate-600 hover:border-violet-300 hover:text-violet-700 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> CSV</button>
          {canWrite ? <button type="button" onClick={() => void save()} disabled={!dirty || saving || !validPct || settingsLoading} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{saving || settingsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Сохранить</button> : null}
        </div>
        {message ? <div className="mt-2 text-[10px] text-slate-500">{message}</div> : null}
        {error ? <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{error}</div> : null}
      </section>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-xl border border-violet-200 bg-violet-50/40 px-4 py-3 text-[11px] leading-5 text-slate-600"><div className="flex items-center gap-2 font-semibold text-violet-800"><Info className="h-4 w-4" /> Почему такая рекомендация</div><p className="mt-1">Доли построены по текущей географии остатков WB. Потребность каждого SKU округляется вверх до минимальной партии и распределяется без потери единиц. Исключённые SKU получают ноль. Проверка ограничений использует официальный WB Tariffs API.</p>{volumeKnown < volumeTotal ? <p className="mt-1 text-amber-700">Объём известен для {volumeKnown} из {volumeTotal} SKU: лимит {palletLiters} л сохранён как ориентир и станет расчётным после загрузки габаритов.</p> : null}</div>
        {canWrite ? <RestrictionsPanel cabinetId={cabinetId} onRows={setRestrictions} /> : <div className="rounded-xl border border-slate-200 bg-white p-4 text-[11px] text-slate-500">В режиме «Все кабинеты» сценарий доступен только для просмотра и экспорта.</div>}
      </div>

      {distributionRows.length === 0 ? <WbEmptyState>Готовой раскладки нет: загрузите остатки WB или измените фильтр.</WbEmptyState> : <div className="h-[calc(100vh-430px)] min-h-[380px] overflow-auto rounded-xl border border-slate-200 bg-white" onScroll={(event) => updateWindow(event.currentTarget)}><table className="min-w-max w-full border-collapse text-[10px]"><thead className="sticky top-0 z-20 bg-slate-50"><tr className="h-9 border-b border-slate-200 text-slate-500"><th className="sticky left-0 z-30 min-w-[220px] border-r border-slate-200 bg-slate-50 px-3 text-left">Артикул</th><th className="min-w-20 px-3 text-right">WB остаток</th><th className="min-w-20 border-r border-slate-200 px-3 text-right">К поставке</th>{warehouses.map((warehouse) => <th key={warehouse.name} className="min-w-28 border-r border-slate-100 px-3 text-right"><div>{warehouse.name}</div><div className="font-semibold text-violet-600">{warehouse.pct}%</div></th>)}<th className="min-w-20 px-3 text-right">Σ</th></tr></thead><tbody>{rowWindow.start > 0 ? <tr aria-hidden="true"><td colSpan={4 + warehouses.length} style={{ height: rowWindow.start * ROW_HEIGHT }} /></tr> : null}{distributionRows.slice(rowWindow.start, rowWindow.end).map((row) => <tr key={row.nm} className={`h-[42px] border-b border-slate-100 ${row.excluded ? "bg-slate-50 opacity-65" : "hover:bg-violet-50/30"}`}><td className={`sticky left-0 z-10 border-r border-slate-100 px-3 ${row.excluded ? "bg-slate-50" : "bg-white"}`}><div className="flex items-center gap-2"><button type="button" onClick={() => toggleExcluded(row.nm)} disabled={!canWrite} aria-label={row.excluded ? `Вернуть ${row.art}` : `Исключить ${row.art}`} className={`rounded-md p-1 ${row.excluded ? "bg-rose-100 text-rose-600" : "text-slate-300 hover:bg-rose-50 hover:text-rose-500"}`}><Ban className="h-3.5 w-3.5" /></button><div><div className={`font-semibold ${row.excluded ? "text-slate-400 line-through" : "text-violet-700"}`}>{row.art}</div><div className="text-[9px] text-slate-400">nm {row.nm}{row.excluded ? " · исключён" : ""}</div></div></div></td><td className="px-3 text-right tabular-nums">{format(row.wb_stock)}</td><td className="border-r border-slate-200 px-3 text-right font-semibold tabular-nums text-violet-700">{format(row.available)}</td>{row.qty.map((value, index) => <td key={`${row.nm}-${index}`} className={`border-r border-slate-100 px-3 text-right tabular-nums ${value > 0 ? "text-slate-700" : "text-slate-300"}`}>{format(value)}</td>)}<td className="px-3 text-right font-semibold tabular-nums">{format(row.qty.reduce((sum, value) => sum + value, 0))}</td></tr>)}{rowWindow.end < distributionRows.length ? <tr aria-hidden="true"><td colSpan={4 + warehouses.length} style={{ height: (distributionRows.length - rowWindow.end) * ROW_HEIGHT }} /></tr> : null}</tbody><tfoot className="sticky bottom-0 bg-slate-50"><tr className="h-9 border-t-2 border-slate-200 font-semibold"><td className="sticky left-0 z-10 border-r border-slate-200 bg-slate-50 px-3">Итого · {distributionRows.length} SKU · исключено {excludedNmIds.size}</td><td className="px-3 text-right tabular-nums">{format(displayedTotals.wb)}</td><td className="border-r border-slate-200 px-3 text-right tabular-nums text-violet-700">{format(displayedTotals.available)}</td>{displayedTotals.qty.map((value, index) => <td key={`total-${index}`} className="border-r border-slate-100 px-3 text-right tabular-nums">{format(value)}</td>)}<td className="px-3 text-right tabular-nums">{format(displayedTotals.qty.reduce((sum, value) => sum + value, 0))}</td></tr></tfoot></table></div>}
    </div>
  );
}
