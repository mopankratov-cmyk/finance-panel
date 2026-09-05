"use client";

import {
  BarChart3,
  Boxes,
  ClipboardList,
  CalendarRange,
  Calculator,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  Filter,
  FlaskConical,
  Home,
  Link2,
  LogOut,
  KeyRound,
  Megaphone,
  MessageSquareText,
  PackageSearch,
  Rows3,
  Search,
  Settings,
  Sparkles,
  Truck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  WB_MOBILE_NAVIGATION,
  WB_NAVIGATION_ITEMS,
  isWbNavigationItemActive,
} from "@/lib/wb/navigation";
import { useDialogBehavior } from "@/hooks/useDialogBehavior";
import { useIsBelowTablet } from "@/hooks/useMediaQuery";
import { WbCabinetSwitcher } from "./WbCabinetSwitcher";
import { useWbCabinet } from "./WbCabinetContext";

type IconComponent = React.ComponentType<{ className?: string }>;

interface NavItem {
  label: string;
  href: string;
  icon: IconComponent;
  target?: boolean;
}

const ITEM_ICONS: Record<string, IconComponent> = {
  "/wb/rnp": BarChart3,
  "/wb/planning": CalendarRange,
  "/wb/funnel": Filter,
  "/wb/unit": Calculator,
  "/wb/seo": Search,
  "/wb/sklejki": Link2,
  "/wb/adverts": Megaphone,
  "/wb/rk": ClipboardList,
  "/wb/ctr": FlaskConical,
  "/wb/shelf": Rows3,
  "/wb/market": ChartNoAxesCombined,
  "/wb/supplies": Truck,
  "/wb/product": PackageSearch,
  "/wb/reviews": MessageSquareText,
};

const WORK_NAV = WB_NAVIGATION_ITEMS.map((item) => ({ ...item, icon: ITEM_ICONS[item.href] ?? BarChart3, target: true }));

const MOBILE_NAV = WB_MOBILE_NAVIGATION.map((item) => ({ ...item, icon: ITEM_ICONS[item.href] ?? BarChart3, target: true }));

const INTERNAL_SYSTEM_NAV: NavItem[] = [
  { label: "Общая главная", href: "/", icon: Home },
  { label: "Кабинеты", href: "/cabinets", icon: Settings },
  { label: "Сотрудники", href: "/users", icon: Users },
];

const SELLER_SYSTEM_NAV: NavItem[] = [
  // Склад — второй модуль внешнего селлера, и попасть в него можно только
  // отсюда: общая витрина модулей ему закрыта, а адрес руками никто не набирает.
  { label: "Склад", href: "/warehouse", icon: Boxes },
  { label: "Подключение WB", href: "/wb/connect", icon: KeyRound },
];

// Команда кабинета — пункт для админа кабинета. Экран существовал, но попасть
// на него можно было только по прямой ссылке: человек, которому выдали право
// заводить сотрудников, не видел этого нигде в интерфейсе.
const SELLER_TEAM_NAV: NavItem = { label: "Команда", href: "/wb/team", icon: Users };

