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
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:border-violet-400 hover:text-violet-600"
        >
          {p.label}
        </button>
      ))}
      <input
        type="date"
        value={range.from}
        onChange={(e) => onChange({ ...range, from: e.target.value })}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
      />
      <span className="text-slate-400">—</span>
      <input
        type="date"
        value={range.to}
        onChange={(e) => onChange({ ...range, to: e.target.value })}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
      />
    </div>
  );
}
