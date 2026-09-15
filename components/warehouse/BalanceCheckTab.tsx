"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import { LoadingBanner, useElapsedSeconds } from "@/components/ui/LoadingState";
import { moscowToday } from "@/lib/sync/moscowDay";
import type { BalanceCheckResponse } from "@/app/api/warehouse/balance-check/route";

const money = (value: number) => `${formatNumber(Math.round(value))} ₽`;
const today = () => moscowToday();

/**
 * Контрольная формула баланса (§19.3/§27.28 ТЗ): начальный остаток + движения
 * периода = конечный остаток, на любую выбранную дату. Read-only отчёт поверх
 * уже существующего регистра — ничего не пишет, ничего не может испортить.
 *
 * Два пункта формулы ТЗ («оприходованные излишки», «возврат поставщику») в
 * регистре не выделены отдельным видом движения — показаны честно как «не
 * отслеживается», а не подставлены под чужую цифру.
 */
export function BalanceCheckTab({ entityId }: { entityId: string }) {
  const [asOf, setAsOf] = useState(today());
  const [from, setFrom] = useState("");
  const [data, setData] = useState<BalanceCheckResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const elapsed = useElapsedSeconds(loading);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ entity: entityId, asOf });
      if (from) params.set("from", from);
      const res = await fetch(`/api/warehouse/balance-check?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось посчитать баланс");
      setData(json.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось посчитать баланс");
    } finally {
      setLoading(false);
    }
  }, [entityId, asOf, from]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-800">Контрольная формула баланса</div>
        <p className="mt-1 text-[11px] text-slate-500">Начальный остаток + поступления + возвраты − отгрузки − продажи − списания = конечный остаток. Проверяется на выбранную дату — сходимость гарантирована построением регистра (append-only), но именно этот отчёт делает её видимой, как требует §27.28.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Период с
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-700" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            по
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || today())} className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-700" />
          </label>
        </div>
      </div>

      {loading ? <LoadingBanner seconds={elapsed} hint="баланс" /> : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Начальный остаток{data.from ? ` · до ${data.from}` : ""}</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">{formatNumber(data.opening.qty)} шт</div>
              <div className="text-xs text-slate-500">{money(data.opening.amount)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Конечный остаток · на {data.asOf}</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">{formatNumber(data.closing.qty)} шт</div>
              <div className="text-xs text-slate-500">{money(data.closing.amount)}</div>
            </div>
            <div className={`rounded-xl border p-4 ${data.reconciles ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {data.reconciles ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 text-rose-600" />}
                Сходится
              </div>
              <div className={`mt-1 text-lg font-semibold ${data.reconciles ? "text-emerald-700" : "text-rose-700"}`}>{data.reconciles ? "Да" : "Нет"}</div>
              <div className="text-xs text-slate-500">Начальный + движения = конечный</div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white">
            <table className="w-full border-collapse text-[11px]">
              <thead><tr className="h-9 border-b border-slate-200 bg-slate-50 text-slate-500"><th className="px-3 text-left font-semibold">Движение за период</th><th className="px-3 text-right font-semibold">Количество</th><th className="px-3 text-right font-semibold">Сумма</th></tr></thead>
              <tbody>
                {data.lines.map((line) => (
                  <tr key={line.key} className="h-10 border-b border-slate-100">
                    <td className="px-3 text-slate-700">{line.label}</td>
                    <td className={`px-3 text-right tabular-nums font-medium ${line.qty > 0 ? "text-emerald-600" : line.qty < 0 ? "text-rose-600" : "text-slate-400"}`}>{line.qty > 0 ? "+" : ""}{formatNumber(line.qty)}</td>
                    <td className="px-3 text-right tabular-nums text-slate-500">{money(line.amount)}</td>
                  </tr>
                ))}
                {data.untracked.map((item) => (
                  <tr key={item.key} className="h-10 border-b border-slate-100 bg-slate-50/50">
                    <td className="px-3 text-slate-400">{item.label}</td>
                    <td className="px-3 text-right text-slate-300" colSpan={2}>не отслеживается отдельно в регистре</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
