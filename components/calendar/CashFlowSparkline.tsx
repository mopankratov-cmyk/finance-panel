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
import { useIsBelowDesktop, useIsTouch } from "@/hooks/useMediaQuery";

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

  // Всё, ради чего в график заглядывают, лежало в подсказке по наведению —
  // пальцем её не достать. Поэтому там, где наведения нет, подсказка
  // открывается по тапу, точки становятся видимыми целями, а два главных
  // числа месяца выписаны текстом и не требуют попадания в линию вовсе.
  const touch = useIsTouch();
  const belowDesktop = useIsBelowDesktop();
  const noHover = touch || belowDesktop;

  const extremes = useMemo(() => {
    if (data.length === 0) return null;
    const lowest = data.reduce((worst, point) => (point.balance < worst.balance ? point : worst), data[0]);
    return { lowest, final: data[data.length - 1] };
  }, [data]);

  if (data.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        Прогноз остатка за месяц
      </p>
      <ResponsiveContainer width="100%" height={noHover ? 120 : 72}>
        <LineChart
          data={data}
          margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
        >
          <XAxis
            dataKey="day"
            tick={{ fontSize: noHover ? 11 : 9, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={{ stroke: "#e2e8f0" }}
            interval="preserveStartEnd"
          />
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip content={<ChartTooltip />} trigger={noHover ? "click" : "hover"} />
          <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3" />
          <Line
            type="monotone"
            dataKey="balancePositive"
            stroke="#7c3aed"
            strokeWidth={2}
            dot={noHover ? { r: 3 } : false}
            activeDot={noHover ? { r: 6 } : true}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="balanceNegative"
            stroke="#ef4444"
            strokeWidth={2}
            dot={noHover ? { r: 3 } : false}
            activeDot={noHover ? { r: 6 } : true}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {noHover && extremes && (
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
          <div className="flex gap-1.5">
            <dt className="text-slate-500">Минимум:</dt>
            <dd className={`font-semibold tabular-nums ${extremes.lowest.balance < 0 ? "text-red-600" : "text-slate-800"}`}>
              {formatMoney(extremes.lowest.balance)} · {extremes.lowest.day} числа
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-slate-500">На конец месяца:</dt>
            <dd className={`font-semibold tabular-nums ${extremes.final.balance < 0 ? "text-red-600" : "text-slate-800"}`}>
              {formatMoney(extremes.final.balance)}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
