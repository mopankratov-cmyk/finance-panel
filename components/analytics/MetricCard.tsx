"use client";

import { HelpCircle } from "lucide-react";
import { useState } from "react";
import { formatPct, formatRub, formatNumber } from "@/lib/analytics/format";

interface MetricCardProps {
  label: string;
  value: string;
  change?: number;
  changeLabel?: string;
  tooltip?: string;
  valueClass?: string;
  badge?: React.ReactNode;
}

export function MetricCard({
  label,
  value,
  change,
  changeLabel,
  tooltip,
  valueClass = "text-slate-900",
  badge,
}: MetricCardProps) {
  const [showTip, setShowTip] = useState(false);

  return (
    <div className="relative rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        {tooltip && (
          <button
            type="button"
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
            className="text-slate-400 hover:text-slate-600"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {showTip && tooltip && (
        <div className="absolute right-2 top-8 z-10 max-w-[200px] rounded-lg border border-slate-200 bg-white p-2 text-[10px] text-slate-600 shadow-lg">
          {tooltip}
        </div>
      )}
      <p className={`mt-1 text-xl font-bold tabular-nums sm:text-2xl ${valueClass}`}>
        {value}
      </p>
      {change !== undefined && (
        <p
          className={`mt-1 text-xs font-medium ${
            change > 0 ? "text-emerald-600" : change < 0 ? "text-red-600" : "text-slate-400"
          }`}
        >
          {change > 0 ? "+" : ""}
          {change.toFixed(1)}% {changeLabel ?? "к пред. периоду"}
        </p>
      )}
      {badge && <div className="mt-2">{badge}</div>}
    </div>
  );
}

export function metricChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export { formatRub, formatNumber, formatPct };
