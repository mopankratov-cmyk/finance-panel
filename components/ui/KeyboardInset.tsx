"use client";

import { useEffect } from "react";

/**
 * Сколько экрана съела клавиатура — в переменную `--kb-inset`.
 *
 * Закреплённая внизу панель действий («Сохранить», «Провести») на телефоне
 * оказывается ПОД экранной клавиатурой: `position: fixed` считает низом низ
 * вьюпорта, а клавиатура его не меняет. Человек видит поле, вводит сумму — и
 * не может сохранить, пока не догадается убрать клавиатуру.
 *
 * Лечится единственным доступным способом: `visualViewport` сообщает реально
 * видимую высоту, разница с окном и есть высота клавиатуры. Пишем её в
 * переменную, а панели действий отступают на неё снизу.
 *
 * Компонент ничего не рисует и монтируется один раз в корневой раскладке.
 */
export function KeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const apply = () => {
      // offsetTop учитывает случай, когда страница «поднята» вместе с полем.
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // Мелкие значения — это адресная строка браузера, а не клавиатура.
      document.documentElement.style.setProperty("--kb-inset", hidden > 120 ? `${Math.round(hidden)}px` : "0px");
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--kb-inset");
    };
  }, []);

  return null;
}
