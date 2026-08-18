"use client";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Clock3,
  KanbanSquare,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LoadingBanner, SkeletonCards, useElapsedSeconds } from "@/components/ui/LoadingState";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

type TaskStatus = "planned" | "progress" | "done";

interface SignalItem {
  nm: number;
  article: string;
  signal: string;
  severity: "high" | "medium" | "low";
  reason: string;
  metrics: { ordersCountMonth?: number; stock?: number; drr?: number | null; marginPct?: number | null };
}

interface SignalsData { items: SignalItem[]; count: number; error?: string }

interface LocalTask {
  id: string;
  title: string;
  detail: string;
  status: TaskStatus;
  createdAt: string;
}

interface TaskView {
  id: string;
  title: string;
  detail: string;
  status: TaskStatus;
  severity: "high" | "medium" | "low";
  article?: string;
  nm?: number;
  local?: boolean;
}

const COLUMNS: Array<{ id: TaskStatus; label: string; icon: typeof CircleDashed; tone: string }> = [
  { id: "planned", label: "Запланировано", icon: CircleDashed, tone: "text-slate-500" },
  { id: "progress", label: "В работе", icon: Clock3, tone: "text-amber-600" },
  { id: "done", label: "Готово", icon: CheckCircle2, tone: "text-emerald-600" },
];

const statusIndex = (status: TaskStatus) => COLUMNS.findIndex((column) => column.id === status);
const severityTone = (severity: TaskView["severity"]) => severity === "high" ? "bg-rose-50 text-rose-700" : severity === "medium" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600";

