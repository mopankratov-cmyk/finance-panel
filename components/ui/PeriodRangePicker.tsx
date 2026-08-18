"use client";

import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addMonths,
  anchorMonthFor,
  applyDayClick,
  calendarPair,
  formatRangeLabel,
  isWithinRange,
  moscowToday,
  WEEKDAY_TITLES,
} from "@/lib/ui/calendarGrid";

export interface PeriodPreset {
  value: string;
  label: string;
}

interface Props {
  from: string;
  to: string;
  presets: ReadonlyArray<PeriodPreset>;
  activePreset?: string;
  /** Дальше этой даты выбирать нечего — по умолчанию сегодня (МСК). */
  maxIso?: string;
  disabled?: boolean;
  align?: "left" | "right";
  onApplyPreset: (value: string) => void;
  onApplyRange: (from: string, to: string) => void;
}

const TRIGGER_CLASS =
  "inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-medium tabular-nums text-slate-700 outline-none transition hover:border-slate-300 focus-visible:border-violet-400 focus-visible:ring-2 focus-visible:ring-violet-100 disabled:opacity-50";

/**
 * Выбор периода двумя календарями — как в кабинете-референсе: пресеты слева,
 * два месяца справа, применение по кнопке «Выбрать» (черновик не трогает экран,
 * пока пользователь не подтвердил).
 */
export function PeriodRangePicker({
  from,
  to,
  presets,
  activePreset,
  maxIso,
  disabled,
  align = "left",
  onApplyPreset,
  onApplyRange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ from: string; to: string | null }>({ from, to });
  const [anchor, setAnchor] = useState(() => anchorMonthFor(from, to));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const limit = maxIso ?? moscowToday();

  // Открытие сбрасывает черновик на текущий период — незавершённый выбор
  // прошлого раза не должен всплывать при следующем открытии.
  useEffect(() => {
    if (!open) return;
    setDraft({ from, to });
    setAnchor(anchorMonthFor(from, to));
  }, [open, from, to]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const months = useMemo(() => calendarPair(anchor.year, anchor.month), [anchor]);
  const draftLabel = draft.to
    ? formatRangeLabel(draft.from, draft.to)
    : `${formatRangeLabel(draft.from, draft.from).split(" – ")[0]} — выберите конец периода`;

  const shiftAnchor = (delta: number) => setAnchor((current) => addMonths(current.year, current.month, delta));

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Период"
        className={TRIGGER_CLASS}
      >
        <CalendarDays className="h-3.5 w-3.5 text-violet-500" />
        {formatRangeLabel(from, to)}
        <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div
          className={`absolute top-full z-50 mt-1 w-[min(640px,calc(100vw-32px))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.18)] ${align === "right" ? "right-0" : "left-0"}`}
        >
          <div className="flex flex-col sm:flex-row">
            <div className="flex shrink-0 flex-wrap gap-1 border-b border-slate-100 p-2 sm:w-[150px] sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r">
              {presets.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => {
                    onApplyPreset(preset.value);
                    setOpen(false);
                  }}
                  className={`h-9 rounded-lg px-3 text-left text-[11px] font-medium transition ${
                    activePreset === preset.value
                      ? "bg-violet-50 text-violet-700"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="min-w-0 flex-1 p-3">
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => shiftAnchor(-1)}
                  aria-label="Предыдущий месяц"
                  className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="flex flex-1 justify-around text-[11px] font-bold text-slate-700">
                  {months.map((month) => <span key={month.title}>{month.title}</span>)}
                </div>
                <button
                  type="button"
                  onClick={() => shiftAnchor(1)}
                  aria-label="Следующий месяц"
                  className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {months.map((month) => (
                  <div key={month.title}>
                    <div className="mb-1 grid grid-cols-7 text-center text-[9px] font-semibold uppercase text-slate-400">
                      {WEEKDAY_TITLES.map((weekday) => <span key={weekday}>{weekday}</span>)}
                    </div>
                    <div className="space-y-0.5">
                      {month.weeks.map((week, weekIndex) => (
                        <div key={weekIndex} className="grid grid-cols-7">
                          {week.map((cell) => {
                            const selected = isWithinRange(cell.iso, draft.from, draft.to);
                            const edge = cell.iso === draft.from || cell.iso === draft.to;
                            const beyond = cell.iso > limit;
                            return (
                              <button
                                key={cell.iso}
                                type="button"
                                disabled={beyond}
                                onClick={() => setDraft((current) => applyDayClick(current, cell.iso))}
                                className={`h-8 text-[11px] tabular-nums transition disabled:cursor-not-allowed disabled:text-slate-200 ${
                                  edge
                                    ? "rounded-md bg-violet-600 font-bold text-white"
                                    : selected
                                      ? "bg-violet-50 text-violet-700"
                                      : cell.currentMonth
                                        ? "rounded-md text-slate-700 hover:bg-slate-100"
                                        : "rounded-md text-slate-300 hover:bg-slate-50"
                                }`}
                              >
                                {cell.day}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2">
            <span className="text-[11px] font-medium tabular-nums text-slate-500">{draftLabel}</span>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-9 rounded-lg border border-slate-200 px-3 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                Закрыть
              </button>
              <button
                type="button"
                disabled={!draft.to}
                title={draft.to ? undefined : "Выберите вторую дату периода"}
                onClick={() => {
                  if (!draft.to) return;
                  onApplyRange(draft.from, draft.to);
                  setOpen(false);
                }}
                className="h-9 rounded-lg bg-violet-600 px-4 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
              >
                Выбрать
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
