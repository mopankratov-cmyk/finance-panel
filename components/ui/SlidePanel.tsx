"use client";

import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useDialogBehavior } from "@/hooks/useDialogBehavior";

interface SlidePanelProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  header?: ReactNode;
  children: ReactNode;
  bare?: boolean;
  wide?: boolean;
  narrow?: boolean;
  fixedWidth?: number;
  /** Кнопки внизу панели: закреплены, не уезжают с прокруткой, не под клавиатурой. */
  footer?: ReactNode;
}

/**
 * Выдвижная панель подробностей.
 *
 * Приезжает справа на планшете и десктопе — там это правильно: список слева
 * остаётся на месте, и видно, к чему относятся подробности. На телефоне
 * места для двух колонок нет, панель занимает экран целиком, и приезжает она
 * СНИЗУ: жест «вверх-вниз» на телефоне естественнее бокового, а закрытие
 * вниз повторяет системную привычку.
 *
 * Высота — `dvh`: при `100vh` низ панели уходит под адресную строку браузера,
 * и последняя кнопка становится недоступна, пока страницу не прокрутишь.
 *
 * Escape, ловушка фокуса и блокировка прокрутки фона — в useDialogBehavior.
 * До этого панель закрывалась только крестиком, а фон под ней прокручивался
 * вместе с содержимым: на телефоне тянешь список внутри, уезжает страница.
 */
export function SlidePanel({
  open,
  onClose,
  title,
  header,
  children,
  bare = false,
  wide = false,
  narrow = false,
  fixedWidth,
  footer,
}: SlidePanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogBehavior(open, onClose, panel);

  const width = fixedWidth
    ? "sm:w-full"
    : narrow
      ? "sm:max-w-sm md:max-w-md"
      : wide
        ? "sm:max-w-4xl"
        : "sm:max-w-3xl";

  return (
    <div
      className={`fixed inset-0 z-[95] transition-opacity duration-300 ${
        open ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      aria-hidden={!open}
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panel}
        /* Панель остаётся в DOM и в закрытом виде — ради плавного выезда. Но
           закрытая она не должна называться диалогом: скринридер объявляет
           `aria-modal` как «открыто модальное окно» и способен спрятать за ним
           остальную страницу. Внешняя обёртка помечена `aria-hidden`, и всё же
           роль честнее снимать вместе с показом. */
        role={open ? "dialog" : undefined}
        aria-modal={open || undefined}
        aria-label={title}
        className={`fixed inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-2xl bg-white shadow-2xl transition-transform duration-300 ease-out
          sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-full sm:rounded-none ${width}
          ${open ? "translate-y-0 sm:translate-x-0" : "translate-y-full sm:translate-y-0 sm:translate-x-full"}`}
        /* На телефоне ограничение шире экрана и потому безвредно; работать
           оно начинает с планшета, где панель отходит к правому краю. */
        style={fixedWidth ? { maxWidth: fixedWidth } : undefined}
      >
        {/* Полоска-ухватка: на телефоне показывает, что лист тянется вниз. */}
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-300 sm:hidden" aria-hidden="true" />

        {bare ? (
          <>
            <button
              type="button"
              onClick={onClose}
              className="tap absolute right-2 top-2 z-10 rounded-lg bg-white/90 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              aria-label="Закрыть"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
          </>
        ) : (
          <>
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3.5 sm:px-6 sm:py-4">
              {header ?? (
                <h2 className="min-w-0 text-base font-semibold text-slate-900 sm:text-lg">{title}</h2>
              )}
              <button
                type="button"
                onClick={onClose}
                className="tap -mr-2 shrink-0 rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                aria-label="Закрыть"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
              {children}
            </div>
          </>
        )}

        {footer ? (
          <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 pb-[calc(0.75rem+var(--safe-b))] sm:px-6">
            {footer}
          </div>
        ) : (
          <div className="h-[var(--safe-b)] shrink-0 sm:hidden" />
        )}
      </div>
    </div>
  );
}
