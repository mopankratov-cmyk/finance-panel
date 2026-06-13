"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Под-вкладки раздела «Финрезультат» — склеивает 4 денежные страницы в один логичный раздел.
const TABS = [
  { href: "/summary", label: "Сводка WB · Ozon" },
  { href: "/pnl", label: "ОПиУ (до СПП)" },
  { href: "/losses", label: "Где теряем" },
  { href: "/opiu", label: "WB недельный" },
];

export function FinanceTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-5">
      <div className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-400">Финрезультат</div>
      <div className="flex flex-wrap gap-1.5 border-b border-gray-200 pb-px">
        {TABS.map((t) => {
          const active = pathname === t.href || pathname.startsWith(t.href + "/");
          return (
            <Link key={t.href} href={t.href}
              className={`rounded-t-lg px-3 py-2 text-sm font-semibold transition-colors ${
                active ? "border-b-2 border-blue-600 text-blue-700" : "text-gray-500 hover:text-gray-800"
              }`}>
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
