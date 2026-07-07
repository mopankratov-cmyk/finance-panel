"use client";

import {
  BarChart3, Bot, Coins, LineChart, Megaphone,
  Package, TrendingDown, Wallet, Building2, ArrowUpRight, LogOut, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { canAccess, ROLE_LABEL } from "@/lib/auth/roles";
import type { Role } from "@/lib/auth/session";

interface ModuleCard {
  title: string; description: string; href: string; icon: LucideIcon; agent?: string;
  zone: "Аналитика" | "Финансы" | "Операции" | "AI";
  color: [string, string]; // [bg, text]
}

const MODULES: ModuleCard[] = [
  { title: "Реклама WB", description: "Активные РК, расход по SKU, ДРР и баланс продвижения", href: "/adverts", icon: Megaphone, agent: "Андер", zone: "Аналитика", color: ["bg-violet-100", "text-violet-700"] },
  { title: "Ozon Аналитика", description: "РНП, воронка, юнит, остатки, удержания", href: "/ozon", icon: BarChart3, agent: "Озар", zone: "Аналитика", color: ["bg-sky-100", "text-sky-700"] },

  { title: "Финансы", description: "Календарь ДДС, платежи, счета, кредиты", href: "/calendar", icon: Wallet, agent: "Нано", zone: "Финансы", color: ["bg-emerald-100", "text-emerald-700"] },
  { title: "ОПиУ WB+Ozon", description: "P&L до СПП + соинвест, маржа, налог", href: "/pnl", icon: LineChart, zone: "Финансы", color: ["bg-blue-100", "text-blue-700"] },
  { title: "Где теряем", description: "Удержания: реклама, логистика, комиссия", href: "/losses", icon: TrendingDown, zone: "Финансы", color: ["bg-rose-100", "text-rose-700"] },

  { title: "Закупки", description: "План поставок, потребность, локализация", href: "/supplies", icon: Package, agent: "Саму", zone: "Операции", color: ["bg-cyan-100", "text-cyan-700"] },
  { title: "Себестоимость", description: "Себес по артикулам — питает маржу", href: "/costs", icon: Coins, zone: "Операции", color: ["bg-amber-100", "text-amber-700"] },
  { title: "Кабинеты", description: "Подключение WB и Ozon аккаунтов", href: "/cabinets", icon: Building2, zone: "Операции", color: ["bg-slate-100", "text-slate-700"] },

  { title: "AI-агент", description: "Анализ данных, аномалии, рекомендации", href: "/agent", icon: Bot, agent: "Мэнси", zone: "AI", color: ["bg-fuchsia-100", "text-fuchsia-700"] },
];

const ZONES = ["Аналитика", "Финансы", "Операции", "AI"] as const;

function Card({ m, badge }: { m: ModuleCard; badge?: number }) {
  const Icon = m.icon;
  return (
    <div className="group relative flex h-full cursor-pointer flex-col rounded-2xl border border-gray-200 bg-white p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-[0_10px_30px_rgba(30,64,175,0.10)]">
      <div className="mb-3 flex items-start justify-between">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${m.color[0]} ${m.color[1]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex items-center gap-2">
          {badge != null && badge > 0 && (
            <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-bold text-white">{badge}</span>
          )}
          <ArrowUpRight className="h-4 w-4 text-gray-300 transition-colors group-hover:text-blue-500" />
        </div>
      </div>
      <div className="text-base font-bold tracking-tight text-gray-900">{m.title}</div>
      <div className="mt-1 flex-1 text-sm leading-snug text-gray-500">{m.description}</div>
      {m.agent && <div className="mt-3 text-[11px] font-medium text-gray-400">Агент: {m.agent}</div>}
    </div>
  );
}

export function ModulesHome() {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [me, setMe] = useState<{ email: string; role: Role } | null>(null);

  useEffect(() => {
    fetch("/api/agent/insights", { cache: "no-store" }).then((r) => r.json()).then((j) => setUnread(j.unread ?? 0)).catch(() => {});
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((j) => setMe(j.user)).catch(() => {});
  }, []);

  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }).catch(() => {}); router.push("/login"); router.refresh(); };
  const visible = MODULES.filter((m) => !me || m.href.startsWith("http") || canAccess(me.role, m.href));

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-gray-900">
      {/* Шапка */}
      <header className="border-b border-gray-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-sm font-extrabold text-white shadow-sm">MP</div>
            <div>
              <div className="text-base font-extrabold tracking-tight">Управление маркетплейсами</div>
              <div className="text-xs text-gray-500">WB + Ozon · аналитика и финансы</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-xs text-gray-500 sm:flex"><span className="h-2 w-2 rounded-full bg-emerald-400" /> система работает</span>
            {me && (
              <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white py-1 pl-1 pr-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">{me.email.slice(0, 2).toUpperCase()}</span>
                <div className="hidden leading-tight sm:block"><div className="text-xs font-semibold">{me.email.split("@")[0]}</div><div className="text-[10px] text-gray-400">{ROLE_LABEL[me.role]}</div></div>
                <button onClick={logout} title="Выйти" className="ml-1 text-gray-400 hover:text-gray-700"><LogOut className="h-4 w-4" /></button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="border-b border-gray-200 bg-gradient-to-br from-blue-600 to-indigo-700">
        <div className="mx-auto max-w-6xl px-6 py-8 text-white">
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Добро пожаловать{me ? `, ${me.email.split("@")[0]}` : ""}</h1>
          <p className="mt-1 text-sm text-blue-100">Выберите модуль. Все цифры — на цене до СПП, с реальной комиссией и удержаниями.</p>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {ZONES.map((zone) => {
          const items = visible.filter((m) => m.zone === zone);
          if (!items.length) return null;
          return (
            <section key={zone} className="mb-8">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">{zone}</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((m) => {
                  const inner = <Card m={m} badge={m.title === "AI-агент" ? unread : undefined} />;
                  return m.href.startsWith("http")
                    ? <a key={m.title} href={m.href} target="_blank" rel="noreferrer">{inner}</a>
                    : <Link key={m.title} href={m.href}>{inner}</Link>;
                })}
              </div>
            </section>
          );
        })}
      </main>

      <footer className="mx-auto max-w-6xl border-t border-gray-200 px-6 py-6 text-xs text-gray-400">
        Финансы МП · WB + Ozon · команда AI-агентов
      </footer>
    </div>
  );
}
