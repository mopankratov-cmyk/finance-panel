"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/format";
import type { BrowserPayoutMarketplace, BrowserPayoutSnapshot } from "@/lib/opiu/browserPayoutSnapshots";

export function BrowserPayoutSnapshotsPanel({ marketplace, cabinetId, year, month, onChange }: {
  marketplace: BrowserPayoutMarketplace;
  cabinetId: string;
  year: number;
  month: number;
  onChange: (snapshots: BrowserPayoutSnapshot[]) => void;
}) {
  const [rows, setRows] = useState<BrowserPayoutSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setRows([]);
    setError("");
    onChange([]);
  }, [cabinetId, marketplace, month, onChange, year]);

  return <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="font-semibold text-indigo-950">Выплаты из кабинета {marketplace === "wb" ? "WB" : "Ozon"}</h3>
        <p className="mt-1 text-xs text-indigo-800">Снимки собирает отдельный видимый браузер на Mac mini. Они не меняют календарь без вашего подтверждения.</p>
      </div>
      <button type="button" disabled={loading || !cabinetId} onClick={async () => {
        setLoading(true);
        setError("");
        try {
          const query = new URLSearchParams({ marketplace, cabinet: cabinetId, year: String(year), month: String(month) });
          const response = await fetch(`/api/opiu/browser-payout-snapshots?${query}`, { cache: "no-store" });
          const result = await response.json().catch(() => null) as { snapshots?: BrowserPayoutSnapshot[]; error?: string } | null;
          if (!response.ok || !result?.snapshots) throw new Error(result?.error || "Не удалось прочитать снимки выплат");
          setRows(result.snapshots);
          onChange(result.snapshots);
        } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Не удалось прочитать снимки выплат"); }
        finally { setLoading(false); }
      }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-indigo-300 bg-white px-4 text-sm font-semibold text-indigo-900 disabled:opacity-50">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Проверить кабинетные выплаты
      </button>
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {!error && rows.length === 0 && <p className="mt-3 text-sm text-indigo-900">Снимков пока нет. Это нормально до первого успешного запуска агента.</p>}
    {rows.length > 0 && <div className="mt-3 overflow-x-auto rounded-lg border border-indigo-200 bg-white">
      <table className="w-full min-w-[700px] text-sm"><thead className="bg-indigo-50 text-xs text-indigo-900"><tr><th className="px-3 py-2 text-left">Статус</th><th className="px-3 py-2 text-left">Дата</th><th className="px-3 py-2 text-right">Сумма</th><th className="px-3 py-2 text-left">Период</th><th className="px-3 py-2 text-left">Собрано</th></tr></thead><tbody>
        {rows.map((row) => <tr key={`${row.marketplace}:${row.cabinetId}:${row.externalId}`} className="border-t border-indigo-100"><td className="px-3 py-2 font-medium text-amber-700">{row.state === "awaiting_transfer" ? "Ожидается перечисление" : "Отправлено маркетплейсом"}</td><td className="px-3 py-2">{new Date(`${row.plannedDate}T00:00:00`).toLocaleDateString("ru-RU")}</td><td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.amount)}</td><td className="px-3 py-2">{row.periodFrom && row.periodTo ? `${row.periodFrom}—${row.periodTo}` : "—"}</td><td className="px-3 py-2">{new Date(row.capturedAt).toLocaleString("ru-RU")}</td></tr>)}
      </tbody></table>
    </div>}
  </div>;
}
