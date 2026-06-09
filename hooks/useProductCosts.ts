"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "wb-product-costs";

export function useProductCosts() {
  const [costs, setCosts] = useState<Record<number, number>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setCosts(JSON.parse(raw) as Record<number, number>);
    } catch {
      /* ignore */
    }
  }, []);

  const setCost = useCallback((nmId: number, cost: number) => {
    setCosts((prev) => {
      const next = { ...prev, [nmId]: cost };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { costs, setCost };
}
