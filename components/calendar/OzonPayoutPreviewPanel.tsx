"use client";

import { BarChart3, Loader2, LockKeyhole, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { formatMoney } from "@/lib/format";
import { OZON_PAYOUT_MAPPINGS } from "@/lib/opiu/ozonPayoutPreview";

interface PreviewData {
  readOnly: true;
  mapping: { cabinetId: string; cabinetName: string; companyName: string; accountName: string };
  period: { from: string; to: string };
  accrual: number | null;
  reportTotal: number | null;
  bankReceived: number | null;
  remaining: number | null;
  schedule: Array<{ key: string; reportId: string; periodFrom: string; periodTo: string; amount: number; estimatedReceiptDate: string }> | null;
  confirmedReceipts: Array<{ id: string; date: string; amount: number; name: string; counterparty: string }>;
  unresolvedReceipts: Array<{ id: string; date: string; amount: number; name: string; counterparty: string; accountId: string }>;
  warnings: string[];
  error?: string;
}

export function OzonPayoutPreviewPanel({ year, month }: { year: number; month: number }) {
  const [cabinetId, setCabinetId] = useState(OZON_PAYOUT_MAPPINGS[0]?.cabinetId ?? "");
  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ year: String(year), month: String(month + 1), cabinet: cabinetId });
    fetch(`/api/opiu/ozon-payout-preview?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as PreviewData;
        if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        setData(body);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setData(null);
          setError(cause instanceof Error ? cause.message : "Не удалось получить прогноз Ozon");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cabinetId, month, year]);

  return <Card>
    <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-700"><BarChart3 className="h-5 w-5" /></div>
        <div>
          <h2 className="font-semibold text-slate-900">Прогноз поступлений Ozon</h2>
          <p className="text-sm text-slate-500">Предварительный просмотр отчётов и поступлений ДДС без изменения календаря.</p>
        </div>
      </div>
      <label className="text-sm font-medium text-slate-700">Кабинет
        <select value={cabinetId} onChange={(event) => setCabinetId(event.target.value)} className="ml-2 min-h-10 rounded-lg border border-slate-300 bg-white px-3">
          {OZON_PAYOUT_MAPPINGS.map((mapping) => <option key={mapping.cabinetId} value={mapping.cabinetId}>{mapping.cabinetName}</option>)}
        </select>
      </label>
    </div>
    <CardContent className="space-y-4 pt-5">
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        <LockKeyhole className="h-4 w-4 text-slate-500" /> Только просмотр: этот блок не создаёт и не меняет платежи.
      </div>
      {loading ? <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Загружаю отчёты Ozon…</div>
        : error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
        : data && <>
          <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-sm text-sky-950">
            <b>{data.mapping.cabinetName}</b> → {data.mapping.companyName} → {data.mapping.accountName}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Начисления Ozon" value={data.accrual} />
            <Metric label="Подтверждено отчётами" value={data.reportTotal} />
            <Metric label="Найдено в ДДС" value={data.bankReceived} green />
            <Metric label="Осталось получить" value={data.remaining} />
          </div>
          {data.unresolvedReceipts.length > 0 && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <div className="flex items-center gap-2 font-semibold"><TriangleAlert className="h-4 w-4" /> Требуется ручная проверка поступлений</div>
            <p className="mt-1 text-amber-800">Пока эти операции не определены, итоговые суммы и график намеренно скрыты.</p>
            <div className="mt-3 divide-y divide-amber-200 rounded-lg border border-amber-200 bg-white">
              {data.unresolvedReceipts.map((row) => <div key={row.id} className="grid gap-1 p-3 sm:grid-cols-[110px_140px_1fr]">
                <span>{row.date}</span><b className="tabular-nums">{formatMoney(row.amount)}</b><span>{row.name || row.counterparty || "Поступление маркетплейса"}</span>
              </div>)}
            </div>
          </div>}
          {data.schedule && <details className="rounded-xl border border-slate-200">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">Расчётный график по отчётам ({data.schedule.length})</summary>
            <div className="overflow-x-auto border-t border-slate-100">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-2 text-left">Отчёт</th><th className="px-4 py-2 text-left">Период</th><th className="px-4 py-2 text-left">Расчётная дата</th><th className="px-4 py-2 text-right">Сумма</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{data.schedule.map((row) => <tr key={row.key}><td className="px-4 py-2">{row.reportId}</td><td className="px-4 py-2">{row.periodFrom}—{row.periodTo}</td><td className="px-4 py-2">{row.estimatedReceiptDate}</td><td className="px-4 py-2 text-right font-semibold tabular-nums">{formatMoney(row.amount)}</td></tr>)}</tbody>
              </table>
            </div>
          </details>}
          {data.confirmedReceipts.length > 0 && <details className="rounded-xl border border-emerald-200">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-emerald-900">Надёжно распознано в ДДС ({data.confirmedReceipts.length})</summary>
            <div className="divide-y divide-emerald-100 border-t border-emerald-100">{data.confirmedReceipts.map((row) => <div key={row.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[110px_140px_1fr]"><span>{row.date}</span><b className="tabular-nums">{formatMoney(row.amount)}</b><span>{row.name || row.counterparty}</span></div>)}</div>
          </details>}
          {data.warnings.length > 0 && <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">{data.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
        </>}
    </CardContent>
  </Card>;
}

function Metric({ label, value, green = false }: { label: string; value: number | null; green?: boolean }) {
  return <div className={`rounded-xl p-4 ${green ? "bg-emerald-50" : "bg-slate-50"}`}><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 text-xl font-bold tabular-nums ${green ? "text-emerald-800" : "text-slate-950"}`}>{value === null ? "Не определено" : formatMoney(value)}</p></div>;
}
