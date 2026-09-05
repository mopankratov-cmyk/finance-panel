"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Ширина окна как источник решения — но только там, где CSS не справляется.
 *
 * Почти вся адаптация в этом проекте сделана на CSS осознанно: при повороте
 * планшета CSS ничего не перемонтирует, а переключение разметки из JS уронило
 * бы состояние — выделенные строки, раскрытые подробности, введённое в поля.
 * Хук нужен для остатка: когда на разных ширинах нужен РАЗНЫЙ компонент
 * (лист снизу против боковой панели), а не разный вид одного.
 *
 * `useSyncExternalStore` вместо useState+useEffect — чтобы React сам
 * согласовал серверную и клиентскую отрисовку и не выдал предупреждение о
 * несовпадении. На сервере ширина неизвестна, поэтому серверный снимок всегда
 * `false`: компонент обязан оставаться работоспособным при таком ответе.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Пороги совпадают с брейкпоинтами Tailwind — чтобы CSS и JS не разъезжались. */
export const useIsPhone = () => useMediaQuery("(max-width: 639px)");
export const useIsBelowTablet = () => useMediaQuery("(max-width: 767px)");
export const useIsBelowDesktop = () => useMediaQuery("(max-width: 1023px)");

/** Указатель грубый — пальцем. Отличает планшет с касанием от узкого окна на мыши. */
export const useIsTouch = () => useMediaQuery("(pointer: coarse)");
