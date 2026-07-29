"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  Check,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Database,
  Factory,
  HeartPulse,
  Loader2,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Ship,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { HealthCheck, OperationalAlert, OperationalOrder, OperationalState, TimelineStageState } from "@/lib/health/operations";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

interface HealthResponse {
  meta: { cabinetId: string; generatedAt: string; warnings: string[] } | null;
  data: {
    orders: OperationalOrder[];
    checks: HealthCheck[];
    alerts: OperationalAlert[];
    score: number;
    scope: { restricted: boolean; count: number | null };
    summary: { activeOrders: number; overdueOrders: number; criticalAlerts: number };
  } | null;
  error: string | null;
}

const stageIcons = [Factory, Ship, Truck, PackageCheck];
const stageTone: Record<TimelineStageState, string> = {
  done: "bg-emerald-500",
  active: "bg-violet-600",
  planned: "bg-slate-200",
  warning: "bg-amber-300",
  overdue: "bg-rose-500",
};
const stageBadge: Record<TimelineStageState, string> = {
  done: "bg-emerald-100 text-emerald-700",
  active: "bg-violet-100 text-violet-700",
  planned: "bg-slate-100 text-slate-500",
  warning: "bg-amber-100 text-amber-700",
  overdue: "bg-rose-100 text-rose-700",
};
const checkTone: Record<OperationalState, { card: string; dot: string; label: string }> = {
  ok: { card: "border-emerald-200 bg-emerald-50/40", dot: "bg-emerald-500", label: "Работает" },
  warning: { card: "border-amber-200 bg-amber-50/40", dot: "bg-amber-400", label: "Настроить" },
  error: { card: "border-rose-200 bg-rose-50/40", dot: "bg-rose-500", label: "Ошибка" },
};

