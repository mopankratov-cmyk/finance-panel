"use client";

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Gauge,
  LineChart,
  Megaphone,
  PackageSearch,
  RefreshCw,
  Sparkles,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LoadingBanner, SkeletonCards, useElapsedSeconds } from "@/components/ui/LoadingState";
import { readApiResponse } from "@/lib/http/readApiResponse";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

type SignalSeverity = "info" | "warn" | "danger";

interface SignalItem {
  nm: number;
  article: string;
  signal: string;
  severity: SignalSeverity;
  reason: string;
  metrics: {
    opens?: number;
    carts?: number;
    orders?: number;
    ordersCountMonth?: number;
    stock?: number;
    turnoverDays?: number | null;
    drr?: number | null;
    marginPct?: number | null;
  };
}

interface SignalsData {
  window?: number;
  count?: number;
  summary?: Record<string, number>;
  items?: SignalItem[];
  error?: string;
}

const SEVERITY_WEIGHT: Record<SignalSeverity, number> = {
  danger: 3,
  warn: 2,
  info: 1,
};

const SIGNAL_WEIGHT: Record<string, number> = {
  Остатки: 60,
  Маржа: 50,
  ДРР: 40,
  Контент: 30,
  Конкуренты: 20,
  Реклама: 10,
};

const SIGNAL_TONE: Record<SignalSeverity, string> = {
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  warn: "border-amber-200 bg-amber-50 text-amber-700",
  info: "border-sky-200 bg-sky-50 text-sky-700",
};

const SIGNAL_LABEL: Record<SignalSeverity, string> = {
  danger: "критично",
  warn: "важно",
  info: "наблюдать",
};

function cabinetParam(cabinetId: string) {
  return `cabinet=${encodeURIComponent(cabinetId || "all")}`;
}

function hrefWithCabinet(path: string, cabinetId: string) {
  return `${path}?${cabinetParam(cabinetId)}`;
}

function hrefForSignal(signal: string, cabinetId: string) {
  if (signal === "Остатки") return hrefWithCabinet("/wb/supplies", cabinetId);
  if (signal === "Маржа") return hrefWithCabinet("/wb/unit", cabinetId);
  if (signal === "ДРР" || signal === "Реклама") return hrefWithCabinet("/wb/adverts", cabinetId);
  if (signal === "Контент") return hrefWithCabinet("/wb/product", cabinetId);
  if (signal === "Конкуренты") return hrefWithCabinet("/wb/market", cabinetId);
  return hrefWithCabinet("/wb/rnp", cabinetId);
}

