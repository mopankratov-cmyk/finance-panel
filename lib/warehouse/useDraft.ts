"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Stored<T> { at: number; value: T }

/** Незаконченный ввод переживает перезагрузку вкладки.
 *
 *  Приёмку на сотню позиций считают полчаса, отгрузку по кабинетам — дольше.
 *  Всё это время работа живёт только в памяти вкладки: `F5`, обрыв сети,
 *  случайно закрытая модалка — и её нет. Черновик пишется в localStorage
 *  с задержкой в 400 мс после последнего нажатия и стирается сам, когда
 *  форма отправлена или опустела.
 *
 *  `key === null` — «ещё рано»: пока форма не получила данные с сервера,
 *  читать нечего (черновик тут же затрёт загрузка), а писать нечего тем более.
 */
export function useDraft<T>(
  key: string | null,
  value: T,
  isEmpty: (value: T) => boolean,
  restore: (value: T) => void,
) {
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  // Колбэки читаются через ref: иначе каждая перерисовка родителя перезапускала
  // бы чтение черновика и возвращала уже стёртые пользователем значения.
  const restoreRef = useRef(restore);
  const emptyRef = useRef(isEmpty);
  restoreRef.current = restore;
  emptyRef.current = isEmpty;
  const readKey = useRef<string | null>(null);

  useEffect(() => {
    setRestoredAt(null);
    readKey.current = null;
    if (!key) return;
    let stored: Stored<T> | null = null;
    try {
      const raw = window.localStorage.getItem(key);
      stored = raw ? (JSON.parse(raw) as Stored<T>) : null;
    } catch {
      stored = null;
    }
    readKey.current = key;
    if (!stored || stored.value == null) return;
    restoreRef.current(stored.value);
    setRestoredAt(stored.at);
  }, [key]);

  useEffect(() => {
    // Пишем только после чтения: пустое начальное состояние формы не должно
    // затирать черновик, ради которого всё и затевалось.
    if (!key || readKey.current !== key) return;
    const timer = window.setTimeout(() => {
      try {
        if (emptyRef.current(value)) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
      } catch {
        // Приватный режим или переполненное хранилище — форма работает как раньше.
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [key, value]);

  const forget = useCallback(() => {
    if (key) {
      try { window.localStorage.removeItem(key); } catch { /* см. выше */ }
    }
    readKey.current = key;
    setRestoredAt(null);
  }, [key]);

  return { restoredAt, forget };
}

export function draftStamp(at: number) {
  return new Date(at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
