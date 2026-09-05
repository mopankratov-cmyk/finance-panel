"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

interface ShellState {
  /** Выезжающее меню на телефоне. */
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
  /** Боковая панель развёрнута (подписи) или свёрнута до иконок. */
  railExpanded: boolean;
  toggleRail: () => void;
}

const ShellContext = createContext<ShellState | null>(null);

const STORAGE_KEY = "fin-rail-expanded";

/**
 * Состояние оболочки финансового контура.
 *
 * Вынесено в контекст по одной причине: ширину боковой панели должны знать
 * ДВА компонента — сама панель и основная область, которой на эту ширину
 * нужно отступить. Держать состояние внутри панели и «угадывать» отступ
 * классами нельзя: панель сворачивается по кнопке, а не по ширине окна.
 *
 * Значение по умолчанию зависит от размера экрана и потому вычисляется уже в
 * браузере: на планшете в портрете (iPad Pro 11" — 834px) панель разумно
 * держать свёрнутой до иконок, отдав ширину таблицам; на большом экране —
 * развёрнутой. Выбор человека важнее умолчания и переживает перезагрузку.
 */
export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const [railExpanded, setRailExpanded] = useState(true);

  // Обращение к localStorage обёрнуто намеренно: в приватном окне и при
  // запрете хранилища сайту сам ДОСТУП бросает исключение, а этот провайдер
  // оборачивает весь финансовый контур — незакрытая ошибка уронила бы не
  // память о ширине панели, а все его экраны разом.
  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(STORAGE_KEY); } catch { saved = null; }
    if (saved !== null) {
      setRailExpanded(saved === "true");
      return;
    }
    setRailExpanded(window.matchMedia("(min-width: 1024px)").matches);
  }, []);

  const toggleRail = useCallback(() => {
    setRailExpanded((current) => {
      const next = !current;
      try { window.localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* не смогли запомнить — не беда */ }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ navOpen, setNavOpen, railExpanded, toggleRail }),
    [navOpen, railExpanded, toggleRail],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellState {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell вызван вне ShellProvider");
  return value;
}
