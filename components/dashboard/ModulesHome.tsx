"use client";

import {
  Boxes,
  BarChart3, Bot, Coins, LineChart, Megaphone, Table2, Search, Layers, Sigma,
  FlaskConical,
  Package, TrendingDown, Wallet, Building2, ArrowUpRight, ChevronDown,
  LogOut, AlertTriangle, Info, XCircle, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { canAccess, ROLE_LABEL } from "@/lib/auth/roles";
import type { Role } from "@/lib/auth/session";
import { normalizeSeverity, type SeverityTier } from "@/lib/agent/severity";
import type { AgentInsight } from "@/app/api/agent/insights/route";
import { Tour, TourReplayButton, type TourStep } from "@/components/ui/Tour";

const SEVERITY_RANK: Record<SeverityTier, number> = { critical: 0, warning: 1, info: 2 };
const SEVERITY_ICON: Record<SeverityTier, LucideIcon> = { critical: XCircle, warning: AlertTriangle, info: Info };
const SEVERITY_COLOR: Record<SeverityTier, string> = { critical: "text-red-600", warning: "text-amber-600", info: "text-slate-400" };

interface ModuleCard {
  title: string; description: string; href: string; icon: LucideIcon; agent?: string;
  zone: "Аналитика" | "Финансы" | "Операции" | "AI";
  color: [string, string]; // [bg, text]
}

type Zone = "Аналитика" | "Финансы" | "Операции" | "AI";

const PRIMARY_MODULES: ModuleCard[] = [
  { title: "РНП WB", description: "Основной рабочий экран Wildberries: заказы, реклама, маржа и остатки по SKU", href: "/wb/rnp", icon: Table2, zone: "Аналитика", color: ["bg-violet-100", "text-violet-700"] },
  { title: "Ozon Cockpit", description: "Продажи, реклама, остатки, заказы и здоровье интеграций", href: "/ozon", icon: BarChart3, agent: "Озар", zone: "Аналитика", color: ["bg-sky-100", "text-sky-700"] },
  { title: "Финансы", description: "Календарь ДДС, платежи, счета и кредиты", href: "/calendar", icon: Wallet, agent: "Нано", zone: "Финансы", color: ["bg-emerald-100", "text-emerald-700"] },
  { title: "Склад", description: "Товары и себестоимость, приёмка, остатки и отгрузка на кабинеты", href: "/warehouse", icon: Boxes, agent: "Саму", zone: "Операции", color: ["bg-teal-100", "text-teal-700"] },
  { title: "Кабинеты", description: "Подключение WB и Ozon аккаунтов", href: "/cabinets", icon: Building2, zone: "Операции", color: ["bg-slate-100", "text-slate-700"] },
];

// v2 сбрасывает старое сохранённое раскрытие: после упрощения главная должна
// впервые открываться компактной даже у пользователей с состоянием v1.
const DISCLOSURE_STORAGE_KEY = "fp_dashboard_disclosure_v2";

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
  const [insights, setInsights] = useState<AgentInsight[]>([]);
  const [me, setMe] = useState<{ email: string; role: Role } | null>(null);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [disclosureReady, setDisclosureReady] = useState(false);

  useEffect(() => {
    fetch("/api/agent/insights?limit=50", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      setUnread(j.unread ?? 0);
      setInsights(j.data ?? []);
    }).catch(() => {});
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((j) => setMe(j.user)).catch(() => {});
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DISCLOSURE_STORAGE_KEY) || "{}") as { attention?: boolean };
      setAttentionOpen(Boolean(saved.attention));
    } catch {
      // Повреждённое локальное состояние не должно ломать главную страницу.
    }
    setDisclosureReady(true);
  }, []);

  useEffect(() => {
    if (!disclosureReady) return;
    try {
      localStorage.setItem(DISCLOSURE_STORAGE_KEY, JSON.stringify({ attention: attentionOpen }));
    } catch {
      // В приватном режиме состояние просто не запомнится.
    }
  }, [attentionOpen, disclosureReady]);

  // топ-5 непрочитанных, сначала критичные — компактный превью «что требует внимания»
  const attention = useMemo(() => {
    return insights
      .filter((i) => !i.is_read)
      .map((i) => ({ ...i, tier: normalizeSeverity(i.severity) }))
      .sort((a, b) => SEVERITY_RANK[a.tier] - SEVERITY_RANK[b.tier] || b.created_at.localeCompare(a.created_at))
      .slice(0, 5);
  }, [insights]);

  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }).catch(() => {}); router.push("/login"); router.refresh(); };
  const visiblePrimary = PRIMARY_MODULES.filter((m) => !me || canAccess(me.role, m.href));
  const tourSteps: TourStep[] = [
    ...(attention.length > 0 ? [{ selector: '[data-tour="attention"]', title: "Что требует внимания", text: "Топ-5 самых срочных сигналов из правил и WB-аналитики — критичные вверху. Клик открывает полный список в AI-агенте." }] : []),
    { selector: '[data-tour="modules"]', title: "Модули", text: "Основные кабинеты доступны сразу. Остальные инструменты сгруппированы в компактные раскрывающиеся разделы." },
    { selector: '[data-tour="user"]', title: "Ваш аккаунт", text: "Email и роль видны здесь же — тут и кнопка выхода." },
  ];

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
            <TourReplayButton tourId="dashboard" />
            {me && (
              <div data-tour="user" className="flex items-center gap-2 rounded-full border border-gray-200 bg-white py-1 pl-1 pr-2">
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
        {attention.length > 0 && (
          <details
            data-tour="attention"
            open={attentionOpen}
            onToggle={(event) => setAttentionOpen(event.currentTarget.open)}
            className="group mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-white"
          >
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 sm:px-5 [&::-webkit-details-marker]:hidden">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600"><AlertTriangle className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-gray-900">Что требует внимания</span>
                <span className="block truncate text-xs text-gray-500">{attention.length} непрочитанных сигналов · нажмите, чтобы посмотреть</span>
              </span>
              <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-bold text-white">{attention.length}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 motion-reduce:transition-none group-open:rotate-180" />
            </summary>
            {attentionOpen && (
              <div className="border-t border-gray-100 px-4 py-3 sm:px-5">
                <div className="mb-2 flex justify-end"><Link href="/agent" className="min-h-11 px-2 text-xs font-semibold text-blue-600 hover:underline sm:min-h-8">Все инсайты →</Link></div>
                <div className="space-y-1">
                  {attention.map((i) => {
                    const Icon = SEVERITY_ICON[i.tier];
                    return (
                      <Link key={i.id} href="/agent" className="-mx-2 flex min-h-11 items-start gap-2 rounded-lg p-2 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${SEVERITY_COLOR[i.tier]}`} />
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-gray-900">{i.title}</span><span className="block truncate text-xs text-gray-500">{i.body}</span></span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </details>
        )}

        <div data-tour="modules">
          <section className="mb-6">
            <div className="mb-3 flex items-end justify-between gap-4">
              <div><h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">Основное</h2><p className="mt-1 text-xs text-gray-500">Каждый модуль — отдельная рабочая зона</p></div>
              <span className="text-xs tabular-nums text-gray-400">{visiblePrimary.length} модулей</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visiblePrimary.map((module) => <Link key={module.href} href={module.href} className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"><Card m={module} /></Link>)}
            </div>
          </section>

        </div>
      </main>

      <footer className="mx-auto max-w-6xl border-t border-gray-200 px-6 py-6 text-xs text-gray-400">
        Финансы МП · WB + Ozon · команда AI-агентов
      </footer>

      <Tour tourId="dashboard" steps={tourSteps} />
    </div>
  );
}
