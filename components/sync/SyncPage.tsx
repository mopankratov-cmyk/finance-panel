"use client";

import { AlertTriangle, CheckCircle2, Play, RefreshCw, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatNumber, formatTime } from "@/lib/analytics/format";
import { deploymentPinnedFetch } from "@/lib/http/deploymentPinnedFetch";
import { readApiResponse, readOkApiResponse } from "@/lib/http/readApiResponse";
import { asSyncPayload, syncDeferredMessage, syncErrorMessage, syncPayloadOk } from "@/lib/sync/result";
import type { SyncLogRow } from "@/app/api/sync-log/route";
import { syncFreshness } from "@/lib/sync/freshness";

const JOBS: { key: string; label: string; schedule: string }[] = [
  { key: "orders", label: "Заказы WB", schedule: "каждый час, :00" },
  { key: "sales", label: "Продажи WB", schedule: "каждый час, :02" },
  { key: "stocks", label: "Остатки WB", schedule: "каждый час, :04" },
  { key: "adverts", label: "Кампании WB", schedule: "каждый час, :00" },
  { key: "advert-stats", label: "Статистика рекламы WB", schedule: "каждый час, :00" },
  { key: "funnel", label: "Воронка WB", schedule: "каждый час, :20" },
  { key: "feedbacks", label: "Отзывы WB", schedule: "каждый час, :10" },
  { key: "token-health", label: "Токены WB", schedule: "ежедневно, 06:15" },
  { key: "ozon-adverts", label: "Реклама Ozon", schedule: "каждый час, :25" },
];

interface CabinetHealthSource {
  job: string;
  status: string;
  rows: number;
  lastSyncedAt: string | null;
  ageMinutes: number | null;
  slaMinutes: number;
  stale: boolean;
  coveragePct: number;
  fieldCoverage?: Array<{ field: string; label: string; filled: number; total: number; coveragePct: number | null; error: string | null }>;
  cursor: string | null;
  lastError: string | null;
}

interface CabinetHealth {
  id: string;
  name: string;
  brands: string[];
  scope: { restricted: boolean; total: number; allowed: number | null; norvia: number; rioBox: number; updatedAt: string | null };
  tokens: Array<{ scope: string; label: string; available: boolean | null; daysLeft: number | null; error: string | null }>;
  sources: CabinetHealthSource[];
}

function durationMs(r: SyncLogRow): number | null {
  if (!r.started_at || !r.finished_at) return null;
  return new Date(r.finished_at).getTime() - new Date(r.started_at).getTime();
}

