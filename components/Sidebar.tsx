"use client";

import {
  BarChart3,
  Bot,
  Building2,
  Calendar,
  Coins,
  ChevronDown,
  CreditCard,
  Landmark,
  LayoutDashboard,
  LineChart,
  Menu,
  LogOut,
  PieChart,
  TrendingUp,
  RefreshCw,
  TrendingDown,
  Truck,
  Users,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { allowedNav, ROLE_LABEL } from "@/lib/auth/roles";
import type { Role } from "@/lib/auth/session";

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
      { href: "/inferno/wb.html", label: "WB Аналитика", icon: BarChart3 },
      { href: "/ozon", label: "Ozon Аналитика", icon: BarChart3 },
      { href: "/abc", label: "ABC прибыли", icon: PieChart },
      { href: "/trends", label: "Динамика", icon: TrendingUp },
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
    ],
  },
  {
    id: "operations",
    label: "Операции",
    items: [
      { href: "/supplies", label: "Закупки", icon: Truck },
      { href: "/costs", label: "Себестоимость", icon: Coins },
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

const DASHBOARD: NavLink = {
  href: "/",
  label: "Дашборд",
  icon: LayoutDashboard,
};

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [me, setMe] = useState<{ email: string; role: Role } | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    analytics: true,
    finres: true,
    money: true,
    operations: true,
    system: true,
  });

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((j) => setMe(j.user)).catch(() => {});
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
    router.refresh();
  };

  // группы с фильтром по роли (пустые группы скрываем)
  const groups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => (me ? allowedNav(me.role, i.href) : true)) }))
    .filter((g) => g.items.length > 0);

  useEffect(() => {
    for (const group of NAV_GROUPS) {
      if (group.items.some((item) => isActive(pathname, item.href))) {
        setOpenGroups((prev) => ({ ...prev, [group.id]: true }));
      }
    }
  }, [pathname]);

  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const linkClass = (active: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      active
        ? "bg-violet-600/20 text-violet-300"
        : "text-slate-300 hover:bg-white/10 hover:text-white"
    }`;

  const nav = (
    <>
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600/25">
          <BarChart3 className="h-5 w-5 text-violet-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Финансы МП</p>
          <p className="text-xs text-slate-400">WB Analytics & Finance</p>
        </div>
        <button
          className="ml-auto text-slate-400 hover:text-white lg:hidden"
          onClick={() => setMobileOpen(false)}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        <Link
          href={DASHBOARD.href}
          onClick={() => setMobileOpen(false)}
          className={linkClass(isActive(pathname, DASHBOARD.href))}
        >
          <DASHBOARD.icon className="h-5 w-5 shrink-0" />
          {DASHBOARD.label}
        </Link>

        {groups.map((group) => {
          const groupActive = group.items.some((item) =>
            isActive(pathname, item.href),
          );
          const expanded = openGroups[group.id] ?? false;

          return (
            <div key={group.id} className="pt-2">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  groupActive ? "text-violet-400" : "text-slate-500"
                } hover:text-slate-300`}
              >
                <span>{group.label}</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              </button>
              {expanded && (
                <div className="mt-1 space-y-0.5 pl-1">
                  {group.items.map(({ href, label, icon: Icon }) =>
                    href.startsWith("/inferno/") ? (
                      <a key={href} href={href} className={linkClass(false)}>
                        <Icon className="h-4 w-4 shrink-0" />
                        {label}
                      </a>
                    ) : (
                      <Link
                        key={href}
                        href={href}
                        onClick={() => setMobileOpen(false)}
                        className={linkClass(isActive(pathname, href))}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {label}
                      </Link>
                    ),
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Пользователь + выход */}
      <div className="border-t border-white/10 p-3">
        {me ? (
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600/30 text-xs font-bold text-violet-200">
              {me.email.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-white">{me.email}</div>
              <div className="text-[10px] text-slate-400">{ROLE_LABEL[me.role]}</div>
            </div>
            <button onClick={logout} title="Выйти" className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="h-8 animate-pulse rounded bg-white/5" />
        )}
      </div>
    </>
  );

  return (
    <>
      <button
        className="fixed left-4 top-4 z-40 flex h-10 w-10 items-center justify-center rounded-lg bg-[#1a1a2e] text-white shadow-lg lg:hidden"
        onClick={() => setMobileOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </button>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-[#1a1a2e] transition-transform lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {nav}
      </aside>
    </>
  );
}
