"use client";

import { Check, Loader2, PencilLine, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RK_NOTE_PRESETS } from "@/lib/wb/rkNotes";

/**
 * Быстрый выбор повторяющейся задачи — прямо у клетки, без диалога.
 *
 * Одни и те же задачи ставятся десятками в день: выключить, включить на вечер,
 * оставить круглосуточно. Полноценное окно ради двух слов заставляет целиться
 * мышью, печатать и подтверждать — здесь один клик по строке списка сразу
 * сохраняет задачу и закрывает список.
 *
 * Открывается рядом с клеткой, а не по центру экрана: взгляд не теряет строку,
 * в которой человек работает.
 */
export function WbRkNoteQuickPick({
  cabinetId, nmId, advertId, date, note, done, anchor, onSaved, onClose, onOpenFull,
}: {
  cabinetId: string;
  nmId: number;
  /** null — задача про товар целиком, иначе про конкретную кампанию. */
  advertId: number | null;
  date: string;
  note: string;
  done: boolean;
  anchor: { x: number; y: number };
  onSaved: (nmId: number, advertId: number | null, date: string, note: string, done: boolean) => void;
  onClose: () => void;
  onOpenFull: () => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async (nextNote: string, nextDone: boolean, tag: string) => {
    setSaving(tag);
    setError(null);
    try {
      const response = await fetch("/api/wb/rk-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cabinetId, nmId, advertId, date, note: nextNote, done: nextDone }),
      });
      const body = await response.json();
      if (!response.ok || !body?.ok) throw new Error(body?.error || "Не удалось сохранить");
      onSaved(nmId, advertId, date, body.note ?? "", Boolean(body.done));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить");
      setSaving(null);
    }
  };

  if (!mounted) return null;

  // Держим список в пределах экрана: у правого края и внизу он раскрывается
  // в другую сторону, иначе часть задач оказалась бы за краем.
  const width = 232;
  const height = note ? 320 : 268;
  const left = Math.min(Math.max(8, anchor.x - width / 2), window.innerWidth - width - 8);
  const top = anchor.y + height > window.innerHeight - 8
    ? Math.max(8, anchor.y - height - 12)
    : anchor.y + 8;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[95]" onClick={onClose} />
      <div
        ref={boxRef}
        role="dialog"
        aria-label="Выбор задачи"
        style={{ left, top, width }}
        className="fixed z-[96] rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.16)]"
      >
        <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Задача на день
        </div>

        {RK_NOTE_PRESETS.map((preset) => {
          const active = preset.note === note;
          return (
            <button
              key={preset.note}
              type="button"
              onClick={() => void save(preset.note, false, preset.note)}
              disabled={saving !== null}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors disabled:opacity-50 ${
                active ? "bg-violet-50 font-semibold text-violet-700" : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span className="truncate">{preset.note}</span>
              {saving === preset.note
                ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-400" />
                : active ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
            </button>
          );
        })}

        <div className="my-1 border-t border-slate-100" />

        {note ? (
          <button
            type="button"
            onClick={() => void save(note, !done, "done")}
            disabled={saving !== null}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <Check className={`h-3.5 w-3.5 shrink-0 ${done ? "text-emerald-600" : "text-slate-300"}`} />
            {done ? "Снять отметку «сделано»" : "Отметить сделанной"}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => { onClose(); onOpenFull(); }}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-slate-600 transition-colors hover:bg-slate-50"
        >
          <PencilLine className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          {note ? "Изменить текст" : "Своя задача…"}
        </button>

        {note ? (
          <button
            type="button"
            onClick={() => void save("", false, "clear")}
            disabled={saving !== null}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
          >
            {saving === "clear" ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 shrink-0" />}
            Убрать задачу
          </button>
        ) : null}

        {error ? <div className="px-2 py-1 text-[11px] text-rose-600">{error}</div> : null}
      </div>
    </>,
    document.body,
  );
}
