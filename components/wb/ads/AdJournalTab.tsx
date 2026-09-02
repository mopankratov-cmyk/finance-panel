"use client";

import { useCallback, useEffect, useState } from "react";

import { WbEmptyState } from "@/components/wb/WbModuleHeader";
import { ADVERT_ACTIONS } from "@/lib/adverts/actionCatalog";
import { adGet, type AdJournalEntry } from "./adControlApi";

const STATUS_TONE: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700",
  error: "bg-rose-50 text-rose-700",
  rejected: "bg-amber-50 text-amber-800",
};

const STATUS_LABEL: Record<string, string> = {
  ok: "выполнено",
  error: "ошибка WB",
  rejected: "не пропущено",
};

function describeValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (Array.isArray(value)) return `${value.length} шт.`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.sum === "number") return `${record.sum}`;
    if (typeof record.count === "number") return `${record.count} фраз`;
    if (typeof record.name === "string") return record.name;
    // Правило описываем его условием, а не перечнем имён полей. Раньше здесь
    // выводилось «goal, nm_id, target» — это ключи объекта, а не то, что человек
    // сделал: через месяц по такой записи не понять ничего.
    if (typeof record.goal === "string" && record.target != null) {
      const goal = record.goal === "cpo" ? "CPO" : "ДРР";
      const bounds = record.min_bid != null && record.max_bid != null ? `, ставка ${record.min_bid}–${record.max_bid}` : "";
      return `${goal} ≤ ${record.target}${bounds}`;
    }
    if (Array.isArray(record.phrases)) return `${record.phrases.length} фраз`;
    return Object.keys(record).slice(0, 3).join(", ");
  }
  return String(value);
}

/**
 * Журнал: полная история того, что модуль сделал с рекламой.
 *
 * Отклонённые попытки показываются наравне с выполненными и намеренно не
 * прячутся под фильтр по умолчанию. Успешные операции рассказывают, что
 * происходило с кампаниями; отклонённые — что человек пытался сделать, а
 * предохранитель не пустил. Второе обычно важнее: три отказа подряд по
 * суточному лимиту означают либо заниженный лимит, либо попытку обойти его
 * повторами, и оба разговора невозможны, пока отказы не видны.
 */
export function AdJournalTab({
  cabinetId,
  advertId,
  onClearAdvert,
}: {
  cabinetId: string;
  /** Показать историю одной кампании. Роут этот параметр умел с самого начала. */
  advertId?: number | null;
  onClearAdvert?: () => void;
}) {
  const [entries, setEntries] = useState<AdJournalEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ cabinet: cabinetId, limit: "100" });
    if (action) params.set("action", action);
    if (status) params.set("status", status);
    if (advertId) params.set("advertId", String(advertId));
    const result = await adGet<{ entries: AdJournalEntry[]; error?: string }>(`/api/adverts/journal?${params}`);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      setEntries([]);
      return;
    }
    setError(null);
    setEntries(result.data?.entries ?? []);
  }, [cabinetId, action, status, advertId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {advertId ? (
          <button
            type="button"
            onClick={onClearAdvert}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-violet-100 px-2 font-semibold text-violet-800 transition-colors hover:bg-violet-200"
          >
            Только кампания {advertId} ✕
          </button>
        ) : null}
        <select
          value={action}
          onChange={(event) => setAction(event.target.value)}
          className="min-h-8 rounded-lg border border-slate-200 bg-white px-2 font-semibold text-slate-600 shadow-sm focus:outline-none"
        >
          <option value="">Все действия</option>
          {ADVERT_ACTIONS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="min-h-8 rounded-lg border border-slate-200 bg-white px-2 font-semibold text-slate-600 shadow-sm focus:outline-none"
        >
          <option value="">Любой исход</option>
          <option value="ok">Выполнено</option>
          <option value="rejected">Не пропущено</option>
          <option value="error">Ошибка WB</option>
        </select>
      </div>

      {error ? <div className="rounded-xl bg-rose-50 px-4 py-3 text-[12px] text-rose-700">{error}</div> : null}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">Читаю журнал…</div>
      ) : entries.length === 0 ? (
        <WbEmptyState>Записей нет. Здесь появится каждое действие модуля — включая те, что не прошли предохранители.</WbEmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[900px] text-[12px]">
            <thead className="border-b border-slate-100 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Когда</th>
                <th className="px-3 py-2 text-left font-semibold">Действие</th>
                <th className="px-3 py-2 text-left font-semibold">Кампания</th>
                <th className="px-3 py-2 text-left font-semibold">Было → стало</th>
                <th className="px-3 py-2 text-left font-semibold">Почему</th>
                <th className="px-3 py-2 text-left font-semibold">Кто</th>
                <th className="px-3 py-2 text-left font-semibold">Исход</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-slate-50 align-top last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                    {new Date(entry.createdAt).toLocaleString("ru-RU")}
                  </td>
                  <td className="px-3 py-2 font-semibold text-slate-800">{entry.actionLabel}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {entry.advertName ?? (entry.advertId ? `Кампания ${entry.advertId}` : "—")}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">
                    {describeValue(entry.oldValue)} → {describeValue(entry.newValue)}
                  </td>
                  <td className="max-w-[240px] px-3 py-2 text-slate-600">{entry.reason || <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2 text-slate-500">{entry.userEmail ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_TONE[entry.status] ?? "bg-slate-100 text-slate-500"}`}>
                      {STATUS_LABEL[entry.status] ?? entry.status}
                    </span>
                    {entry.detail ? <div className="mt-1 max-w-md text-[11px] leading-4 text-slate-400">{entry.detail}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
