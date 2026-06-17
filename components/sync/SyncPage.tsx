"use client";

import { CheckCircle2, Play, RefreshCw, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatNumber, formatTime } from "@/lib/analytics/format";
import type { SyncLogRow } from "@/app/api/sync-log/route";

const JOBS: { key: string; label: string; schedule: string }[] = [
  { key: "orders", label: "Заказы", schedule: "каждые 30 мин" },
  { key: "sales", label: "Продажи", schedule: "каждые 30 мин" },
  { key: "stocks", label: "Остатки", schedule: "каждый час" },
  { key: "adverts", label: "Кампании", schedule: "каждый час" },
  { key: "advert-stats", label: "Статистика рекламы", schedule: "каждый час" },
  { key: "funnel", label: "Воронка", schedule: "каждые 2 часа" },
];

function durationMs(r: SyncLogRow): number | null {
  if (!r.started_at || !r.finished_at) return null;
  return new Date(r.finished_at).getTime() - new Date(r.started_at).getTime();
}

export function SyncPage() {
  const [log, setLog] = useState<SyncLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backfillFrom, setBackfillFrom] = useState("2026-03-01");

  const loadLog = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sync-log", { cache: "no-store" });
      const json = await res.json();
      if (json.error) setError(json.error);
      else setLog(json.data ?? []);
    } catch {
      setError("Не удалось загрузить журнал");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLog();
  }, [loadLog]);

  const runJob = async (job: string) => {
    setRunning(job);
    setError(null);
    try {
      await fetch(`/api/sync/trigger?job=${job}`, { method: "POST" });
    } catch {
      setError("Ошибка запуска синхронизации");
    } finally {
      setRunning(null);
      loadLog();
    }
  };

  // Догрузка истории: заказы + продажи с выбранной даты, по одному кабинету за вызов
  // (большие объёмы за один запрос упираются в лимит функции 60с). Идемпотентно по srid/saleID.
  const runBackfill = async () => {
    setRunning("backfill");
    setError(null);
    try {
      const shopsRes = await fetch("/api/shops", { cache: "no-store" });
      const shops: { key: string }[] = await shopsRes.json();
      const cabs = shops.map((s) => s.key).filter((k) => k && k !== "all");
      const from = encodeURIComponent(backfillFrom);
      for (const cab of cabs) {
        await fetch(`/api/sync/trigger?job=orders&from=${from}&cabinet=${cab}`, { method: "POST" });
        await fetch(`/api/sync/trigger?job=sales&from=${from}&cabinet=${cab}`, { method: "POST" });
        loadLog();
      }
    } catch {
      setError("Ошибка догрузки истории");
    } finally {
      setRunning(null);
      loadLog();
    }
  };

  // последняя запись по каждому заданию
  const lastByJob = new Map<string, SyncLogRow>();
  for (const r of log) {
    if (!lastByJob.has(r.job)) lastByJob.set(r.job, r);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Синхронизация</h1>
          <p className="text-sm text-slate-400 mt-1">
            Состояние синков WB → Supabase и журнал запусков
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadLog}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Журнал
          </button>
          <button
            onClick={() => runJob("all")}
            disabled={running !== null}
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <Play className={`h-4 w-4 ${running === "all" ? "animate-pulse" : ""}`} />
            Обновить всё
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="font-medium text-slate-900">Догрузить историю</p>
            <p className="mt-0.5 max-w-xl text-xs text-slate-500">
              Обычный синк тянет только последние 30 дней. Чтобы подтянуть продажи и заказы за более ранний
              период (графики «до 15 мая» и т.п.), укажите дату начала и запустите разовую догрузку.
              Идёт по кабинетам последовательно — может занять пару минут, дождитесь окончания.
            </p>
          </div>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            С даты
            <input
              type="date"
              value={backfillFrom}
              onChange={(e) => setBackfillFrom(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
            />
          </label>
          <button
            onClick={runBackfill}
            disabled={running !== null}
            className="flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            <Play className={`h-4 w-4 ${running === "backfill" ? "animate-pulse" : ""}`} />
            Догрузить заказы + продажи
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {JOBS.map((j) => {
          const last = lastByJob.get(j.key);
          const ok = last?.status === "ok";
          return (
            <div key={j.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-slate-900">{j.label}</p>
                  <p className="text-xs text-slate-400">{j.schedule}</p>
                </div>
                <button
                  onClick={() => runJob(j.key)}
                  disabled={running !== null}
                  className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Play className={`h-3 w-3 ${running === j.key ? "animate-pulse" : ""}`} />
                  Запустить
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2 text-sm">
                {last ? (
                  <>
                    {ok ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span className={ok ? "text-emerald-700" : "text-red-700"}>
                      {ok ? `${formatNumber(last.rows_affected ?? 0)} строк` : "ошибка"}
                    </span>
                    {last.finished_at && (
                      <span className="ml-auto text-xs text-slate-400">{formatTime(last.finished_at)}</span>
                    )}
                  </>
                ) : (
                  <span className="text-slate-400">ещё не запускалось</span>
                )}
              </div>
              {last && !ok && last.error && (
                <p className="mt-2 truncate text-xs text-red-500" title={last.error}>
                  {last.error}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Задание</th>
              <th className="px-4 py-3">Статус</th>
              <th className="px-4 py-3 text-right">Строк</th>
              <th className="px-4 py-3 text-right">Длит.</th>
              <th className="px-4 py-3 text-right">Завершено</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {log.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  {loading ? "Загрузка..." : "Журнал пуст"}
                </td>
              </tr>
            ) : (
              log.map((r) => {
                const ms = durationMs(r);
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-700">{r.job}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          r.status === "ok"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-red-50 text-red-700"
                        }`}
                      >
                        {r.status}
                      </span>
                      {r.error && (
                        <span className="ml-2 text-xs text-red-400" title={r.error}>
                          {r.error.slice(0, 40)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600">
                      {r.rows_affected != null ? formatNumber(r.rows_affected) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-400">
                      {ms != null ? `${(ms / 1000).toFixed(1)}с` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-400">
                      {r.finished_at ? formatTime(r.finished_at) : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