function formatMetric(value: number | null | undefined, suffix = "") {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value)}${suffix}`;
}

function AttentionCard({ item, cabinetId }: { item: SignalItem; cabinetId: string }) {
  return (
    <Link
      href={hrefForSignal(item.signal, cabinetId)}
      className="group block rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
    >
      <div className="flex items-start gap-3">
        <span className={`shrink-0 rounded-xl border px-2 py-1 text-[10px] font-bold uppercase ${SIGNAL_TONE[item.severity]}`}>
          {SIGNAL_LABEL[item.severity]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-bold text-slate-800">{item.article || `nm ${item.nm}`}</h3>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
              {item.signal}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{item.reason}</p>
        </div>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-violet-600" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-[11px] text-slate-500 sm:grid-cols-4">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Заказы</div>
          <div className="mt-0.5 font-semibold tabular-nums text-slate-700">{formatMetric(item.metrics.ordersCountMonth ?? item.metrics.orders, " шт.")}</div>
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Остаток</div>
          <div className="mt-0.5 font-semibold tabular-nums text-slate-700">{formatMetric(item.metrics.stock, " шт.")}</div>
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">ДРР</div>
          <div className="mt-0.5 font-semibold tabular-nums text-slate-700">{formatMetric(item.metrics.drr, "%")}</div>
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Маржа</div>
          <div className="mt-0.5 font-semibold tabular-nums text-slate-700">{formatMetric(item.metrics.marginPct, "%")}</div>
        </div>
      </div>
    </Link>
  );
}

export function WbHomePage() {
  const { cabinetId, activeCabinet, cabinets, ready, loading: cabinetsLoading, error: cabinetsError } = useWbCabinet();
  const [data, setData] = useState<SignalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const elapsed = useElapsedSeconds(loading);

  useEffect(() => {
    if (!ready || cabinetsLoading) return;
    if (!cabinets.length) {
      setData(null);
      setLoading(false);
      setError(cabinetsError || "Подключите хотя бы один активный WB-кабинет в настройках");
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/signals?${cabinetParam(cabinetId)}&window=14&persist=0`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await readApiResponse<SignalsData>(response, "Сигналы WB");
        if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then(setData)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить сигналы WB");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, ready, retryKey]);

  const problemItems = useMemo(() => {
    return (data?.items ?? [])
      .filter((item) => item.signal !== "OK")
      .sort((a, b) => {
        const severityDelta = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
        if (severityDelta) return severityDelta;
        return (SIGNAL_WEIGHT[b.signal] ?? 0) - (SIGNAL_WEIGHT[a.signal] ?? 0);
      });
  }, [data?.items]);

  const summary = data?.summary ?? {};
  const dangerous = problemItems.filter((item) => item.severity === "danger").length;
  const warning = problemItems.filter((item) => item.severity === "warn").length;
  const ok = summary.OK ?? Math.max(0, (data?.count ?? 0) - problemItems.length);

  const quickLinks = [
    { title: "РНП", detail: "план-факт, остатки, ДРР", href: "/wb/rnp", icon: BarChart3 },
    { title: "План продаж", detail: "заказы по дням и цветам", href: "/wb/planning", icon: LineChart },
    { title: "Реклама", detail: "кампании и расходы", href: "/wb/adverts", icon: Megaphone },
    { title: "Поставки", detail: "остатки и дозаказы", href: "/wb/supplies", icon: Truck },
  ];

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
      <WbModuleHeader
        icon={Activity}
        title="Главная WB"
        description={`${activeCabinet?.name ?? "все кабинеты"} · контроль сигналов, РНП, рекламы и остатков`}
        actions={(
          <>
            <button
              type="button"
              onClick={() => setRetryKey((value) => value + 1)}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-8"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Обновить
            </button>
            <Link
              href={hrefWithCabinet("/wb/rnp", cabinetId)}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:min-h-8"
            >
              Открыть РНП
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </>
        )}
      />

      <div className="space-y-4 px-2 py-3 sm:px-6">
        <section className="grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-rose-100 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2 text-xs font-semibold text-rose-600"><AlertTriangle className="h-4 w-4" />Критично</div>
            <div className="mt-2 text-2xl font-black tabular-nums text-slate-900">{dangerous}</div>
            <p className="mt-1 text-[11px] text-slate-500">маржа ниже нуля или деньги горят</p>
          </div>
          <div className="rounded-2xl border border-amber-100 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-600"><Gauge className="h-4 w-4" />Важные</div>
            <div className="mt-2 text-2xl font-black tabular-nums text-slate-900">{warning}</div>
            <p className="mt-1 text-[11px] text-slate-500">остатки, ДРР, контент и маржа</p>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600"><CheckCircle2 className="h-4 w-4" />Без узких мест</div>
            <div className="mt-2 text-2xl font-black tabular-nums text-slate-900">{ok}</div>
            <p className="mt-1 text-[11px] text-slate-500">SKU с нормальным сигналом OK</p>
          </div>
          <div className="rounded-2xl border border-violet-100 bg-violet-50 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2 text-xs font-semibold text-violet-700"><Sparkles className="h-4 w-4" />Окно анализа</div>
            <div className="mt-2 text-2xl font-black tabular-nums text-slate-900">{data?.window ?? 14} дн.</div>
            <p className="mt-1 text-[11px] text-slate-500">воронка + РНП + юнит-экономика</p>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-base font-bold text-slate-900">Что требует внимания</h2>
              <p className="mt-0.5 text-xs text-slate-500">Топ проблемных SKU по текущему кабинету. Клик ведёт сразу в нужный раздел.</p>
            </div>
            <div className="flex flex-wrap gap-1.5 sm:ml-auto">
              {Object.entries(summary)
                .filter(([signal]) => signal !== "OK")
                .sort(([a], [b]) => (SIGNAL_WEIGHT[b] ?? 0) - (SIGNAL_WEIGHT[a] ?? 0))
                .map(([signal, count]) => (
                  <span key={signal} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">
                    {signal}: {count}
                  </span>
                ))}
            </div>
          </div>

          {loading ? (
            <div>
              <LoadingBanner seconds={elapsed} hint="сигналы WB по SKU" />
              <SkeletonCards count={6} />
            </div>
          ) : error ? (
            <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} />
          ) : problemItems.length === 0 ? (
            <WbEmptyState>Сигналы чистые: критичных проблем по текущему кабинету не найдено.</WbEmptyState>
          ) : (
            <div className="grid gap-2 xl:grid-cols-2">
              {problemItems.slice(0, 8).map((item) => (
                <AttentionCard key={`${item.nm}-${item.signal}`} item={item} cabinetId={cabinetId} />
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-3 lg:grid-cols-4">
          {quickLinks.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={hrefWithCabinet(item.href, cabinetId)}
                className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-700">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-bold text-slate-800">{item.title}</h3>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{item.detail}</p>
                  </div>
                  <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-violet-600" />
                </div>
              </Link>
            );
          })}
        </section>
      </div>
    </div>
  );
}
