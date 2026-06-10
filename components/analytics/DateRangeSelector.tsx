"use client";

import { addDays, toISODate } from "@/lib/analytics/format";
import type { DateRange } from "@/lib/wb/analytics/sales";

const PRESETS = [{ label: "7д", days: 7 }];

interface DateRangeSelectorProps {
  range: DateRange;
  onChange: (range: DateRange) => void;
}

export function DateRangeSelector({ range, onChange }: DateRangeSelectorProps) {
  const setPreset = (days: number) => {
    const to = new Date();
    const from = addDays(to, -(days - 1));
    onChange({ from: toISODate(from), to: toISODate(to) });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((p) => (
        <button
          key={p.label}
          type="button"
          onClick={() => setPreset(p.days)}
          className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-emerald-600 hover:text-emerald-400"
        >
          {p.label}
        </button>
      ))}
      <input
        type="date"
        value={range.from}
        onChange={(e) => onChange({ ...range, from: e.target.value })}
        className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-200"
      />
      <span className="text-slate-500">—</span>
      <input
        type="date"
        value={range.to}
        onChange={(e) => onChange({ ...range, to: e.target.value })}
        className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-200"
      />
    </div>
  );
}
