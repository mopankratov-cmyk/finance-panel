"use client";

import { Warehouse } from "lucide-react";
import { useMemo, useState } from "react";
import { SlidePanel } from "@/components/ui/SlidePanel";
import { formatNumber } from "@/lib/analytics/format";
import { normalizeSelection, onlyWbWarehouses, selectionLabel, toggleWarehouse, type WarehouseOption } from "@/lib/supplies/stockFilter";

/**
 * Выбор складов WB, по которым считается остаток.
 *
 * Реален только остаток на «Склад WB» (FBW и FBS): склады по городам после
 * пожара пусты, а их строки в отчёте WB — фантом, из-за которого общая сумма
 * завышена. Поэтому по умолчанию выбран «Склад WB», а остальные склады остаются
 * в списке для сверки. Выбор лежит в панели, а не в выпадающем списке: складов
 * десятки, и на телефоне длинный список поверх страницы не прокрутить, а
 * SlidePanel умеет и то, и другое (mobile-adaptation §5).
 */
export function WarehouseFilter({
  options,
  selected,
  onChange,
}: {
  options: WarehouseOption[];
  /** null — все склады. */
  selected: ReadonlySet<string> | null;
  onChange: (next: Set<string> | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? options.filter((option) => option.warehouse.toLowerCase().includes(needle)) : options;
  }, [options, query]);
  const hasWb = options.some((option) => option.wb);
  const chosen = (warehouse: string) => selected === null || selected.has(warehouse);
  const chosenQuantity = options.reduce((sum, option) => sum + (chosen(option.warehouse) ? option.quantity : 0), 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={`inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm lg:min-h-0 lg:py-1.5 ${selected === null ? "border-slate-300 bg-white text-slate-700" : "border-violet-300 bg-violet-50 font-medium text-violet-800"}`}
      >
        <Warehouse className="h-4 w-4 shrink-0" />
        Склады WB: {selectionLabel(selected, options)}
      </button>
      {selected !== null ? (
        <button type="button" onClick={() => onChange(null)} className="min-h-11 rounded-md px-2 text-sm text-violet-700 underline-offset-2 hover:underline lg:min-h-0">
          все склады
        </button>
      ) : null}

      <SlidePanel
        open={open}
        onClose={() => setOpen(false)}
        title="Склады WB"
        narrow
        footer={
          <button type="button" onClick={() => setOpen(false)} className="min-h-11 w-full rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700">
            Готово · {formatNumber(chosenQuantity)} шт
          </button>
        }
      >
        <div className="space-y-3 p-4">
          <p className="text-xs leading-5 text-slate-500">
            Остаток, «хватит дней» и итоги считаются по выбранным складам. Реален только остаток на <b>«Склад WB»</b> (FBW и FBS): склады по городам после пожара пусты, а их цифры в отчёте WB — фантом, из-за которого общая сумма завышена.
          </p>
          <div className="flex flex-wrap gap-2">
            {hasWb ? (
              <button type="button" onClick={() => onChange(onlyWbWarehouses(options))} className="min-h-11 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 lg:min-h-0 lg:py-1.5">
                Только «Склад WB» — корректный остаток
              </button>
            ) : null}
            <button type="button" onClick={() => onChange(null)} className="min-h-11 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 lg:min-h-0 lg:py-1.5">Все склады</button>
            <button type="button" onClick={() => onChange(normalizeSelection(new Set(), options))} className="min-h-11 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 lg:min-h-0 lg:py-1.5">Снять все</button>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="поиск по складу"
            aria-label="Поиск по складу"
            className="min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm focus:border-violet-500 focus:outline-none lg:min-h-0 lg:py-1.5"
          />
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {visible.map((option) => (
              <li key={option.warehouse}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={chosen(option.warehouse)}
                    onChange={() => onChange(toggleWarehouse(selected, option.warehouse, options))}
                    className="h-5 w-5 shrink-0 lg:h-4 lg:w-4"
                  />
                  <span className="min-w-0 flex-1 text-sm text-slate-800">
                    <span className="break-anywhere">{option.warehouse}</span>
                    {option.wb ? <span className="ml-1.5 text-[10px] font-medium text-emerald-700">реальный остаток · FBW и FBS</span> : null}
                  </span>
                  <span className="shrink-0 text-right text-xs tabular-nums text-slate-500">
                    {formatNumber(option.quantity)} шт
                    <span className="block text-[10px] text-slate-400">{formatNumber(option.skus)} арт.</span>
                  </span>
                </label>
              </li>
            ))}
            {visible.length === 0 ? <li className="px-3 py-6 text-center text-xs text-slate-400">Склада с таким названием нет.</li> : null}
          </ul>
        </div>
      </SlidePanel>
    </>
  );
}
