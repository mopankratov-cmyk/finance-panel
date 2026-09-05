"use client";

import { Printer } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import { formatSince } from "@/lib/warehouse/duration";
import { plural } from "@/lib/warehouse/plural";
import type { ShipmentTaskRow, ShipmentTasksResponse } from "@/lib/warehouse/tasks";
import { TaskCabinet, TaskCard, TaskStatusPill, taskDate } from "@/components/warehouse/TaskCard";

/** Ключ перемонтирования карточки: строки задания поменялись — поля ввода
 *  должны начаться заново с новых количеств, а не хранить старые. */
const cardKey = (task: ShipmentTaskRow) =>
  `${task.id}:${task.lines.map((line) => `${line.variantId}=${line.qty}`).join(",")}`;

/**
 * Список заданий на отгрузку (ТЗ команды, п. 4). Ждущие первыми — их
 * выполняют; выполненные и отменённые за два месяца — компактными строками,
 * чтобы было видно, что сделано и через сколько.
 */
export function TaskList({
  entityId,
  canManage,
  refreshKey,
  onShipped,
  onChanged,
}: {
  entityId: string;
  canManage: boolean;
  /** Любая смена значения перечитывает список. */
  refreshKey: string | number;
  /** Отгрузка подтверждена: остаток изменился, родителю пора перечитать своё. */
  onShipped: () => void;
  /** Задание изменено или отменено: изменился только резерв. */
  onChanged?: () => void;
}) {
  const [data, setData] = useState<ShipmentTasksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/tasks?entity=${entityId}`, { cache: "no-store" });
      const json = await res.json();
      // 503 до миграции приходит с подсказкой, какие файлы применить, — показываем как есть.
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить задания");
      const payload = json.data as ShipmentTasksResponse;
      setData(payload);
      // Первое ждущее задание открыто сразу: оператор пришёл его выполнять, а
      // не искать, что нажать. Уже открытые остаются открытыми, выполненные
      // из набора уходят.
      setExpanded((prev) => {
        const drafts = payload.rows.filter((row) => row.status === "draft");
        const alive = new Set([...prev].filter((id) => drafts.some((row) => row.id === id)));
        if (alive.size === 0 && drafts[0]) alive.add(drafts[0].id);
        return alive;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить задания");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const shipped = async (message: string) => {
    setDone(message);
    await load();
    onShipped();
  };

  const changed = async (message: string) => {
    setDone(message);
    await load();
    onChanged?.();
  };

  if (loading && !data) {
    return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Загружаю задания…</div>;
  }

  const drafts = (data?.rows ?? []).filter((row) => row.status === "draft");
  const finished = (data?.rows ?? []).filter((row) => row.status !== "draft");
  const pending = data?.pending ?? drafts.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-900">Задания</span>
        {pending > 0 ? (
          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600">
            {pending} {plural(pending, "ждёт", "ждут", "ждут")} ФФ
          </span>
        ) : (
          <span className="text-xs text-slate-400">ожидающих нет</span>
        )}
        {loading && <span className="text-xs text-slate-300">обновляю…</span>}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {done && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{done}</div>}

      {data && data.rows.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-700">Заданий пока нет</p>
          <p className="mt-1 text-sm text-slate-400">
            {canManage
              ? "Создайте задание выше — фулфилмент увидит его здесь."
              : "Администратор ещё не поставил ни одного задания на отгрузку."}
          </p>
        </div>
      )}

      {drafts.map((task) => (
        <TaskCard
          key={cardKey(task)}
          task={task}
          entityId={entityId}
          canManage={canManage}
          expanded={expanded.has(task.id)}
          onToggle={() => toggle(task.id)}
          onShipped={(message) => void shipped(message)}
          onChanged={(message) => void changed(message)}
        />
      ))}

      {finished.map((task) => {
        const who = task.status === "posted" ? task.confirmedBy ?? task.createdBy : task.createdBy;
        const when = task.status === "posted" ? task.confirmedAt ?? task.occurredAt : task.occurredAt;
        // Тайминг итерации по ТЗ считается из отметок, не вводится руками.
        const took = task.status === "posted" ? formatSince(task.createdAt, task.confirmedAt) : null;
        const qty = task.shippedQty ?? task.qty;
        return (
          <div
            key={task.id}
            className={`flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm ${
              task.status === "posted" ? "" : "opacity-70"
            }`}
          >
            <span className="font-medium text-slate-900">{task.number}</span>
            <TaskCabinet task={task} />
            <TaskStatusPill status={task.status} />
            <span className="text-xs text-slate-400">
              {who ?? "—"} · {taskDate(when)}{took ? ` · ${took}` : ""}
            </span>
            <span className="text-xs text-slate-400">
              {task.lines.length} {plural(task.lines.length, "позиция", "позиции", "позиций")} · {formatNumber(qty)} шт
              {task.status === "posted" && task.shippedQty !== null && task.shippedQty !== task.qty
                ? ` (задание ${formatNumber(task.qty)})`
                : ""}
            </span>
            {task.status === "cancelled" && task.note && (
              <span className="text-xs text-slate-400">· {task.note}</span>
            )}
            {task.status === "posted" && (
              <a
                href={`/warehouse/print/${task.id}`}
                target="_blank"
                rel="noreferrer"
                title="Печатная форма накладной"
                className="ml-auto inline-flex min-h-11 items-center gap-1 text-xs text-slate-500 hover:text-violet-600 lg:min-h-0"
              >
                <Printer className="h-3.5 w-3.5" /> Печать
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
