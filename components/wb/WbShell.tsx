"use client";

import {
  BarChart3,
  Calculator,
  ChartNoAxesCombined,
  ChevronRight,
  Clapperboard,
  Filter,
  FlaskConical,
  Home,
  HeartPulse,
  Link2,
  LogOut,
  KanbanSquare,
  Megaphone,
  MessageSquareText,
  PackageSearch,
  Search,
  Settings,
  Sparkles,
  Target,
  Truck,
  TrendingUp,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  WB_MOBILE_NAVIGATION,
  WB_NAVIGATION_SCENARIOS,
  isWbNavigationItemActive,
  type WbNavigationScenario,
} from "@/lib/wb/navigation";
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
  "/wb/funnel": Filter,
  "/wb/planning": Target,
  "/wb/tasks": KanbanSquare,
  "/wb/health": HeartPulse,
  "/wb/unit": Calculator,
  "/wb/seo": Search,
  "/wb/sklejki": Link2,
  "/wb/adverts": Megaphone,
  "/wb/ctr": FlaskConical,
  "/wb/ugc": Clapperboard,
  "/wb/abc": BarChart3,
  "/wb/trends": TrendingUp,
  "/wb/market": ChartNoAxesCombined,
  "/wb/supplies": Truck,
  "/wb/product": PackageSearch,
  "/wb/reviews": MessageSquareText,
};

const SCENARIO_ICONS: Record<WbNavigationScenario["id"], IconComponent> = {
  sales: BarChart3,
  operations: Truck,
  product: PackageSearch,
  experiments: FlaskConical,
  analytics: ChartNoAxesCombined,
};

const WORK_GROUPS = WB_NAVIGATION_SCENARIOS.map((scenario) => ({
  ...scenario,
  icon: SCENARIO_ICONS[scenario.id],
  items: scenario.items.map((item) => ({ ...item, icon: ITEM_ICONS[item.href] ?? BarChart3, target: true })),
}));

const MOBILE_NAV = WB_MOBILE_NAVIGATION.map((item) => ({ ...item, icon: ITEM_ICONS[item.href] ?? BarChart3, target: true }));

const SYSTEM_NAV: NavItem[] = [
  { label: "Главная", href: "/", icon: Home },
  { label: "Кабинеты", href: "/cabinets", icon: Settings },
  { label: "Сотрудники", href: "/users", icon: Users },
];

function RailLink({ item, active, cabinetId }: { item: NavItem; active: boolean; cabinetId: string }) {
  const Icon = item.icon;
  const href = item.target ? `${item.href}?cabinet=${encodeURIComponent(cabinetId)}` : item.href;
  return (
    <Link
      href={href}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      title={item.label}
      className={`group relative mx-2 flex h-11 items-center justify-center rounded-[9px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 md:h-9 ${
        active ? "bg-violet-50 text-violet-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
      }`}
    >
      {active && <span className="absolute -left-2 h-6 w-[3px] rounded-r bg-violet-600" />}
      <Icon className="h-[17px] w-[17px]" />
      <span className="pointer-events-none absolute left-[43px] z-[90] hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white shadow-lg group-hover:block group-focus-visible:block">
        {item.label}
      </span>
    </Link>
  );
}

