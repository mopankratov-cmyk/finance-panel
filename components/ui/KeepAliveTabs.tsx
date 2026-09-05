"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

/**
 * Вкладка, на которой человек уже был, не должна умирать.
 *
 * Обычный условный рендер (`tab === "x" ? <A/> : <B/>`) размонтирует компонент
 * при каждом переключении: данные грузятся заново, а вместе с компонентом
 * пропадает всё состояние — раскрытые ветки, фильтры, незаконченный ввод,
 * положение прокрутки. На складе это стоило 3–7 секунд ожидания НА КАЖДЫЙ
 * заход, при том что круг к базе из региона панели стоит 0,35–0,7 с и данные
 * за минуту не изменились.
 *
 * Здесь первый заход стоит одну загрузку, а все следующие переключения
 * мгновенны и возвращают человека ровно туда, где он стоял.
 *
 * `resetKey` — то, при смене чего показанное перестаёт быть правдой: юрлицо,
 * кабинет, период. При его смене набор сбрасывается до текущей вкладки, иначе
 * на соседней висели бы чужие данные.
 *
 * Цена решения честная: смонтированные вкладки остаются в DOM и держат своё
 * состояние в памяти. Это оправдано на десятке вкладок одного модуля и НЕ
 * оправдано там, где вкладок сотни или каждая тянет тяжёлый холст.
 */
export function useKeepAliveTabs<T extends string>(active: T, resetKey?: unknown) {
  const [visited, setVisited] = useState<Set<T>>(() => new Set<T>([active]));

  useEffect(() => {
    setVisited((prev) => (prev.has(active) ? prev : new Set(prev).add(active)));
  }, [active]);

  useEffect(() => {
    setVisited(new Set<T>([active]));
    // active намеренно не в зависимостях: сброс — событие смены resetKey, а не
    // переключения вкладки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  return useCallback(
    (tab: T) => ({ visited: visited.has(tab), active: tab === active }),
    [visited, active],
  );
}

/**
 * Обёртка вокруг содержимого вкладки.
 *
 * Непосещённая не рендерится вовсе — иначе первый вход в модуль поднял бы все
 * вкладки разом и заплатил за них запросами. Посещённая, но неактивная,
 * прячется: React сохраняет её состояние, а `aria-hidden` убирает её от
 * скринридера, чтобы он не читал вслух три экрана подряд.
 */
export function TabPanel({
  visited,
  active,
  children,
}: {
  visited: boolean;
  active: boolean;
  children: ReactNode;
}) {
  if (!visited) return null;
  return (
    <div className={active ? "" : "hidden"} aria-hidden={!active}>
      {children}
    </div>
  );
}
