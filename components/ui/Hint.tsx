"use client";

import { HelpCircle } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Клавиатурный ли это фокус. Касание тоже даёт кнопке focus, и открывать по
 * нему нельзя: следом придёт click и тут же закроет поповер. `:focus-visible`
 * знают не все окружения (в jsdom селектор бросает), поэтому под защитой.
 */
function isKeyboardFocus(element: HTMLElement) {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

/**
 * Пояснение, которое доступно и пальцем.
 *
 * В панели десятки объяснений живут в атрибуте `title`: что такое «Доступно» и
 * «В заданиях», почему остаток красный, откуда взялась рекомендация «снизить
 * ставку на 30%», что означает колонка удержаний. На мыши это работает, на
 * касании — нет вовсе: `title` показывается только по наведению, а на телефоне
 * наведения не бывает, первое касание уже нажатие. То есть объяснение не
 * «неудобно получить», его нет.
 *
 * Здесь оно открывается нажатием (и по наведению — для мыши, чтобы привычка
 * не ломалась), закрывается по Escape, по нажатию вне и при прокрутке.
 *
 * Источники открытия разведены по типу указателя, иначе на касании поповер
 * моргал и закрывался: браузер шлёт кнопке focus, а следом click, и
 * переключатель тут же возвращал состояние обратно. Поэтому наведение
 * открывает только настоящую мышь, focus — только клавиатурный (`:focus-visible`),
 * а click переключает лишь тогда, когда нажали пальцем или пером.
 *
 * Положение считается от кнопки и прижимается к краям окна: поповер шириной
 * 260px рядом с правым краем экрана в 320px иначе уезжает за границу. Позиция
 * `fixed`, а не `absolute`, намеренно — объяснения стоят внутри таблиц и
 * карточек с `overflow: hidden`, и абсолютный поповер там обрезается.
 */
export function Hint({
  children,
  label = "Пояснение",
  className = "",
}: {
  children: ReactNode;
  /** Что читает скринридер и что видит мышь при наведении. */
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  /** Чем нажали в последний раз: мышью поповер уже открыт наведением. */
  const lastPointer = useRef("");

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const width = Math.min(260, window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8);
    // Снизу, если там есть место; иначе сверху — иначе на нижних строках
    // длинной таблицы пояснение открывалось бы за пределами экрана.
    const below = window.innerHeight - r.bottom > 140;
    setPos({ top: below ? r.bottom + 8 : Math.max(8, r.top - 8), left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.type === "keydown" && (event as KeyboardEvent).key !== "Escape") return;
      if (event.type === "pointerdown") {
        const target = event.target as Node;
        if (trigger.current?.contains(target) || bubble.current?.contains(target)) return;
      }
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    // Прокрутка уводит кнопку, а поповер прибит к окну — проще закрыть, чем
    // пересчитывать положение на каждый кадр.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onPointerDown={(event) => { lastPointer.current = event.pointerType; }}
        onPointerEnter={(event) => { if (event.pointerType === "mouse") setOpen(true); }}
        onPointerLeave={(event) => { if (event.pointerType === "mouse") setOpen(false); }}
        onClick={() => { if (lastPointer.current !== "mouse") setOpen((value) => !value); }}
        onFocus={(event) => { if (isKeyboardFocus(event.currentTarget)) setOpen(true); }}
        onBlur={() => { lastPointer.current = ""; setOpen(false); }}
        className={`tap-hit inline-flex shrink-0 items-center justify-center align-middle text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${className}`}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>

      {open && pos ? (
        <div
          ref={bubble}
          role="tooltip"
          style={{ top: pos.top, left: pos.left, width: Math.min(260, typeof window === "undefined" ? 260 : window.innerWidth - 16) }}
          className="fixed z-[70] rounded-lg bg-slate-900 px-3 py-2 text-xs leading-5 text-white shadow-xl"
        >
          {children}
        </div>
      ) : null}
    </>
  );
}
