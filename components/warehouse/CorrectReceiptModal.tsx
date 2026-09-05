"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import { WbProductImage } from "@/components/wb/WbProductImage";
import { newDocKey } from "@/lib/warehouse/docKey";
import { plural } from "@/lib/warehouse/plural";
import type { ReceiptLineRow } from "@/app/api/warehouse/receipts/route";

interface Draft { expected: string; received: string; defect: string }

/** В запрос уходят только изменённые строки: у ожидаемой — новое ожидание,
 *  у пересчитанной — принято и брак вместе, чтобы функция в базе считала
 *  дельту по обоим полям от одного снимка. */
interface ChangedLine { id: number; expectedQty?: number; receivedQty?: number; defectQty?: number }

/** Коррекция прихода админом или менеджером (п. 1 ТЗ).
 *
 *  Пересчитанное фулфилментом не переписывается задним числом: проведённая
 *  строка правится разницей — в регистр уходит +N / −N по себестоимости партии,
 *  а в хронику — «было → стало» с причиной. Поэтому причина обязательна, а
 *  окно показывает, сколько именно уйдёт в остаток, до нажатия кнопки. */
export function CorrectReceiptModal({
  batchId,
  number,
  entityId,
  onClose,
  onDone,
}: {
  batchId: string;
  number: string | null;
  entityId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [lines, setLines] = useState<ReceiptLineRow[]>([]);
  const [draft, setDraft] = useState<Record<number, Draft>>({});
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/warehouse/receipts?entity=${encodeURIComponent(entityId)}&batch=${encodeURIComponent(batchId)}`,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить позиции");
      const rows: ReceiptLineRow[] = json.data ?? [];
      setLines(rows);
      setDraft(Object.fromEntries(rows.map((row) => [row.id, {
        expected: String(row.expectedQty),
        received: row.receivedQty === null ? "" : String(row.receivedQty),
        defect: String(row.defectQty || ""),
      }])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить позиции");
    } finally {
      setLoading(false);
    }
  }, [batchId, entityId]);

  useEffect(() => { void load(); }, [load]);

  /** Модели с их размерами — та же группировка, что в окне пересчёта. */
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; article: string; nmId: number | null; photoUrl: string | null; rows: ReceiptLineRow[] }>();
    for (const line of lines) {
      const key = line.productId ?? `nm:${line.nmId ?? line.article}`;
      const group = map.get(key) ?? { key, article: line.article, nmId: line.nmId, photoUrl: line.photoUrl, rows: [] };
      group.rows.push(line);
      map.set(key, group);
    }
    return [...map.values()];
  }, [lines]);

  const changes = useMemo((): ChangedLine[] => lines.flatMap((line): ChangedLine[] => {
    const value = draft[line.id];
    if (!value) return [];
    if (line.status === "expected") {
      const expected = Number(value.expected || 0);
      return expected !== line.expectedQty ? [{ id: line.id, expectedQty: expected }] : [];
    }
    const received = Number(value.received || 0);
    const defect = Number(value.defect || 0);
    return received !== (line.receivedQty ?? 0) || defect !== line.defectQty
      ? [{ id: line.id, receivedQty: received, defectQty: defect }]
      : [];
  }), [lines, draft]);

  // Что уйдёт в регистр по проведённым строкам: остаток = принято − брак,
  // было → стало. Плюс и минус порознь — «+3 / −1» честнее, чем «+2».
  const ledger = useMemo(() => {
    let plus = 0;
    let minus = 0;
    let any = false;
    for (const line of lines) {
      if (!line.postedAt) continue;
      any = true;
      const value = draft[line.id];
      if (!value) continue;
      const before = (line.receivedQty ?? 0) - line.defectQty;
      const after = Number(value.received || 0) - Number(value.defect || 0);
      const delta = after - before;
      if (delta > 0) plus += delta;
      else if (delta < 0) minus += -delta;
    }
    return { any, plus, minus };
  }, [lines, draft]);

  const badDefect = lines.some((line) =>
    line.status === "received" && Number(draft[line.id]?.defect || 0) > Number(draft[line.id]?.received || 0));
  const canSubmit = changes.length > 0 && reason.trim().length > 0 && !badDefect && !saving;

  const setValue = (id: number, patch: Partial<Draft>) =>
    setDraft((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { expected: "", received: "", defect: "" }), ...patch } }));

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/warehouse/receipts/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, batchId, reason: reason.trim(), lines: changes, docKey: newDocKey() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось скорректировать приход");
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось скорректировать приход");
    } finally {
      setSaving(false);
    }
  };

  const digits = (value: string) => value.replace(/[^\d]/g, "");
  const inputClass = (changed: boolean, bad = false) =>
    `w-24 rounded-lg border px-2 py-1 text-right placeholder:text-slate-300 ${
      bad ? "border-red-300 bg-red-50" : changed ? "border-amber-300 bg-amber-50" : "border-slate-200"
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-base font-bold text-slate-900">Коррекция прихода{number ? ` ${number}` : ""}</p>
            <p className="text-xs text-slate-400">Ожидание правится у непересчитанных строк, принято и брак — у пересчитанных</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>

        {error && <div className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {ledger.any && (
          <div className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Проведённые строки правятся разницей: в регистр уйдёт{" "}
            <span className="font-semibold">+{formatNumber(ledger.plus)} / −{formatNumber(ledger.minus)}</span> по себестоимости партии.
          </div>
        )}

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-400">Загружаю позиции…</div>
        ) : lines.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">В партии нет строк</div>
        ) : (
          <div className="max-h-[50vh] space-y-4 overflow-y-auto px-5 py-4">
            {groups.map((group) => (
              <div key={group.key} className="rounded-xl border border-slate-200">
                <div className="flex items-center gap-2.5 border-b border-slate-100 px-3 py-2.5">
                  <WbProductImage
                    nm={group.nmId ?? undefined}
                    src={group.photoUrl ?? undefined}
                    alt={group.article}
                    label={group.article}
                    className="h-9 w-9 shrink-0 rounded-lg border border-slate-100 bg-slate-50 object-cover"
                  />
                  <span className="font-medium text-slate-900">{group.article || group.nmId}</span>
                  <span className="ml-auto text-xs text-slate-400">
                    {group.rows.length > 1 ? `${group.rows.length} ${plural(group.rows.length, "размер", "размера", "размеров")}` : ""}
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-slate-400">
                      <th className="px-3 pb-1 pt-2 text-left font-medium">Размер</th>
                      <th className="px-3 pb-1 pt-2 text-right font-medium">Ожидалось</th>
                      <th className="px-3 pb-1 pt-2 text-right font-medium">Принято</th>
                      <th className="px-3 pb-1 pt-2 text-right font-medium">Из них брак</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((line) => {
                      const value = draft[line.id] ?? { expected: "", received: "", defect: "" };
                      const pending = line.status === "expected";
                      const expectedChanged = Number(value.expected || 0) !== line.expectedQty;
                      const receivedChanged = Number(value.received || 0) !== (line.receivedQty ?? 0);
                      const defectChanged = Number(value.defect || 0) !== line.defectQty;
                      const tooMuchDefect = Number(value.defect || 0) > Number(value.received || 0);
                      return (
                        <tr key={line.id} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-slate-700">
                            {line.sizeLabel || <span className="text-slate-300">без размера</span>}
                            {pending ? (
                              <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">не пересчитано</span>
                            ) : line.postedAt ? (
                              <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">в остатке</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {pending ? (
                              <input
                                inputMode="numeric"
                                value={value.expected}
                                onChange={(e) => setValue(line.id, { expected: digits(e.target.value) })}
                                className={inputClass(expectedChanged)}
                              />
                            ) : (
                              <span className="text-slate-500">{formatNumber(line.expectedQty)}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {pending ? (
                              <span className="text-slate-300">—</span>
                            ) : (
                              <input
                                inputMode="numeric"
                                value={value.received}
                                onChange={(e) => setValue(line.id, { received: digits(e.target.value) })}
                                className={inputClass(receivedChanged)}
                              />
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {pending ? (
                              <span className="text-slate-300">—</span>
                            ) : (
                              <input
                                inputMode="numeric"
                                value={value.defect}
                                onChange={(e) => setValue(line.id, { defect: digits(e.target.value) })}
                                placeholder="0"
                                className={inputClass(defectChanged, tooMuchDefect)}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3 border-t border-slate-100 px-5 py-4">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Причина коррекции: досчитали мешок, ошибка в накладной"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-300"
          />
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-slate-500">
              {changes.length === 0
                ? "Ничего не изменено"
                : `Изменено строк: ${changes.length}`}
              {badDefect && <span className="text-red-600"> · брака больше, чем принято</span>}
              {changes.length > 0 && !reason.trim() && <span className="text-amber-700"> · укажите причину</span>}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600">Отмена</button>
              <button
                onClick={() => void submit()}
                disabled={!canSubmit}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? "Корректирую…" : "Скорректировать"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
