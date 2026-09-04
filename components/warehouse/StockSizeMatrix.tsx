"use client";

import { formatNumber } from "@/lib/analytics/format";
import { receiptCell, shipmentCell, type StockColorNode } from "@/lib/warehouse/stockMatrix";

const shortDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }) : "—";

const RECEIPT_STATE_TITLE: Record<StockColorNode["columns"]["receipts"][number]["state"], string> = {
  expected: "Партия ждёт пересчёта — в остатке её ещё нет",
  received: "Партия пересчитана, но ещё не поставлена на остаток",
  posted: "Партия в остатке",
};

const SHIPMENT_STATUS_TITLE: Record<StockColorNode["columns"]["shipments"][number]["status"], string> = {
  draft: "Задание на отгрузку — товар размещён, но ещё не отгружен",
  posted: "Отгружено",
  reversed: "Отгрузка сторнирована — товар вернулся в остаток",
  cancelled: "Задание отменено",
};

/**
 * Матрица «Склад» из ТЗ команды под раскрытым цветом: строка на размер,
 * колонка на каждую партию прихода и на каждый документ отгрузки. Красным —
 * то, что ещё не случилось: партия не пересчитана, задание не отгружено.
 * Колонки ФБС нет: продажи FBS в эту матрицу не заводим (решение владельца 04.09).
 */
export function StockSizeMatrix({ node }: { node: StockColorNode }) {
  const { receipts, shipments } = node.columns;
  const title = node.color ? `${node.article} ${node.color}` : node.article;

  if (receipts.length === 0 && shipments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-3 text-xs text-slate-400">
        {title}: приходов и отгрузок по размерам ещё не было.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
        <span className="text-sm font-medium text-slate-800">{title} · приходы и отгрузки по размерам</span>
        <span className="ml-auto text-xs text-slate-400">красным — ещё не в остатке / ещё не отгружено</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-400">
              <th className="px-4 py-2 text-left font-medium uppercase tracking-wide">Размер</th>
              <th className="px-3 py-2 text-right font-medium uppercase tracking-wide">Остаток</th>
              {receipts.map((column) => (
                <th
                  key={column.id}
                  title={RECEIPT_STATE_TITLE[column.state]}
                  className={`whitespace-nowrap px-3 py-2 text-right font-medium ${column.state !== "posted" ? "text-red-600" : "text-slate-500"}`}
                >
                  <div>{column.number ?? "партия"}</div>
                  <div className="font-normal">{shortDate(column.date)}</div>
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium uppercase tracking-wide">Получено</th>
              {shipments.map((column) => (
                <th
                  key={column.id}
                  title={`${SHIPMENT_STATUS_TITLE[column.status]}${column.cabinetName ? ` · ${column.cabinetName}` : ""}`}
                  className={`whitespace-nowrap px-3 py-2 text-right font-medium ${
                    column.status === "draft"
                      ? "text-red-600"
                      : column.status === "reversed" ? "text-slate-400 line-through" : "text-slate-500"
                  }`}
                >
                  <div>{column.number}</div>
                  <div className="font-normal">{column.status === "draft" ? "ждёт ФФ" : shortDate(column.date)}</div>
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium uppercase tracking-wide">Отгружено</th>
            </tr>
          </thead>
          <tbody>
            {node.sizes.map((row) => (
              <tr key={row.variantId} className="border-b border-slate-100 last:border-0">
                <td className="whitespace-nowrap px-4 py-2">
                  {row.sizeLabel
                    ? <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{row.sizeLabel}</span>
                    : <span className="text-slate-300">—</span>}
                  {row.barcode && <span className="ml-2 text-xs text-slate-400">{row.barcode}</span>}
                </td>
                <td className={`px-3 py-2 text-right font-semibold tabular-nums ${row.qty < 0 ? "text-red-600" : "text-slate-900"}`}>
                  {formatNumber(row.qty)}
                </td>
                {receipts.map((column) => {
                  const cell = receiptCell(row, column.id);
                  return (
                    <td
                      key={column.id}
                      className={`px-3 py-2 text-right tabular-nums ${
                        cell && cell.state !== "posted" ? "bg-red-50 text-red-600" : "text-slate-700"
                      }`}
                    >
                      {cell ? formatNumber(cell.qty) : ""}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatNumber(row.received)}</td>
                {shipments.map((column) => {
                  const cell = shipmentCell(row, column.id);
                  return (
                    <td
                      key={column.id}
                      className={`px-3 py-2 text-right tabular-nums ${
                        !cell
                          ? ""
                          : cell.status === "draft"
                            ? "bg-red-50 text-red-600"
                            : cell.status === "reversed" ? "text-slate-400 line-through" : "text-slate-700"
                      }`}
                    >
                      {cell ? formatNumber(cell.qty) : ""}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatNumber(row.shipped)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
