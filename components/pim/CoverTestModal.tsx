"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { PimRow } from "@/lib/wb/cards";

export function CoverTestModal({ row, onClose, onDone }: { row: PimRow; onClose: () => void; onDone: () => void }) {
  const [picked, setPicked] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (picked === 0) { onClose(); return; } // уже главное — менять нечего
    setBusy(true); setError(null);
    try {
      // Отправляем НОМЕР фотографии, а не набор URL. Здесь, в сетке превью,
      // лежат витринные миниатюры 246×328 — если отправить их на запись, WB
      // подменит ими всю галерею, а оригиналы оттуда уже не достать. Какие
      // именно URL писать, решает сервер по свежей карточке.
      const res = await fetch("/api/cover-test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cabinetId: row.cabinetId, nmId: row.nmId, article: row.article, photoIndex: picked }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) setError(json.error || `HTTP ${res.status}`);
      else onDone();
    } catch (e) {
      setError("Сеть: " + String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Тест обложки — ${row.article}`}>
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Это реально меняет главное фото карточки на WB — его увидят все покупатели. Выбранное фото станет первым в галерее и на месте текущей даты фиксируется точка отсчёта для сравнения конверсии до/после.</span>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {row.photos.map((url, i) => (
            <button key={url} onClick={() => setPicked(i)}
              className={`relative overflow-hidden rounded-lg border-2 ${picked === i ? "border-violet-600" : "border-transparent"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="aspect-[3/4] w-full object-cover" />
              {i === 0 && <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">сейчас главное</span>}
            </button>
          ))}
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Отмена</button>
          <button onClick={submit} disabled={busy || picked === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Отправляю на WB…" : "Сделать главным на WB"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
