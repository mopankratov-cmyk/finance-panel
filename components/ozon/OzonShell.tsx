"use client";

import {
  CalendarDays,
  BadgeRussianRuble,
  BarChart3,
  Boxes,
  CalendarRange,
  ChevronRight,
  HeartPulse,
  Home,
  LayoutDashboard,
  LogOut,
  Megaphone,
  RefreshCw,
  Settings,
  ShoppingCart,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OzonCabinetSwitcher } from "./OzonCabinetSwitcher";
import { useOzonCabinet } from "./OzonCabinetContext";
import { withOzonCabinetScope } from "@/lib/ozon/navigation";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  scoped?: boolean;
}

const WORK_NAV: NavItem[] = [
  { label: "Обзор", href: "/ozon", icon: LayoutDashboard, scoped: true },
  { label: "План продаж", href: "/ozon/planning", icon: CalendarRange, scoped: true },
  { label: "Продажи", href: "/ozon/sales", icon: BarChart3, scoped: true },
  { label: "Реклама", href: "/ozon/adverts", icon: Megaphone, scoped: true },
  { label: "Журнал рекламы", href: "/ozon/journal", icon: CalendarDays, scoped: true },
  { label: "Остатки", href: "/ozon/stocks", icon: Boxes, scoped: true },
  { label: "Заказы", href: "/ozon/orders", icon: ShoppingCart, scoped: true },
  { label: "Экономика", href: "/ozon/economy", icon: BadgeRussianRuble, scoped: true },
  { label: "Здоровье", href: "/ozon/health", icon: HeartPulse, scoped: true },
];

const SYSTEM_NAV: NavItem[] = [
  { label: "Главная", href: "/", icon: Home },
  { label: "Кабинеты", href: "/cabinets", icon: Settings },
  { label: "Синхронизация", href: "/sync", icon: RefreshCw },
];

function isActive(pathname: string, item: NavItem) {
  if (item.href === "/ozon") return pathname === "/ozon";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function RailLink({ item, active, cabinetId }: { item: NavItem; active: boolean; cabinetId: string }) {
  const Icon = item.icon;
  const href = item.scoped ? withOzonCabinetScope(item.href, cabinetId) : item.href;
  return (
    <Link
      href={href}
      aria-label={item.label}
      title={item.label}
      className={`group relative mx-2 flex h-11 items-center justify-center rounded-[9px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 md:h-9 ${active ? "bg-sky-50 text-sky-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}
    >
      {active && <span className="absolute -left-2 h-6 w-[3px] rounded-r bg-sky-600" />}
      <Icon className="h-[17px] w-[17px]" />
      <span className="pointer-events-none absolute left-[43px] z-[90] hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white shadow-lg group-hover:block group-focus-visible:block">
        {item.label}
      </span>
    </Link>
  );
}

export function OzonShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { cabinetId, user } = useOzonCabinet();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);
  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : "OZ";
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/login");
    router.refresh();
  };
  const scopedCabinet = cabinetId || "all";

  const nav = (
    <>
      <div className="flex h-[54px] shrink-0 items-center justify-center border-b border-slate-200">
        <Link href="/" aria-label="Управление Ozon" className="grid h-7 w-7 place-items-center rounded-[9px] bg-gradient-to-br from-sky-500 to-blue-800 text-[9px] font-black text-white shadow-sm">OZ</Link>
      </div>
      <div className="flex h-[58px] shrink-0 items-center justify-center border-b border-slate-200">
        <button type="button" onClick={() => setMenuOpen(false)} aria-label="Свернуть навигацию" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <nav aria-label="Инструменты Ozon" className="flex-1 overflow-y-auto py-2">
        <div className="space-y-0.5">
          {WORK_NAV.map((item) => <RailLink key={item.href} item={item} cabinetId={scopedCabinet} active={isActive(pathname, item)} />)}
        </div>
        <div className="mx-3 my-2 border-t border-slate-200" />
        <div className="space-y-0.5">
          {SYSTEM_NAV.map((item) => <RailLink key={item.href} item={item} cabinetId={scopedCabinet} active={pathname === item.href} />)}
        </div>
      </nav>
      <div className="flex h-8 shrink-0 items-center justify-center border-t border-slate-200">
        <span className="h-2 w-2 rounded-full bg-emerald-400" title="Система работает" />
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-slate-800">
      <a href="#ozon-main" className="fixed left-16 top-2 z-[100] -translate-y-16 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white focus:translate-y-0">К содержимому</a>
      <aside className="fixed inset-y-0 left-0 z-[70] hidden w-[55px] flex-col border-r border-slate-200 bg-white md:flex">{nav}</aside>
      {menuOpen && (
        <>
          <button type="button" aria-label="Закрыть меню" className="fixed inset-0 z-[69] bg-slate-950/25 md:hidden" onClick={() => setMenuOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-[70] flex w-[55px] flex-col border-r border-slate-200 bg-white md:hidden">{nav}</aside>
        </>
      )}
      <header className="fixed left-0 right-0 top-0 z-[60] flex h-[54px] items-center border-b border-slate-200 bg-white px-3 md:left-[55px] md:px-5">
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="Открыть меню" className="mr-2 grid h-11 w-11 place-items-center rounded-lg bg-sky-700 text-[9px] font-black text-white md:hidden">OZ</button>
        <div className="hidden items-center gap-2 text-[11px] text-slate-400 sm:flex">
          <Sparkles className="h-3.5 w-3.5 text-sky-500" />
          <span>Управление Ozon</span>
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
          <OzonCabinetSwitcher />
          <div className="hidden h-5 w-px bg-slate-200 sm:block" />
          <div className="hidden min-w-0 items-center gap-2 sm:flex">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-500">{initials}</span>
            <span className="max-w-40 truncate text-xs text-slate-600">{user?.email ?? "Пользователь"}</span>
          </div>
          <button type="button" onClick={logout} title="Выйти" aria-label="Выйти" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700 sm:h-8 sm:w-8">
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>
      <main id="ozon-main" className="min-h-screen pb-16 pt-[54px] md:ml-[55px] md:pb-0">{children}</main>
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-14 items-center justify-around border-t border-slate-200 bg-white md:hidden" aria-label="Быстрая навигация Ozon">
        {WORK_NAV.slice(0, 4).map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item);
          return (
            <Link key={item.href} href={withOzonCabinetScope(item.href, scopedCabinet)} className={`flex h-full min-w-14 flex-col items-center justify-center gap-0.5 text-[9px] ${active ? "text-sky-700" : "text-slate-400"}`}>
              <Icon className="h-4 w-4" />{item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