export function SyncPage() {
  const [log, setLog] = useState<SyncLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cabinetHealth, setCabinetHealth] = useState<CabinetHealth[]>([]);
  const [healthWarnings, setHealthWarnings] = useState<string[]>([]);
  const [backfillFrom, setBackfillFrom] = useState("2026-03-01");

  const loadLog = useCallback(async () => {
    setLoading(true);
    try {
      const [logResponse, healthResponse] = await Promise.all([
        deploymentPinnedFetch("/api/sync-log", { cache: "no-store" }),
        deploymentPinnedFetch("/api/wb/sync-health", { cache: "no-store" }),
      ]);
      const json = await readOkApiResponse<{ data?: SyncLogRow[]; error?: string }>(logResponse, "Журнал синхронизации");
      setLog(json.data ?? []);
      const health = await readApiResponse<{ cabinets?: CabinetHealth[]; warnings?: string[]; error?: string }>(healthResponse, "Диагностика WB");
      if (!healthResponse.ok || health.error) {
        setHealthWarnings([health.error || `Диагностика WB вернула HTTP ${healthResponse.status}`]);
      } else {
        setCabinetHealth(health.cabinets ?? []);
        setHealthWarnings(health.warnings ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить журнал");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLog();
  }, [loadLog]);

  const requestSync = async (url: string) => {
    const res = await deploymentPinnedFetch(url, { method: "POST" });
    const raw = await readApiResponse<{ error?: string } & Record<string, unknown>>(res, "Запуск синхронизации");
    const body = asSyncPayload(raw);
    if (!syncPayloadOk(res.ok, body)) {
      throw new Error(syncErrorMessage(body, `HTTP ${res.status}`));
    }
    return body;
  };

  const runJob = async (job: string, cabinetId?: string) => {
    const runningKey = cabinetId ? `${job}:${cabinetId}` : job;
    setRunning(runningKey);
    setError(null);
    setNotice(null);
    try {
      const result = await requestSync(`/api/sync/trigger?job=${job}${cabinetId ? `&cabinet=${encodeURIComponent(cabinetId)}` : ""}`);
      setNotice(syncDeferredMessage(result));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка запуска синхронизации");
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
      const shopsRes = await deploymentPinnedFetch("/api/shops", { cache: "no-store" });
      const shops = await readOkApiResponse<Array<{ key: string }> & { error?: string }>(shopsRes, "Список кабинетов");
      const cabs = shops.map((s) => s.key).filter((k) => k && k !== "all");
      const from = encodeURIComponent(backfillFrom);
      for (const cab of cabs) {
        await requestSync(`/api/sync/trigger?job=orders&from=${from}&cabinet=${cab}`);
        await requestSync(`/api/sync/trigger?job=sales&from=${from}&cabinet=${cab}`);
        loadLog();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка догрузки истории");
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
            Состояние синхронизаций маркетплейсов и журнал запусков
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
            Обновить WB
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{notice}</div>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Кабинеты WB</h2>
          <p className="mt-1 text-xs text-slate-400">Полнота товарного контура, токены, курсоры и свежесть источников без раскрытия секретов.</p>
        </div>
        {healthWarnings.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{healthWarnings.join(" · ")}</div>}
        <div className="space-y-3">
          {cabinetHealth.map((cabinet) => (
            <article key={cabinet.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <div><h3 className="font-semibold text-slate-900">{cabinet.name}</h3><p className="mt-0.5 text-xs text-slate-400">{cabinet.scope.restricted ? `Разрешено ${cabinet.scope.allowed ?? cabinet.scope.total} SKU · NORVIA ${cabinet.scope.norvia} · RIO BOX ${cabinet.scope.rioBox}` : `Весь кабинет · ${cabinet.scope.total} SKU в scope`}</p></div>
                <div className="flex flex-wrap gap-1">{cabinet.brands.map((brand) => <span key={brand} className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-semibold uppercase text-violet-700">{brand}</span>)}</div>
              </header>
              <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-xs">
                    <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-400"><tr><th className="px-4 py-2">Источник</th><th className="px-3 py-2">Состояние</th><th className="px-3 py-2 text-right">Покрытие</th><th className="px-3 py-2 text-right">Строк</th><th className="px-3 py-2">Последнее обновление</th><th className="px-3 py-2 text-right">Действие</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">{cabinet.sources.map((source) => {
                      const bad = source.status === "error" || source.status === "stale" || Boolean(source.lastError);
                      const pending = source.status === "running" || source.status === "pending" || source.status === "backfill";
                      const tone = bad ? "bg-red-50 text-red-700" : pending ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700";
                      const key = `${source.job}:${cabinet.id}`;
                      const statusLabel = source.status === "stale" ? "просрочено" : bad ? "ошибка" : pending ? "догружается" : "свежо";
                      return <tr key={source.job}><td className="px-4 py-2.5 font-medium text-slate-700">{source.job}</td><td className="px-3 py-2.5"><span className={`rounded px-1.5 py-0.5 font-semibold ${tone}`}>{statusLabel}</span>{source.lastError ? <div title={source.lastError} className="mt-1 max-w-[220px] truncate text-[10px] text-red-500">{source.lastError}</div> : null}</td><td className="px-3 py-2.5 text-right tabular-nums"><div>{source.coveragePct}%</div>{source.fieldCoverage?.map((coverage) => <div key={coverage.field} title={coverage.error || `${coverage.filled} из ${coverage.total}`} className={`mt-1 text-[9px] ${coverage.error ? "text-red-500" : coverage.coveragePct == null ? "text-slate-300" : coverage.coveragePct >= 80 ? "text-emerald-600" : "text-amber-600"}`}>{coverage.label}: {coverage.error ? "ошибка" : coverage.coveragePct == null ? "—" : `${coverage.coveragePct}%`}</div>)}</td><td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(source.rows)}</td><td className="px-3 py-2.5 text-slate-500">{source.lastSyncedAt ? formatTime(source.lastSyncedAt) : "—"}{source.ageMinutes != null ? <div className="text-[9px] text-slate-300">возраст {source.ageMinutes} мин · SLA {source.slaMinutes} мин</div> : null}{source.cursor ? <div className="max-w-[180px] truncate text-[9px] text-slate-300" title={source.cursor}>cursor {source.cursor}</div> : null}</td><td className="px-3 py-2.5 text-right"><button onClick={() => runJob(source.job, cabinet.id)} disabled={running !== null} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"><Play className={`h-3 w-3 ${running === key ? "animate-pulse" : ""}`} />Повторить</button></td></tr>;
                    })}</tbody>
                  </table>
                </div>
                <aside className="border-t border-slate-100 p-4 lg:border-l lg:border-t-0"><h4 className="text-xs font-semibold text-slate-700">Токены</h4>{cabinet.tokens.length ? <div className="mt-2 space-y-2">{cabinet.tokens.map((token) => <div key={token.scope} className="flex items-center justify-between gap-2"><span className="text-[11px] text-slate-500">{token.label}</span><span title={token.error || undefined} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${token.available === true && (token.daysLeft == null || token.daysLeft > 30) ? "bg-emerald-50 text-emerald-700" : token.available === null ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{token.available === false ? "нет доступа" : token.daysLeft != null ? `${token.daysLeft} дн.` : token.available === true ? "доступен" : "не проверен"}</span></div>)}</div> : <p className="mt-2 text-[11px] text-slate-400">Ежедневная проверка ещё не запускалась.</p>}</aside>
              </div>
            </article>
          ))}
        </div>
      </section>

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
          const freshness = syncFreshness(last);
          const ok = freshness.state === "ok";
          const missed = freshness.state === "missed";
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
                    ) : missed ? (
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span className={ok ? "text-emerald-700" : missed ? "text-amber-700" : "text-red-700"}>
                      {ok ? `${formatNumber(last.rows_affected ?? 0)} строк` : missed ? `пропущен · ${freshness.ageMinutes} мин без обновления` : "ошибка"}
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

      <div className="max-w-full overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
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
                            : r.status === "partial"
                              // Начали и не доделали — это не провал, но и не успех.
                              ? "bg-amber-50 text-amber-700"
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
