"use client";

import { Check, Printer } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import { WbProductImage } from "@/components/wb/WbProductImage";
import { MARKETPLACE_LABEL } from "@/lib/warehouse/cabinetChannels";
import { DraftNotice } from "@/components/warehouse/DraftNotice";
import { formatWaiting, TASK_STALE_MS } from "@/lib/warehouse/duration";
import { newDocKey } from "@/lib/warehouse/docKey";
import { plural } from "@/lib/warehouse/plural";
import { TASK_STATUS_LABEL, type ShipmentTaskRow, type TaskLineInput } from "@/lib/warehouse/tasks";
import { useDraft } from "@/lib/warehouse/useDraft";

export const taskDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }) : "";

/** Кабинет-адресат с меткой маркетплейса: у кабинетов бывают похожие имена,
 *  а отгрузка не туда — это товар, уехавший не на ту площадку. */
export function TaskCabinet({ task }: { task: ShipmentTaskRow }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-slate-700">{task.cabinetName ?? "кабинет"}</span>
      {task.marketplace && (
        <span className={`rounded px-1 py-0.5 text-[10px] ${
          task.marketplace === "ozon" ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700"
        }`}>{MARKETPLACE_LABEL[task.marketplace]}</span>
      )}
    </span>
  );
}

const STATUS_CLASS: Record<ShipmentTaskRow["status"], string> = {
  draft: "bg-red-50 text-red-600",
  posted: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-slate-200 text-slate-600",
  reversed: "bg-amber-100 text-amber-700",
};

