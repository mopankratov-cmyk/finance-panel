export function MetricSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-700/80 bg-slate-800/60 p-4">
      <div className="h-3 w-20 rounded bg-slate-700" />
      <div className="mt-3 h-7 w-28 rounded bg-slate-700" />
      <div className="mt-2 h-3 w-16 rounded bg-slate-700" />
    </div>
  );
}

export function ChartSkeleton({ height = 240 }: { height?: number }) {
  return (
    <div
      className="animate-pulse rounded-xl border border-slate-700/80 bg-slate-800/60"
      style={{ height }}
    />
  );
}

export function TableSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-700/80 bg-slate-800/60 p-4 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-8 rounded bg-slate-700" />
      ))}
    </div>
  );
}