export function WbTasksPage() {
  const { cabinetId, activeCabinet, cabinets, ready, loading: cabinetsLoading, error: cabinetsError } = useWbCabinet();
  const [data, setData] = useState<SignalsData | null>(null);
  const [statuses, setStatuses] = useState<Record<string, TaskStatus>>({});
  const [customTasks, setCustomTasks] = useState<LocalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDetail, setDraftDetail] = useState("");
  const [loadedStorageKey, setLoadedStorageKey] = useState("");
  const elapsed = useElapsedSeconds(loading);
  const storageKey = `wb_tasks:${cabinetId || "all"}`;

  useEffect(() => {
    setLoadedStorageKey("");
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "{}") as { statuses?: Record<string, TaskStatus>; customTasks?: LocalTask[] };
      setStatuses(saved.statuses ?? {});
      setCustomTasks(Array.isArray(saved.customTasks) ? saved.customTasks : []);
    } catch {
      setStatuses({});
      setCustomTasks([]);
    }
    setLoadedStorageKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (loadedStorageKey !== storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ statuses, customTasks }));
    } catch {
      // The board still works in memory when browser storage is unavailable.
    }
  }, [customTasks, loadedStorageKey, statuses, storageKey]);

  useEffect(() => {
    if (!modalOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [modalOpen]);

  useEffect(() => {
    if (!ready || cabinetsLoading) return;
    if (!cabinets.length) {
      setLoading(false);
      setError(cabinetsError || "Подключите хотя бы один активный WB-кабинет в настройках");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/signals?cabinet=${encodeURIComponent(cabinetId || "all")}&window=14&persist=0`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as SignalsData;
        if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then(setData)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить задачи");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, ready, retryKey]);

  const tasks = useMemo<TaskView[]>(() => {
    const signalTasks = (data?.items ?? []).filter((item) => item.signal !== "OK").map((item) => {
      const id = `signal:${item.nm}:${item.signal}`;
      return {
        id,
        title: item.signal,
        detail: item.reason,
        status: statuses[id] ?? "planned",
        severity: item.severity,
        article: item.article,
        nm: item.nm,
      } satisfies TaskView;
    });
    return [
      ...signalTasks,
      ...customTasks.map((task) => ({ ...task, severity: "low" as const, local: true })),
    ];
  }, [customTasks, data?.items, statuses]);

  const move = (task: TaskView, direction: -1 | 1) => {
    const next = COLUMNS[statusIndex(task.status) + direction]?.id;
    if (!next) return;
    if (task.local) setCustomTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: next } : item));
    else setStatuses((current) => ({ ...current, [task.id]: next }));
  };

  const createTask = () => {
    const title = draftTitle.trim();
    if (!title) return;
    setCustomTasks((current) => [...current, { id: `local:${Date.now()}`, title, detail: draftDetail.trim(), status: "planned", createdAt: new Date().toISOString() }]);
    setDraftTitle("");
    setDraftDetail("");
    setModalOpen(false);
  };

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
      <WbModuleHeader
        icon={KanbanSquare}
        title="Задачи / Roadmap"
        description={`Сигналы по данным · ${activeCabinet?.name ?? "все кабинеты"}`}
        actions={<><button type="button" onClick={() => setRetryKey((value) => value + 1)} className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-8 sm:min-w-8" title="Обновить"><RefreshCw className="h-3.5 w-3.5" /></button><button type="button" onClick={() => setModalOpen(true)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:min-h-8"><Plus className="h-3.5 w-3.5" /> Новая задача</button></>}
      />

      <div className="px-2 py-3 sm:px-6">
        {loading ? <><LoadingBanner seconds={elapsed} hint="Формируем задачи из сигналов SKU" /><SkeletonCards count={9} /></> : error ? <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} /> : tasks.length === 0 ? <WbEmptyState>Сигналов нет. Можно добавить ручную задачу.</WbEmptyState> : (
          <div className="grid min-w-0 gap-3 lg:grid-cols-3">
            {COLUMNS.map((column) => {
              const rows = tasks.filter((task) => task.status === column.id);
              const Icon = column.icon;
              return <section key={column.id} className="min-w-0 rounded-xl border border-slate-200 bg-slate-100/60 p-2.5" aria-labelledby={`tasks-${column.id}`}>
                <div className="mb-2 flex h-8 items-center gap-2 px-1"><Icon className={`h-4 w-4 ${column.tone}`} /><h2 id={`tasks-${column.id}`} className="text-xs font-bold text-slate-700">{column.label}</h2><span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-400">{rows.length}</span></div>
                <div className="space-y-2">
                  {rows.map((task) => <article key={task.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                    <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${severityTone(task.severity)}`}>{task.severity === "high" ? "высокий" : task.severity === "medium" ? "средний" : task.local ? "локально" : "низкий"}</span>{task.article ? <span className="truncate text-[9px] text-slate-400">{task.article} · nm {task.nm}</span> : null}</div><h3 className="mt-2 text-[12px] font-bold leading-4 text-slate-800">{task.title}</h3><p className="mt-1 text-[11px] leading-4 text-slate-500">{task.detail || "Без описания"}</p></div>{task.local ? <button type="button" aria-label="Удалить задачу" onClick={() => setCustomTasks((current) => current.filter((item) => item.id !== task.id))} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-600 sm:h-8 sm:w-8"><Trash2 className="h-3.5 w-3.5" /></button> : null}</div>
                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2"><button type="button" disabled={statusIndex(task.status) === 0} onClick={() => move(task, -1)} className="inline-flex h-11 items-center gap-1 rounded-lg px-2 text-[10px] font-semibold text-slate-500 hover:bg-slate-50 disabled:invisible sm:h-8"><ArrowLeft className="h-3 w-3" /> Назад</button><button type="button" disabled={statusIndex(task.status) === COLUMNS.length - 1} onClick={() => move(task, 1)} className="inline-flex h-11 items-center gap-1 rounded-lg px-2 text-[10px] font-semibold text-violet-700 hover:bg-violet-50 disabled:invisible sm:h-8">Дальше <ArrowRight className="h-3 w-3" /></button></div>
                  </article>)}
                  {!rows.length ? <div className="rounded-xl border border-dashed border-slate-300 px-3 py-8 text-center text-[11px] text-slate-400">Переместите сюда задачу</div> : null}
                </div>
              </section>;
            })}
          </div>
        )}
      </div>

      {modalOpen ? <><button type="button" aria-label="Закрыть окно" className="fixed inset-0 z-[79] bg-slate-950/30" onClick={() => setModalOpen(false)} /><div role="dialog" aria-modal="true" aria-labelledby="new-task-title" className="fixed left-1/2 top-1/2 z-[80] w-[calc(100%-24px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"><div className="flex items-center"><h2 id="new-task-title" className="text-sm font-bold text-slate-800">Новая задача</h2><button type="button" aria-label="Закрыть диалог" onClick={() => setModalOpen(false)} className="ml-auto grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:bg-slate-50 sm:h-10 sm:w-10"><X className="h-4 w-4" /></button></div><label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Название<input autoFocus value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal normal-case tracking-normal outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /></label><label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Описание<textarea value={draftDetail} onChange={(event) => setDraftDetail(event.target.value)} rows={4} className="mt-1 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal normal-case tracking-normal outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /></label><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setModalOpen(false)} className="min-h-11 rounded-lg px-3 text-xs font-semibold text-slate-500 hover:bg-slate-50">Отмена</button><button type="button" onClick={createTask} disabled={!draftTitle.trim()} className="min-h-11 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-40">Создать</button></div></div></> : null}
    </div>
  );
}
