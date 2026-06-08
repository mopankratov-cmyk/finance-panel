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
import { loadFinanceState, persistFinanceAction } from "@/lib/db";
import { financeReducer } from "@/lib/reducer";
import type { FinanceAction, FinanceState } from "@/lib/types";

interface FinanceContextValue {
  state: FinanceState;
  dispatch: React.Dispatch<FinanceAction>;
  hydrated: boolean;
  loadError: string | null;
}

const FinanceContext = createContext<FinanceContextValue | null>(null);

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [state, baseDispatch] = useReducer(financeReducer, {
    accounts: [],
    payments: [],
    loans: [],
  });
  const [hydrated, setHydrated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await loadFinanceState();
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
  }, []);

  const dispatch = useCallback((action: FinanceAction) => {
    const prevState = stateRef.current;
    const nextState = financeReducer(prevState, action);
    stateRef.current = nextState;
    baseDispatch(action);

    if (action.type !== "LOAD") {
      void persistFinanceAction(action, prevState, nextState).catch((error) => {
        console.error("Failed to persist finance action:", action.type, error);
      });
    }
  }, []);

  return (
    <FinanceContext.Provider
      value={{ state, dispatch, hydrated, loadError }}
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
