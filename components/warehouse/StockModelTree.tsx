"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { formatNumber } from "@/lib/analytics/format";
import { WbProductImage } from "@/components/wb/WbProductImage";
import { plural } from "@/lib/warehouse/plural";
import type { StockMatrixResponse, StockModelNode } from "@/lib/warehouse/stockMatrix";
import { StockSizeMatrix } from "@/components/warehouse/StockSizeMatrix";
import { Hint } from "@/components/ui/Hint";

export type StockWarehouse = StockMatrixResponse["warehouses"][number];

/** Колонок в таблице — чтобы строка с матрицей растянулась на всю ширину. */
const COLUMNS = 8;

const money = (value: number) => formatNumber(Math.round(value));

/**
 * Короткое имя склада для разбивки в строке: «ФФ 568 · в пути 44». Полное
 * название («ФФ СЕРДЦА») в каждой строке — шум; но если фулфилментов два,
 * «ФФ» перестаёт что-то значить, и остаётся название.
 */
export function warehouseShortName(warehouse: StockWarehouse, all: StockWarehouse[]): string {
  if (warehouse.kind === "transit") return "в пути";
  if (warehouse.kind === "fulfillment" && all.filter((item) => item.kind === "fulfillment").length === 1) return "ФФ";
  return warehouse.name;
}

/** Разбивка остатка по складам в порядке справочника, без нулей. */
export function warehouseBreakdown(byWarehouse: Record<string, number>, warehouses: StockWarehouse[]): string {
  const known = warehouses
    .filter((warehouse) => (byWarehouse[warehouse.id] ?? 0) !== 0)
    .map((warehouse) => `${warehouseShortName(warehouse, warehouses)} ${formatNumber(byWarehouse[warehouse.id])}`);
  // Склад, которого уже нет в справочнике, но остаток на нём есть: показать
  // честнее, чем молча спрятать разницу между «всего» и суммой по складам.
  const orphan = Object.entries(byWarehouse)
    .filter(([id, qty]) => qty !== 0 && !warehouses.some((warehouse) => warehouse.id === id))
    .map(([, qty]) => `склад удалён ${formatNumber(qty)}`);
  return [...known, ...orphan].join(" · ");
}

function QtyCell({ qty, byWarehouse, warehouses }: { qty: number; byWarehouse: Record<string, number>; warehouses: StockWarehouse[] }) {
  // Разбивка нужна, только когда складов больше одного: при единственном
  // складе «ФФ 173» под каждой цифрой — повтор того, что и так известно.
  const breakdown = warehouses.length > 1 ? warehouseBreakdown(byWarehouse, warehouses) : "";
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      <div className={`font-semibold ${qty < 0 ? "text-red-600" : "text-slate-900"}`}>{formatNumber(qty)}</div>
      {breakdown && <div className="whitespace-nowrap text-[11px] text-slate-400">{breakdown}</div>}
    </td>
  );
}

/** «В заданиях» и «Ожидается»: ноль не печатаем — пустая клетка читается
 *  быстрее, чем столбец нулей, а красное должно бросаться в глаза. */
function RedCell({ value }: { value: number }) {
  return (
    <td className={`px-3 py-2 text-right tabular-nums ${value > 0 ? "font-medium text-red-600" : "text-slate-300"}`}>
      {value > 0 ? formatNumber(value) : ""}
    </td>
  );
}

function PlainCell({ value }: { value: number }) {
  return <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatNumber(value)}</td>;
}

/** Себестоимость и сумма. У размера себестоимость приходит с сервера, у
 *  модели и цвета — средняя по остатку: сумма денег на количество. */
