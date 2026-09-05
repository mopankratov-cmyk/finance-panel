"use client";

import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useDialogBehavior } from "@/hooks/useDialogBehavior";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Кнопки внизу окна. На телефоне закрепляются и не уезжают с прокруткой. */
  footer?: ReactNode;
  /** Ширина на планшете и десктопе. На телефоне окно всегда во всю ширину. */
  size?: "sm" | "md" | "lg" | "xl";
}

const WIDTH: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
};

/**
 * Модальное окно.
 *
 * На телефоне это НЕ уменьшенное окно с полями по краям, а лист, поднятый от
 * низа экрана на всю ширину: в 320px рамка вокруг окна съедает восьмую часть
 * полезного места, а закруглённый верх сам показывает, что лист можно закрыть
 * вниз. С планшета и шире — привычная карточка по центру, десктоп не меняется.
 *
 * Высота считается в `dvh`, а не в `vh`. В мобильном браузере `vh` — это
 * высота БЕЗ учёта адресной строки: окно на 90vh оказывается выше видимой
 * области, и его нижняя кнопка остаётся за краем экрана, пока строку не
 * спрячешь прокруткой. `dvh` следует за реальной видимой высотой.
 *
 * Escape, ловушка фокуса и блокировка прокрутки фона — в useDialogBehavior.
 */
export function Modal({ open, onClose, title, children, footer, size = "md" }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogBehavior(open, onClose, panel);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[90dvh] sm:rounded-xl ${WIDTH[size]}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3.5 sm:px-6 sm:py-4">
          <h2 className="min-w-0 text-base font-semibold text-slate-900 sm:text-lg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="tap -mr-2 shrink-0 rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          {children}
        </div>

        {footer ? (
          <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 pb-[calc(0.75rem+var(--safe-b))] sm:px-6 sm:pb-3">
            {footer}
          </div>
        ) : (
          /* Без панели кнопок лист всё равно обязан отступить от системного
             индикатора — иначе последняя строка содержимого лежит под ним. */
          <div className="h-[var(--safe-b)] shrink-0 sm:hidden" />
        )}
      </div>
    </div>
  );
}