function dateLabel(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function timeLabel(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "ещё нет данных";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function orderTone(state: OperationalOrder["state"]) {
  if (state === "complete") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (state === "overdue") return "border-rose-300 bg-rose-50 text-rose-700";
  if (state === "warning") return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-violet-300 bg-violet-50 text-violet-700";
}

function stageStateLabel(state: TimelineStageState) {
  return ({ done: "Готово", active: "В работе", planned: "Запланировано", warning: "Нужны данные", overdue: "Просрочено" } as const)[state];
}

function Timeline({ order }: { order: OperationalOrder }) {
  return (
    <section aria-labelledby="health-cycle-title" className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,.04)] sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h2 id="health-cycle-title" className="text-sm font-bold text-slate-800">Цикл заказа {order.orderNumber}</h2>
          <p className="mt-1 text-[10px] text-slate-500">{order.supplier || "Поставщик не указан"} · {order.itemsCount} SKU · {order.quantity.toLocaleString("ru-RU")} шт.</p>
        </div>
        <span className={`ml-auto rounded-full border px-2.5 py-1 text-[9px] font-bold ${orderTone(order.state)}`}>{order.progressPct}% цикла</span>
      </div>

      <div className="mt-6 hidden sm:block">
        <div className="flex items-end gap-1">
          {order.stages.map((stage, index) => {
            const Icon = stageIcons[Math.min(index, stageIcons.length - 1)];
            return (
              <div key={stage.key} className="min-w-24 text-center" style={{ flexGrow: Math.max(1, stage.durationDays), flexBasis: 0 }}>
                <span className={`mx-auto grid h-9 w-9 place-items-center rounded-xl ${stageBadge[stage.state]}`}><Icon className="h-4 w-4" /></span>
                <div className="mt-2 truncate text-[10px] font-bold text-slate-700">{stage.label}</div>
                <div className="mt-0.5 truncate text-[9px] text-slate-400">{stage.detail}</div>
                <div className="mt-1 text-[11px] font-bold tabular-nums text-slate-700">{stage.durationDays}<span className="ml-0.5 text-[8px] font-medium text-slate-400">дн.</span></div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100">
          {order.stages.map((stage) => <span key={stage.key} title={`${stage.label}: ${stageStateLabel(stage.state)}`} className={`${stageTone[stage.state]} border-r border-white last:border-r-0`} style={{ flexGrow: Math.max(1, stage.durationDays), flexBasis: 0 }} />)}
        </div>
        <div className="mt-2 flex text-[8px] tabular-nums text-slate-400"><span>{dateLabel(order.orderDate)}</span><span className="ml-auto">{dateLabel(order.stages.at(-1)?.dueDate ?? order.expectedReadyDate)}</span></div>
      </div>

      <div className="mt-4 grid gap-2 sm:hidden">
        {order.stages.map((stage, index) => {
          const Icon = stageIcons[Math.min(index, stageIcons.length - 1)];
          return (
            <div key={stage.key} className="flex min-h-20 items-center gap-3 rounded-xl border border-slate-200 p-3">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${stageBadge[stage.state]}`}><Icon className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1"><div className="truncate text-xs font-bold text-slate-700">{stage.label}</div><div className="mt-1 truncate text-[10px] text-slate-500">{stage.detail}</div><div className="mt-1 text-[9px] text-slate-400">{stage.durationDays} дн. · {stageStateLabel(stage.state)}</div></div>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stageTone[stage.state]}`} />
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 pt-4 text-[9px] text-slate-500">
        {Object.entries({ done: "Готово", active: "В работе", planned: "Запланировано", warning: "Нужны данные", overdue: "Просрочено" }).map(([state, label]) => <span key={state} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${stageTone[state as TimelineStageState]}`} />{label}</span>)}
      </div>
    </section>
  );
}

function CheckCard({ check, cabinetId }: { check: HealthCheck; cabinetId: string }) {
  const tone = checkTone[check.state];
  const href = check.href?.startsWith("/wb/") ? `${check.href}?cabinet=${encodeURIComponent(cabinetId)}` : check.href;
  return (
    <article className={`rounded-xl border p-3 ${tone.card}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`} />
        <div className="min-w-0 flex-1"><h3 className="text-xs font-bold text-slate-700">{check.name}</h3><p className="mt-1 text-[10px] leading-4 text-slate-500">{check.detail}</p></div>
        <span className="text-[8px] font-bold uppercase tracking-wide text-slate-400">{tone.label}</span>
      </div>
      <div className="mt-3 flex items-center border-t border-black/5 pt-2 text-[9px] text-slate-400"><Clock3 className="mr-1 h-3 w-3" />{timeLabel(check.updatedAt)}{href ? <Link href={href} className="ml-auto inline-flex min-h-11 items-center gap-1 rounded-lg px-2 font-semibold text-violet-700 hover:bg-white/70 sm:min-h-8">Открыть <ArrowUpRight className="h-3 w-3" /></Link> : null}</div>
    </article>
  );
}

export function WbHealthPage() {
  const { activeCabinet, cabinetId, canWrite, ready, loading: cabinetsLoading, error: cabinetsError } = useWbCabinet();
  const [response, setResponse] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    if (!ready || cabinetsLoading) return;
    if (!canWrite) { setResponse(null); setError(cabinetsError || "Для operational health выберите один реальный WB-кабинет"); return; }
    const controller = new AbortController();
    let cancelled = false;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 35_000);
    setResponse(null); setSelectedId(""); setLoading(true); setError(null);
    fetch(`/api/operational-health?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (result) => {
        const body = await result.json().catch(() => ({})) as HealthResponse;
        if (!result.ok || body.error || !body.data) throw new Error(body.error || `Ошибка ${result.status}`);
        return body;
      })
      .then((body) => { setResponse(body); setSelectedId((current) => body.data?.orders.some((order) => order.id === current) ? current : body.data?.orders.find((order) => order.state !== "complete")?.id ?? body.data?.orders[0]?.id ?? ""); })
      .catch((cause: unknown) => { if (cancelled) return; setError(timedOut ? "Operational health не ответил за 35 секунд. Повторите запрос." : cause instanceof Error ? cause.message : "Не удалось загрузить operational health"); })
      .finally(() => { window.clearTimeout(timeout); if (!cancelled) setLoading(false); });
    return () => { cancelled = true; window.clearTimeout(timeout); controller.abort(); };
  }, [cabinetId, cabinetsError, cabinetsLoading, canWrite, ready, retryKey]);

  const data = response?.data ?? null;
  const selectedOrder = data?.orders.find((order) => order.id === selectedId) ?? data?.orders[0] ?? null;
  const visibleAlerts = useMemo(() => data?.alerts.filter((alert) => !alert.orderId || alert.orderId === selectedOrder?.id) ?? [], [data?.alerts, selectedOrder?.id]);

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-20 md:pb-6">
      <WbModuleHeader
        icon={HeartPulse}
        title="Здоровье"
        description={activeCabinet ? `${activeCabinet.name} · состояние операций и сервисов` : "Operational health"}
        actions={<button type="button" onClick={() => setRetryKey((value) => value + 1)} disabled={loading} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 sm:min-h-9">{loading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-4 w-4" />}Обновить</button>}
      />

      <div className="space-y-3 px-2 py-3 sm:px-6">
        {!canWrite ? <WbErrorState message={error || "Выберите один реальный кабинет"} /> : error ? <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} /> : null}
        {loading && !data ? <div className="grid min-h-[440px] place-items-center rounded-xl border border-slate-200 bg-white"><div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />Собираю сроки заказов и статусы сервисов…</div></div> : null}
        {data ? (
          <>
            {response?.meta?.warnings.length ? <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{response.meta.warnings.join(" · ")}</div> : null}
            <section aria-label="Сводка operational health" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {[
                { label: "Активные циклы", value: data.summary.activeOrders, icon: Factory, tone: "text-violet-600 bg-violet-50" },
                { label: "Просрочено", value: data.summary.overdueOrders, icon: AlertTriangle, tone: data.summary.overdueOrders ? "text-rose-600 bg-rose-50" : "text-emerald-600 bg-emerald-50" },
                { label: "Здоровье сервисов", value: `${data.score}%`, icon: HeartPulse, tone: data.score >= 80 ? "text-emerald-600 bg-emerald-50" : data.score >= 50 ? "text-amber-600 bg-amber-50" : "text-rose-600 bg-rose-50" },
                { label: data.scope.restricted ? "Разрешённые SKU" : "Контур SKU", value: data.scope.count ?? "Весь", icon: ShieldCheck, tone: "text-slate-600 bg-slate-100" },
              ].map((metric) => <article key={metric.label} className="rounded-xl border border-slate-200 bg-white p-3"><div className={`grid h-8 w-8 place-items-center rounded-lg ${metric.tone}`}><metric.icon className="h-4 w-4" /></div><div className="mt-2 text-xl font-black tracking-tight text-slate-800">{metric.value}</div><div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">{metric.label}</div></article>)}
            </section>

            <section className="rounded-xl bg-slate-950 p-3 text-white sm:p-4" aria-labelledby="cycle-panel-title">
              <div className="flex items-center gap-2"><CircleDashed className="h-4 w-4 text-violet-300" /><h2 id="cycle-panel-title" className="text-xs font-bold">Операционный цикл</h2><span className="ml-auto text-[9px] font-semibold text-emerald-300">{selectedOrder ? `${selectedOrder.progressPct}%` : "нет активного заказа"}</span></div>
              <p className="mt-1 text-[10px] text-slate-400">Производство → логистика → приёмка. Без P&amp;L, ДДС и расчётов финансового блока.</p>
            </section>

            {data.orders.length ? <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Заказы для operational timeline">{data.orders.map((order) => <button key={order.id} type="button" role="tab" aria-selected={order.id === selectedOrder?.id} onClick={() => setSelectedId(order.id)} className={`min-h-11 shrink-0 rounded-full border px-3 text-[10px] font-semibold ${order.id === selectedOrder?.id ? "border-violet-500 bg-violet-600 text-white" : orderTone(order.state)}`}>{order.orderNumber}<span className="ml-1.5 opacity-70">{order.progressPct}%</span></button>)}</div> : null}
            {selectedOrder ? <Timeline order={selectedOrder} /> : <WbEmptyState><div className="space-y-2"><Boxes className="mx-auto h-7 w-7 text-slate-300" /><p>Активных заказов фабрике пока нет.</p><Link href={`/wb/supplies?cabinet=${encodeURIComponent(cabinetId)}`} className="inline-flex min-h-11 items-center rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white">Открыть закупки</Link></div></WbEmptyState>}

            {visibleAlerts.length ? <section aria-labelledby="health-alerts-title" className="rounded-xl border border-rose-200 bg-rose-50 p-3"><div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-rose-600" /><h2 id="health-alerts-title" className="text-xs font-bold text-rose-800">Требует внимания</h2><span className="ml-auto rounded-full bg-white px-2 py-1 text-[9px] font-bold text-rose-600">{visibleAlerts.length}</span></div><div className="mt-3 grid gap-2 lg:grid-cols-2">{visibleAlerts.map((alert) => <div key={alert.key} className="rounded-lg border border-rose-100 bg-white p-3"><div className="text-[10px] font-bold text-rose-800">{alert.title}</div><div className="mt-1 text-[9px] leading-4 text-rose-600">{alert.detail}</div></div>)}</div></section> : <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" />По выбранному циклу критичных задержек нет.</div>}

            <section aria-labelledby="services-health-title">
              <div className="mb-3 flex items-end gap-2"><div><h2 id="services-health-title" className="text-base font-bold text-slate-800">Здоровье сервисов</h2><p className="mt-1 text-[10px] text-slate-500">Статусы выбранного кабинета; продуктовые метрики применяют его разрешённый SKU-контур.</p></div><Database className="ml-auto h-5 w-5 text-slate-300" /></div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">{data.checks.map((check) => <CheckCard key={check.key} check={check} cabinetId={cabinetId} />)}</div>
            </section>

            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-[10px] text-slate-500"><Check className="h-4 w-4 text-emerald-500" />Срез сформирован {timeLabel(response?.meta?.generatedAt ?? null)}. Экран только читает данные и ничего не меняет в WB, WMS или финансах.</div>
          </>
        ) : null}
      </div>
    </div>
  );
}
