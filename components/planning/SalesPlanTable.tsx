"use client";

import { ChevronDown, Trash2 } from "lucide-react";
import {
  calculateSalesPlanDaily,
  calculateSalesPlanRowMonth,
  calculateSalesPlanSummary,
  daysInSalesPlanMonth,
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
const STICKY_WIDTHS = {
  product: 196,
  price: 50,
  buyout: 42,
  ads: 42,
} as const;
const STICKY_LEFT = {
  product: 0,
  price: STICKY_WIDTHS.product,
  buyout: STICKY_WIDTHS.product + STICKY_WIDTHS.price,
  ads: STICKY_WIDTHS.product + STICKY_WIDTHS.price + STICKY_WIDTHS.buyout,
} as const;
const DAY_WIDTH = 48;
const END_WIDTH = 62;
const stickyWidth = (width: number) => ({ minWidth: width, width });
const stickyOffset = (left: number, width?: number) => ({ left, ...(width ? stickyWidth(width) : {}) });
const dayCellClass = "min-w-12 w-12";
const dayNumericClass = "tabular-nums tracking-[-0.02em]";
const endCellClass = "min-w-[62px] w-[62px]";
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
  const needle = query.trim().toLocaleLowerCase("ru-RU");
  const visibleRows = plan.rows.filter((row) => !needle || `${row.model} ${row.modelName} ${row.variant} ${row.color} ${row.externalId}`.toLocaleLowerCase("ru-RU").includes(needle));
  const summary = calculateSalesPlanSummary(plan, [monthKey]);
  const dayOrderTotals = dayIndexes.map((day) => plan.rows.reduce((sum, row) => sum + Number(row.months[monthKey]?.[day] ?? 0), 0));
  const dayGrossTotals = dayIndexes.map((day) => plan.rows.reduce((sum, row) => sum + calculateSalesPlanDaily(row, row.months[monthKey]?.[day] ?? 0).gross, 0));
  const dayAdTotals = dayIndexes.map((day) => plan.rows.reduce((sum, row) => sum + calculateSalesPlanDaily(row, row.months[monthKey]?.[day] ?? 0).ads, 0));
  const accent = marketplace === "wb" ? "violet" : "sky";
  const focusClass = accent === "violet" ? "focus:border-violet-400 focus:ring-violet-100" : "focus:border-sky-400 focus:ring-sky-100";
  const selectedClass = accent === "violet" ? "ring-2 ring-inset ring-violet-500" : "ring-2 ring-inset ring-sky-500";
  const handleClass = accent === "violet" ? "bg-violet-600" : "bg-sky-600";
  const fillClass = accent === "violet" ? "bg-violet-100/80" : "bg-sky-100/80";
  const totalColumns = 4 + days + 5;
  const tableWidth = STICKY_LEFT.ads + STICKY_WIDTHS.ads + days * DAY_WIDTH + 5 * END_WIDTH;

  if (visibleRows.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">По заданному фильтру SKU не найдены.</div>;
  }

  return (
    <div className="overflow-auto overscroll-x-contain rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <table style={{ width: tableWidth, minWidth: tableWidth }} className="table-fixed border-separate border-spacing-0 text-[10px] leading-4 text-slate-700">
        <colgroup>
          <col style={{ width: STICKY_WIDTHS.product }} />
          <col style={{ width: STICKY_WIDTHS.price }} />
          <col style={{ width: STICKY_WIDTHS.buyout }} />
          <col style={{ width: STICKY_WIDTHS.ads }} />
          {dayIndexes.map((day) => <col key={`day-${day}`} style={{ width: DAY_WIDTH }} />)}
          {Array.from({ length: 5 }, (_, index) => <col key={`end-${index}`} style={{ width: END_WIDTH }} />)}
        </colgroup>
        <thead>
          <tr className="h-8 text-[8px] font-bold uppercase tracking-[0.04em] text-slate-400">
            <th style={stickyOffset(STICKY_LEFT.product, STICKY_WIDTHS.product)} className="sticky top-0 z-40 border-b border-r border-slate-200 bg-slate-50 px-2 text-left">Товар</th>
            <th style={stickyOffset(STICKY_LEFT.price, STICKY_WIDTHS.price)} className="sticky top-0 z-40 border-b border-r border-slate-200 bg-slate-50 px-1 text-right">Цена</th>
            <th style={stickyOffset(STICKY_LEFT.buyout, STICKY_WIDTHS.buyout)} className="sticky top-0 z-40 border-b border-r border-slate-200 bg-slate-50 px-1 text-right">{marketplace === "wb" ? "Вык %" : "Зав %"}</th>
            <th style={stickyOffset(STICKY_LEFT.ads, STICKY_WIDTHS.ads)} className="sticky top-0 z-40 border-b border-r border-slate-200 bg-slate-50 px-1 text-right shadow-[6px_0_10px_rgba(15,23,42,0.05)]">Рек %</th>
            {dayIndexes.map((day) => (
              <th key={day} className={`sticky top-0 z-30 ${dayCellClass} border-b border-r border-slate-200 px-0.5 py-1 text-center ${isWeekend(plan.year, monthKey, day + 1) ? "bg-sky-50" : "bg-slate-50"}`}>
                <span className="block text-[10px] font-semibold text-slate-600">{String(day + 1).padStart(2, "0")}</span>
                <span className="block text-[9px] font-medium text-slate-400">{weekday(plan.year, monthKey, day + 1)}</span>
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
            <td style={stickyOffset(STICKY_LEFT.product, STICKY_WIDTHS.product)} className="sticky z-20 border-t border-r border-slate-200 bg-slate-100 px-2.5">ИТОГО · {salesPlanMonthLabel(plan.year, monthKey, false)}</td>
            <StickyTotal left={STICKY_LEFT.price} width={STICKY_WIDTHS.price}>—</StickyTotal><StickyTotal left={STICKY_LEFT.buyout} width={STICKY_WIDTHS.buyout}>—</StickyTotal><StickyTotal left={STICKY_LEFT.ads} width={STICKY_WIDTHS.ads} shadow>—</StickyTotal>
            {dayOrderTotals.map((value, day) => <td key={day} title={value ? number(value) : undefined} className={`${dayCellClass} border-t border-r border-slate-200 px-1 text-center text-[11px] font-semibold ${dayNumericClass}`}>{compactInteger(value)}</td>)}
            <EndCell strong>{number(summary.orders)}</EndCell><EndCell strong>{number(summary.buyouts)}</EndCell><EndCell strong>{compactMoney(summary.ads)}</EndCell><EndCell strong>{compactMoney(summary.revenue)}</EndCell><EndCell strong>{summary.drr.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%</EndCell>
          </tr>
          <ExtraTotal label={`ИТОГО заказы ₽ · ${salesPlanMonthLabel(plan.year, monthKey, false)}`} values={dayGrossTotals} days={days} end={["—", "—", "—", compactMoney(summary.gross), "—"]} />
          <ExtraTotal label={`ИТОГО реклама ₽ · ${salesPlanMonthLabel(plan.year, monthKey, false)}`} values={dayAdTotals} days={days} end={["—", "—", compactMoney(summary.ads), "—", `${summary.adPct.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`]} />
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
        <td colSpan={totalColumns} className="border-b border-slate-200 bg-violet-50/70 px-2 py-1 text-left text-[10px] text-slate-700">
          <div className="flex items-center justify-between gap-4"><strong>{model} · {rows[0]?.modelName}</strong><span className="text-[10px] text-slate-500">{rows.length} {rows.length === 1 ? "цвет" : "цвета"} · {number(modelTotals)} заказов</span></div>
        </td>
      </tr>
      {rows.map((row) => <SkuRows key={row.id} row={row} {...props} />)}
    </>
  );
}

function SkuRows({
  row, monthKey, days, plan, readOnly, marketplace, expanded, selectedCell, fill, focusClass, selectedClass, handleClass, fillClass,
  onToggleExpand, onRowChange, onDayChange, onRemove, onSelectCell, onFillStart, onFillEnter,
}: Omit<Parameters<typeof ModelRows>[0], "model" | "rows" | "totalColumns" | "modelTotals"> & { row: SalesPlanRow }) {
  const totals = calculateSalesPlanRowMonth(row, monthKey);
  const opened = expanded.has(row.id);
  const fillMin = fill?.rowId === row.id ? Math.min(fill.day, fill.endDay) : -1;
  const fillMax = fill?.rowId === row.id ? Math.max(fill.day, fill.endDay) : -1;
  const fixedCell = "border-b border-r border-slate-200 bg-[#fdf7ef] px-1";
  return (
    <>
      <tr className="group h-9 hover:bg-slate-50/60">
        <td style={stickyOffset(STICKY_LEFT.product, STICKY_WIDTHS.product)} className="sticky z-20 border-b border-r border-slate-200 bg-white px-1.5 py-0.5">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => onToggleExpand(row.id)} aria-label={opened ? `Свернуть ${row.color}` : `Раскрыть ${row.color}`} aria-expanded={opened} className="grid h-7 w-5 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${opened ? "rotate-180" : "-rotate-90"}`} />
            </button>
            <ProductThumb row={row} marketplace={marketplace} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[10px] font-semibold text-slate-800">{row.color}{row.isNew ? " · Новый" : ""}</span>
              <span className="block truncate text-[9px] text-slate-400">{row.variant} · {marketplace === "wb" ? "WB" : "SKU"} {row.externalId || "—"} · ост. {number(row.stock)}</span>
            </span>
            {!readOnly ? <button type="button" onClick={() => onRemove(row.id)} aria-label={`Удалить ${row.color} из плана`} title="Удалить из плана" className="grid h-7 w-6 shrink-0 place-items-center rounded-md text-slate-300 opacity-0 hover:bg-rose-50 hover:text-rose-600 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button> : null}
          </div>
        </td>
        <td style={stickyOffset(STICKY_LEFT.price, STICKY_WIDTHS.price)} className={`sticky z-20 ${fixedCell}`}><FixedInput label={`${row.variant}, цена`} value={row.price} disabled={readOnly} focusClass={focusClass} onChange={(value) => onRowChange(row.id, { price: value })} /></td>
        <td style={stickyOffset(STICKY_LEFT.buyout, STICKY_WIDTHS.buyout)} className={`sticky z-20 ${fixedCell}`}><FixedInput label={`${row.variant}, ${marketplace === "wb" ? "выкуп" : "завершение"}`} value={row.buyout} disabled={readOnly} focusClass={focusClass} onChange={(value) => onRowChange(row.id, { buyout: value })} /></td>
        <td style={stickyOffset(STICKY_LEFT.ads, STICKY_WIDTHS.ads)} className={`sticky z-20 ${fixedCell} shadow-[6px_0_10px_rgba(15,23,42,0.05)]`}><FixedInput label={`${row.variant}, реклама`} value={row.adPct} disabled={readOnly} focusClass={focusClass} onChange={(value) => onRowChange(row.id, { adPct: value })} /></td>
        {days.map((day) => {
          const orders = row.months[monthKey]?.[day] ?? 0;
          const selected = selectedCell?.rowId === row.id && selectedCell.day === day;
          const inFill = day >= fillMin && day <= fillMax;
          return (
            <td key={day} onMouseEnter={() => onFillEnter({ rowId: row.id, day })} className={`relative ${dayCellClass} border-b border-r border-slate-200 p-0.5 ${isWeekend(plan.year, monthKey, day + 1) ? "bg-sky-50/70" : "bg-white"} ${inFill ? fillClass : ""}`}>
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
                className={`h-7 w-full rounded-md border border-transparent bg-transparent px-0.5 text-center text-[11px] font-semibold ${dayNumericClass} text-slate-700 outline-none transition placeholder:text-slate-300 hover:border-slate-200 focus:bg-white focus:ring-2 disabled:cursor-default disabled:text-slate-500 ${focusClass} ${selected ? selectedClass : ""}`}
              />
              {selected && !readOnly ? <button type="button" tabIndex={-1} aria-label="Протянуть значение" onMouseDown={(event) => { event.preventDefault(); onFillStart({ rowId: row.id, day, endDay: day, value: orders }); }} className={`absolute bottom-0.5 right-0.5 h-2.5 w-2.5 cursor-crosshair rounded-[2px] border border-white ${handleClass}`} /> : null}
            </td>
          );
        })}
        <EndCell strong>{number(totals.orders)}</EndCell><EndCell>{number(totals.buyouts)}</EndCell><EndCell>{compactMoney(totals.ads)}</EndCell><EndCell>{compactMoney(totals.revenue)}</EndCell><EndCell>{totals.drr.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%</EndCell>
      </tr>
      {opened ? <ExpandedRows row={row} monthKey={monthKey} days={days} year={plan.year} /> : null}
    </>
  );
}

function FixedInput({ label, value, disabled, onChange, focusClass }: { label: string; value: number; disabled: boolean; onChange: (value: number) => void; focusClass: string }) {
  return <input type="text" inputMode="decimal" value={value || ""} placeholder="—" disabled={disabled} aria-label={label} onChange={(event) => onChange(parseNonNegativeNumber(event.target.value))} className={`h-7 w-full rounded-md border border-transparent bg-transparent px-0.5 text-right text-[10px] font-semibold tabular-nums text-slate-700 outline-none transition hover:border-[#eadcc8] focus:bg-white focus:ring-2 disabled:cursor-default disabled:text-slate-500 ${focusClass}`} />;
}

function ExpandedRows({ row, monthKey, days }: { row: SalesPlanRow; monthKey: string; days: number[]; year: number }) {
  const definitions = [
    { label: "Выкупы, шт", color: "bg-emerald-500", read: (day: number) => calculateSalesPlanDaily(row, row.months[monthKey]?.[day] ?? 0).buyouts, total: calculateSalesPlanRowMonth(row, monthKey).buyouts, kind: "number" },
    { label: "Заказы в ₽", color: "bg-violet-500", read: (day: number) => calculateSalesPlanDaily(row, row.months[monthKey]?.[day] ?? 0).gross, total: calculateSalesPlanRowMonth(row, monthKey).gross, kind: "money" },
    { label: "Реклама, ₽", color: "bg-amber-500", read: (day: number) => calculateSalesPlanDaily(row, row.months[monthKey]?.[day] ?? 0).ads, total: calculateSalesPlanRowMonth(row, monthKey).ads, kind: "money" },
    { label: "ДРР, %", color: "bg-rose-500", read: (day: number) => calculateSalesPlanDaily(row, row.months[monthKey]?.[day] ?? 0).drr, total: calculateSalesPlanRowMonth(row, monthKey).drr, kind: "pct" },
  ];
  return <>{definitions.map((definition) => (
    <tr key={definition.label} className="h-7 bg-slate-50/50 text-[10px] text-slate-500">
      <td style={stickyOffset(STICKY_LEFT.product, STICKY_WIDTHS.product)} className="sticky z-20 border-b border-r border-slate-200 bg-slate-50 px-2"><span className="flex items-center gap-1.5 pl-5"><span className={`h-2 w-2 rounded-full ${definition.color}`} />{definition.label}</span></td>
      <td style={stickyOffset(STICKY_LEFT.price, STICKY_WIDTHS.price)} className="sticky z-20 border-b border-r border-slate-200 bg-slate-50" /><td style={stickyOffset(STICKY_LEFT.buyout, STICKY_WIDTHS.buyout)} className="sticky z-20 border-b border-r border-slate-200 bg-slate-50" /><td style={stickyOffset(STICKY_LEFT.ads, STICKY_WIDTHS.ads)} className="sticky z-20 border-b border-r border-slate-200 bg-slate-50 shadow-[6px_0_10px_rgba(15,23,42,0.05)]" />
      {days.map((day) => {
        const value = definition.read(day);
        const fullValue = definition.kind === "money" ? `${number(value)} ₽` : definition.kind === "pct" ? `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%` : number(value);
        return <td key={day} title={value ? fullValue : undefined} className={`${dayCellClass} border-b border-r border-slate-200 px-1 text-center ${dayNumericClass}`}>{definition.kind === "money" ? compactDayMoney(value) : definition.kind === "pct" ? `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%` : value ? number(value) : "—"}</td>;
      })}
      <td className={`${endCellClass} border-b border-r border-slate-200 bg-slate-50 px-1 text-right font-semibold tabular-nums`}>{definition.kind === "money" ? compactMoney(definition.total) : definition.kind === "pct" ? `${definition.total.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%` : number(definition.total)}</td>
      <td className="border-b border-r border-slate-200 bg-slate-50" /><td className="border-b border-r border-slate-200 bg-slate-50" /><td className="border-b border-r border-slate-200 bg-slate-50" /><td className="border-b border-r border-slate-200 bg-slate-50" />
    </tr>
  ))}</>;
}

function EndHead({ children }: { children: React.ReactNode }) { return <th className={`sticky top-0 z-30 ${endCellClass} border-b border-r border-slate-200 bg-slate-50 px-1 text-right last:border-r-0`}>{children}</th>; }
function EndCell({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) { return <td className={`${endCellClass} border-b border-r border-slate-200 bg-white px-1 text-right text-[10px] tabular-nums last:border-r-0 ${strong ? "font-semibold text-slate-800" : ""}`}>{children}</td>; }
function StickyTotal({ children, left, width, shadow = false }: { children: React.ReactNode; left: number; width: number; shadow?: boolean }) { return <td style={stickyOffset(left, width)} className={`sticky z-20 border-t border-r border-slate-200 bg-slate-100 px-1.5 text-right ${shadow ? "shadow-[6px_0_10px_rgba(15,23,42,0.05)]" : ""}`}>{children}</td>; }
function ExtraTotal({ label, values, days, end }: { label: string; values: number[]; days: number; end: string[] }) { return <tr className="h-7 bg-slate-50 text-[10px] font-semibold text-slate-600"><td style={stickyOffset(STICKY_LEFT.product, STICKY_WIDTHS.product)} className="sticky z-20 border-b border-r border-slate-200 bg-slate-50 px-2">{label}</td><td style={stickyOffset(STICKY_LEFT.price, STICKY_WIDTHS.price)} className="sticky z-20 border-b border-r border-slate-200 bg-slate-50" /><td style={stickyOffset(STICKY_LEFT.buyout, STICKY_WIDTHS.buyout)} className="sticky z-20 border-b border-r border-slate-200 bg-slate-50" /><td style={stickyOffset(STICKY_LEFT.ads, STICKY_WIDTHS.ads)} className="sticky z-20 border-b border-r border-slate-200 bg-slate-50 shadow-[6px_0_10px_rgba(15,23,42,0.05)]" />{Array.from({ length: days }, (_, day) => { const value = values[day] ?? 0; return <td key={day} title={value ? `${number(value)} ₽` : undefined} className={`${dayCellClass} border-b border-r border-slate-200 px-0.5 text-center ${dayNumericClass}`}>{compactDayMoney(value)}</td>; })}{end.map((value, index) => <td key={index} className={`${endCellClass} border-b border-r border-slate-200 px-1 text-right text-[10px] tabular-nums last:border-r-0`}>{value}</td>)}</tr>; }
