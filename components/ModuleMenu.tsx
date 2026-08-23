"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Grid3x3, ChevronDown } from "lucide-react";

// Сквозное меню модулей — убирает тупики на полноэкранных страницах (Ozon и др.).
const MODULES: { href: string; label: string; group: string }[] = [
  { href: "/", label: "Все модули", group: "" },
  { href: "/ozon", label: "Ozon Аналитика", group: "Аналитика" },
  { href: "/pnl", label: "ОПиУ WB+Ozon", group: "Финансы" },
  { href: "/losses", label: "Где теряем", group: "Финансы" },
  { href: "/summary", label: "Сводка МП", group: "Финансы" },
  { href: "/calendar", label: "Календарь / ДДС", group: "Финансы" },
  { href: "/supplies", label: "Закупки", group: "Операции" },
  { href: "/warehouse", label: "Склад", group: "Операции" },
  { href: "/costs", label: "Себестоимость", group: "Операции" },
  { href: "/cabinets", label: "Кабинеты", group: "Операции" },
];

export function ModuleMenu({ accent = "violet" }: { accent?: "violet" | "sky" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const color = accent === "sky" ? "text-sky-700" : "text-violet-700";

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ${color} hover:bg-gray-100`}>
        <Grid3x3 className="h-4 w-4" /> Модули <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {MODULES.map((m, i) => {
            const prevGroup = MODULES[i - 1]?.group;
            const showHdr = m.group && m.group !== prevGroup;
            const inner = <Link href={m.href} onClick={() => setOpen(false)} className="block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">{m.label}</Link>;
            return (
              <div key={m.href}>
                {showHdr && <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{m.group}</div>}
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
