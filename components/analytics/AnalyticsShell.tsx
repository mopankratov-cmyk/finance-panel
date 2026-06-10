"use client";

import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { formatTime } from "@/lib/analytics/format";

interface AnalyticsShellProps {
  title: string;
  subtitle?: string;
  timestamp?: string;
  loading?: boolean;
  syncing?: boolean;
  empty?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  toolbar?: ReactNode;
  children: ReactNode;
}

export function AnalyticsShell({
  title,
  subtitle,
  timestamp,
  loading,
  syncing,
  empty,
  error,
  onRefresh,
  toolbar,
  children,
}: AnalyticsShellProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
          {timestamp && (
            <p className="mt-1 text-xs text-slate-500">
              Данные обновлены: {formatTime(timestamp)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading || syncing}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              Обновить
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-800/60 bg-red-950/30 p-4">
          <p className="text-sm text-red-400">{error}</p>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="mt-2 text-sm font-medium text-red-300 underline"
            >
              Попробовать снова
            </button>
          )}
        </div>
      )}

      {!loading && empty && !error ? (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-6 text-center">
          <p className="text-sm text-slate-300">
            Данных нет. Нажмите «Обновить» для загрузки из Wildberries.
          </p>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
