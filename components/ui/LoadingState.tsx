"use client";

import { useEffect, useState } from "react";

// Живой счётчик секунд с момента как active стало true — используется в LoadingBanner,
// чтобы честно показывать «сколько уже ждём» вместо голого спиннера. WB-агрегация
// (РНП/склейки/комиссия) может занимать 10-20+ секунд, особенно на холодном кэше.
export function useElapsedSeconds(active: boolean): number {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!active) { setSec(0); return; }
    const start = Date.now();
    const id = setInterval(() => setSec(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [active]);
  return sec;
}

export function LoadingBanner({ seconds, hint }: { seconds: number; hint?: string }) {
  const slow = seconds >= 15;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`mb-4 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors ${
        slow ? "border-amber-200 bg-amber-50 text-amber-800" : "border-gray-200 bg-gray-50 text-gray-500"
      }`}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full motion-reduce:animate-none ${slow ? "bg-amber-400" : "bg-gray-400"} opacity-75`} />
        <span className={`relative inline-flex h-2 w-2 rounded-full ${slow ? "bg-amber-500" : "bg-gray-400"}`} />
      </span>
      <span>
        Готовим данные{hint ? ` — ${hint}` : ""}… ({seconds} с)
        {slow && <span className="ml-1 font-medium">— дольше обычного, идёт синхронизация с WB</span>}
      </span>
    </div>
  );
}

export function SkeletonKpiRow({ count = 4 }: { count?: number }) {
  return (
    <div className="mb-5 grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(count, 6)}, minmax(0,1fr))` }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="h-3 w-16 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
          <div className="mt-2 h-6 w-20 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTableRows({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className={`flex items-center gap-3 px-3 py-2.5 ${r > 0 ? "border-t border-gray-100" : ""}`}>
          <div className="h-8 w-8 shrink-0 animate-pulse rounded bg-gray-100 motion-reduce:animate-none" />
          <div className="h-3 w-24 shrink-0 animate-pulse rounded bg-gray-100 motion-reduce:animate-none" />
          <div className="ml-auto flex gap-3">
            {Array.from({ length: cols }).map((_, c) => (
              <div key={c} className="h-3 w-10 animate-pulse rounded bg-gray-100 motion-reduce:animate-none" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3">
          <div className="h-12 w-12 shrink-0 animate-pulse rounded-lg bg-gray-100 motion-reduce:animate-none" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 animate-pulse rounded bg-gray-100 motion-reduce:animate-none" />
            <div className="h-2.5 w-1/4 animate-pulse rounded bg-gray-100 motion-reduce:animate-none" />
          </div>
          <div className="h-4 w-16 animate-pulse rounded bg-gray-100 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}
