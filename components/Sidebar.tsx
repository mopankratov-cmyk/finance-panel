"use client";

import {
  BarChart3,
  ClipboardList,
  Bot,
  Building2,
  Calendar,
  Coins,
  ChevronDown,
  CreditCard,
  Landmark,
  LayoutDashboard,
  LineChart,
  Megaphone,
  Menu,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  MessageSquare,
  Boxes,
  LogOut,
  PackageSearch,
  CalendarRange,
  Layers,
  MousePointerClick,
  PieChart,
  Search,
  Settings2,
  Sigma,
  Table2,
  Tag,
  Target,
  TrendingUp,
  RefreshCw,
  Rows3,
  UserRoundCog,
  TrendingDown,
  Truck,
  Users,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { allowedNav, ROLE_LABEL } from "@/lib/auth/roles";
import type { Role } from "@/lib/auth/session";
import { isAgentSidebarPath, isFinanceSidebarPath, isSystemSidebarPath } from "@/lib/navigation/sidebar";
import { useShell } from "./providers/ShellProvider";

interface NavLink {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavLink[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: "analytics",
    label: "Аналитика МП",
    items: [
      { href: "/wb/adverts", label: "Реклама WB", icon: Megaphone },
      { href: "/wb/rnp", label: "РНП по SKU", icon: Table2 },
      { href: "/wb/rk", label: "Журнал РК", icon: ClipboardList },
      { href: "/wb/seo", label: "SEO / Воронка", icon: Search },
      { href: "/wb/sklejki", label: "Склейки", icon: Layers },
      { href: "/wb/reviews", label: "Отзывы", icon: MessageSquare },
      { href: "/wb/product", label: "Инфо по SKU", icon: PackageSearch },
      { href: "/wb/unit", label: "Юнит-экономика", icon: Sigma },
      { href: "/wb/ctr", label: "CTR по SKU", icon: MousePointerClick },
      { href: "/wb/shelf", label: "Полки WB", icon: Rows3 },
      { href: "/ozon", label: "Ozon Аналитика", icon: BarChart3 },
      { href: "/wb/market", label: "Рынок", icon: Target },
    ],
  },
  {
    id: "finres",
    label: "Финрезультат",
    items: [
      { href: "/pnl", label: "ОПиУ / P&L", icon: LineChart },
      { href: "/losses", label: "Где теряем", icon: TrendingDown },
    ],
  },
  {
    id: "money",
    label: "Деньги (ДДС)",
    items: [
      { href: "/calendar", label: "Календарь", icon: Calendar },
      { href: "/payments", label: "Платежи", icon: CreditCard },
      { href: "/accounts", label: "Счета", icon: Wallet },
      { href: "/loans", label: "Кредиты", icon: Landmark },
      { href: "/payroll", label: "Зарплатная ведомость", icon: UserRoundCog },
    ],
  },
  {
    id: "operations",
    label: "Операции",
    items: [
      { href: "/wb/supplies", label: "Закупки", icon: Truck },
      { href: "/warehouse", label: "Склад", icon: Boxes },
      { href: "/costs", label: "Себестоимость", icon: Coins },
      { href: "/wb/funnel?view=repricer", label: "Цена и маржа", icon: Tag },
    ],
  },
  {
    id: "system",
    label: "Система",
    items: [
      { href: "/cabinets", label: "Кабинеты", icon: Building2 },
      { href: "/users", label: "Сотрудники", icon: Users },
      { href: "/agent", label: "AI-агент", icon: Bot },
      { href: "/sync", label: "Синхронизация", icon: RefreshCw },
    ],
  },
];

const FINANCE_NAV_GROUPS: NavGroup[] = [
  {
    id: "finres",
    label: "Финрезультат",
    items: [
      { href: "/summary", label: "Сводка WB · Ozon", icon: LayoutDashboard },
      { href: "/pnl", label: "ОПиУ (до СПП)", icon: LineChart },
      { href: "/losses", label: "Где теряем", icon: TrendingDown },
      { href: "/opiu", label: "WB недельный", icon: Table2 },
    ],
  },
  {
    id: "money",
    label: "Деньги (ДДС)",
    items: [
      { href: "/calendar", label: "Календарь", icon: Calendar },
      { href: "/payments", label: "Платежи", icon: CreditCard },
      { href: "/accounts", label: "Счета", icon: Wallet },
      { href: "/loans", label: "Кредиты", icon: Landmark },
      { href: "/payroll", label: "Зарплатная ведомость", icon: UserRoundCog },
    ],
  },
  {
    id: "finance-data",
    label: "Учёт",
    items: [
      { href: "/warehouse", label: "Склад", icon: Boxes },
      { href: "/costs", label: "Себестоимость", icon: Coins },
    ],
  },
];

const SYSTEM_NAV_GROUPS: NavGroup[] = [
  {
    id: "system",
    label: "Настройки",
    items: [
      { href: "/cabinets", label: "Кабинеты", icon: Building2 },
      { href: "/users", label: "Сотрудники", icon: Users },
      { href: "/sync", label: "Синхронизация", icon: RefreshCw },
    ],
  },
];

const AGENT_NAV_GROUPS: NavGroup[] = [
  {
    id: "agent",
    label: "Помощник",
    items: [
      { href: "/agent", label: "AI-агент", icon: Bot },
    ],
  },
];

const DASHBOARD: NavLink = {
  href: "/",
  label: "Дашборд",
  icon: LayoutDashboard,
};

function isActive(pathname: string, href: string): boolean {
  const hrefPath = href.split(/[?#]/, 1)[0] || href;
  return hrefPath === "/" ? pathname === "/" : pathname.startsWith(hrefPath);
}

export function Sidebar() {
  const pathname = usePathname();
  const financeOnly = isFinanceSidebarPath(pathname);
  const systemOnly = isSystemSidebarPath(pathname);
  const agentOnly = isAgentSidebarPath(pathname);
  const router = useRouter();
  const { navOpen, setNavOpen, railExpanded, toggleRail } = useShell();
  const [me, setMe] = useState<{ email: string; role: Role } | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Мобильный drawer: focus-trap + Escape + возврат фокуса на триггер при закрытии —
  // без этого клавиатурный/скринридер-пользователь мог провалиться фокусом за drawer.
  useEffect(() => {
    if (!navOpen) return;
    previouslyFocused.current = document.activeElement as HTMLElement;
    const focusables = asideRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
    focusables?.[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setNavOpen(false); return; }
      if (e.key !== "Tab" || !focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [navOpen, setNavOpen]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    analytics: true,
    finres: true,
    money: true,
    operations: true,
    system: true,
    agent: true,
  });

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((j) => setMe(j.user)).catch(() => {});
  }, []);

  // Переход по ссылке закрывает выезжающее меню: иначе оно остаётся висеть
  // поверх только что открытого экрана.
  useEffect(() => { setNavOpen(false); }, [pathname, setNavOpen]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
    router.refresh();
  };

  // группы с фильтром по роли (пустые группы скрываем)
  const sourceGroups = financeOnly
    ? FINANCE_NAV_GROUPS
    : systemOnly
      ? SYSTEM_NAV_GROUPS
      : agentOnly
        ? AGENT_NAV_GROUPS
        : NAV_GROUPS;
  const groups = sourceGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => (me ? allowedNav(me.role, i.href.split(/[?#]/, 1)[0] || i.href) : true)) }))
    .filter((g) => g.items.length > 0);

  useEffect(() => {
    for (const group of sourceGroups) {
      if (group.items.some((item) => isActive(pathname, item.href))) {
        setOpenGroups((prev) => ({ ...prev, [group.id]: true }));
      }
    }
  }, [pathname, sourceGroups]);

  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const linkClass = (active: boolean) =>
    `nav-link flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1a2e] ${
      active
        ? "bg-violet-600/20 text-violet-300"
        : "text-slate-300 hover:bg-white/10 hover:text-white"
    }`;
  const financeHomeLinkClass =
    "nav-link mb-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:border-violet-400/50 hover:bg-violet-500/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1a2e]";

  const BrandIcon = systemOnly ? Settings2 : agentOnly ? Bot : BarChart3;
  const brandTitle = systemOnly ? "Настройки" : agentOnly ? "AI-агент" : "Финансы МП";
  const brandSubtitle = systemOnly
    ? "Кабинеты и доступы"
    : agentOnly
      ? "Инсайты и рекомендации"
      : financeOnly
        ? "Финансовый контур"
        : "WB Analytics & Finance";

  const renderNav = (expanded: boolean) => (
    <>
      <div className={`flex shrink-0 items-center border-b border-white/10 py-4 lg:py-6 ${expanded ? "gap-3 px-4" : "justify-center px-2"}`}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-600/25">
          <BrandIcon className="h-5 w-5 text-violet-400" />
        </div>
        {expanded ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{brandTitle}</p>
            <p className="truncate text-xs text-slate-400">{brandSubtitle}</p>
          </div>
        ) : null}
        <button
          className="tap ml-auto rounded-md text-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 md:hidden"
          onClick={() => setNavOpen(false)}
          aria-label="Закрыть меню"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Свернуть до иконок — на планшете это отдаёт таблицам 190px ширины,
          а на телефоне кнопка не нужна: там панель и так выезжает поверх. */}
      <div className={`hidden shrink-0 items-center border-b border-white/10 py-1.5 md:flex ${expanded ? "justify-between px-4" : "justify-center px-2"}`}>
        {expanded ? <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Разделы</span> : null}
        <button
          type="button"
          onClick={toggleRail}
          aria-label={expanded ? "Свернуть панель" : "Развернуть панель"}
          className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          {expanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {financeOnly ? (
          <Link
            href={DASHBOARD.href}
            onClick={() => setNavOpen(false)}
            className={expanded ? financeHomeLinkClass : `${financeHomeLinkClass} justify-center px-0`}
            aria-label="Вернуться на главную страницу"
            title="На главную"
          >
            <DASHBOARD.icon className="h-5 w-5 shrink-0 text-violet-300" />
            {expanded ? "На главную" : null}
          </Link>
        ) : (
          <Link
            href={DASHBOARD.href}
            onClick={() => setNavOpen(false)}
            className={`${linkClass(isActive(pathname, DASHBOARD.href))} ${expanded ? "" : "justify-center"}`}
            aria-current={isActive(pathname, DASHBOARD.href) ? "page" : undefined}
            aria-label={DASHBOARD.label}
            title={DASHBOARD.label}
          >
            <DASHBOARD.icon className="h-5 w-5 shrink-0" />
            {expanded ? DASHBOARD.label : null}
          </Link>
        )}

        {groups.map((group) => {
          const groupActive = group.items.some((item) =>
            isActive(pathname, item.href),
          );
          const groupOpen = openGroups[group.id] ?? false;

          if (!expanded) {
            return (
              <div key={group.id} className="pt-2">
                <div className="mx-3 mb-1 border-t border-white/10" />
                <div className="space-y-0.5">
                  {group.items.map(({ href, label, icon: Icon }) => {
                    const active = isActive(pathname, href);
                    return (
                      <Link
                        key={href}
                        href={href}
                        onClick={() => setNavOpen(false)}
                        className={`${linkClass(active)} justify-center`}
                        aria-current={active ? "page" : undefined}
                        aria-label={label}
                        title={label}
                      >
                        <Icon className="h-[18px] w-[18px] shrink-0" />
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          }

          return (
            <div key={group.id} className="pt-2">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                aria-expanded={groupOpen}
                className={`nav-group-toggle flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                  groupActive ? "text-violet-400" : "text-slate-500"
                } hover:text-slate-300`}
              >
                <span>{group.label}</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${groupOpen ? "rotate-180" : ""}`}
                />
              </button>
              {groupOpen && (
                <div className="mt-1 space-y-0.5 pl-1">
                  {group.items.map(({ href, label, icon: Icon }) => {
                    const active = isActive(pathname, href);
                    return (
                      <Link
                        key={href}
                        href={href}
                        onClick={() => setNavOpen(false)}
                        className={linkClass(active)}
                        aria-current={active ? "page" : undefined}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Пользователь + выход */}
      <div className="shrink-0 border-t border-white/10 p-3 pb-[calc(0.75rem+var(--safe-b))]">
        {me ? (
          <div className={`flex items-center gap-2 ${expanded ? "" : "flex-col"}`}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600/30 text-xs font-bold text-violet-200">
              {me.email.slice(0, 2).toUpperCase()}
            </div>
            {expanded ? (
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-white">{me.email}</div>
                <div className="text-[10px] text-slate-400">{ROLE_LABEL[me.role]}</div>
              </div>
            ) : null}
            <button onClick={logout} title="Выйти" aria-label="Выйти" className="tap shrink-0 rounded-md text-slate-400 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="h-8 animate-pulse rounded bg-white/5" />
        )}
      </div>
    </>
  );

  // Текущий раздел — для заголовка верхней панели: с телефона по одному
  // содержимому не всегда понятно, где ты находишься.
  const currentLabel =
    sourceGroups.flatMap((g) => g.items).find((i) => isActive(pathname, i.href))?.label
    ?? (isActive(pathname, DASHBOARD.href) ? DASHBOARD.label : brandTitle);

  // Нижняя навигация: четыре ежедневных адреса плюс вход в полное меню.
  // Список фильтруется теми же правами, что и боковая панель, — пункт, на
  // который человеку ответят отказом, показывать нельзя.
  const quickNav = [
    { href: "/", label: "Главная", icon: LayoutDashboard },
    { href: "/calendar", label: "Календарь", icon: Calendar },
    { href: "/payments", label: "Платежи", icon: CreditCard },
    { href: "/warehouse", label: "Склад", icon: Boxes },
  ].filter((item) => (me ? allowedNav(me.role, item.href) : true));

  return (
    <>
      {/* ── Верхняя панель: только телефон и узкое окно ──
          Раньше здесь висела круглая кнопка меню поверх содержимого — она
          перекрывала первую строку экрана и не говорила, где ты находишься.
          Панель занимает те же 54px, но несёт название раздела и выход. */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-[calc(54px+var(--safe-t))] items-center gap-2 border-b border-white/10 bg-[#1a1a2e] px-2 pt-safe md:hidden">
        <button
          type="button"
          className="tap rounded-lg text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          onClick={() => setNavOpen(true)}
          aria-label="Открыть меню"
          aria-expanded={navOpen}
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{currentLabel}</span>
        {me ? (
          <button
            type="button"
            onClick={logout}
            className="tap rounded-lg text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            aria-label="Выйти"
          >
            <LogOut className="h-4 w-4" />
          </button>
        ) : null}
      </header>

      {navOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Боковая панель ──
          На телефоне выезжает поверх содержимого, с планшета (768px, сюда
          попадает iPad Pro 11" в портрете) стоит постоянно и сворачивается
          до иконок. Ширина в развёрнутом виде на планшете уже, чем на
          десктопе: 834px — это не 1440, и 256px там стоят слишком дорого. */}
      <aside
        ref={asideRef}
        role={navOpen ? "dialog" : undefined}
        aria-modal={navOpen || undefined}
        aria-label="Навигация"
        /* Два разных режима, разведённых по взаимоисключающим брейкпоинтам.
           На телефоне панель выезжает поверх содержимого (fixed), с планшета —
           становится обычным элементом потока (sticky), и её ширину вычитает из
           основной области сам флексбокс. Это не украшение: пока панель была
           fixed на всех ширинах, ширину приходилось дублировать отступом
           основной области, и две величины разъезжались при каждой правке.
           Теперь дублировать нечего.

           Пары max-md/md здесь потому, что режимы отличаются САМИМ СПОСОБОМ
           позиционирования (fixed против sticky), а не величиной одного
           свойства: перечислить их взаимоисключающими вариантами честнее, чем
           переопределять базовый класс. */
        className={`z-50 flex flex-col bg-[#1a1a2e] transition-transform duration-200
          max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:w-72
          ${navOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full"}
          md:sticky md:top-0 md:h-dvh md:shrink-0
          ${railExpanded ? "md:w-56 lg:w-64" : "md:w-[60px]"}`}
      >
        {/* Одно дерево навигации, а не два. Раньше здесь стояли две копии —
            телефонная с подписями и десктопная, — и 27 ссылок висели в DOM
            дважды на каждой странице финансового контура.

            Различие сводилось к одному флагу, и его можно вывести без второй
            копии: выезжающее меню показывается только когда navOpen, и там
            подписи нужны всегда; на планшете и шире navOpen ложно, и вид
            решает railExpanded. */}
        <div className="flex min-h-0 flex-1 flex-col">{renderNav(navOpen || railExpanded)}</div>
      </aside>

      {/* ── Нижняя навигация: ежедневные адреса в один палец ──
          Полное меню — 27 пунктов, и лезть за календарём в выезжающую панель
          по десять раз на дню слишком дорого. */}
      {quickNav.length > 0 ? (
        <nav
          aria-label="Быстрая навигация"
          className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(3.5rem+var(--safe-b))] items-start justify-around border-t border-slate-200 bg-white pb-safe md:hidden"
        >
          {quickNav.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex h-14 min-w-14 flex-1 flex-col items-center justify-center gap-1 px-1 text-[10px] leading-tight ${
                  active ? "font-semibold text-violet-700" : "text-slate-500"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" />
                <span className="max-w-full truncate">{label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="flex h-14 min-w-14 flex-1 flex-col items-center justify-center gap-1 px-1 text-[10px] leading-tight text-slate-500"
            aria-label="Все разделы"
          >
            <MoreHorizontal className="h-[18px] w-[18px]" />
            <span>Ещё</span>
          </button>
        </nav>
      ) : null}
    </>
  );
}
