"use client";

import { useState } from "react";

/**
 * Начальное значение фильтра из адреса.
 *
 * Сигналы «Требует внимания» ведут в конкретную строку конкретного экрана:
 * `/ozon/stocks?q=CLR00913&status=out`. Без чтения этих параметров ссылка
 * открывала общий список, и менеджер второй раз за минуту искал тот же товар
 * руками.
 *
 * Значение читается один раз при открытии: дальше человек управляет фильтром
 * сам, и подменять его выбор адресом было бы навязчиво.
 */
export function useOzonUrlFilter<T extends string>(param: string, fallback: T, allowed?: readonly T[]): [T, (value: T) => void] {
  return useState<T>(() => {
    if (typeof window === "undefined") return fallback;
    const raw = new URLSearchParams(window.location.search).get(param);
    if (!raw) return fallback;
    if (allowed && !allowed.includes(raw as T)) return fallback;
    return raw as T;
  });
}
