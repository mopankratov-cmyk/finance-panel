"use client";

import { useMemo } from "react";
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DayInfo } from "@/lib/calculations";
import { formatMoney } from "@/lib/format";

interface CashFlowSparklineProps {
  year: number;
  month: number;
  dailyMap: Map<string, DayInfo>;
}

interface ChartPoint {
  day: number;
  dateStr: string;
  balance: number;
  balancePositive: number | null;
  balanceNegative: number | null;
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
}) {
  if (!active || !payload?.[0]) return null;
  const { day, balance } = payload[0].payload;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md">
      <p className="text-slate-500">День {day}</p>
      <p
        className={`font-bold tabular-nums ${balance >= 0 ? "text-emerald-600" : "text-red-600"}`}
      >
        {formatMoney(balance)}
      </p>
    </div>
  );
}

export function CashFlowSparkline({
  year,
  month,
  dailyMap,
}: CashFlowSparklineProps) {
  const data = useMemo(() => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const points: ChartPoint[] = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const balance = dailyMap.get(dateStr)?.balance ?? 0;
      points.push({
        day: d,
        dateStr,
        balance,
        balancePositive: balance >= 0 ? balance : null,
        balanceNegative: balance < 0 ? balance : null,
      });
    }

    return points;
  }, [year, month, dailyMap]);

  if (data.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        Прогноз остатка за месяц
      </p>
      <ResponsiveContainer width="100%" height={72}>
        <LineChart
          data={data}
          margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
        >
          <XAxis
            dataKey="day"
            tick={{ fontSize: 9, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={{ stroke: "#e2e8f0" }}
            interval="preserveStartEnd"
          />
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip content={<ChartTooltip />} />
          <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3" />
          <Line
            type="monotone"
            dataKey="balancePositive"
            stroke="#7c3aed"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="balanceNegative"
            stroke="#ef4444"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
