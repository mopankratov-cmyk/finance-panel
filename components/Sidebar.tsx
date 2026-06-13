"use client";

import {
  BarChart3,
  Bot,
  Building2,
  Calendar,
  FlaskConical,
  ChevronDown,
  CreditCard,
  Landmark,
  LayoutDashboard,
  LineChart,
  Menu,
  RefreshCw,
  Truck,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

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
    id: "finance",
    label: "Финансы",
    items: [
      { href: "/calendar", label: "Календарь", icon: Calendar },
      { href: "/payments", label: "Платежи", icon: CreditCard },
      { href: "/accounts", label: "Счета", icon: Wallet },
      { href: "/loans", label: "Кредиты", icon: Landmark },
      { href: "/opiu", label: "ОПиУ", icon: LineChart },
      { href: "/supplies", label: "Закупки", icon: Truck },
    ],
  },
  {
    id: "system",
    label: "Система",
    items: [
      { href: "/agent", label: "AI-агент", icon: Bot },
      { href: "/content", label: "Контент-лаб", icon: FlaskConical },
      { href: "/cabinets", label: "Кабинеты WB", icon: Building2 },
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    finance: true,
    system: true,
  });

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

        {NAV_GROUPS.map((group) => {
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
                  {group.items.map(({ href, label, icon: Icon }) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setMobileOpen(false)}
                      className={linkClass(isActive(pathname, href))}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
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
