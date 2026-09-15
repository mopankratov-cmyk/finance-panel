"use client";

import { Truck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ShipmentStatus } from "@/lib/purchases/shipments";
import { LoadingBanner, useElapsedSeconds } from "@/components/ui/LoadingState";
import { WbEmptyState, WbErrorState } from "./WbModuleHeader";

/** Ответ /api/supplier-shipments — SupplierShipmentWithOrder оттуда же. */
interface ShipmentWithOrder {
  id: string;
  orderId: string;
  orderNumber: string;
  supplier: string;
  carrier: string;
  route: string;
  status: ShipmentStatus;
  eta: string | null;
  items: { nmId: number; article: string; quantity: number }[];
  /** §27.11 ТЗ: наступил ли момент перехода права собственности по договору.
   *  null — нет договора на эту пару (поставщик, юрлицо), бейдж не рисуем. */
  ownershipTransferred: boolean | null;
}

const STATUS_LABELS: Record<ShipmentStatus, string> = {
  planned: "Готовится",
  shipped: "Отгружена",
  customs: "На таможне",
  arrived: "Прибыла",
  received: "Принята",
  cancelled: "Отменена",
};

const STATUS_STYLES: Record<ShipmentStatus, string> = {
  planned: "border-slate-200 bg-slate-50 text-slate-600",
  shipped: "border-blue-200 bg-blue-50 text-blue-700",
  customs: "border-amber-200 bg-amber-50 text-amber-700",
  arrived: "border-violet-200 bg-violet-50 text-violet-700",
  received: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-700",
};

const today = () => new Date().toISOString().slice(0, 10);
const formatDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("ru-RU");

interface Props {
  cabinetId: string;
}

/**
 * Сводка «Товар в пути» — по всем активным заказам кабинета сразу, а не по
 * одному: раньше это можно было узнать только зайдя в каждый заказ отдельно.
 * Создание отгрузки живёт в самом заказе (WbPurchaseOrdersTab) — здесь
 * только видимость и смена статуса на пути.
 */
export function WbTransitShipmentsTab({ cabinetId }: Props) {
  const [shipments, setShipments] = useState<ShipmentWithOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const elapsed = useElapsedSeconds(loading);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!cabinetId || cabinetId === "all") {
      setShipments([]);
      setLoading(false);
      setLoadError("Выберите один реальный кабинет");
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/supplier-shipments?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store" });
      const body = await response.json() as { data: { shipments?: ShipmentWithOrder[] } | null; error: string | null };
      if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
      setShipments(body.data?.shipments ?? []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Не удалось загрузить отгрузки");
    } finally {
      setLoading(false);
    }
  }, [cabinetId]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Truck className="h-4 w-4 text-violet-600" /> Товар в пути</div>
        <p className="mt-1 text-[11px] text-slate-500">Активные отгрузки по всем заказам кабинета. Отгрузку создают внутри самого заказа фабрике.</p>
      </div>

      {loading ? <LoadingBanner seconds={elapsed} hint="отгрузки" /> : loadError ? <WbErrorState message={loadError} onRetry={() => void load()} /> : shipments.length === 0 ? (
        <WbEmptyState>Активных отгрузок нет — либо всё уже принято, либо ни один заказ ещё не отправлен в путь.</WbEmptyState>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {shipments.map((shipment) => {
            const quantity = shipment.items.reduce((sum, item) => sum + item.quantity, 0);
            const overdue = shipment.eta && !["arrived", "received", "cancelled"].includes(shipment.status) && shipment.eta < today();
            return (
              <div key={shipment.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-slate-800">{shipment.orderNumber}</div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-500">{shipment.supplier || "Поставщик не указан"}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${STATUS_STYLES[shipment.status]}`}>{STATUS_LABELS[shipment.status]}</span>
                    {shipment.ownershipTransferred === true ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[9px] font-semibold text-emerald-700">Наш товар</span>
                    ) : shipment.ownershipTransferred === false ? (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-semibold text-slate-500">Ещё не наш</span>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 space-y-1 text-[11px] text-slate-600">
                  <div>{shipment.carrier || "Перевозчик не указан"}{shipment.route ? ` · ${shipment.route}` : ""}</div>
                  <div>{quantity.toLocaleString("ru-RU")} шт{shipment.eta ? <span className={overdue ? "ml-1.5 font-semibold text-rose-600" : "ml-1.5 text-slate-400"}>{overdue ? "· задержка, план " : "· план "}{formatDate(shipment.eta)}</span> : null}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
