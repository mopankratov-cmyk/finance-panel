"use client";

import { useEffect, useRef } from "react";

/**
 * Общее поведение всех модальных окон и выдвижных панелей.
 *
 * До этого хука каждое окно в проекте закрывалось только крестиком: Escape не
 * работал, фокус уходил за спину диалога на страницу под ним, а фон
 * прокручивался вместе с содержимым окна. На мыши это мелкое неудобство, на
 * телефоне — поломка: тянешь список внутри окна, а уезжает страница позади.
 *
 * Блокировка фона сделана через `position: fixed` с запоминанием прокрутки, а
 * не через `overflow: hidden` на body. Причина ровно одна: в Safari на iOS
 * `overflow: hidden` фон не держит — он продолжает прокручиваться под окном.
 * Побочный эффект приёма — страница прыгает к началу, поэтому положение
 * запоминается и возвращается при закрытии.
 */
export function useDialogBehavior(
  open: boolean,
  onClose: () => void,
  container: React.RefObject<HTMLElement | null>,
) {
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  // Обработчик закрытия живёт в ref и НЕ входит в зависимости эффекта — иначе
  // диалог невозможно заполнить.
  //
  // Вызывают компонент почти всегда так: onClose={() => setOpen(false)}. Эта
  // стрелка создаётся заново на каждом рендере родителя, а родитель
  // перерисовывается на каждый введённый символ, потому что черновик формы
  // лежит в его состоянии. Если onClose стоит в зависимостях, эффект
  // пересобирается после КАЖДОГО нажатия клавиши: уборка возвращает фокус на
  // кнопку, открывшую окно, а новый заход уводит его на крестик. Человек
  // печатает один символ, теряет курсор, жмёт Enter — и окно закрывается,
  // потеряв введённое.
  //
  // Держать актуальную функцию в ref безопасно: она нужна только внутри
  // обработчиков, которые читают ref в момент вызова.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // ── Escape и ловушка фокуса ──
  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        container.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    // Фокус внутрь окна, но НЕ в поле ввода: на телефоне это мгновенно
    // поднимает клавиатуру поверх окна, которое человек ещё не прочитал.
    const first = focusable();
    const safeFirst = first.find((el) => !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) ?? first[0];
    safeFirst?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Фокус возвращается на кнопку, которой окно открыли, — иначе после
      // закрытия клавиатурный пользователь оказывается в начале страницы.
      restoreFocusTo.current?.focus?.({ preventScroll: true });
    };
  }, [open, container]);

  // ── Фон не прокручивается ──
  useEffect(() => {
    if (!open) return;
    const { body } = document;
    const scrollY = window.scrollY;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflowY: body.style.overflowY,
    };

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflowY = "scroll"; // держим место под полосу, чтобы не дёргалась ширина

    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      body.style.overflowY = previous.overflowY;
      window.scrollTo(0, scrollY);
    };
  }, [open]);
}
