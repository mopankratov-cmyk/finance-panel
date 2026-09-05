"use client";

import { Bot, CheckCircle2, ChevronDown, Loader2, RefreshCw, ShieldAlert, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { formatDate, formatMoney } from "@/lib/format";
import type { Account, Payment } from "@/lib/types";
import type { FinancialIntelligenceResult } from "@/lib/opiu/financialIntelligence";
import { displayPaymentComment, getPaymentPriority } from "./paymentPriority";

export function FinancialAlertsPanel({
  accounts,
  payments,
  today,
  onReschedulePayment,
}: {
  accounts: Account[];
  payments: Payment[];
  today: string;
  onReschedulePayment: (payment: Payment, targetDate: string) => Promise<void>;
}) {
  const [result, setResult] = useState<FinancialIntelligenceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [serverSynced, setServerSynced] = useState<boolean | null>(null);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [busyPaymentId, setBusyPaymentId] = useState<string | null>(null);
  const [rescheduleError, setRescheduleError] = useState("");
  const accountNames = useMemo(() => new Map(accounts.map((account) => [account.id, account.name])), [accounts]);
  const overdueCritical = useMemo(
    () => payments
      .filter((payment) => payment.status === "planned" && payment.amount < 0 && payment.date < today && getPaymentPriority(payment) === "A")
      .sort((left, right) => left.date.localeCompare(right.date) || Math.abs(right.amount) - Math.abs(left.amount)),
    [payments, today],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/opiu/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts, payments }),
      });
      const body = await response.json() as FinancialIntelligenceResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не удалось провести анализ");
      setResult(body);
      setError("");
      const syncResponse = await fetch("/api/opiu/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts, payments }),
      });
      setServerSynced(syncResponse.ok);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось провести анализ");
    } finally {
      setLoading(false);
    }
  }, [accounts, payments]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><Bot className="h-5 w-5" /></div>
          <div>
            <h2 className="font-semibold text-slate-900">Финансовый контроль</h2>
            <p className="text-sm text-slate-500">Кассовые разрывы, критичные платежи и отклонения плана от факта.</p>
            {serverSynced !== null && <p className={`mt-1 text-xs ${serverSynced ? "text-emerald-700" : "text-amber-700"}`}>{serverSynced ? "Telegram получает актуальные данные" : "Серверная синхронизация ожидает настройки владельца"}</p>}
          </div>
        </div>
        <button onClick={() => void refresh()} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 lg:min-h-10">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Пересчитать
        </button>
      </div>
      <div className="p-5">
        {error ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
          : loading && !result ? <p className="text-sm text-slate-500">Проверяю финансовый план…</p>
          : result && <>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <SmallMetric label="План совпал с фактом" value={`${result.planFact.matched} из ${result.planFact.due}`} />
              <SmallMetric label="Совпадение" value={`${Math.round(result.planFact.matchRate * 100)}%`} />
              <SmallMetric label="Минимальный остаток" value={formatMoney(result.forecast.lowestBalance)} danger={result.forecast.lowestBalance < 0} />
            </div>
            {result.alerts.length === 0 ? (
              <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
                <CheckCircle2 className="h-5 w-5" /><span className="font-medium">Серьёзных финансовых отклонений не найдено.</span>
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {result.alerts.map((alert) => {
                  const isOverdueAlert = alert.key.startsWith("overdue-a:");
                  const content = (
                    <div className="flex items-start gap-3">
                      {alert.severity === "critical" ? <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" /> : <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />}
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-slate-950">{alert.title}</h3>
                        <p className="mt-1 text-sm text-slate-700">{alert.message}</p>
                        <p className="mt-2 text-xs font-medium text-slate-600">Рекомендация: {alert.action}</p>
                      </div>
                      {isOverdueAlert && <ChevronDown className={`mt-0.5 h-5 w-5 shrink-0 text-rose-700 transition-transform ${overdueOpen ? "rotate-180" : ""}`} />}
                    </div>
                  );
                  const tone = alert.severity === "critical" ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50";
                  return isOverdueAlert ? (
                    <button
                      key={alert.key}
                      type="button"
                      aria-expanded={overdueOpen}
                      aria-controls="overdue-critical-payments"
                      onClick={() => setOverdueOpen((value) => !value)}
                      className={`min-h-11 w-full cursor-pointer rounded-xl border p-4 text-left transition hover:border-rose-400 hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-500 ${tone}`}
                    >
                      {content}
                    </button>
                  ) : <div key={alert.key} className={`rounded-xl border p-4 ${tone}`}>{content}</div>;
                })}
              </div>
            )}
            {overdueOpen && overdueCritical.length > 0 && (
              <section id="overdue-critical-payments" aria-labelledby="overdue-critical-title" className="mt-4 rounded-xl border border-rose-200 bg-white p-4">
                <div className="mb-3">
                  <h3 id="overdue-critical-title" className="font-semibold text-slate-950">Просроченные критичные платежи</h3>
                  <p className="mt-1 text-sm text-slate-600">Выберите новую дату и подтвердите перенос отдельно для каждого платежа.</p>
                </div>
                {rescheduleError && <p role="alert" className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{rescheduleError}</p>}
                <div className="space-y-3">
                  {overdueCritical.map((payment) => {
                    const targetDate = dates[payment.id] ?? "";
                    const busy = busyPaymentId === payment.id;
                    const readableComment = displayPaymentComment(payment.comment);
                    return (
                      <article key={payment.id} className="grid gap-3 rounded-xl border border-slate-200 p-3 lg:grid-cols-[minmax(260px,1fr)_180px_190px] lg:items-end">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-md bg-rose-100 px-2 py-1 text-xs font-bold text-rose-800">Просрочен с {formatDate(payment.date)}</span>
                            <strong className="tabular-nums text-rose-700">{formatMoney(Math.abs(payment.amount))}</strong>
                          </div>
                          <p className="mt-2 font-semibold text-slate-900">{payment.name || payment.category || "Платёж без названия"}</p>
                          <p className="mt-1 text-sm text-slate-600">{payment.category || "Статья не указана"} · {accountNames.get(payment.accountId) ?? "Счёт не найден"}</p>
                          {readableComment && <p className="mt-1 text-sm text-slate-500">{readableComment}</p>}
                        </div>
                        <label className="text-xs font-semibold text-slate-700">Новая дата
                          <input
                            type="date"
                            min={today}
                            value={targetDate}
                            onChange={(event) => setDates((current) => ({ ...current, [payment.id]: event.target.value }))}
                            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
                          />
                        </label>
                        <button
                          type="button"
                          disabled={!targetDate || targetDate < today || busy}
                          onClick={async () => {
                            setBusyPaymentId(payment.id);
                            setRescheduleError("");
                            try {
                              await onReschedulePayment(payment, targetDate);
                              setDates((current) => {
                                const next = { ...current };
                                delete next[payment.id];
                                return next;
                              });
                            } catch (caught) {
                              setRescheduleError(caught instanceof Error ? caught.message : "Не удалось перенести платёж. Попробуйте ещё раз.");
                            } finally {
                              setBusyPaymentId(null);
                            }
                          }}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-bold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
                          {busy ? "Переношу…" : "Назначить дату"}
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}
          </>}
      </div>
    </Card>
  );
}

function SmallMetric({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 text-lg font-bold tabular-nums ${danger ? "text-rose-700" : "text-slate-950"}`}>{value}</p></div>;
}
