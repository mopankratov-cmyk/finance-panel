"use client";

import { RotateCcw } from "lucide-react";
import { draftStamp } from "@/lib/warehouse/useDraft";

/** Форма заполнилась сама — человек должен знать, откуда взялись числа. */
export function DraftNotice({ at, onForget }: { at: number | null; onForget: () => void }) {
  if (at === null) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
      <RotateCcw className="h-3.5 w-3.5 shrink-0" />
      <span>Вернул незаконченный ввод от {draftStamp(at)}</span>
      <button onClick={onForget} className="ml-auto text-xs text-sky-700 underline underline-offset-2 hover:text-sky-900">
        Начать заново
      </button>
    </div>
  );
}
