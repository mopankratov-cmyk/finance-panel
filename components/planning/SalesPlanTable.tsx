"use client";

import { ChevronDown, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import { useIsBelowDesktop } from "@/hooks/useMediaQuery";
import {
  calculateSalesPlanDaily,
  calculateSalesPlanRowStockRisk,
  calculateSalesPlanRowMonth,
  calculateSalesPlanSummary,
  calculateSalesPlanStockRiskSummary,
  daysInSalesPlanMonth,
  salesPlanForecastUnavailableLabel,
  salesPlanMonthLabel,
  type SalesPlanDocument,
  type SalesPlanRow,
} from "@/lib/planning/salesPlan";
import { wbCardImageUrl } from "@/lib/wb/cardImage";

export interface SalesPlanCellPosition {
  rowId: string;
  day: number;
}

export interface SalesPlanFillState extends SalesPlanCellPosition {
  endDay: number;
  value: number;
}

const number = (value: number) => Math.round(value || 0).toLocaleString("ru-RU");

type FixedColumn = "product" | "price" | "buyout" | "ads" | "ff" | "marketplace" | "forecast";
const FIXED_ORDER: FixedColumn[] = ["product", "price", "buyout", "ads", "ff", "marketplace", "forecast"];

/* Замороженная часть таблицы существует в двух размерах.
   На мыши закреплены все семь колонок — экран так и задумывался. Но их сумма
   566px шире телефона целиком: закреплённый блок перекрыл бы дни полностью, и
   ввод заказов — то, ради чего экран открывают, — стал бы недоступен даже
   прокруткой. Поэтому ниже 1024px закреплён только «Товар», остальные шесть
   становятся обычными колонками: до них доезжают вбок, ни одна не потеряна.
   Их ширины при этом растут — на касании браузер поднимает шрифт поля до 16px
   (app/globals.css), и в прежние 48px пятизначная цена уже не помещается. */
const WIDE_COLUMNS = { product: 208, price: 56, buyout: 48, ads: 48, ff: 64, marketplace: 64, forecast: 78, day: 56 } as const;
const NARROW_COLUMNS = { product: 152, price: 84, buyout: 64, ads: 64, ff: 84, marketplace: 84, forecast: 96, day: 64 } as const;
const END_WIDTH = 74;
const EDGE_SHADOW = "shadow-[6px_0_10px_rgba(15,23,42,0.05)]";

interface ColumnLayout {
  width: Record<FixedColumn | "day", number>;
  /** Смещение слева — только у тех колонок, что на этой ширине закреплены. */
  offset: Partial<Record<FixedColumn, number>>;
  /** Последняя закреплённая колонка: на ней тень, отделяющая блок от дней. */
  edge: FixedColumn;
  tableWidth: number;
}

function columnLayout(compact: boolean, days: number): ColumnLayout {
  const width = compact ? NARROW_COLUMNS : WIDE_COLUMNS;
  const offset: Partial<Record<FixedColumn, number>> = {};
  let left = 0;
  for (const column of FIXED_ORDER) {
    if (!compact || column === "product") offset[column] = left;
    left += width[column];
  }
  return { width, offset, edge: compact ? "product" : "forecast", tableWidth: left + days * width.day + 5 * END_WIDTH };
}

const fixedStyle = (cols: ColumnLayout, column: FixedColumn): CSSProperties => {
  const left = cols.offset[column];
  const size = { minWidth: cols.width[column], width: cols.width[column] };
  return left === undefined ? size : { left, ...size };
};
const fixedClass = (cols: ColumnLayout, column: FixedColumn) =>
  `${cols.offset[column] === undefined ? "" : "sticky z-20"} ${cols.edge === column ? EDGE_SHADOW : ""}`;
const fixedHeadClass = (cols: ColumnLayout, column: FixedColumn) =>
  `sticky top-0 ${cols.offset[column] === undefined ? "z-30" : "z-40"} ${cols.edge === column ? EDGE_SHADOW : ""}`;
const dayStyle = (cols: ColumnLayout): CSSProperties => ({ minWidth: cols.width.day, width: cols.width.day });

const dayNumericClass = "whitespace-nowrap tabular-nums tracking-[-0.01em]";
const endCellClass = "min-w-[74px] w-[74px]";
const parseNonNegativeNumber = (value: string) => {
  const parsed = Number(value.replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};
const parseNonNegativeInteger = (value: string) => Math.max(0, Math.round(parseNonNegativeNumber(value)));
const compactInteger = (value: number) => {
  if (!value) return "—";
  if (Math.abs(value) < 10_000) return number(value);
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(value).replace(/тыс\./, "к");
};
const compactDayMoney = (value: number) => {
  if (!value) return "—";
  if (Math.abs(value) < 10_000) return number(value);
  if (Math.abs(value) < 1_000_000) return `${Math.round(value / 1000).toLocaleString("ru-RU")}к`;
  return `${(value / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}м`;
};
const compactMoney = (value: number) => {
  if (!value) return "—";
  if (Math.abs(value) < 10_000) return number(value);
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(value).replace(/тыс\./, "к");
};

function weekday(year: number, monthKey: string, day: number) {
  return ["вс", "пн", "вт", "ср", "чт", "пт", "сб"][new Date(year, Number(monthKey) - 1, day).getDay()];
}

function isWeekend(year: number, monthKey: string, day: number) {
  const value = new Date(year, Number(monthKey) - 1, day).getDay();
  return value === 0 || value === 6;
}

function grouped(rows: SalesPlanRow[]) {
  const groups = new Map<string, SalesPlanRow[]>();
  for (const row of rows) groups.set(row.model, [...(groups.get(row.model) ?? []), row]);
  return [...groups.entries()];
}

function productImage(row: SalesPlanRow, marketplace: "wb" | "ozon") {
  const direct = String(row.image ?? "").trim();
  if (direct) return direct;
  if (marketplace !== "wb") return null;
  const nmId = Number(row.externalId);
  return Number.isInteger(nmId) && nmId > 0 ? wbCardImageUrl(nmId, "c246x328") : null;
}

function ProductThumb({ row, marketplace }: { row: SalesPlanRow; marketplace: "wb" | "ozon" }) {
  const src = productImage(row, marketplace);
  const initials = (row.color || row.variant).slice(0, 2).toUpperCase();
  return (
    <span className="relative grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-md border border-slate-200 bg-gradient-to-br from-slate-100 to-slate-200 text-[8px] font-bold text-slate-400">
      <span aria-hidden="true">{initials}</span>
      {src ? (
        // Динамические миниатюры WB/Ozon идут с разных CDN; держим обычный lazy img без правки next.config.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`Фото ${row.variant}`}
          width={28}
          height={28}
          loading="lazy"
          decoding="async"
          onError={(event) => { event.currentTarget.style.display = "none"; }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}

export function SalesPlanTable({
  plan,
  monthKey,
  readOnly,
  marketplace,
  query,
  stockRiskOnly,
  expanded,
  selectedCell,
  fill,
  onToggleExpand,
  onRowChange,
  onDayChange,
  onRemove,
  onSelectCell,
  onFillStart,
  onFillEnter,
}: {
  plan: SalesPlanDocument;
  monthKey: string;
  readOnly: boolean;
  marketplace: "wb" | "ozon";
  query: string;
  stockRiskOnly: boolean;
  expanded: Set<string>;
  selectedCell: SalesPlanCellPosition | null;
  fill: SalesPlanFillState | null;
  onToggleExpand: (rowId: string) => void;
  onRowChange: (rowId: string, patch: Partial<SalesPlanRow>) => void;
  onDayChange: (rowId: string, day: number, value: number) => void;
  onRemove: (rowId: string) => void;
  onSelectCell: (position: SalesPlanCellPosition) => void;
  onFillStart: (state: SalesPlanFillState) => void;
  onFillEnter: (position: SalesPlanCellPosition) => void;
}) {
  const days = daysInSalesPlanMonth(plan.year, monthKey);
  const dayIndexes = Array.from({ length: days }, (_, index) => index);
  // Ширины колонок — единственное место, где решает JS, а не CSS: пиксельные
  // смещения закреплённых ячеек живут в inline-style, и медиазапросом их не
  // переписать. Разметка при этом одна и та же, поэтому поворот экрана ничего
  // не перемонтирует — введённое в поля и раскрытые строки остаются на месте.
  const compact = useIsBelowDesktop();
  const cols = columnLayout(compact, days);
  const needle = query.trim().toLocaleLowerCase("ru-RU");
  const visibleRows = plan.rows.filter((row) => {
    const matchesQuery = !needle || `${row.model} ${row.modelName} ${row.variant} ${row.color} ${row.externalId}`.toLocaleLowerCase("ru-RU").includes(needle);
    const matchesStockRisk = !stockRiskOnly || calculateSalesPlanRowStockRisk(row, monthKey, plan.year).shortageDay !== null;
    return matchesQuery && matchesStockRisk;
  });
  const summary = calculateSalesPlanSummary(plan, [monthKey]);
  const stockRiskTotals = calculateSalesPlanStockRiskSummary(plan, monthKey);
  const hasLegacyStockRows = plan.rows.some((row) => row.marketplaceStocks?.[monthKey]?.quantity == null);
  const dayOrderTotals = dayIndexes.map((day) => plan.rows.reduce((sum, row) => sum + Number(row.months[monthKey]?.[day] ?? 0), 0));
  const dayGrossTotals = dayIndexes.map((day) => plan.rows.reduce((sum, row) => sum + calculateSalesPlanDaily(row, row.months[monthKey]?.[day] ?? 0).gross, 0));
  const dayAdTotals = dayIndexes.map((day) => plan.rows.reduce((sum, row) => sum + calculateSalesPlanDaily(row, row.months[monthKey]?.[day] ?? 0).ads, 0));
  const accent = marketplace === "wb" ? "violet" : "sky";
  const focusClass = accent === "violet" ? "focus:border-violet-400 focus:ring-violet-100" : "focus:border-sky-400 focus:ring-sky-100";
  const selectedClass = accent === "violet" ? "ring-2 ring-inset ring-violet-500" : "ring-2 ring-inset ring-sky-500";
  const handleClass = accent === "violet" ? "bg-violet-600" : "bg-sky-600";
  const fillClass = accent === "violet" ? "bg-violet-100/80" : "bg-sky-100/80";
  const totalColumns = 7 + days + 5;

  if (visibleRows.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">{stockRiskOnly ? "По фильтру дефицита SKU не найдены." : "По заданному фильтру SKU не найдены."}</div>;
  }

  return (
    <div className="overflow-auto overscroll-x-contain rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <table style={{ width: cols.tableWidth, minWidth: cols.tableWidth }} className="table-fixed border-separate border-spacing-0 text-[11px] leading-4 text-slate-700 lg:text-[10px]">
        <colgroup>
          {FIXED_ORDER.map((column) => <col key={column} style={{ width: cols.width[column] }} />)}
          {dayIndexes.map((day) => <col key={`day-${day}`} style={{ width: cols.width.day }} />)}
          {Array.from({ length: 5 }, (_, index) => <col key={`end-${index}`} style={{ width: END_WIDTH }} />)}
        </colgroup>
        <thead>
          <tr className="h-8 text-[10px] font-bold uppercase tracking-[0.04em] text-slate-400 lg:text-[8px]">
            <th style={fixedStyle(cols, "product")} className={`${fixedHeadClass(cols, "product")} border-b border-r border-slate-200 bg-slate-50 px-2 text-left`}>Товар</th>
            <th style={fixedStyle(cols, "price")} className={`${fixedHeadClass(cols, "price")} border-b border-r border-slate-200 bg-slate-50 px-1 text-right`}>Цена</th>
            <th style={fixedStyle(cols, "buyout")} className={`${fixedHeadClass(cols, "buyout")} border-b border-r border-slate-200 bg-slate-50 px-1 text-right`}>{marketplace === "wb" ? "Вык %" : "Зав %"}</th>
            <th style={fixedStyle(cols, "ads")} className={`${fixedHeadClass(cols, "ads")} border-b border-r border-slate-200 bg-slate-50 px-1 text-right`}>Рек %</th>
            <th style={fixedStyle(cols, "ff")} className={`${fixedHeadClass(cols, "ff")} border-b border-r border-slate-200 bg-amber-50 px-1 text-right`}>ФФ, шт.</th>
            <th style={fixedStyle(cols, "marketplace")} className={`${fixedHeadClass(cols, "marketplace")} border-b border-r border-slate-200 bg-slate-50 px-1 text-right`}>МП, шт.</th>
            <th style={fixedStyle(cols, "forecast")} className={`${fixedHeadClass(cols, "forecast")} border-b border-r border-slate-200 bg-slate-50 px-1 text-right`}>Прогноз конца</th>
            {dayIndexes.map((day) => (
              <th key={day} style={dayStyle(cols)} className={`sticky top-0 z-30 border-b border-r border-slate-200 px-0.5 py-1 text-center ${isWeekend(plan.year, monthKey, day + 1) ? "bg-sky-50" : "bg-slate-50"}`}>
                <span className="block text-[11px] font-semibold text-slate-600 lg:text-[10px]">{String(day + 1).padStart(2, "0")}</span>
                <span className="block text-[10px] font-medium text-slate-400 lg:text-[9px]">{weekday(plan.year, monthKey, day + 1)}</span>
              </th>
            ))}
            <EndHead>Заказы</EndHead><EndHead>Выкуп</EndHead><EndHead>Рек ₽</EndHead><EndHead>Выруч ₽</EndHead><EndHead>ДРР</EndHead>
          </tr>
        </thead>
        <tbody>
          {grouped(visibleRows).map(([model, rows]) => {
            const modelTotals = rows.reduce((sum, row) => sum + calculateSalesPlanRowMonth(row, monthKey).orders, 0);
            return (
              <ModelRows
                key={model}
                model={model}
                rows={rows}
                monthKey={monthKey}
                days={dayIndexes}
                plan={plan}
                cols={cols}
                readOnly={readOnly}
                marketplace={marketplace}
                expanded={expanded}
                selectedCell={selectedCell}
                fill={fill}
                focusClass={focusClass}
                selectedClass={selectedClass}
                handleClass={handleClass}
                fillClass={fillClass}
                totalColumns={totalColumns}
                modelTotals={modelTotals}
                onToggleExpand={onToggleExpand}
                onRowChange={onRowChange}
                onDayChange={onDayChange}
                onRemove={onRemove}
                onSelectCell={onSelectCell}
                onFillStart={onFillStart}
                onFillEnter={onFillEnter}
              />
            );
          })}
          <tr className="h-8 bg-slate-100 font-semibold text-slate-800">
            <td style={fixedStyle(cols, "product")} className={`${fixedClass(cols, "product")} border-t border-r border-slate-200 bg-slate-100 px-2.5`}>ИТОГО · {salesPlanMonthLabel(plan.year, monthKey, false)}</td>
            <StickyTotal cols={cols} column="price">—</StickyTotal><StickyTotal cols={cols} column="buyout">—</StickyTotal><StickyTotal cols={cols} column="ads">—</StickyTotal>
            <StickyTotal cols={cols} column="ff">{hasLegacyStockRows ? "—" : number(stockRiskTotals.ffAllocated)}</StickyTotal>
            <StickyTotal cols={cols} column="marketplace">{hasLegacyStockRows ? "—" : number(stockRiskTotals.marketplaceStock)}</StickyTotal>
            <StickyTotal cols={cols} column="forecast">{stockRiskTotals.forecastAvailable ? number(stockRiskTotals.endingStock) : "—"}</StickyTotal>
            {dayOrderTotals.map((value, day) => <td key={day} style={dayStyle(cols)} title={value ? number(value) : undefined} className={`border-t border-r border-slate-200 px-1 text-center text-[11px] font-semibold ${dayNumericClass}`}>{compactInteger(value)}</td>)}
            <EndCell strong>{number(summary.orders)}</EndCell><EndCell strong>{number(summary.buyouts)}</EndCell><EndCell strong>{compactMoney(summary.ads)}</EndCell><EndCell strong>{compactMoney(summary.revenue)}</EndCell><EndCell strong>{summary.drr.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%</EndCell>
          </tr>
          <ExtraTotal cols={cols} label={`ИТОГО заказы ₽ · ${salesPlanMonthLabel(plan.year, monthKey, false)}`} values={dayGrossTotals} days={days} end={["—", "—", "—", compactMoney(summary.gross), "—"]} />
          <ExtraTotal cols={cols} label={`ИТОГО реклама ₽ · ${salesPlanMonthLabel(plan.year, monthKey, false)}`} values={dayAdTotals} days={days} end={["—", "—", compactMoney(summary.ads), "—", `${summary.adPct.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`]} />
        </tbody>
      </table>
    </div>
  );
}

function ModelRows(props: {
  model: string;
  rows: SalesPlanRow[];
  monthKey: string;
  days: number[];
  plan: SalesPlanDocument;
  cols: ColumnLayout;
  readOnly: boolean;
  marketplace: "wb" | "ozon";
  expanded: Set<string>;
  selectedCell: SalesPlanCellPosition | null;
  fill: SalesPlanFillState | null;
  focusClass: string;
  selectedClass: string;
  handleClass: string;
  fillClass: string;
  totalColumns: number;
  modelTotals: number;
  onToggleExpand: (rowId: string) => void;
  onRowChange: (rowId: string, patch: Partial<SalesPlanRow>) => void;
  onDayChange: (rowId: string, day: number, value: number) => void;
  onRemove: (rowId: string) => void;
  onSelectCell: (position: SalesPlanCellPosition) => void;
  onFillStart: (state: SalesPlanFillState) => void;
  onFillEnter: (position: SalesPlanCellPosition) => void;
}) {
  const { model, rows, totalColumns, modelTotals } = props;
  return (
    <>
      <tr>
        <td colSpan={totalColumns} className="border-b border-slate-200 bg-violet-50/70 px-2 py-1 text-left text-[11px] text-slate-700 lg:text-[10px]">
          {/* Ячейка растянута на всю таблицу, поэтому у прокрученной вправо
              строки название модели уезжало за экран и было непонятно, к какому
              артикулу относятся дни. Держим его у левого края видимой области. */}
          <div className="flex items-center justify-between gap-4"><strong className="sticky left-2">{model} · {rows[0]?.modelName}</strong><span className="text-slate-500">{rows.length} {rows.length === 1 ? "цвет" : "цвета"} · {number(modelTotals)} заказов</span></div>
        </td>
      </tr>
      {rows.map((row) => <SkuRows key={row.id} row={row} {...props} />)}
    </>
  );
}

function SkuRows({
  row, monthKey, days, plan, cols, readOnly, marketplace, expanded, selectedCell, fill, focusClass, selectedClass, handleClass, fillClass,
  onToggleExpand, onRowChange, onDayChange, onRemove, onSelectCell, onFillStart, onFillEnter,
}: Omit<Parameters<typeof ModelRows>[0], "model" | "rows" | "totalColumns" | "modelTotals"> & { row: SalesPlanRow }) {
  const totals = calculateSalesPlanRowMonth(row, monthKey);
  const stockRisk = calculateSalesPlanRowStockRisk(row, monthKey, plan.year);
  const forecastTitle = row.marketplaceStocks?.[monthKey]
    ? `ФФ ${number(stockRisk.ffAllocated)} + МП ${number(stockRisk.marketplaceStock)} − ожидаемые выкупы ${number(stockRisk.plannedBuyouts)} (оставшиеся заказы ${number(stockRisk.remainingOrders)} + план месяца ${number(stockRisk.targetMonthOrders)}, выкуп ${number(row.buyout)}%)`
    : `Legacy-остаток ${number(stockRisk.currentStock)} − ожидаемые выкупы ${number(stockRisk.plannedBuyouts)} (план месяца ${number(stockRisk.targetMonthOrders)}, выкуп ${number(row.buyout)}%); обновится после успешной загрузки МП`;
  const marketplaceAsOfTitle = stockRisk.marketplaceAsOf
    ? `Остаток маркетплейса на ${new Date(stockRisk.marketplaceAsOf).toLocaleString("ru-RU")}${stockRisk.marketplaceStale ? " · устарело" : ""}`
    : "Остаток маркетплейса недоступен";
  const opened = expanded.has(row.id);
  const fillMin = fill?.rowId === row.id ? Math.min(fill.day, fill.endDay) : -1;
  const fillMax = fill?.rowId === row.id ? Math.max(fill.day, fill.endDay) : -1;
  const fixedCell = "border-b border-r border-slate-200 bg-[#fdf7ef] px-1";
  return (
    <>
      <tr className="group h-12 hover:bg-slate-50/60 lg:h-9">
        <td style={fixedStyle(cols, "product")} className={`${fixedClass(cols, "product")} border-b border-r border-slate-200 bg-white px-1.5 py-0.5`}>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => onToggleExpand(row.id)} aria-label={opened ? `Свернуть ${row.color}` : `Раскрыть ${row.color}`} aria-expanded={opened} className="tap-hit grid h-7 w-5 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${opened ? "rotate-180" : "-rotate-90"}`} />
            </button>
            <ProductThumb row={row} marketplace={marketplace} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-semibold text-slate-800 lg:text-[10px]">{row.color}{row.isNew ? " · Новый" : ""}</span>
              <span className={`block truncate text-[10px] lg:text-[9px] ${stockRisk.shortageQty ? "text-rose-500" : "text-slate-400"}`}>{row.variant} · {marketplace === "wb" ? "WB" : "SKU"} {row.externalId || "—"} · {stockRisk.forecastAvailable ? `прогноз ${number(stockRisk.endingStock)}${stockRisk.shortageQty ? ` · Дефицит ${number(stockRisk.shortageQty)} шт.` : ""}` : salesPlanForecastUnavailableLabel(stockRisk.unavailableReason)}</span>
            </span>
            {!readOnly ? <button type="button" onClick={() => onRemove(row.id)} aria-label={`Удалить ${row.color} из плана`} title="Удалить из плана" className="hover-actions tap-hit grid h-7 w-6 shrink-0 place-items-center rounded-md text-slate-300 opacity-0 hover:bg-rose-50 hover:text-rose-600 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button> : null}
          </div>
        </td>
        <td style={fixedStyle(cols, "price")} className={`${fixedClass(cols, "price")} ${fixedCell}`}><FixedInput label={`${row.variant}, цена`} value={row.price} disabled={readOnly} focusClass={focusClass} onChange={(value) => onRowChange(row.id, { price: value })} /></td>
        <td style={fixedStyle(cols, "buyout")} className={`${fixedClass(cols, "buyout")} ${fixedCell}`}><FixedInput label={`${row.variant}, ${marketplace === "wb" ? "выкуп" : "завершение"}`} value={row.buyout} disabled={readOnly} focusClass={focusClass} onChange={(value) => onRowChange(row.id, { buyout: value })} /></td>
        <td style={fixedStyle(cols, "ads")} className={`${fixedClass(cols, "ads")} ${fixedCell}`}><FixedInput label={`${row.variant}, реклама`} value={row.adPct} disabled={readOnly} focusClass={focusClass} onChange={(value) => onRowChange(row.id, { adPct: value })} /></td>
        <td style={fixedStyle(cols, "ff")} className={`${fixedClass(cols, "ff")} ${fixedCell}`}>
          <FixedInput
            label={`${row.variant}, распределено на ФФ`}
            value={stockRisk.ffAllocated}
            disabled={readOnly}
            focusClass={focusClass}
            onChange={(value) => onRowChange(row.id, {
              ffAllocatedStocks: { ...row.ffAllocatedStocks, [monthKey]: parseNonNegativeInteger(String(value)) },
            })}
          />
        </td>
        <td
          style={fixedStyle(cols, "marketplace")}
          className={`${fixedClass(cols, "marketplace")} border-b border-r border-slate-200 px-1 text-right font-semibold tabular-nums ${stockRisk.marketplaceStale ? "bg-amber-50 text-amber-700" : "bg-white text-slate-600"}`}
          title={marketplaceAsOfTitle}
        >
          {row.marketplaceStocks?.[monthKey]?.quantity == null ? "—" : number(stockRisk.marketplaceStock)}{stockRisk.marketplaceStale ? <span className="block text-[10px] lg:text-[8px]">устарело</span> : null}
        </td>
        <td
          style={fixedStyle(cols, "forecast")}
          className={`${fixedClass(cols, "forecast")} border-b border-r border-slate-200 px-1 text-right font-bold tabular-nums ${stockRisk.shortageQty ? "bg-rose-50 text-rose-700" : "bg-white text-slate-700"}`}
          title={stockRisk.forecastAvailable ? forecastTitle : `Прогноз недоступен: ${stockRisk.unavailableReason}`}
        >
          {stockRisk.forecastAvailable ? number(stockRisk.endingStock) : "—"}
        </td>
        {days.map((day) => {
          const orders = row.months[monthKey]?.[day] ?? 0;
          const selected = selectedCell?.rowId === row.id && selectedCell.day === day;
          const inFill = day >= fillMin && day <= fillMax;
          const afterShortage = stockRisk.shortageDay !== null && day + 1 >= stockRisk.shortageDay;
          const firstShortage = stockRisk.shortageDay === day + 1;
          return (
            <td key={day} style={dayStyle(cols)} data-fill-row={row.id} data-fill-day={day} className={`relative border-b border-r border-slate-200 p-0.5 ${afterShortage ? "bg-rose-50/80" : isWeekend(plan.year, monthKey, day + 1) ? "bg-sky-50/70" : "bg-white"} ${firstShortage ? "ring-1 ring-inset ring-rose-300" : ""} ${inFill ? fillClass : ""}`}>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={orders || ""}
                placeholder="—"
                disabled={readOnly}
                aria-label={`${row.variant}, ${day + 1} ${salesPlanMonthLabel(plan.year, monthKey)}`}
                onFocus={() => onSelectCell({ rowId: row.id, day })}
                onChange={(event) => onDayChange(row.id, day, parseNonNegativeInteger(event.target.value))}
                title={orders ? number(orders) : undefined}
                className={`h-11 w-full rounded-md border border-transparent bg-transparent px-1 text-center text-[11px] font-semibold lg:h-7 ${dayNumericClass} text-slate-700 outline-none transition placeholder:text-slate-300 hover:border-slate-200 focus:bg-white focus:ring-2 disabled:cursor-default disabled:text-slate-500 ${focusClass} ${selected ? selectedClass : ""}`}
              />
              {/* Протяжка диапазона висела на mouseDown/mouseEnter — пальцем таких
                  событий не бывает вовсе. Указательные события покрывают и мышь,
                  и касание одной веткой: захват удерживает жест на маркере, а
                  ячейку под пальцем находим по координате. */}
              {selected && !readOnly ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Протянуть значение до нужного дня"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    onFillStart({ rowId: row.id, day, endDay: day, value: orders });
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-fill-day]");
                    const nextDay = Number(cell?.dataset.fillDay);
                    if (cell?.dataset.fillRow === row.id && Number.isInteger(nextDay)) onFillEnter({ rowId: row.id, day: nextDay });
                  }}
                  className={`absolute bottom-0.5 right-0.5 h-5 w-5 touch-none cursor-crosshair rounded-[3px] border border-white lg:h-2.5 lg:w-2.5 lg:rounded-[2px] ${handleClass}`}
                />
              ) : null}
            </td>
          );
        })}
        <EndCell strong>{number(totals.orders)}</EndCell><EndCell>{number(totals.buyouts)}</EndCell><EndCell>{compactMoney(totals.ads)}</EndCell><EndCell>{compactMoney(totals.revenue)}</EndCell><EndCell>{totals.drr.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%</EndCell>
      </tr>
      {opened ? (
        <>
          {/* Расшифровка прогноза и дата остатка живут в подсказках title, а на
              касании подсказка не всплывает. Под пальцем это единственный способ
              их прочитать, поэтому строка показывается только на узком экране. */}
          <tr className="bg-slate-50/50 lg:hidden">
            <td colSpan={7 + days.length + 5} className="border-b border-slate-200 px-2 py-1.5 text-[11px] leading-4 text-slate-500">
              <span className="sticky left-2 inline-block max-w-[min(86vw,720px)] whitespace-normal break-anywhere">
                {stockRisk.forecastAvailable ? forecastTitle : `Прогноз недоступен: ${stockRisk.unavailableReason}`} · {marketplaceAsOfTitle}
              </span>
            </td>
          </tr>
          <ExpandedRows row={row} monthKey={monthKey} days={days} cols={cols} year={plan.year} />
        </>
      ) : null}
    </>
  );
}

function FixedInput({ label, value, disabled, onChange, focusClass }: { label: string; value: number; disabled: boolean; onChange: (value: number) => void; focusClass: string }) {
  return <input type="text" inputMode="decimal" value={value || ""} placeholder="—" disabled={disabled} aria-label={label} title={value ? number(value) : undefined} onChange={(event) => onChange(parseNonNegativeNumber(event.target.value))} className={`h-11 w-full rounded-md border border-transparent bg-transparent px-1 text-right text-[10px] font-semibold tabular-nums tracking-[-0.01em] text-slate-700 outline-none transition hover:border-[#eadcc8] focus:bg-white focus:ring-2 disabled:cursor-default disabled:text-slate-500 lg:h-7 ${focusClass}`} />;
}

function ExpandedRows({ row, monthKey, days, cols }: { row: SalesPlanRow; monthKey: string; days: number[]; cols: ColumnLayout; year: number }) {
  const definitions = [
    { label: "Выкупы, шт", color: "bg-emerald-500", read: (day: number) => calculateSalesPlanDaily(row, row.months[monthKey]?.[day] ?? 0).buyouts, total: calculateSalesPlanRowMonth(row, monthKey).buyouts, kind: "number" },
    { label: "Заказы в ₽", color: "bg-violet-500", read: (day: number) => calculateSalesPlanDaily(row, row.months[monthKey]?.[day] ?? 0).gross, total: calculateSalesPlanRowMonth(row, monthKey).gross, kind: "money" },
    { label: "Реклама, ₽", color: "bg-amber-500", read: (day: number) => calculateSalesPlanDaily(row, row.months[monthKey]?.[day] ?? 0).ads, total: calculateSalesPlanRowMonth(row, monthKey).ads, kind: "money" },
    { label: "ДРР, %", color: "bg-rose-500", read: (day: number) => calculateSalesPlanDaily(row, row.months[monthKey]?.[day] ?? 0).drr, total: calculateSalesPlanRowMonth(row, monthKey).drr, kind: "pct" },
  ];
  return <>{definitions.map((definition) => (
    <tr key={definition.label} className="h-7 bg-slate-50/50 text-[11px] text-slate-500 lg:text-[10px]">
      <td style={fixedStyle(cols, "product")} className={`${fixedClass(cols, "product")} border-b border-r border-slate-200 bg-slate-50 px-2`}><span className="flex items-center gap-1.5 pl-5"><span className={`h-2 w-2 rounded-full ${definition.color}`} />{definition.label}</span></td>
      {FIXED_ORDER.slice(1).map((column) => <td key={column} style={fixedStyle(cols, column)} className={`${fixedClass(cols, column)} border-b border-r border-slate-200 bg-slate-50`} />)}
      {days.map((day) => {
        const value = definition.read(day);
        const fullValue = definition.kind === "money" ? `${number(value)} ₽` : definition.kind === "pct" ? `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%` : number(value);
        return <td key={day} style={dayStyle(cols)} title={value ? fullValue : undefined} className={`border-b border-r border-slate-200 px-1 text-center ${dayNumericClass}`}>{definition.kind === "money" ? compactDayMoney(value) : definition.kind === "pct" ? `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%` : value ? number(value) : "—"}</td>;
      })}
      <td className={`${endCellClass} border-b border-r border-slate-200 bg-slate-50 px-1 text-right font-semibold tabular-nums`}>{definition.kind === "money" ? compactMoney(definition.total) : definition.kind === "pct" ? `${definition.total.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%` : number(definition.total)}</td>
      <td className="border-b border-r border-slate-200 bg-slate-50" /><td className="border-b border-r border-slate-200 bg-slate-50" /><td className="border-b border-r border-slate-200 bg-slate-50" /><td className="border-b border-r border-slate-200 bg-slate-50" />
    </tr>
  ))}</>;
}

function EndHead({ children }: { children: React.ReactNode }) { return <th className={`sticky top-0 z-30 ${endCellClass} border-b border-r border-slate-200 bg-slate-50 px-1 text-right last:border-r-0`}>{children}</th>; }
function EndCell({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) { return <td className={`${endCellClass} border-b border-r border-slate-200 bg-white px-1.5 text-right tabular-nums tracking-[-0.01em] last:border-r-0 ${strong ? "font-semibold text-slate-800" : ""}`}>{children}</td>; }
function StickyTotal({ children, cols, column }: { children: React.ReactNode; cols: ColumnLayout; column: FixedColumn }) { return <td style={fixedStyle(cols, column)} className={`${fixedClass(cols, column)} border-t border-r border-slate-200 bg-slate-100 px-1.5 text-right`}>{children}</td>; }
function ExtraTotal({ cols, label, values, days, end }: { cols: ColumnLayout; label: string; values: number[]; days: number; end: string[] }) {
  return (
    <tr className="h-7 bg-slate-50 text-[11px] font-semibold text-slate-600 lg:text-[10px]">
      <td style={fixedStyle(cols, "product")} className={`${fixedClass(cols, "product")} border-b border-r border-slate-200 bg-slate-50 px-2`}>{label}</td>
      {FIXED_ORDER.slice(1).map((column) => <td key={column} style={fixedStyle(cols, column)} className={`${fixedClass(cols, column)} border-b border-r border-slate-200 bg-slate-50`} />)}
      {Array.from({ length: days }, (_, day) => {
        const value = values[day] ?? 0;
        return <td key={day} style={dayStyle(cols)} title={value ? `${number(value)} ₽` : undefined} className={`border-b border-r border-slate-200 px-1 text-center ${dayNumericClass}`}>{compactDayMoney(value)}</td>;
      })}
      {end.map((value, index) => <td key={index} className={`${endCellClass} border-b border-r border-slate-200 px-1.5 text-right tabular-nums tracking-[-0.01em] last:border-r-0`}>{value}</td>)}
    </tr>
  );
}
