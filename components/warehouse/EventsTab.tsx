"use client";

import { useEffect, useMemo, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import {
  ALL_EVENT_KINDS,
  EVENT_LABEL,
  EVENT_TONE,
  describeChange,
  describeEvent,
  type WarehouseEventKind,
  type WarehouseEventsResponse,
} from "@/lib/warehouse/events";

const PERIODS = [
  { days: 7, label: "Последние 7 дней" },
  { days: 30, label: "Последние 30 дней" },
  { days: 90, label: "Последние 90 дней" },
] as const;

/** Цвет метки события — по EVENT_TONE из lib, чтобы лента и полоса дел
 *  говорили одними красками: тревога красная, правка жёлтая, готово зелёное. */
const TONE_CLASS: Record<(typeof EVENT_TONE)[WarehouseEventKind], string> = {
  danger: "bg-red-100 text-red-700",
  warn: "bg-amber-100 text-amber-800",
  info: "bg-violet-100 text-violet-700",
  ok: "bg-emerald-100 text-emerald-700",
};

/** Роль рядом с почтой: кто из ленты — фулфилмент, а кто — свои. Финансы и
 *  менеджер Ozon для склада — те же менеджеры: правят и ставят задания. */
const ROLE_TAG: Record<string, { text: string; className: string }> = {
  warehouse: { text: "ФФ", className: "bg-amber-100 text-amber-800" },
  director: { text: "админ", className: "bg-violet-100 text-violet-700" },
  manager: { text: "менеджер", className: "bg-violet-100 text-violet-700" },
  finance: { text: "менеджер", className: "bg-violet-100 text-violet-700" },
  ozon_manager: { text: "менеджер", className: "bg-violet-100 text-violet-700" },
};

/** Сводка «По пользователям»: одна колонка может складывать несколько видов —
 *  отгрузка по заданию и отгрузка сразу для человека одно и то же «отгружено». */
const SUMMARY_COLUMNS: { label: string; kinds: WarehouseEventKind[] }[] = [
  { label: "Приёмок создано", kinds: ["receipt_created"] },
  { label: "Пересчитано", kinds: ["receipt_counted"] },
  { label: "Заданий", kinds: ["task_created"] },
  { label: "Отгружено", kinds: ["task_shipped", "shipment_posted"] },
  { label: "Брак", kinds: ["writeoff_created"] },
];

const stamp = (value: string) =>
  new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Дата N дней назад в местном времени: `toISOString` даёт UTC, и вечером
 *  «сегодня» уехало бы на завтра. */
const dayAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

function RoleTag({ role }: { role: string | null }) {
  const tag = role ? ROLE_TAG[role] : undefined;
  if (!tag) return null;
  return <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] ${tag.className}`}>{tag.text}</span>;
}

const count = (value: number) =>
  value > 0 ? <span className="font-semibold text-slate-900">{formatNumber(value)}</span> : <span className="text-slate-300">—</span>;

/** Хроника склада (п. 5 ТЗ) и журнал правок по людям (п. 6).
 *
 *  Регистр движений знает, что случилось с остатком; лента — кто, когда и
 *  зачем. «Только правки» оставляет коррекции, изменения и отмены с «было →
 *  стало». Сводка внизу — что и сколько сделал каждый за период. */
export function EventsTab({ entityId, refreshKey }: { entityId: string; refreshKey: number }) {
  const [actor, setActor] = useState("");
  const [kind, setKind] = useState<"" | WarehouseEventKind>("");
  const [days, setDays] = useState<number>(30);
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [data, setData] = useState<WarehouseEventsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ entity: entityId, from: dayAgo(days), to: dayAgo(0) });
    if (actor) params.set("actor", actor);
    if (kind) params.set("kind", kind);
    if (onlyChanges) params.set("changes", "1");
    fetch(`/api/warehouse/events?${params}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        // 503 до миграции приходит с подсказкой, какой файл применить — показываем как есть.
        if (!res.ok) throw new Error(json.error || "Не удалось загрузить события");
        return (json.data ?? null) as WarehouseEventsResponse | null;
      })
      .then((next) => { if (!cancelled) setData(next); })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Не удалось загрузить события");
        setData(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entityId, refreshKey, actor, kind, days, onlyChanges]);

  // Выбранный человек остаётся в списке, даже если ответ с его фильтром
  // пришёл без перечня авторов, — иначе фильтр нельзя было бы снять.
  const actors = useMemo(() => {
    const set = new Set(data?.actors ?? []);
    if (actor) set.add(actor);
    return [...set];
  }, [data, actor]);

  const rows = data?.rows ?? [];
  const byActor = data?.byActor ?? [];
  const period = PERIODS.find((item) => item.days === days)?.label ?? `${days} дней`;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-4">
        <select
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="">Все пользователи</option>
          {actors.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as "" | WarehouseEventKind)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="">Все события</option>
          {ALL_EVENT_KINDS.map((item) => <option key={item} value={item}>{EVENT_LABEL[item]}</option>)}
        </select>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
        >
          {PERIODS.map((item) => <option key={item.days} value={item.days}>{item.label}</option>)}
        </select>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {([[false, "Лента"], [true, "Только правки"]] as const).map(([value, label]) => (
            <button
              key={label}
              onClick={() => setOnlyChanges(value)}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                onlyChanges === value ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {data?.truncated && (
          <span className="ml-auto text-xs text-amber-600">Показаны последние {rows.length} — лента длиннее, сузьте период</span>
        )}
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Загружаю события…</div>
      ) : rows.length === 0 && !error ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-700">Событий пока нет</p>
          <p className="mt-1 text-sm text-slate-400">
            {onlyChanges ? "Правок за период не было." : "Приёмки, задания, отгрузки и брак появятся здесь по мере работы."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 text-left font-medium">Когда</th>
                <th className="px-4 py-3 text-left font-medium">Кто</th>
                <th className="px-4 py-3 text-left font-medium">Что</th>
                <th className="px-4 py-3 text-left font-medium">Подробности</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const details = describeEvent(row);
                return (
                  <tr key={row.id} className="border-b border-slate-100 align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{stamp(row.occurredAt)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">
                      {row.actor ?? <span className="text-slate-300">—</span>}
                      <RoleTag role={row.actorRole} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASS[EVENT_TONE[row.kind] ?? "info"]}`}>
                        {row.label}
                      </span>
                      {row.number && <span className="ml-1.5 font-medium text-slate-900">{row.number}</span>}
                      {row.warehouseName && <span className="ml-1.5 text-xs text-slate-400">{row.warehouseName}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {details || (row.changes.length === 0 ? <span className="text-slate-300">—</span> : null)}
                      {row.changes.length > 0 && (
                        <ul className={`space-y-0.5 text-xs text-slate-500 ${details ? "mt-1" : ""}`}>
                          {row.changes.map((change, index) => <li key={index}>{describeChange(change)}</li>)}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && byActor.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-3 text-sm font-medium text-slate-900">По пользователям · {period.toLowerCase()}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-2 text-left font-medium">Кто</th>
                  {SUMMARY_COLUMNS.map((column) => (
                    <th key={column.label} className="px-3 py-2 text-right font-medium">{column.label}</th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">Правок</th>
                  <th className="px-3 py-2 text-right font-medium">Всего</th>
                </tr>
              </thead>
              <tbody>
                {byActor.map((row) => (
                  <tr key={row.actor} className="border-b border-slate-100 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                      {row.actor}
                      <RoleTag role={row.actorRole} />
                    </td>
                    {SUMMARY_COLUMNS.map((column) => (
                      <td key={column.label} className="px-3 py-2 text-right">
                        {count(column.kinds.reduce((sum, item) => sum + (row.kinds[item] ?? 0), 0))}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right">{count(row.changes)}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{formatNumber(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