function CostCells({ qty, amount, unitCost }: { qty: number; amount: number; unitCost?: number }) {
  const cost = unitCost ?? (qty > 0 ? amount / qty : 0);
  return (
    <>
      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
        {cost > 0 ? cost.toFixed(2) : <span className="text-slate-300">—</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
        {amount !== 0 ? money(amount) : <span className="text-slate-300">—</span>}
      </td>
    </>
  );
}

function Caret({ open }: { open: boolean }) {
  return open
    ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
    : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />;
}

/**
 * Остатки как иерархия «модель → цвет → размер» (ТЗ команды, п. 2). Модель
 * раскрывается в цвета, цвет — в размеры и в матрицу приходов и отгрузок.
 * Раскрытие живёт в памяти вкладки: по умолчанию всё свёрнуто, чтобы список
 * из полусотни моделей читался как список, а не как простыня размеров.
 */
export function StockModelTree({ models, warehouses }: { models: StockModelNode[]; warehouses: StockWarehouse[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const rows: ReactNode[] = [];
  for (const model of models) {
    const modelOpen = expanded.has(model.key);
    rows.push(
      <tr
        key={model.key}
        onClick={() => toggle(model.key)}
        className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
      >
        <td className="px-4 py-2">
          <div className="flex items-center gap-2.5">
            <Caret open={modelOpen} />
            <WbProductImage
              nm={model.nmId ?? undefined}
              src={model.photoUrl ?? undefined}
              alt={model.label}
              label={model.label}
              className="h-10 w-10 shrink-0 rounded-lg border border-slate-100 bg-slate-50 object-cover"
            />
            <div className="min-w-0">
              <div className="font-semibold text-slate-900">{model.label}</div>
              <div className="truncate text-xs text-slate-400">
                {model.name && model.name !== model.label ? `${model.name} · ` : ""}
                {model.colors.length} {plural(model.colors.length, "цвет", "цвета", "цветов")}
              </div>
            </div>
          </div>
        </td>
        <QtyCell qty={model.totals.qty} byWarehouse={model.totals.byWarehouse} warehouses={warehouses} />
        <RedCell value={model.totals.reserved} />
        <RedCell value={model.totals.expected} />
        <PlainCell value={model.totals.received} />
        <PlainCell value={model.totals.shipped} />
        <CostCells qty={model.totals.qty} amount={model.totals.amount} />
      </tr>,
    );
    if (!modelOpen) continue;

    for (const color of model.colors) {
      const colorOpen = expanded.has(color.key);
      rows.push(
        <tr
          key={color.key}
          onClick={() => toggle(color.key)}
          className="cursor-pointer border-b border-slate-100 bg-slate-50/40 hover:bg-slate-50"
        >
          <td className="py-2 pl-10 pr-4">
            <div className="flex items-center gap-2.5">
              <Caret open={colorOpen} />
              <WbProductImage
                nm={color.nmId ?? undefined}
                src={color.photoUrl ?? undefined}
                alt={color.article}
                label={color.article}
                className="h-8 w-8 shrink-0 rounded-lg border border-slate-100 bg-slate-50 object-cover"
              />
              <span className="font-medium text-slate-800">{color.article}</span>
              {color.color && <span className="text-xs text-slate-400">{color.color}</span>}
              {color.isNovelty && (
                <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">новинка</span>
              )}
              <span className="text-xs text-slate-300">
                {color.sizes.length} {plural(color.sizes.length, "размер", "размера", "размеров")}
              </span>
            </div>
          </td>
          <QtyCell qty={color.totals.qty} byWarehouse={color.totals.byWarehouse} warehouses={warehouses} />
          <RedCell value={color.totals.reserved} />
          <RedCell value={color.totals.expected} />
          <PlainCell value={color.totals.received} />
          <PlainCell value={color.totals.shipped} />
          <CostCells qty={color.totals.qty} amount={color.totals.amount} />
        </tr>,
      );
      if (!colorOpen) continue;

      for (const size of color.sizes) {
        const byWarehouse: Record<string, number> = {};
        for (const item of size.byWarehouse) byWarehouse[item.warehouseId] = item.qty;
        rows.push(
          <tr key={size.variantId} className="border-b border-slate-100 bg-slate-50/70">
            <td className="py-1.5 pl-20 pr-4">
              <div className="flex items-center gap-2">
                {size.sizeLabel
                  ? <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{size.sizeLabel}</span>
                  : <span className="text-xs text-slate-300">без размера</span>}
                {size.barcode && <span className="text-xs text-slate-400">{size.barcode}</span>}
              </div>
            </td>
            <QtyCell qty={size.qty} byWarehouse={byWarehouse} warehouses={warehouses} />
            <RedCell value={size.reserved} />
            <RedCell value={size.expected} />
            <PlainCell value={size.received} />
            <PlainCell value={size.shipped} />
            <CostCells qty={size.qty} amount={size.amount} unitCost={size.unitCost} />
          </tr>,
        );
      }

      rows.push(
        <tr key={`${color.key}:matrix`} className="border-b border-slate-100">
          <td colSpan={COLUMNS} className="bg-slate-50 px-4 py-3">
            {/* Ячейка растянута на всю ширину таблицы остатков, а та шире
                экрана: раскрыв цвет на телефоне, человек видел середину
                матрицы и её заголовок с колонкой «Размер» искал, прокрутив
                внешнюю таблицу обратно влево. Прилипание к левому краю
                прокрутки возвращает матрицу туда, где на неё смотрят. */}
            <div className="sticky left-0 max-w-[calc(100vw-3rem)] lg:static lg:max-w-none">
              <StockSizeMatrix node={color} />
            </div>
          </td>
        </tr>,
      );
    }
  }

  return (
    <div className="scroll-x rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
            <th className="px-4 py-3 text-left font-medium">Модель / цвет / размер</th>
            <th className="px-3 py-3 text-right font-medium">Остаток</th>
            {/* Смысл красных колонок жил только в `title`, а подсказки по
                наведению на касании не существует. Абзацем над таблицей его
                выносить нельзя: на десктопе это две лишние строки текста там,
                где раньше была одна шапка. Кнопка-пояснение открывается и
                пальцем, и мышью, а места занимает 14px. */}
            <th className="px-3 py-3 text-right font-medium text-red-600">
              <span className="inline-flex items-center justify-end gap-1">
                В заданиях
                <Hint label="Что значит «В заданиях»">Размещено в заданиях на отгрузку, но ещё не отгружено.</Hint>
              </span>
            </th>
            <th className="px-3 py-3 text-right font-medium text-red-600">
              <span className="inline-flex items-center justify-end gap-1">
                Ожидается
                <Hint label="Что значит «Ожидается»">Ждём приёмки или пересчитано, но ещё не на остатке.</Hint>
              </span>
            </th>
            <th className="px-3 py-3 text-right font-medium">Получено</th>
            <th className="px-3 py-3 text-right font-medium">Отгружено</th>
            <th className="px-3 py-3 text-right font-medium">Себес, ₽</th>
            <th className="px-3 py-3 text-right font-medium">Сумма, ₽</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}