export function TaskStatusPill({ status }: { status: ShipmentTaskRow["status"] }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLASS[status]}`}>
      {TASK_STATUS_LABEL[status]}
    </span>
  );
}

const digitsOnly = (value: string) => value.replace(/[^\d]/g, "");
const toQty = (raw: string | undefined) => Math.max(0, Number(raw ?? "") || 0);
const initialQty = (task: ShipmentTaskRow) =>
  Object.fromEntries(task.lines.map((line) => [line.variantId, String(line.qty)]));

/**
 * Карточка задания на отгрузку — то, что видит фулфилмент. Все поля из ТЗ:
 * модель, размер, баркод, остаток на складе, количество. Отгрузить можно
 * меньше задания (не нашли, брак) — разница попадёт в событие и в документ;
 * больше — нельзя: задание и есть предел того, что админ разрешил увезти.
 *
 * Родитель перемонтирует карточку через key при изменении строк, поэтому
 * начальные значения полей берутся из пропсов один раз.
 */
export function TaskCard({
  task,
  entityId,
  canManage,
  expanded,
  onToggle,
  onShipped,
  onChanged,
}: {
  task: ShipmentTaskRow;
  entityId: string;
  canManage: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** Отгрузка подтверждена: сообщение для зелёной панели. */
  onShipped: (message: string) => void;
  /** Задание изменено или отменено: резерв поменялся, список перечитать. */
  onChanged: (message: string) => void;
}) {
  const [shipQty, setShipQty] = useState<Record<string, string>>(() => initialQty(task));

  /**
   * Сборка переживает заснувший телефон.
   *
   * Кладовщик ходит по складу с телефоном: вкладка выгружается, и колонка
   * «Отгружаем» снова показывает ПОЛНОЕ задание — правдоподобно и неверно.
   * Это опаснее пустых полей: «Отгружено» проведёт то, чего не отгружали.
   *
   * Черновик пуст, пока значения равны заданию: иначе синяя плашка висела бы
   * на каждой нетронутой карточке. Возвращаем только те размеры, которые в
   * задании ещё есть — админ мог его поправить, пока человек шёл до полки.
   */
  const draftValue = useMemo(() => shipQty, [shipQty]);
  const { restoredAt, forget } = useDraft(
    `warehouse:task:${task.id}`,
    draftValue,
    useCallback((value: Record<string, string>) =>
      task.lines.every((line) => toQty(value[line.variantId]) === line.qty), [task.lines]),
    useCallback((value: Record<string, string>) => {
      setShipQty((prev) => {
        const next = { ...prev };
        for (const line of task.lines) {
          const saved = value?.[line.variantId];
          if (saved !== undefined) next[line.variantId] = saved;
        }
        return next;
      });
    }, [task.lines]),
  );
  const [editing, setEditing] = useState(false);
  // Время берём один раз при монтировании: вычислять его в теле рендера значит
  // получить разную разметку на сервере и в браузере.
  const [nowMs] = useState(() => Date.now());
  const waiting = task.status === "draft" ? formatWaiting(task.createdAt, nowMs) : null;
  const stale = waiting !== null && nowMs - Date.parse(task.createdAt) >= TASK_STALE_MS;
  const [editQty, setEditQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"ship" | "save" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shipLines: TaskLineInput[] = task.lines.map((line) => ({ variantId: line.variantId, qty: toQty(shipQty[line.variantId]) }));
  const shipTotal = shipLines.reduce((sum, line) => sum + line.qty, 0);
  const overTask = task.lines.filter((line) => toQty(shipQty[line.variantId]) > line.qty);
  const changed = task.lines.some((line) => toQty(shipQty[line.variantId]) !== line.qty);

  const ship = async () => {
    if (shipTotal === 0) {
      setError("Нечего отгружать: все количества нули. Если задание не нужно, его отменяет администратор.");
      return;
    }
    if (overTask.length > 0) { setError("Больше задания отгрузить нельзя — исправьте выделенные строки"); return; }
    setBusy("ship");
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/tasks/${task.id}/ship`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Строки шлём только когда что-то изменили: без них сервер отгружает
        // задание как есть, и в событии видно, что оно выполнено полностью.
        body: JSON.stringify({ entityId, docKey: newDocKey(), ...(changed ? { lines: shipLines } : {}) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось отгрузить");
      const result = json.data as { number: string; qty: number };
      // Стираем черновик ДО коллбэка: после него карточка уходит из списка и
      // размонтируется, и вызов «после» может не состояться.
      forget();
      onShipped(`Отгружено ${formatNumber(result.qty)} шт, накладная ${result.number}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отгрузить");
    } finally {
      setBusy(null);
    }
  };

  const startEdit = () => {
    setEditQty(initialQty(task));
    setEditing(true);
    setError(null);
  };

  const save = async () => {
    const lines = task.lines
      .map((line) => ({ variantId: line.variantId, qty: toQty(editQty[line.variantId]) }))
      .filter((line) => line.qty > 0);
    if (lines.length === 0) { setError("Чтобы убрать всё, отмените задание"); return; }
    if (task.lines.every((line) => toQty(editQty[line.variantId]) === line.qty)) { setEditing(false); return; }
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, lines }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось изменить задание");
      setEditing(false);
      forget();
      onChanged(`Задание ${task.number} изменено`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить задание");
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (!window.confirm(`Отменить задание ${task.number}? Резерв снимется, товар останется на складе.`)) return;
    const reason = window.prompt("Причина отмены (можно оставить пустой)", "");
    // «Отмена» в окне причины — человек передумал.
    if (reason === null) return;
    setBusy("cancel");
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/tasks/${task.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, reason: reason.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось отменить задание");
      onChanged(`Задание ${task.number} отменено`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отменить задание");
    } finally {
      setBusy(null);
    }
  };

  const lineCount = task.lines.length;

  return (
    <div className={`rounded-xl border bg-white ${expanded ? "border-slate-200" : "border-slate-200/80"}`}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button onClick={onToggle} className="text-sm font-semibold text-slate-900 hover:text-violet-700">
          {task.number}
        </button>
        <TaskCabinet task={task} />
        <TaskStatusPill status={task.status} />
        <span className="text-xs text-slate-400">
          поставил {task.createdBy ?? "—"} {taskDate(task.createdAt)}
          {task.warehouseName ? ` · со склада ${task.warehouseName}` : ""}
        </span>
        {/* Возраст задания виден до открытия: очередь читается сверху вниз, и
            «ждёт 3 дн» красным — единственный способ отличить залежавшееся от
            поставленного пять минут назад. */}
        {waiting && (
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${stale ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-500"}`}>
            {waiting}
          </span>
        )}
        {!expanded && (
          <span className="text-xs text-slate-400">
            {lineCount} {plural(lineCount, "позиция", "позиции", "позиций")} · {formatNumber(task.qty)} шт
          </span>
        )}
        <button
          onClick={onToggle}
          className="ml-auto inline-flex min-h-11 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 hover:bg-slate-50 lg:min-h-0 lg:py-1"
        >
          {expanded ? "Свернуть" : "Открыть"}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-100">
          {task.note && <p className="px-4 pt-3 text-xs text-slate-500">Комментарий: {task.note}</p>}
          {restoredAt !== null && (
            <div className="px-4 pt-3">
              <DraftNotice at={restoredAt} onForget={() => { forget(); setShipQty(initialQty(task)); }} />
            </div>
          )}
          {error && <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

          {/* Пять колонок с полем ввода в последней в 320 px не помещаются: на
              телефоне строка становится карточкой, где артикул с размером —
              заголовок, а «Отгружаем» — поле под ним. Иначе фулфилмент вводит
              число, уже не видя, к какому размеру оно относится. */}
          <div className="table-cards scroll-x px-4 md:px-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 text-left font-medium">Товар</th>
                  <th className="px-4 py-2 text-left font-medium">Штрихкод</th>
                  <th className="px-4 py-2 text-right font-medium">На складе</th>
                  <th className="px-4 py-2 text-right font-medium">Задание</th>
                  {!editing && <th className="px-4 py-2 text-right font-medium">Отгружаем</th>}
                </tr>
              </thead>
              <tbody>
                {task.lines.map((line) => {
                  const wanted = toQty(shipQty[line.variantId]);
                  const tone = wanted > line.qty
                    ? "border-red-300 bg-red-50"
                    : wanted < line.qty ? "border-amber-300 bg-amber-50" : "border-slate-200";
                  const short = line.onHand < line.qty;
                  return (
                    <tr key={line.id} className="border-b border-slate-100 last:border-0">
                      <td data-cell="title" className="px-4 py-2">
                        <div className="flex items-center gap-2.5">
                          <WbProductImage
                            nm={line.nmId ?? undefined}
                            src={line.photoUrl ?? undefined}
                            alt={line.article}
                            label={line.article}
                            className="h-9 w-9 shrink-0 rounded-lg border border-slate-100 bg-slate-50 object-cover"
                          />
                          <span className="break-anywhere font-medium text-slate-900">{line.article}</span>
                          {line.sizeLabel && (
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{line.sizeLabel}</span>
                          )}
                        </div>
                      </td>
                      <td data-label="Штрихкод" className="break-anywhere px-4 py-2 text-xs text-slate-400">{line.barcode ?? "—"}</td>
                      <td
                        data-label="На складе"
                        className={`px-4 py-2 text-right tabular-nums ${short ? "font-medium text-red-600" : "text-slate-600"}`}
                      >
                        {formatNumber(line.onHand)}
                        {/* Пояснение текстом, а не в title: на касании подсказки
                            по наведению не существует. */}
                        {short && <span className="ml-1.5 text-xs font-normal">меньше задания</span>}
                      </td>
                      <td data-label="Задание" className="px-4 py-2 text-right">
                        {editing ? (
                          <input
                            inputMode="numeric"
                            value={editQty[line.variantId] ?? ""}
                            onChange={(e) => setEditQty((prev) => ({ ...prev, [line.variantId]: digitsOnly(e.target.value) }))}
                            className={`min-h-11 w-20 rounded-lg border px-2 py-1 text-right text-sm lg:min-h-0 ${
                              toQty(editQty[line.variantId]) > line.onHand ? "border-red-300 bg-red-50" : "border-slate-200"
                            }`}
                          />
                        ) : (
                          <span className="font-semibold tabular-nums text-slate-900">{formatNumber(line.qty)}</span>
                        )}
                      </td>
                      {!editing && (
                        <td data-label="Отгружаем" className="px-4 py-2 text-right">
                          <input
                            inputMode="numeric"
                            value={shipQty[line.variantId] ?? ""}
                            onChange={(e) => setShipQty((prev) => ({ ...prev, [line.variantId]: digitsOnly(e.target.value) }))}
                            className={`min-h-11 w-20 rounded-lg border px-2 py-1 text-right text-sm lg:min-h-0 ${tone}`}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-4 py-3">
            <a
              href={`/warehouse/print/${task.id}`}
              target="_blank"
              rel="noreferrer"
              title="Печатная форма задания"
              className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 hover:bg-slate-50 lg:min-h-0 lg:py-1.5"
            >
              <Printer className="h-3.5 w-3.5" /> Печать
            </a>
            {editing ? (
              <>
                <span className="text-xs text-slate-400">Ноль убирает строку из задания</span>
                <button
                  onClick={() => setEditing(false)}
                  disabled={busy !== null}
                  className="ml-auto inline-flex min-h-11 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 lg:min-h-0 lg:py-1.5"
                >
                  Отмена
                </button>
                <button
                  onClick={() => void save()}
                  disabled={busy !== null}
                  className="inline-flex min-h-11 items-center rounded-lg bg-violet-600 px-4 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 lg:min-h-0 lg:py-1.5"
                >
                  {busy === "save" ? "Сохраняю…" : "Сохранить"}
                </button>
              </>
            ) : (
              <>
                <span className="text-sm text-slate-600">
                  Отгружаем <b className="text-slate-900">{formatNumber(shipTotal)}</b> из {formatNumber(task.qty)} шт
                  {overTask.length > 0 && <span className="ml-2 text-red-600">больше задания нельзя</span>}
                </span>
                {canManage && (
                  <>
                    <button
                      onClick={startEdit}
                      disabled={busy !== null}
                      className="ml-auto inline-flex min-h-11 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 lg:min-h-0 lg:py-1.5"
                    >
                      Изменить
                    </button>
                    <button
                      onClick={() => void cancel()}
                      disabled={busy !== null}
                      className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 hover:text-red-600 disabled:opacity-50 lg:min-h-0 lg:py-1.5"
                    >
                      {busy === "cancel" ? "Отменяю…" : "Отменить"}
                    </button>
                  </>
                )}
                <button
                  onClick={() => void ship()}
                  disabled={busy !== null || shipTotal === 0 || overTask.length > 0}
                  className={`${canManage ? "" : "ml-auto "}inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-4 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 lg:min-h-0 lg:py-1.5`}
                >
                  <Check className="h-4 w-4" />
                  {busy === "ship" ? "Отгружаю…" : "Отгружено"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
