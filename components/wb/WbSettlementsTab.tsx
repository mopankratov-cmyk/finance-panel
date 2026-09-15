"use client";

import { HandCoins } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LoadingBanner, useElapsedSeconds } from "@/components/ui/LoadingState";
import type { SupplierSettlementRow } from "@/app/api/purchase-orders/settlements/route";
import { WbEmptyState, WbErrorState } from "./WbModuleHeader";

const formatMoney = (value: number) => new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
}).format(value || 0);

interface Props {
  cabinetId: string;
}

/**
 * «Расчёты» — сводка по каждому поставщику этого кабинета: заказано /
 * оплачено / получено / баланс (аванс или долг). Чистое чтение поверх уже
 * существующих заказов, платежей и приёмок — ни одной новой таблицы.
 */
export function WbSettlementsTab({ cabinetId }: Props) {
  const [suppliers, setSuppliers] = useState<SupplierSettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const elapsed = useElapsedSeconds(loading);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!cabinetId || cabinetId === "all") {
      setSuppliers([]);
      setLoading(false);
      setLoadError("Выберите один реальный кабинет");
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/purchase-orders/settlements?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store" });
      const body = await response.json() as { data: { suppliers?: SupplierSettlementRow[] } | null; error: string | null };
      if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
      setSuppliers(body.data?.suppliers ?? []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Не удалось загрузить расчёты");
    } finally {
      setLoading(false);
    }
  }, [cabinetId]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><HandCoins className="h-4 w-4 text-violet-600" /> Расчёты с поставщиками</div>
        <p className="mt-1 text-[11px] text-slate-500">Заказано — стоимость товара по заказам этого кабинета. Оплачено — из этапов оплаты. Получено — по факту приёмки, в цене заказа. К допоставке — недовоз по закрытым партиям, за вычетом того, что уже решено иначе, чем «ждать допоставку». Баланс = оплачено − получено: положительный — аванс поставщику, отрицательный — долг перед вами.</p>
      </div>

      {loading ? <LoadingBanner seconds={elapsed} hint="расчёты" /> : loadError ? <WbErrorState message={loadError} onRetry={() => void load()} /> : suppliers.length === 0 ? (
        <WbEmptyState>Заказов фабрике в этом кабинете пока нет.</WbEmptyState>
      ) : (
        <div className="scroll-x rounded-xl border border-slate-200 bg-white">
          <table className="min-w-[860px] w-full border-collapse text-[11px]">
            <thead><tr className="h-9 border-b border-slate-200 bg-slate-50 text-slate-500"><th className="px-3 text-left font-semibold">Поставщик</th><th className="px-3 text-right font-semibold">Заказов</th><th className="px-3 text-right font-semibold">Заказано</th><th className="px-3 text-right font-semibold">Оплачено</th><th className="px-3 text-right font-semibold">Получено</th><th className="px-3 text-right font-semibold">К допоставке</th><th className="px-3 text-right font-semibold">Баланс</th></tr></thead>
            <tbody>{suppliers.map((row) => (
              <tr key={row.supplierId ?? row.supplierName} className="h-11 border-b border-slate-100">
                <td className="px-3"><div className="font-semibold text-slate-800">{row.supplierName}</div>{!row.supplierId ? <div className="text-[9px] text-slate-400">не привязан к справочнику</div> : null}</td>
                <td className="px-3 text-right tabular-nums text-slate-600">{row.orderCount}</td>
                <td className="px-3 text-right tabular-nums text-slate-600">{formatMoney(row.ordered)}</td>
                <td className="px-3 text-right tabular-nums text-slate-600">{formatMoney(row.paid)}</td>
                <td className="px-3 text-right tabular-nums text-slate-600">{formatMoney(row.received)}</td>
                <td className={`px-3 text-right tabular-nums font-semibold ${row.toRestock > 0 ? "text-amber-600" : "text-slate-400"}`}>
                  {row.toRestock > 0 ? `${row.toRestock} шт.` : "—"}
                </td>
                <td className={`px-3 text-right tabular-nums font-semibold ${row.balance > 0 ? "text-emerald-600" : row.balance < 0 ? "text-rose-600" : "text-slate-400"}`}>
                  {row.balance === 0 ? "—" : row.balance > 0 ? `аванс ${formatMoney(row.balance)}` : `долг ${formatMoney(-row.balance)}`}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
