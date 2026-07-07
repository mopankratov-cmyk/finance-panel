"use client";

import { useEffect, useState } from "react";

// Активный кабинет по маркетплейсу, сохраняется в localStorage.
// "" = первый активный (дефолт сервера). ready становится true только после чтения
// localStorage — потребители должны отложить фетч данных до ready, иначе на каждой
// странице улетает лишний (самый тяжёлый, "все кабинеты") запрос ещё до гидрации.
export function useActiveCabinet(mp: "ozon" | "wb"): [string, (v: string) => void, boolean] {
  const key = `fp_cab_${mp}`;
  const [id, setId] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { const v = localStorage.getItem(key); if (v) setId(v); } catch { /* ignore */ }
    setReady(true);
  }, [key]);
  const set = (v: string) => {
    setId(v);
    try { if (v) localStorage.setItem(key, v); else localStorage.removeItem(key); } catch { /* ignore */ }
  };
  return [id, set, ready];
}
