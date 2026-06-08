"use client";

import {
  LayoutDashboard,
  Wallet,
  Calendar,
  CreditCard,
  Landmark,
  Menu,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV_ITEMS = [
  { href: "/", label: "Дашборд", icon: LayoutDashboard },
  { href: "/accounts", label: "Счета", icon: Wallet },
  { href: "/calendar", label: "Календарь", icon: Calendar },
  { href: "/payments", label: "Платежи", icon: CreditCard },
  { href: "/loans", label: "Кредиты", icon: Landmark },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = (
    <>
      <div className="flex items-center gap-3 px-4 py-6 border-b border-slate-700/50">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/20">
          <Wallet className="h-5 w-5 text-emerald-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Финансы МП</p>
          <p className="text-xs text-slate-400">Управление денежными потоками</p>
        </div>
        <button
          className="ml-auto lg:hidden text-slate-400 hover:text-white"
          onClick={() => setMobileOpen(false)}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );

  return (
    <>
      <button
        className="fixed top-4 left-4 z-40 lg:hidden flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800 text-white shadow-lg"
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
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-slate-900 transition-transform lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {nav}
      </aside>
    </>
  );
}
