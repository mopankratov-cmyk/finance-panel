"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import type { FbsSalesResult } from "@/app/api/warehouse/fbs-sales/route";
import { buildStockMatrix, type StockMatrixResponse, type StockReceiptCell } from "@/lib/warehouse/stockMatrix";
import { plural } from "@/lib/warehouse/plural";
import { StockModelTree, warehouseBreakdown } from "@/components/warehouse/StockModelTree";

const money = (value: number) => `${formatNumber(Math.round(value))} ₽`;
const shortDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }) : "";

/**
 * Остатки по ТЗ команды: только иерархия «модель → цвет → размер» (решение
 * владельца 04.09: плоской таблицы «строка на размер и склад» больше нет).
 * Разбивка по складам, себестоимость и сумма живут внутри дерева.
 */
/** Отметка времени по Москве: склад живёт по московскому дню, как и весь учёт. */
const freshStamp = (value: string) =>
  new Date(value).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function BalancesTab({ entityId, refreshKey }: { entityId: string; refreshKey: number }) {
  const [data, setData] = useState<StockMatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [sales, setSales] = useState<FbsSalesResult | null>(null);
  const [salesError, setSalesError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/stock?entity=${entityId}`, { cache: "no-store" });
      const json = await res.json();
      // 503 до миграции приходит с подсказкой, какие файлы применить, — показываем как есть.
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить остатки");
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить остатки");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const models = useMemo(() => (data ? buildStockMatrix(data.rows) : []), [data]);

  // Остаток по складам для плитки: строки уже несут разбивку, складываем её.
  const byWarehouse = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const row of data?.rows ?? []) {
      for (const item of row.byWarehouse) totals[item.warehouseId] = (totals[item.warehouseId] ?? 0) + item.qty;
    }
    return totals;
  }, [data]);

  // Непересчитанные партии для плитки «Ожидается»: по одной на batch_id,
  // свежие первыми — как в макете «ПРМ-0013 · 27.08».
  const pendingBatches = useMemo(() => {
    const map = new Map<string, StockReceiptCell>();
    for (const row of data?.rows ?? []) {
      for (const cell of row.receipts) {
        if (cell.state !== "posted" && !map.has(cell.batchId)) map.set(cell.batchId, cell);
      }
    }
    return [...map.values()].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  }, [data]);

  // Продажи FBS — единственное движение, которое приходит не от человека, а от
  // маркетплейса: товар лежит на фулфилменте и уезжает оттуда покупателю без
  // нашего участия. Пока их не списать, остаток на ФФ не уменьшается никогда.
  const syncSales = async () => {
    setSyncing(true);
    setSalesError(null);
    setSales(null);
    try {
      const res = await fetch("/api/warehouse/fbs-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось списать продажи");
      setSales(json.data as FbsSalesResult);
      await load();
    } catch (e) {
      setSalesError(e instanceof Error ? e.message : "Не удалось списать продажи");
    } finally {
      setSyncing(false);
    }
  };

  const salesPanel = (
    <>
      {salesError && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{salesError}</div>}
      {sales && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {sales.warehouses.map((row) => (
            <p key={row.warehouseId}>
              <span className="font-medium">{row.warehouseName}</span>: списано {formatNumber(row.written)}
              {row.skipped > 0 ? `, уже были списаны ${formatNumber(row.skipped)}` : ""}
              {row.negative > 0 ? `, из них ${formatNumber(row.negative)} при нехватке остатка` : ""}
            </p>
          ))}
          <p className="mt-1 text-xs text-emerald-700">
            Прочитано заказов FBS: {formatNumber(sales.scanned)}
            {sales.otherEntity > 0 ? ` · ${formatNumber(sales.otherEntity)} чужих юрлиц` : ""}
          </p>
          {sales.unresolved.length > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              Не опознан размер: {sales.unresolved.map((row) => `${row.article} (${row.count})`).join(", ")}.
              Импортируйте размеры из карточек WB на вкладке «Товары».
            </p>
          )}
        </div>
      )}
    </>
  );

  const syncButton = (
    <button
      onClick={() => void syncSales()}
      disabled={syncing}
      title="Вычесть из остатка продажи со склада продавца. Включается по складу и дате на вкладке «Склады»."
      className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
    >
      <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
      {syncing ? "Списываю продажи…" : "Списать продажи FBS"}
    </button>
  );

  // Заглушка — только пока данных нет вовсе. Раньше она подменяла таблицу на
  // КАЖДОЕ обновление, StockModelTree размонтировался, и раскрытые модели
  // схлопывались: сравнил размеры, нажал «Обновить» — раскрывай заново.
  if (loading && !data) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Считаю остаток по движениям…</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  if (data.rows.length === 0) {
    return (
      <div className="space-y-4">
        {salesPanel}
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-700">Остатка пока нет — проведите приёмку</p>
          <p className="mt-1 text-sm text-slate-400">Товар появится здесь, как только партия встанет на остаток.</p>
          <div className="mt-3 flex justify-center">{syncButton}</div>
        </div>
      </div>
    );
  }

  const available = data.totals.qty - data.totals.reserved;
  // Отставание считаем от последнего списания. null — на складах нет FBS, и
  // подпись про продажи там только мешала бы.
  const fbsLag = data.warehouses.some((warehouse) => warehouse.kind === "fulfillment")
    ? (data.lastFbsSaleAt ? Math.floor((Date.now() - Date.parse(data.lastFbsSaleAt)) / 86_400_000) : 999)
    : null;
  const breakdown = warehouseBreakdown(byWarehouse, data.warehouses);

  return (
    <div className={`space-y-4 ${loading ? "opacity-60 transition-opacity" : ""}`}>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* Цифра на экране живёт своей жизнью, пока её не обновят, а остаток на
            фулфилменте уменьшается ТОЛЬКО списанием продаж FBS. Человек,
            сверяющий панель с полкой, обязан видеть, что именно он сравнивает. */}
        <span className="mr-auto text-xs text-slate-400">
          {loading ? "Обновляю…" : `Данные на ${freshStamp(data.computedAt)}`}
          {fbsLag !== null && (
            <span className={fbsLag > 1 ? "ml-2 rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800" : "ml-2"}>
              {data.lastFbsSaleAt
                ? `продажи FBS списаны ${freshStamp(data.lastFbsSaleAt)}${fbsLag > 1 ? ` — ${fbsLag} ${plural(fbsLag, "день", "дня", "дней")} назад` : ""}`
                : "продажи FBS ещё ни разу не списывали"}
            </span>
          )}
        </span>
        {syncButton}
      </div>

      {salesPanel}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Всего в остатке</p>
          <p className="text-xl font-bold text-slate-900">{formatNumber(data.totals.qty)}</p>
          <p className="mt-1 text-xs text-slate-400">
            {data.totals.skuCount} {plural(data.totals.skuCount, "позиция", "позиции", "позиций")}
            {breakdown ? ` · ${breakdown}` : ""}
          </p>
        </div>
        {/* Как считаются обе цифры, раньше говорил только title — то есть на
            телефоне не говорил никто. Пишем в самой карточке. */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">В заданиях на отгрузку</p>
          <p className={`text-xl font-bold ${data.totals.reserved > 0 ? "text-red-600" : "text-slate-900"}`}>
            {formatNumber(data.totals.reserved)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            доступно {formatNumber(available)} = остаток − в заданиях
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Ожидается, не пересчитано</p>
          <p className={`text-xl font-bold ${data.totals.expected > 0 ? "text-red-600" : "text-slate-900"}`}>
            {formatNumber(data.totals.expected)}
          </p>
          <p className="mt-1 truncate text-xs text-slate-400">
            {pendingBatches.length === 0
              ? "всё пересчитано"
              : pendingBatches.slice(0, 3).map((cell) => [cell.number ?? "партия", shortDate(cell.date)].filter(Boolean).join(" · ")).join(", ")
                + (pendingBatches.length > 3 ? ` и ещё ${pendingBatches.length - 3}` : "")}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Деньги в товаре</p>
          <p className="text-xl font-bold text-violet-700">{money(data.totals.amount)}</p>
          <p className="mt-1 text-xs text-slate-400">по себестоимости приёмок</p>
        </div>
      </div>

      <StockModelTree models={models} warehouses={data.warehouses} />
    </div>
  );
}
