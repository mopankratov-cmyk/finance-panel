"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import { WbProductImage } from "@/components/wb/WbProductImage";
import type { ReceiptLineRow } from "@/app/api/warehouse/receipts/route";

interface Draft { received: string; defect: string }

/** Приём партии: оператор фулфилмента вводит по позициям, сколько пришло и сколько
 *  из них брак — одной операцией, как он и сообщает это по факту разгрузки. */
export function ReceiveModal({
  batchId,
  onClose,
  onDone,
}: {
  batchId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [lines, setLines] = useState<ReceiptLineRow[]>([]);
  const [draft, setDraft] = useState<Record<number, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/warehouse/receipts?batch=${batchId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить позиции");
      const rows: ReceiptLineRow[] = json.data ?? [];
      setLines(rows);
      // По умолчанию пришло сколько ждали: расхождение — исключение, а не правило.
      setDraft(Object.fromEntries(rows.map((row) => [row.id, {
        received: String(row.receivedQty ?? row.expectedQty),
        defect: String(row.defectQty || ""),
      }])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить позиции");
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      for (const line of lines) {
        if (line.status === "received") continue;
        const value = draft[line.id];
        const received = Number(value?.received ?? 0);
        const defect = Number(value?.defect || 0);
        if (!Number.isFinite(received) || received < 0) throw new Error(`${line.article}: некорректное количество`);
        if (defect > received) throw new Error(`${line.article}: брака больше, чем принято`);
        const res = await fetch(`/api/supplies/receipts/${line.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ receivedQty: received, defectQty: defect }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Не удалось сохранить приём");
      }
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить приём");
    } finally {
      setSaving(false);
    }
  };

  const pending = lines.filter((line) => line.status === "expected");

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-base font-bold text-slate-900">Приём партии</p>
            <p className="text-xs text-slate-400">Сколько пришло и сколько из этого брак</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>

        {error && <div className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-400">Загружаю позиции…</div>
        ) : pending.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-700">Все позиции уже приняты</p>
            <p className="mt-1 text-sm text-slate-400">Осталось провести партию на склад.</p>
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-400">
                  <th className="pb-2 text-left font-medium">Товар</th>
                  <th className="pb-2 text-right font-medium">Ждём</th>
                  <th className="pb-2 text-right font-medium">Принято</th>
                  <th className="pb-2 text-right font-medium">Из них брак</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((line) => {
                  const value = draft[line.id] ?? { received: "", defect: "" };
                  const tooMuchDefect = Number(value.defect || 0) > Number(value.received || 0);
                  const short = Number(value.received || 0) < line.expectedQty;
                  return (
                    <tr key={line.id} className="border-t border-slate-100">
                      <td className="py-2.5">
                        <div className="flex items-center gap-2.5">
                          <WbProductImage
                            nm={line.nmId ?? undefined}
                            alt={line.article}
                            className="h-9 w-9 shrink-0 rounded-lg border border-slate-100 bg-slate-50 object-cover"
                          />
                          <span className="font-medium text-slate-900">{line.article || line.nmId}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right text-slate-500">{formatNumber(line.expectedQty)}</td>
                      <td className="py-2.5 text-right">
                        <input
                          inputMode="numeric"
                          value={value.received}
                          onChange={(e) => setDraft((prev) => ({
                            ...prev,
                            [line.id]: { ...value, received: e.target.value.replace(/[^\d]/g, "") },
                          }))}
                          className={`w-24 rounded-lg border px-2 py-1 text-right ${short ? "border-amber-300 bg-amber-50" : "border-slate-200"}`}
                        />
                      </td>
                      <td className="py-2.5 text-right">
                        <input
                          inputMode="numeric"
                          value={value.defect}
                          onChange={(e) => setDraft((prev) => ({
                            ...prev,
                            [line.id]: { ...value, defect: e.target.value.replace(/[^\d]/g, "") },
                          }))}
                          placeholder="0"
                          className={`w-24 rounded-lg border px-2 py-1 text-right placeholder:text-slate-300 ${tooMuchDefect ? "border-red-300 bg-red-50" : "border-slate-200"}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600">Отмена</button>
            <button
              onClick={() => void save()}
              disabled={saving || pending.length === 0}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? "Сохраняю…" : "Отметить приём"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
