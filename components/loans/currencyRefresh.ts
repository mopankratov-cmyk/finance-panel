"use client";

import { useEffect, useRef } from "react";
import { recalculatePlannedLoanPayment, loanCommentValue } from "@/lib/opiu/loanCurrency";
import type { FinanceAction, Payment } from "@/lib/types";

export async function refreshPlannedLoanCurrencies(
  payments: Payment[],
  dispatch: (action: FinanceAction) => void,
): Promise<number> {
  const currencies = [...new Set(payments
    .filter((payment) => payment.status === "planned" && /\[loan:[^:\]]+:schedule:/.test(payment.comment ?? ""))
    .map((payment) => loanCommentValue(payment.comment, "currency"))
    .filter((currency) => currency && currency !== "RUB"))];
  let updated = 0;
  for (const currency of currencies) {
    const response = await fetch(`/api/opiu/exchange-rate?currency=${encodeURIComponent(currency)}`, { cache: "no-store" });
    const result = await response.json().catch(() => null) as { rate?: number; date?: string; error?: string } | null;
    if (!response.ok || !result?.rate) throw new Error(result?.error || `Не удалось получить курс ${currency}`);
    for (const payment of payments) {
      if (loanCommentValue(payment.comment, "currency") !== currency) continue;
      const next = recalculatePlannedLoanPayment(payment, result.rate, result.date ?? new Date().toISOString().slice(0, 10));
      if (!next || (next.amount === payment.amount && next.comment === payment.comment)) continue;
      dispatch({ type: "UPDATE_PAYMENT", payload: next });
      updated++;
    }
  }
  return updated;
}

export function useDailyLoanCurrencyRefresh(
  payments: Payment[],
  dispatch: (action: FinanceAction) => void,
  onError?: (error: unknown) => void,
) {
  const paymentsRef = useRef(payments);
  const errorRef = useRef(onError);
  paymentsRef.current = payments;
  errorRef.current = onError;

  useEffect(() => {
    let stopped = false;
    let refreshedDay = "";
    const run = async () => {
      const moscowDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(new Date());
      if (stopped || refreshedDay === moscowDay || paymentsRef.current.length === 0) return;
      refreshedDay = moscowDay;
      try {
        await refreshPlannedLoanCurrencies(paymentsRef.current, dispatch);
      } catch (error) {
        refreshedDay = "";
        errorRef.current?.(error);
      }
    };
    void run();
    const timer = window.setInterval(() => void run(), 60 * 60 * 1_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [dispatch]);
}
