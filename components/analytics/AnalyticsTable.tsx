"use client";

import { Download } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { exportCsv } from "@/lib/analytics/format";

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  render: (row: T) => ReactNode;
  csv?: (row: T) => string;
  /**
   * Значение для сортировки, когда csv-текст сортировать нельзя.
   * Нужно для дат: parseFloat("2026-08-19") === 2026, поэтому все даты
   * одного года сравниваются как равные и сортировка не работает.
   */
  sortValue?: (row: T) => number | string | null;
}

interface AnalyticsTableProps<T> {
  columns: Column<T>[];
  data: T[];
  filename?: string;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
}

export function AnalyticsTable<T>({
  columns,
  data,
  filename = "export.csv",
  emptyMessage = "Нет данных",
  onRowClick,
  rowClassName,
}: AnalyticsTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return data;
    // sortValue важнее csv: у дат текстовый csv сортируется неверно.
    if (col.sortValue) {
      const pick = col.sortValue;
      return [...data].sort((a, b) => {
        const av = pick(a);
        const bv = pick(b);
        // Пустые значения всегда в конце, независимо от направления.
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === "number" && typeof bv === "number") {
          return sortDir === "asc" ? av - bv : bv - av;
        }
        const as = String(av);
        const bs = String(bv);
        return sortDir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
      });
    }
    if (!col.csv) return data;
    return [...data].sort((a, b) => {
      const av = col.csv!(a);
      const bv = col.csv!(b);
      const an = parseFloat(av.replace(/[^\d.-]/g, ""));
      const bn = parseFloat(bv.replace(/[^\d.-]/g, ""));
      if (!Number.isNaN(an) && !Number.isNaN(bn)) {
        return sortDir === "asc" ? an - bn : bn - an;
      }
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [data, sortKey, sortDir, columns]);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const handleExport = () => {
    exportCsv(
      filename,
      columns.map((c) => c.label),
      sorted.map((row) => columns.map((c) => c.csv?.(row) ?? "")),
    );
  };

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-500 shadow-sm">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex justify-end border-b border-slate-100 px-3 py-2">
        <button
          type="button"
          onClick={handleExport}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700"
        >
          <Download className="h-3.5 w-3.5" />
          CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-3 py-2.5 font-medium whitespace-nowrap ${
                    col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""
                  } ${col.sortable ? "cursor-pointer hover:text-slate-800" : ""}`}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  {col.label}
                  {sortKey === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((row, i) => (
              <tr
                key={i}
                onClick={() => onRowClick?.(row)}
                className={`hover:bg-violet-50 ${onRowClick ? "cursor-pointer" : ""} ${rowClassName?.(row) ?? ""}`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-3 py-2 whitespace-nowrap text-slate-700 ${
                      col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""
                    }`}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
