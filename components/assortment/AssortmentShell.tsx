"use client";

import { Home, Database, Shirt, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ASSORTMENT_BASE_PATH } from "@/lib/assortment/constants";

type IconComponent = React.ComponentType<{ className?: string }>;

interface NavItem {
  label: string;
  href: string;
  icon: IconComponent;
}

/**
 * Разделы модуля. «Подборки» появятся здесь вместе с экраном подборок: пункт,
 * ведущий в пустоту, не показываем.
 */
export const ASSORTMENT_NAV: NavItem[] = [
  { label: "Куртки", href: `${ASSORTMENT_BASE_PATH}/jackets`, icon: Shirt },
  { label: "Сумки", href: `${ASSORTMENT_BASE_PATH}/bags`, icon: ShoppingBag },
  { label: "Источники", href: `${ASSORTMENT_BASE_PATH}/sources`, icon: Database },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Оболочка модуля «Разработка ассортимента».
 *
 * Как у WB, Ozon и «Склада»: слева светлое меню только этого модуля вместо
 * навигации всей панели (решение владельца 01.10.2026). Вход в модуль —
 * плитка на главной. На телефоне меню — строка вкладок под шапкой.
 */
export function AssortmentShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  return (
    <div className="min-h-dvh bg-[#f6f7f9] text-slate-800">
      <aside className="fixed inset-y-0 left-0 z-[60] hidden w-[216px] flex-col border-r border-slate-200 bg-white pt-safe md:flex">
        <div className="flex h-[54px] shrink-0 items-center gap-2.5 border-b border-slate-200 px-3">
          <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-violet-700 text-[10px] font-black text-white">РА</span>
          <span className="text-xs font-bold leading-4 text-slate-700">Разработка<br />ассортимента</span>
        </div>
        <nav aria-label="Разделы модуля" className="flex-1 space-y-0.5 py-3">
          {ASSORTMENT_NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative mx-2 flex h-9 items-center gap-3 rounded-[9px] px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                  active ? "bg-violet-50 text-violet-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                {active && <span className="absolute -left-2 h-6 w-[3px] rounded-r bg-violet-600" />}
                <Icon className="h-[17px] w-[17px] shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-200 py-2">
          <Link href="/" className="mx-2 flex h-9 items-center gap-3 rounded-[9px] px-3 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800">
            <Home className="h-[17px] w-[17px] shrink-0" />
            <span>Общая главная</span>
          </Link>
        </div>
      </aside>

      <header className="sticky top-0 z-[50] border-b border-slate-200 bg-white pt-safe md:hidden">
        <div className="flex h-[54px] items-center gap-2.5 px-3">
          <Link href="/" aria-label="Общая главная" className="grid h-11 w-11 place-items-center rounded-lg text-slate-500 hover:bg-slate-50">
            <Home className="h-5 w-5" />
          </Link>
          <span className="text-sm font-bold text-slate-800">Разработка ассортимента</span>
        </div>
        <nav aria-label="Разделы модуля" className="flex gap-1 overflow-x-auto px-2 pb-2">
          {ASSORTMENT_NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-11 shrink-0 items-center rounded-full px-4 text-sm ${
                  active ? "bg-violet-700 font-medium text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="min-h-dvh md:ml-[216px]">{children}</main>
    </div>
  );
}