function RailLink({ item, active, cabinetId, expanded, onNavigate }: { item: NavItem; active: boolean; cabinetId: string; expanded: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  const href = item.target ? `${item.href}?cabinet=${encodeURIComponent(cabinetId)}` : item.href;
  return (
    <Link
      href={href}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      title={item.label}
      onClick={onNavigate}
      className={`group relative mx-2 flex h-11 items-center rounded-[9px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 md:h-9 ${expanded ? "gap-3 px-3" : "justify-center max-lg:flex-col max-lg:gap-0.5"} ${
        active ? "bg-violet-50 text-violet-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
      }`}
    >
      {active && <span className="absolute -left-2 h-6 w-[3px] rounded-r bg-violet-600" />}
      <Icon className="h-[17px] w-[17px] shrink-0" />
      {expanded ? <span className="truncate text-xs font-medium">{item.label}</span> : (
        <>
          <span className="pointer-events-none absolute left-[43px] z-[90] hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white shadow-lg group-hover:block group-focus-visible:block">
            {item.label}
          </span>
          <span aria-hidden="true" className="w-full truncate px-0.5 text-center text-[8px] font-medium leading-none lg:hidden">{item.label}</span>
        </>
      )}
    </Link>
  );
}

export function WbShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { cabinetId, cabinets, user, cabinetLevel } = useWbCabinet();
  // Пока сессия не загрузилась, роль неизвестна — рисуем скелетон, а не меню
  // «по умолчанию»: иначе внешний селлер на каждой перезагрузке видел вспышку
  // владельческой навигации (Полки, Кабинеты, Сотрудники) с мёртвыми ссылками.
  const roleKnown = Boolean(user);
  const systemNav = !roleKnown
    ? []
    : user?.role === "seller"
    // Пункт видит только админ кабинета: рядовому сотруднику экран ответит
    // отказом, и ссылка была бы обманом.
    ? (cabinetLevel === "lead" ? [...SELLER_SYSTEM_NAV, SELLER_TEAM_NAV] : SELLER_SYSTEM_NAV)
    : INTERNAL_SYSTEM_NAV;
  const workNav = !roleKnown || (user?.role === "seller" && cabinets.length === 0)
    ? []
    : user?.role === "seller"
    ? WORK_NAV.map((item) => item.href === "/wb/funnel" ? { ...item, label: "Воронка" } : item)
    : WORK_NAV;
  const mobileNav = !roleKnown
    ? []
    : user?.role === "seller" && cabinets.length === 0
    ? SELLER_SYSTEM_NAV
    : MOBILE_NAV;
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const menuRef = useRef<HTMLElement | null>(null);

  // Выдвижное меню — полноценный диалог: Escape, замкнутый Tab и неподвижный
  // фон. Без последнего страница под затемнением продолжала ехать пальцем, и,
  // закрыв меню, человек оказывался не там, откуда его открыл.
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDialogBehavior(menuOpen, closeMenu, menuRef);

  // Шторка и её подложка живут только до md (`md:hidden`), а блокировка фона —
  // в состоянии. Поворот телефона в ландшафт (≈844px) или растягивание окна
  // через 768px с открытым меню прятали и шторку, и подложку, но фон оставался
  // прикреплённым: страница не прокручивалась, и закрыть было нечем. Уходит
  // разметка — уходит и состояние.
  const belowTablet = useIsBelowTablet();
  useEffect(() => {
    if (!belowTablet) setMenuOpen(false);
  }, [belowTablet]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const saved = window.localStorage.getItem("wb-sidebar-expanded");
    if (saved !== null) setSidebarExpanded(saved !== "false");
  }, []);

  const toggleSidebar = () => {
    setSidebarExpanded((current) => {
      const next = !current;
      window.localStorage.setItem("wb-sidebar-expanded", String(next));
      return next;
    });
  };

  const initials = useMemo(() => {
    const email = user?.email ?? "";
    return email ? email.slice(0, 2).toUpperCase() : "WB";
  }, [user?.email]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/login");
    router.refresh();
  };

  const renderNav = (expanded: boolean, mobile = false) => (
    <>
      <div className={`flex h-[54px] shrink-0 items-center border-b border-slate-200 ${expanded ? "gap-2.5 px-3" : "justify-center"}`}>
        <Link
          href={user?.role === "seller" && cabinets.length === 0 ? "/wb/connect" : `/wb/rnp?cabinet=${encodeURIComponent(cabinetId || "all")}`}
          aria-label="Управление WB"
          className="grid h-7 w-7 place-items-center rounded-[9px] bg-gradient-to-br from-violet-500 to-violet-800 text-[10px] font-black text-white shadow-sm"
        >
          WB
        </Link>
        {expanded ? <span className="truncate text-xs font-bold text-slate-700">Управление WB</span> : null}
      </div>

      <div className={`flex h-[46px] shrink-0 items-center border-b border-slate-200 ${expanded ? "justify-between px-3" : "justify-center"}`}>
        {expanded ? <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Инструменты</span> : null}
        <button
          type="button"
          onClick={mobile ? () => setMenuOpen(false) : toggleSidebar}
          aria-label={mobile ? "Закрыть навигацию" : expanded ? "Свернуть навигацию" : "Развернуть навигацию"}
          className="grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700 lg:h-8 lg:w-8"
        >
          {expanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      <nav aria-label="Инструменты Wildberries" className="flex-1 overflow-y-auto overflow-x-visible py-2">
        {!roleKnown ? (
          <div className="space-y-1.5 px-2 py-1" aria-hidden="true">
            {Array.from({ length: 9 }).map((_, index) => (
              <div key={index} className="h-9 animate-pulse rounded-[9px] bg-slate-100 motion-reduce:animate-none" />
            ))}
          </div>
        ) : null}
        <div className="space-y-0.5">
          {workNav.map((item) => (
            <RailLink
              key={item.href}
              item={item}
              cabinetId={cabinetId || "all"}
              expanded={expanded}
              onNavigate={mobile ? () => setMenuOpen(false) : undefined}
              active={isWbNavigationItemActive(pathname, item.href)}
            />
          ))}
        </div>
        <div className="mx-3 my-2 border-t border-slate-200" />
        <div className="space-y-0.5">
          {systemNav.map((item) => (
            <RailLink
              key={`${item.label}-${item.href}`}
              item={item}
              cabinetId={cabinetId || "all"}
              expanded={expanded}
              onNavigate={mobile ? () => setMenuOpen(false) : undefined}
              active={pathname === item.href}
            />
          ))}
        </div>
      </nav>

      <div className="flex h-8 shrink-0 items-center justify-center border-t border-slate-200">
        <span className="h-2 w-2 rounded-full bg-emerald-400" title="Система работает" />
      </div>
    </>
  );

  return (
    <div className="min-h-dvh bg-[#f6f7f9] text-slate-800">
      <a href="#wb-main-content" className="fixed left-3 top-2 z-[100] -translate-y-20 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0">
        Перейти к содержимому
      </a>
      <aside className={`fixed inset-y-0 left-0 z-[70] hidden flex-col border-r border-slate-200 bg-white px-safe pt-safe transition-[width] duration-200 md:flex ${sidebarExpanded ? "w-[216px]" : "w-[55px]"}`}>
        {renderNav(sidebarExpanded)}
      </aside>

      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="Закрыть меню"
            className="fixed inset-0 z-[69] bg-slate-950/25 md:hidden"
            onClick={() => setMenuOpen(false)}
          />
          <aside ref={menuRef} role="dialog" aria-modal="true" aria-label="Навигация Wildberries" className="fixed inset-y-0 left-0 z-[70] flex w-[216px] flex-col border-r border-slate-200 bg-white px-safe pt-safe md:hidden">
            {renderNav(true, true)}
          </aside>
        </>
      )}

      {/* pt-safe: в горизонтальной ориентации iPhone и в установленном на
          домашний экран приложении под шапкой оказывается вырез, и первая
          строка кнопок уезжает под него. */}
      <header className={`fixed left-0 right-0 top-0 z-[60] flex h-[calc(54px+var(--safe-t))] items-center border-b border-slate-200 bg-white pl-[calc(0.75rem+var(--safe-l))] pr-[calc(0.75rem+var(--safe-r))] pt-safe transition-[left] duration-200 md:pl-[calc(1.25rem+var(--safe-l))] md:pr-[calc(1.25rem+var(--safe-r))] ${sidebarExpanded ? "md:left-[216px]" : "md:left-[55px]"}`}>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Открыть меню"
          className="mr-2 grid h-11 w-11 place-items-center rounded-lg bg-violet-700 text-[9px] font-black text-white md:hidden"
        >
          WB
        </button>
        <div className="hidden items-center gap-2 text-[11px] text-slate-400 sm:flex">
          <Sparkles className="h-3.5 w-3.5 text-violet-500" />
          <span>Управление Wildberries</span>
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
          {/* Селлер ведёт свой кабинет сам (порядок артикулов, план, теги,
              журнал, реестр «Полок») — метка «только просмотр» врала бы. */}
          <WbCabinetSwitcher />
          <div className="hidden h-5 w-px bg-slate-200 sm:block" />
          <div className="hidden min-w-0 items-center gap-2 sm:flex">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-500">
              {initials}
            </span>
            <span className="max-w-40 truncate text-xs text-slate-600">{user?.email ?? "Пользователь"}</span>
          </div>
          <button
            type="button"
            onClick={logout}
            title="Выйти"
            aria-label="Выйти"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700 lg:h-8 lg:w-8"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Запас снизу под нижнюю навигацию и системный индикатор: без него
          последняя строка любой таблицы навсегда оставалась под панелью, и
          добраться до неё было нечем. На планшете и шире панели нет — запас
          снимается. */}
      <main
        id="wb-main-content"
        tabIndex={-1}
        className={`min-h-dvh pb-[calc(3.5rem+var(--safe-b))] pt-[calc(54px+var(--safe-t))] transition-[margin] duration-200 md:pb-0 ${sidebarExpanded ? "md:ml-[216px]" : "md:ml-[55px]"}`}
      >
        {children}
      </main>

      {/* z-40, а не z-50: панель нарисована после <main>, и при равном слое с
          Modal и SlidePanel (оба z-50) она ложилась поверх открытого диалога —
          ровно на нижний ряд кнопок «Сохранить/Отмена». */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(3.5rem+var(--safe-b))] items-start justify-around border-t border-slate-200 bg-white pb-safe md:hidden" aria-label="Быстрая навигация">
        {mobileNav.map((item) => {
          const Icon = item.icon;
          const href = item.target ? `${item.href}?cabinet=${encodeURIComponent(cabinetId || "all")}` : item.href;
          const active = isWbNavigationItemActive(pathname, item.href);
          return (
            <Link
              key={item.label}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex h-14 min-w-14 flex-1 flex-col items-center justify-center gap-1 px-1 text-[10px] leading-tight ${active ? "font-semibold text-violet-700" : "text-slate-500"}`}
            >
              <Icon className="h-[18px] w-[18px]" />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
