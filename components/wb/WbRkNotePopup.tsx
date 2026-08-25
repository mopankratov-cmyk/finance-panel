"use client";

import { Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Заметка менеджеру: что сделать с товаром или кампанией в этот день.
 *
 * Журнал показывает, что происходило; решение принимает человек и держит его
 * в голове. Через неделю не вспомнить, что решили и сделали ли — заметка
 * живёт рядом с той клеткой, к которой относится.
 */
export function WbRkNotePopup({
  cabinetId, nmId, advertId, date, title, subtitle, initialNote, initialDone, canWrite, onClose, onSaved,
}: {
  cabinetId: string;
  nmId: number;
  /** null — заметка про товар целиком, иначе про конкретную кампанию. */
  advertId: number | null;
  date: string;
  title: string;
  subtitle: string;
  initialNote: string;
  initialDone: boolean;
  canWrite: boolean;
  onClose: () => void;
  onSaved: (nmId: number, advertId: number | null, date: string, note: string, done: boolean) => void;
}) {
  const [note, setNote] = useState(initialNote);
  const [done, setDone] = useState(initialDone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    boxRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/wb/rk-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cabinetId, nmId, advertId, date, note, done }),
      });
      const body = await response.json();
      if (!response.ok || !body?.ok) throw new Error(body?.error || "Не удалось сохранить");
      onSaved(nmId, advertId, date, body.note ?? "", Boolean(body.done));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }, [cabinetId, nmId, advertId, date, note, done, onSaved, onClose]);

  if (!mounted) return null;

  const dayLabel = new Date(`${date}T00:00:00`).toLocaleDateString("ru-RU", { day: "2-digit", month: "long" });

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Заметка: ${title}`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl focus:outline-none"
      >
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-slate-800">{title}</div>
            <div className="truncate text-[12px] text-slate-400">{subtitle} · {dayLabel}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <label htmlFor="rk-note" className="text-[12px] font-semibold text-slate-600">Что нужно сделать</label>
          <textarea
            id="rk-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            disabled={!canWrite}
            placeholder="Например: поднять ставку до 250 · выключить полки · ждём новый контент"
            className="mt-2 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-700 placeholder:text-slate-300 focus:border-violet-400 focus:outline-none disabled:bg-slate-50"
          />
          {canWrite ? (
            <label className="mt-2.5 flex items-center gap-2 text-[12px] text-slate-600">
              <input type="checkbox" checked={done} onChange={(event) => setDone(event.target.checked)} className="h-3.5 w-3.5 accent-violet-600" />
              Сделано
            </label>
          ) : done ? <div className="mt-2.5 text-[12px] text-emerald-600">Отмечено «сделано»</div> : null}
          {/* Заметка не стирается отметкой: история решений важнее чистоты списка. */}
          {error ? <div className="mt-2 text-[12px] text-rose-600">{error}</div> : null}
        </div>

        {canWrite ? (
          <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : null}
              {note.trim() ? "Сохранить" : initialNote ? "Удалить заметку" : "Сохранить"}
            </button>
            <button type="button" onClick={onClose} className="ml-auto text-[12px] text-slate-500 hover:text-slate-700">Отмена</button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
