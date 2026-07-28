"use client";

import { Check, Loader2, PackagePlus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  emptySalesPlanOpeningStocks,
  emptySalesPlanMonths,
  inferColorFromVariant,
  inferModelArticle,
  type SalesPlanMarketplace,
  type SalesPlanRow,
} from "@/lib/planning/salesPlan";

export interface SalesPlanCatalogSku {
  externalId: string;
  variant: string;
  name: string;
  stock: number;
  image: string | null;
  ordersWeek?: number;
  revenueWeek?: number;
  ordersMonth?: number;
  revenueMonth?: number;
  avgDaily7?: number;
  avgPriceMonth?: number;
  seasonalityFactor?: number;
  seasonalityRawFactor?: number;
  seasonalitySource?: string;
  seasonalitySubject?: string;
  seasonalityNote?: string;
  demandFactor?: number;
  stockAsOf?: string | null;
}
function rowId() {
  return globalThis.crypto?.randomUUID?.() ?? `sales-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function CatalogThumb({ sku }: { sku: SalesPlanCatalogSku }) {
  const initials = (sku.variant || sku.name).slice(0, 2).toUpperCase();
  return (
    <span className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-gradient-to-br from-slate-100 to-slate-200 text-[10px] font-bold text-slate-400">
      <span aria-hidden="true">{initials}</span>
      {sku.image ? (
        // Динамические миниатюры WB/Ozon идут с разных CDN; держим обычный lazy img без правки next.config.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sku.image}
          alt={`Фото ${sku.variant}`}
          width={40}
          height={40}
          loading="lazy"
          decoding="async"
          onError={(event) => { event.currentTarget.style.display = "none"; }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}

export function SalesPlanAddSkuModal({
  marketplace,
  year,
  monthKey,
  catalog,
  catalogLoading,
  catalogError,
  existingVariants,
  onClose,
  onAdd,
}: {
  marketplace: SalesPlanMarketplace;
  year: number;
  monthKey: string;
  catalog: SalesPlanCatalogSku[];
  catalogLoading: boolean;
  catalogError: string | null;
  existingVariants: string[];
  onClose: () => void;
  onAdd: (rows: SalesPlanRow[]) => void;
}) {
  const [tab, setTab] = useState<"catalog" | "manual">("catalog");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState({
    modelName: "",
    model: "",
    color: "",
    variant: "",
    externalId: "",
    price: "",
    buyout: marketplace === "wb" ? "30" : "92",
    adPct: "12",
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const existing = useMemo(
    () => new Set(existingVariants.map((value) => value.toLocaleLowerCase("ru-RU"))),
    [existingVariants],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return catalog
      .filter((sku) => !needle || `${sku.variant} ${sku.name} ${sku.externalId}`.toLocaleLowerCase("ru-RU").includes(needle))
      .slice(0, 200);
  }, [catalog, query]);

  useEffect(() => {
    searchRef.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);

  const accent = marketplace === "wb";
  const primary = accent
    ? "bg-violet-600 hover:bg-violet-700 focus-visible:ring-violet-500"
    : "bg-sky-600 hover:bg-sky-700 focus-visible:ring-sky-500";
  const activeTab = accent ? "bg-violet-50 text-violet-700" : "bg-sky-50 text-sky-700";

  const addCatalog = () => {
    const rows = catalog
      .filter((sku) => selected.has(sku.variant))
      .map((sku): SalesPlanRow => ({
        id: rowId(),
        model: inferModelArticle(sku.variant),
        modelName: sku.name || sku.variant,
        variant: sku.variant,
        color: inferColorFromVariant(sku.variant),
        externalId: sku.externalId,
        price: 0,
        buyout: marketplace === "wb" ? 30 : 92,
        adPct: 12,
        stock: sku.stock,
        openingStocks: emptySalesPlanOpeningStocks(sku.stock),
        ffAllocatedStocks: { [monthKey]: 0 },
        marketplaceStocks: { [monthKey]: { quantity: Math.max(0, Math.round(sku.stock)), asOf: sku.stockAsOf ?? null, stale: false } },
        image: sku.image,
        isNew: false,
        months: emptySalesPlanMonths(year),
      }));
    if (rows.length) onAdd(rows);
  };

  const addManual = () => {
    const model = manual.model.trim();
    const variant = manual.variant.trim();
    const color = manual.color.trim();
    if (!model || !variant || !color) return;
    onAdd([{
      id: rowId(),
      model,
      modelName: manual.modelName.trim() || variant,
      variant,
      color,
      externalId: manual.externalId.trim(),
      price: Number(manual.price) || 0,
      buyout: Number(manual.buyout) || 0,
      adPct: Number(manual.adPct) || 0,
      stock: 0,
      openingStocks: emptySalesPlanOpeningStocks(),
      ffAllocatedStocks: {},
      marketplaceStocks: {},
      image: null,
      isNew: true,
      months: emptySalesPlanMonths(year),
    }]);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="sales-plan-add-title">
      <button type="button" aria-label="Закрыть окно добавления SKU" className="absolute inset-0 bg-slate-950/50" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-4 py-4 sm:px-6">
          <div>
            <h2 id="sales-plan-add-title" className="text-lg font-bold text-slate-900">Добавить SKU в план</h2>
            <p className="mt-1 text-xs text-slate-500">Каждый цвет добавляется отдельной строкой. Размеры внутри цвета суммируются.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:h-9 sm:w-9">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-slate-100 px-4 pt-3 sm:px-6" role="tablist" aria-label="Способ добавления SKU">
          <button type="button" role="tab" aria-selected={tab === "catalog"} onClick={() => setTab("catalog")} className={`min-h-11 rounded-t-lg px-4 text-xs font-semibold ${tab === "catalog" ? activeTab : "text-slate-500 hover:bg-slate-50"}`}>Из каталога</button>
          <button type="button" role="tab" aria-selected={tab === "manual"} onClick={() => setTab("manual")} className={`min-h-11 rounded-t-lg px-4 text-xs font-semibold ${tab === "manual" ? activeTab : "text-slate-500 hover:bg-slate-50"}`}>Новый товар вручную</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {tab === "catalog" ? (
            <div>
              <label className="relative block">
                <span className="sr-only">Поиск товара</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Артикул, nmID / SKU или название" className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100" />
              </label>
              <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                {catalogLoading ? (
                  <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> Загружаем каталог…</div>
                ) : catalogError ? (
                  <div role="alert" className="p-5 text-sm text-rose-700">{catalogError}</div>
                ) : filtered.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">Товары не найдены. Можно добавить новый SKU вручную.</div>
                ) : (
                  <div className="max-h-[390px] divide-y divide-slate-100 overflow-y-auto">
                    {filtered.map((sku) => {
                      const unavailable = existing.has(sku.variant.toLocaleLowerCase("ru-RU"));
                      const checked = selected.has(sku.variant);
                      return (
                        <button
                          key={`${sku.externalId}:${sku.variant}`}
                          type="button"
                          disabled={unavailable}
                          onClick={() => setSelected((current) => {
                            const next = new Set(current);
                            if (next.has(sku.variant)) next.delete(sku.variant); else next.add(sku.variant);
                            return next;
                          })}
                          className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-55"
                        >
                          <span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${checked ? `${primary} border-transparent text-white` : "border-slate-300 bg-white"}`}>{checked ? <Check className="h-3.5 w-3.5" /> : null}</span>
                          <CatalogThumb sku={sku} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-slate-800">{sku.name}</span>
                            <span className="mt-0.5 block truncate text-[11px] text-slate-400">{sku.variant} · ID {sku.externalId || "не привязан"}</span>
                          </span>
                          <span className="text-right text-[11px] text-slate-400">остаток<br /><b className="tabular-nums text-slate-600">{sku.stock.toLocaleString("ru-RU")}</b></span>
                          {unavailable ? <span className="rounded-md bg-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-500">Уже в плане</span> : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Название товара" value={manual.modelName} onChange={(value) => setManual((current) => ({ ...current, modelName: value }))} placeholder="Куртка демисезонная" />
              <Field label="Артикул модели *" value={manual.model} onChange={(value) => setManual((current) => ({ ...current, model: value }))} placeholder="NV-08-35" />
              <Field label="Цвет *" value={manual.color} onChange={(value) => setManual((current) => ({ ...current, color: value }))} placeholder="Графит" />
              <Field label="Артикул цветовой вариации *" value={manual.variant} onChange={(value) => setManual((current) => ({ ...current, variant: value }))} placeholder="NV-08-35-GRF" />
              <Field label={marketplace === "wb" ? "nmID Wildberries" : "SKU Ozon"} value={manual.externalId} onChange={(value) => setManual((current) => ({ ...current, externalId: value }))} placeholder="Можно привязать позже" />
              <Field label="Цена, ₽" type="number" value={manual.price} onChange={(value) => setManual((current) => ({ ...current, price: value }))} placeholder="13 500" />
              <Field label={marketplace === "wb" ? "Выкуп, %" : "Завершение заказов, %"} type="number" value={manual.buyout} onChange={(value) => setManual((current) => ({ ...current, buyout: value }))} />
              <Field label="Реклама от заказной выручки, %" type="number" value={manual.adPct} onChange={(value) => setManual((current) => ({ ...current, adPct: value }))} />
              <p className="sm:col-span-2 text-xs leading-5 text-slate-500">После появления карточки маркетплейса временный SKU можно будет связать с внешним ID без потери дневного плана.</p>
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">Отмена</button>
          <button
            type="button"
            onClick={tab === "catalog" ? addCatalog : addManual}
            disabled={tab === "catalog" ? selected.size === 0 : !manual.model.trim() || !manual.variant.trim() || !manual.color.trim()}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 ${primary}`}
          >
            <PackagePlus className="h-4 w-4" /> {tab === "catalog" ? `Добавить ${selected.size || ""}` : "Добавить SKU"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: "text" | "number" }) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
      {label}
      <input type={type} min={type === "number" ? 0 : undefined} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100" />
    </label>
  );
}
