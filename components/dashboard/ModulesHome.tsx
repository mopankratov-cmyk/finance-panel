"use client";

import {
  BarChart3,
  Bot,
  Calculator,
  FlaskConical,
  Megaphone,
  Truck,
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
  status: "active" | "soon";
}

const MODULES: ModuleCard[] = [
  {
    title: "Финансы",
    description: "Календарь ДДС, платежи, счета, кредиты, ОПиУ",
    href: "/calendar",
    icon: Wallet,
    status: "active",
  },
  {
    title: "WB Аналитика",
    description: "РНП, продажи, воронка, остатки, оборачиваемость",
    href: "/analytics/rnp",
    icon: BarChart3,
    status: "active",
  },
  {
    title: "Реклама",
    description: "Кампании, ставки, CTR/CPC, анализ ДРР",
    href: "/analytics/ads",
    icon: Megaphone,
    status: "active",
  },
  {
    title: "Закупки",
    description: "План поставок по складам, потребность, мин. партии",
    href: "/supplies",
    icon: Truck,
    status: "active",
  },
  {
    title: "Юнит-экономика",
    description: "Калькулятор цены, маржа, себестоимость по SKU",
    href: "/unit",
    icon: Calculator,
    status: "active",
  },
  {
    title: "AI-агент",
    description: "Анализ данных, поиск аномалий, рекомендации",
    href: "/agent",
    icon: Bot,
    status: "active",
  },
  {
    title: "Контент-лаборатория",
    description: "AI-генерация текста карточек, A/B заголовки",
    href: "/content",
    icon: FlaskConical,
    status: "active",
  },
];

function CardInner({ module: m, badge }: { module: ModuleCard; badge?: number }) {
  const Icon = m.icon;
  const active = m.status === "active";
  return (
    <div
      className={`flex h-full flex-col rounded-xl border bg-white p-5 transition-shadow ${
        active
          ? "border-slate-200 hover:shadow-md hover:border-violet-300"
          : "border-slate-100 opacity-60"
      }`}
    >
      <div className="flex items-start justify-between">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-lg ${
            active ? "bg-violet-500/10" : "bg-slate-100"
          }`}
        >
          <Icon className={`h-5 w-5 ${active ? "text-violet-600" : "text-slate-400"}`} />
        </div>
        <div className="flex items-center gap-2">
          {badge != null && badge > 0 && (
            <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white">
              {badge}
            </span>
          )}
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              active
                ? "bg-emerald-50 text-emerald-600"
                : "bg-slate-100 text-slate-400"
            }`}
          >
            {active ? "Активен" : "Скоро"}
          </span>
        </div>
      </div>
      <h3 className="mt-4 font-semibold text-slate-900">{m.title}</h3>
      <p className="mt-1 text-sm text-slate-500">{m.description}</p>
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
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">
          Система управления WB
        </h1>
        <p className="mt-2 text-slate-500">
          Финансы, аналитика, реклама и закупки маркетплейс-бизнеса — в одном
          месте
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((m) =>
          m.href ? (
            <Link key={m.title} href={m.href}>
              <CardInner module={m} badge={m.title === "AI-агент" ? unread : undefined} />
            </Link>
          ) : (
            <div key={m.title}>
              <CardInner module={m} />
            </div>
          ),
        )}
      </div>
    </div>
  );
}
