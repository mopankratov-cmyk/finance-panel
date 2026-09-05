"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { SupplyRow, WarehouseSummary } from "@/app/api/supplies/route";

interface Line { nmId: string; article: string; expectedQty: string }

const emptyLine = (): Line => ({ nmId: "", article: "", expectedQty: "" });

export function NewReceiptModal({ open, onClose, onCreated, cabinetId, skus, warehouses, openNmIds }: {
  open: boolean; onClose: () => void; onCreated: () => void; cabinetId: string;
  skus: SupplyRow[]; warehouses: WarehouseSummary[]; openNmIds: Set<number>;
}) {
  const [expectedAt, setExpectedAt] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fillFromNeed = () => {
    const suggested = skus.filter((s) => s.need45 > 0 && !openNmIds.has(s.nmId));
    if (!suggested.length) return;
    setLines(suggested.map((s) => ({ nmId: String(s.nmId), article: s.article, expectedQty: String(s.need45) })));
  };

  const updateLine = (i: number, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i));
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);

  const valid = lines.length > 0 && lines.every((l) => {
    const nm = Number(l.nmId), qty = Number(l.expectedQty);
    return Number.isFinite(nm) && nm > 0 && Number.isFinite(qty) && qty > 0;
  });

  const reset = () => {
    setExpectedAt(""); setWarehouse(""); setNote(""); setLines([emptyLine()]); setError(null);
  };

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/supplies/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cabinetId,
          expectedAt: expectedAt || undefined,
          warehouse: warehouse || undefined,
          note: note || undefined,
          lines: lines.map((l) => ({ nmId: Number(l.nmId), article: l.article, expectedQty: Number(l.expectedQty) })),
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) { setError(json.error || `HTTP ${res.status}`); return; }
      reset();
      onCreated();
      onClose();
    } catch {
      setError("Не удалось создать поставку");
    } finally {
      setSaving(false);
    }
  };

  // Кнопки уходят в футер модалки, а не в её содержимое: после десятка
  // добавленных позиций «Создать поставку» уезжала вниз вместе с прокруткой, а
  // при открытой клавиатуре её не было видно вовсе — закрепление и учёт
  // клавиатуры живут только в футере.
  const footer = (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={() => { reset(); onClose(); }}
        className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50 lg:min-h-0 lg:py-1.5"
      >
        Отмена
      </button>
      <button
        type="button"
        onClick={submit}
        disabled={!valid || saving}
        className="inline-flex min-h-11 items-center rounded-lg bg-violet-600 px-3 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 lg:min-h-0 lg:py-1.5"
      >
        {saving ? "Создаём..." : "Создать поставку"}
      </button>
    </div>
  );

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Новая поставка" footer={footer}>
      <div className="space-y-4">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-600">
            Ожидаемая дата
            <input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)}
              className="mt-1 min-h-11 w-full rounded border border-slate-300 px-2 text-sm lg:min-h-0 lg:py-1.5" />
          </label>
          <label className="text-sm text-slate-600">
            Склад / направление
            <input list="wh-list" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}
              className="mt-1 min-h-11 w-full rounded border border-slate-300 px-2 text-sm lg:min-h-0 lg:py-1.5" placeholder="Коледино" />
            <datalist id="wh-list">
              {warehouses.map((w) => <option key={w.warehouse} value={w.warehouse} />)}
            </datalist>
          </label>
        </div>

        <label className="block text-sm text-slate-600">
          Комментарий
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="от фабрики..." />
        </label>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Позиции</span>
            <button type="button" onClick={fillFromNeed} className="inline-flex min-h-11 items-center text-xs font-medium text-violet-700 hover:underline lg:min-h-0">
              Заполнить из «К поставке»
            </button>
          </div>
          {/* Артикулу в строке из трёх полей и крестика оставалось ~70 px:
              на телефоне поля встают в столбик, с 640 px возвращаются в ряд. */}
          <div className="space-y-1.5">
            {lines.map((l, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1.5">
                <input inputMode="numeric" value={l.nmId} onChange={(e) => updateLine(i, { nmId: e.target.value })} placeholder="nmId"
                  className="min-h-11 w-full rounded border border-slate-300 px-2 text-xs sm:w-24 lg:min-h-0 lg:py-1" />
                <input value={l.article} onChange={(e) => updateLine(i, { article: e.target.value })} placeholder="артикул"
                  className="min-h-11 w-full min-w-0 rounded border border-slate-300 px-2 text-xs sm:flex-1 lg:min-h-0 lg:py-1" />
                <input inputMode="numeric" value={l.expectedQty} onChange={(e) => updateLine(i, { expectedQty: e.target.value })} placeholder="кол-во"
                  className="min-h-11 min-w-0 flex-1 rounded border border-slate-300 px-2 text-xs sm:w-20 sm:flex-none lg:min-h-0 lg:py-1" />
                <button type="button" onClick={() => removeLine(i)} aria-label="Убрать строку"
                  className="tap-hit px-1.5 text-slate-400 hover:text-red-600">×</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addLine} className="mt-2 inline-flex min-h-11 items-center text-xs font-medium text-slate-500 hover:text-slate-700 lg:min-h-0">+ Строка</button>
        </div>
      </div>
    </Modal>
  );
}
