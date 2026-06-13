"use client";

import { useEffect, useState } from "react";

// Активный кабинет по маркетплейсу, сохраняется в localStorage.
// "" = первый активный (дефолт сервера).
export function useActiveCabinet(mp: "ozon" | "wb"): [string, (v: string) => void] {
  const key = `fp_cab_${mp}`;
  const [id, setId] = useState("");
  useEffect(() => {
    try { const v = localStorage.getItem(key); if (v) setId(v); } catch { /* ignore */ }
  }, [key]);
  const set = (v: string) => {
    setId(v);
    try { if (v) localStorage.setItem(key, v); else localStorage.removeItem(key); } catch { /* ignore */ }
  };
  return [id, set];
}
