"use client";

import { useMemo, useState } from "react";

// Кликабельная сортировка по колонкам (как "Сорт ↓ Остаток Заказы Оборач GMROI ДРР"
// в infernoff.ru) — общий хук для всех WB-таблиц. getValue достаёт число/строку
// из строки данных по имени поля; null/undefined всегда уходят в конец.
export function useSort<T>(rows: T[], getValue: (row: T, field: string) => number | string | null | undefined) {
  const [field, setField] = useState<string | null>(null);
  const [dir, setDir] = useState<1 | -1>(-1); // -1 = по убыванию (дефолт inferno)

  const sorted = useMemo(() => {
    if (!field) return rows;
    return [...rows].sort((a, b) => {
      const va = getValue(a, field), vb = getValue(b, field);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string" || typeof vb === "string") return dir * String(va).localeCompare(String(vb), "ru");
      return dir * (va - vb);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, field, dir]);

  const toggleSort = (f: string) => {
    if (field === f) setDir((d) => (d === -1 ? 1 : -1));
    else { setField(f); setDir(-1); }
  };

  return { sorted, sortField: field, sortDir: dir, toggleSort };
}

export function sortGlyph(active: boolean, dir: 1 | -1) {
  if (!active) return "";
  return dir === -1 ? " ↓" : " ↑";
}
