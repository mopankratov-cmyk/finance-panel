"use client";

import {
  BarChart3,
  Bot,
  Calculator,
  FlaskConical,
  Megaphone,
  Package,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

interface ModuleCard {
  title: string;
  description: string;
  href: string | null;
  icon: LucideIcon;
  agent: string;
  status: "active" | "soon";
  /** tailwind-цвета иконки: [bg, text] */
  color: [string, string];
}

const MODULES: ModuleCard[] = [
  { title: "Финансы", description: "Календарь ДДС, платежи, счета, кредиты, ОПиУ", href: "/calendar", icon: Wallet, agent: "Нано", status: "active", color: ["bg-emerald-100", "text-emerald-700"] },
  { title: "WB Аналитика", description: "РНП, воронка, остатки, оборачиваемость, продажи", href: "/inferno/wb.html", icon: BarChart3, agent: "Андер", status: "active", color: ["bg-purple-100", "text-purple-700"] },
  { title: "Ozon Аналитика", description: "Воронка, юнит-экономика, остатки, удержания", href: "/ozon", icon: BarChart3, agent: "Озар", status: "active", color: ["bg-sky-100", "text-sky-700"] },
  { title: "Реклама", description: "Кампании, ставки, CTR/CPC, анализ ДРР", href: "/inferno/wb.html", icon: Megaphone, agent: "Патрик", status: "active", color: ["bg-orange-100", "text-orange-700"] },
  { title: "Закупки", description: "План поставок по складам, потребность, мин. партии", href: "/supplies", icon: Package, agent: "Саму", status: "active", color: ["bg-cyan-100", "text-cyan-700"] },
  { title: "Юнит-экономика", description: "Калькулятор цены, маржа, себестоимость по SKU", href: "/inferno/wb.html", icon: Calculator, agent: "Гусман", status: "active", color: ["bg-violet-100", "text-violet-700"] },
  { title: "AI-агент", description: "Анализ данных, поиск аномалий, рекомендации", href: "/agent", icon: Bot, agent: "Мэнси", status: "active", color: ["bg-rose-100", "text-rose-700"] },
  { title: "Контент-лаборатория", description: "AI-генерация текста, фото и видео карточек", href: "/content", icon: FlaskConical, agent: "Лекси", status: "active", color: ["bg-amber-100", "text-amber-700"] },
];

function Card({ m, badge }: { m: ModuleCard; badge?: number }) {
  const Icon = m.icon;
  const active = m.status === "active";
  return (
    <div
      className={`mod block rounded-xl border border-gray-200 bg-white p-6 transition-shadow hover:shadow-[0_12px_32px_rgba(0,0,0,0.10)] ${
        active ? "cursor-pointer" : "cursor-not-allowed opacity-55"
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg font-bold ${m.color[0]} ${m.color[1]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex items-center gap-2">
          {badge != null && badge > 0 && (
            <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white">{badge}</span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
            }`}
          >
            {active ? "активен" : "скоро"}
          </span>
        </div>
      </div>
      <div className="mb-1 text-lg font-bold text-gray-900">{m.title}</div>
      <div className="mb-3 text-sm text-gray-500">{m.description}</div>
      <div className="text-xs text-gray-400">Агент: {m.agent}</div>
    </div>
  );
}

export function ModulesHome() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    fetch("/api/agent/insights", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setUnread(j.unread ?? 0))
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Шапка */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-to-br from-purple-600 to-purple-900 text-sm font-extrabold text-white">
              WB
            </div>
            <div>
              <div className="text-lg font-extrabold tracking-tight">Управление WB</div>
              <div className="text-xs text-gray-500">платформа управления маркетплейсом</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className="h-2 w-2 rounded-full bg-green-400" />
            <span>система работает</span>
          </div>
        </div>
      </header>

      {/* Модули */}
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="mb-2 text-3xl font-extrabold tracking-tight">Модули</h1>
        <p className="mb-8 text-gray-500">Каждый модуль — отдельный AI-агент с собственной зоной.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => {
            if (!m.href) return <div key={m.title}><Card m={m} /></div>;
            const inner = <Card m={m} badge={m.title === "AI-агент" ? unread : undefined} />;
            // статические файлы из public (/inferno/*) — обычной ссылкой, не Next Link
            return m.href.startsWith("/inferno/") ? (
              <a key={m.title} href={m.href}>{inner}</a>
            ) : (
              <Link key={m.title} href={m.href}>{inner}</Link>
            );
          })}
        </div>
      </main>

      <footer className="mx-auto mt-12 max-w-6xl border-t border-gray-200 px-6 py-8 text-xs text-gray-400">
        Система управления WB · команда AI-агентов
      </footer>
    </div>
  );
}