function ScenarioMenu({
  scenario,
  active,
  open,
  pathname,
  cabinetId,
  onOpen,
  onClose,
}: {
  scenario: (typeof WORK_GROUPS)[number];
  active: boolean;
  open: boolean;
  pathname: string;
  cabinetId: string;
  onOpen: () => void;
  onClose: () => void;
}) {
  const Icon = scenario.icon;
  const menuId = `wb-scenario-${scenario.id}`;
  return (
    <div className="relative" onMouseEnter={onOpen} onMouseLeave={onClose}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={scenario.label}
        aria-current={active ? "page" : undefined}
        aria-expanded={open}
        aria-controls={menuId}
        title={scenario.label}
        className={`group relative mx-2 flex h-11 w-[39px] items-center justify-center rounded-[9px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 md:h-9 ${
          active || open ? "bg-violet-50 text-violet-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
        }`}
      >
        {active && <span className="absolute -left-2 h-6 w-[3px] rounded-r bg-violet-600" />}
        <Icon className="h-[17px] w-[17px]" />
        {!open && <span className="pointer-events-none absolute left-[43px] z-[90] hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white shadow-lg group-hover:block group-focus-visible:block">{scenario.label}</span>}
      </button>
      {open ? (
        <div id={menuId} className="absolute left-full top-0 z-[95] ml-1 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 px-3 py-3">
            <div className="text-xs font-bold text-slate-800">{scenario.label}</div>
            <div className="mt-1 text-[10px] leading-4 text-slate-400">{scenario.description}</div>
          </div>
          <div className="p-1.5">
            {scenario.items.map((item) => {
              const ItemIcon = item.icon;
              const itemActive = isWbNavigationItemActive(pathname, item.href);
              const href = `${item.href}?cabinet=${encodeURIComponent(cabinetId)}`;
              return (
                <Link key={item.href} href={href} onClick={onClose} aria-current={itemActive ? "page" : undefined} className={`flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-xs font-medium transition-colors ${itemActive ? "bg-violet-50 text-violet-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}>
                  <ItemIcon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function WbShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { cabinetId, user } = useWbCabinet();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openScenario, setOpenScenario] = useState<WbNavigationScenario["id"] | null>(null);

  useEffect(() => {
    setMenuOpen(false);
    setOpenScenario(null);
  }, [pathname]);

  const initials = useMemo(() => {
    const email = user?.email ?? "";
    return email ? email.slice(0, 2).toUpperCase() : "WB";
  }, [user?.email]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/login");
    router.refresh();
  };

  const nav = (
    <>
      <div className="flex h-[54px] shrink-0 items-center justify-center border-b border-slate-200">
        <Link
          href="/"
          aria-label="Управление WB"
          className="grid h-7 w-7 place-items-center rounded-[9px] bg-gradient-to-br from-violet-500 to-violet-800 text-[10px] font-black text-white shadow-sm"
        >
          WB
        </Link>
      </div>

      <div className="flex h-[58px] shrink-0 items-center justify-center border-b border-slate-200">
        <button
          type="button"
          onClick={() => setMenuOpen(false)}
          aria-label="Свернуть навигацию"
          className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <nav aria-label="Инструменты Wildberries" className="flex-1 overflow-visible py-2">
        <div className="space-y-0.5">
          {WORK_GROUPS.map((scenario) => (
            <ScenarioMenu
              key={scenario.id}
              scenario={scenario}
              pathname={pathname}
              cabinetId={cabinetId || "all"}
              active={scenario.items.some((item) => isWbNavigationItemActive(pathname, item.href))}
              open={openScenario === scenario.id}
              onOpen={() => setOpenScenario(scenario.id)}
              onClose={() => setOpenScenario(null)}
            />
          ))}
        </div>
        <div className="mx-3 my-2 border-t border-slate-200" />
        <div className="space-y-0.5">
          {SYSTEM_NAV.map((item) => (
            <RailLink
              key={`${item.label}-${item.href}`}
              item={item}
              cabinetId={cabinetId || "all"}
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
    <div className="min-h-screen bg-[#f6f7f9] text-slate-800">
      <aside className="fixed inset-y-0 left-0 z-[70] hidden w-[55px] flex-col border-r border-slate-200 bg-white md:flex">
        {nav}
      </aside>

      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="Закрыть меню"
            className="fixed inset-0 z-[69] bg-slate-950/25 md:hidden"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-[70] flex w-[55px] flex-col border-r border-slate-200 bg-white md:hidden">
            {nav}
          </aside>
        </>
      )}

      <header className="fixed left-0 right-0 top-0 z-[60] flex h-[54px] items-center border-b border-slate-200 bg-white px-3 md:left-[55px] md:px-5">
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
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700 sm:h-8 sm:w-8"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <main className="min-h-screen pt-[54px] md:ml-[55px]">{children}</main>

      <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-14 items-center justify-around border-t border-slate-200 bg-white md:hidden" aria-label="Быстрая навигация">
        {MOBILE_NAV.map((item) => {
          const Icon = item.icon;
          const href = item.target ? `${item.href}?cabinet=${encodeURIComponent(cabinetId || "all")}` : item.href;
          const active = isWbNavigationItemActive(pathname, item.href);
          return (
            <Link key={item.label} href={href} aria-current={active ? "page" : undefined} className={`flex h-full min-w-14 flex-col items-center justify-center gap-0.5 text-[9px] ${active ? "text-violet-700" : "text-slate-400"}`}>
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
