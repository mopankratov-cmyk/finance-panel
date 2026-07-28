"use client";

import { Bot, CheckCircle2, ChevronDown, RefreshCw, ShieldAlert, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { formatMoney } from "@/lib/format";
import type { Account, Payment } from "@/lib/types";
import type { FinancialIntelligenceResult } from "@/lib/opiu/financialIntelligence";

export function FinancialAlertsPanel({ accounts, payments }: { accounts: Account[]; payments: Payment[] }) {
  const [result, setResult] = useState<FinancialIntelligenceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [serverSynced, setServerSynced] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState(false);

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
        <div className="flex flex-wrap items-center gap-2">
          {result && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${result.alerts.length ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
            {result.alerts.length ? `Требуют внимания: ${result.alerts.length}` : "Отклонений нет"}
          </span>}
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
            Детали
          </button>
        </div>
      </div>
      {expanded && <div className="p-5">
        <div className="mb-4 flex justify-end">
          <button onClick={() => void refresh()} disabled={loading} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Пересчитать
          </button>
        </div>
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
                {result.alerts.map((alert) => (
                  <div key={alert.key} className={`rounded-xl border p-4 ${alert.severity === "critical" ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`}>
                    <div className="flex items-start gap-3">
                      {alert.severity === "critical" ? <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" /> : <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />}
                      <div>
                        <h3 className="font-semibold text-slate-950">{alert.title}</h3>
                        <p className="mt-1 text-sm text-slate-700">{alert.message}</p>
                        <p className="mt-2 text-xs font-medium text-slate-600">Рекомендация: {alert.action}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>}
      </div>}
    </Card>
  );
}

function SmallMetric({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 text-lg font-bold tabular-nums ${danger ? "text-rose-700" : "text-slate-950"}`}>{value}</p></div>;
}
