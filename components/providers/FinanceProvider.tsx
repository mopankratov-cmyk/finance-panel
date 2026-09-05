"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { needsFinanceHydration } from "@/lib/navigation/financeHydration";
import { loadFinanceState, persistFinanceAction } from "@/lib/db";
import { financeReducer } from "@/lib/reducer";
import type { FinanceAction, FinanceState } from "@/lib/types";

interface FinanceContextValue {
  state: FinanceState;
  dispatch: React.Dispatch<FinanceAction>;
  hydrated: boolean;
  loadError: string | null;
  /** Последняя ошибка записи в базу: экран уже показал изменение, а база его не приняла. */
  persistError: string | null;
  clearPersistError: () => void;
}

const ACTION_LABELS: Record<FinanceAction["type"], string> = {
  LOAD: "загрузка",
  ADD_ACCOUNT: "добавление счёта",
  UPDATE_ACCOUNT: "изменение счёта",
  DELETE_ACCOUNT: "удаление счёта",
  ADD_PAYMENT: "добавление платежа",
  UPDATE_PAYMENT: "изменение платежа",
  DELETE_PAYMENT: "удаление платежа",
  ADD_LOAN: "добавление договора",
  UPDATE_LOAN: "изменение договора",
  DELETE_LOAN: "удаление договора",
};

const FinanceContext = createContext<FinanceContextValue | null>(null);
const FINANCE_LOAD_TIMEOUT_MS = 12_000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Финансовые таблицы не ответили за ${Math.round(timeoutMs / 1000)} секунд`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [state, baseDispatch] = useReducer(financeReducer, {
    accounts: [],
    payments: [],
    loans: [],
  });
  const [hydrated, setHydrated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const clearPersistError = useCallback(() => setPersistError(null), []);
  const stateRef = useRef(state);
  stateRef.current = state;

  /**
   * Финансовое состояние грузится ТОЛЬКО на экранах, которым оно нужно.
   *
   * Провайдер лежит в корневом макете, и запрос уходил на КАЖДОЙ странице
   * панели: на складе, в кабинете WB, в кокпите Ozon. Замер на проде показал
   * 2,7–3,1 с — второй по тяжести запрос на экране воронки WB, где это
   * состояние не читает никто. А роль ниже финансиста получала за эти секунды
   * ещё и отказ: /api/finance/state открыт только директору и финотделу.
   *
   * Условие то же самое, по которому макет решает, ждать ли гидрацию
   * (needsFinanceHydration) — два разных ответа на один вопрос разошлись бы.
   * Переход с /wb на /payments поднимет загрузку сам: pathname меняется.
   */
  const pathname = usePathname();
  const financeNeeded = needsFinanceHydration(pathname);

  useEffect(() => {
    let cancelled = false;
    if (!financeNeeded) {
      // Не «загружено», а «не требовалось»: экран финансов, открытый следом,
      // должен честно дождаться своих данных, а не показать пустые счета.
      setHydrated(false);
      return;
    }

    async function load() {
      try {
        const data = await withTimeout(loadFinanceState(), FINANCE_LOAD_TIMEOUT_MS);
        if (!cancelled) {
          baseDispatch({ type: "LOAD", payload: data });
          setLoadError(null);
        }
      } catch (error) {
        console.error("Failed to load finance data:", error);
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Не удалось загрузить данные",
          );
        }
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [financeNeeded]);

  const dispatch = useCallback((action: FinanceAction) => {
    const prevState = stateRef.current;
    const nextState = financeReducer(prevState, action);
    stateRef.current = nextState;
    baseDispatch(action);

    if (action.type !== "LOAD") {
      // Интерфейс применяет изменение сразу; если база его не приняла, человек
      // должен это увидеть, а не узнать после перезагрузки. Раньше ошибка уходила
      // только в консоль.
      void persistFinanceAction(action, prevState, nextState).catch((error) => {
        console.error("Failed to persist finance action:", action.type, error);
        const reason = error instanceof Error ? error.message : "неизвестная ошибка";
        setPersistError(`Не сохранилось: ${ACTION_LABELS[action.type]} — ${reason}. На экране есть изменения, которых нет в базе: обновите страницу и повторите.`);
      });
    }
  }, []);

  return (
    <FinanceContext.Provider
      value={{ state, dispatch, hydrated, loadError, persistError, clearPersistError }}
    >
      {children}
    </FinanceContext.Provider>
  );
}

export function useFinance() {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error("useFinance must be used within FinanceProvider");
  return ctx;
}
