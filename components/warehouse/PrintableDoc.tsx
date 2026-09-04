"use client";

import { Printer } from "lucide-react";
import { formatNumber } from "@/lib/analytics/format";
import { variantLabel } from "@/lib/warehouse/variantLabel";
import type { StockDocDetail } from "@/app/api/warehouse/docs/[id]/route";

const TITLE: Record<StockDocDetail["kind"], string> = {
  shipment: "Накладная на отгрузку",
  transfer: "Накладная на перемещение",
  writeoff: "Акт списания",
  return: "Акт приёмки возврата",
  receipt: "Акт приёмки",
  adjustment: "Акт коррекции прихода",
};

const date = (value: string) => new Date(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });

/** Бумага для фулфилмента: со сторонним складом спор о недовозе выигрывается
 *  подписанным листом, а не строкой в базе. */
export function PrintableDoc({ doc }: { doc: StockDocDetail }) {
  // В перемещении строки идут парами «минус там, плюс тут» — печатаем только
  // расходную половину, иначе в накладной каждая позиция задвоится.
  const lines = doc.kind === "transfer" ? doc.lines.filter((row) => row.qty < 0) : doc.lines;
  // Кабинет в строках нужен только там, где их несколько: у накладной на один
  // кабинет он уже стоит в шапке, и колонка с одним и тем же словом — шум.
  const showCabinetColumn = doc.kind === "shipment" && !doc.cabinetName;

  return (
    <div className="mx-auto max-w-[820px] bg-white p-8 text-slate-900 print:p-0">
      <style>{`@media print { .no-print { display: none !important; } @page { margin: 16mm; } }`}</style>

      <div className="no-print mb-6 flex items-center justify-between border-b border-slate-200 pb-4">
        <p className="text-sm text-slate-500">Печать документа. Проверьте состав и подпишите оба экземпляра.</p>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
        >
          <Printer className="h-4 w-4" /> Печать
        </button>
      </div>

      <header className="mb-6">
        <h1 className="text-xl font-bold">{TITLE[doc.kind]} № {doc.number}</h1>
        <p className="mt-1 text-sm text-slate-600">от {date(doc.occurredAt)}</p>
        {doc.status === "reversed" && (
          <p className="mt-2 inline-block rounded border border-red-300 px-2 py-1 text-sm font-medium text-red-700">
            Документ сторнирован{doc.reversedByNumber ? ` — ${doc.reversedByNumber}` : ""}
          </p>
        )}
      </header>

      <table className="mb-6 w-full text-sm">
        <tbody>
          <tr>
            <td className="w-40 py-1 align-top text-slate-500">Юрлицо</td>
            <td className="py-1 font-medium">{doc.entityName}{doc.entityInn ? `, ИНН ${doc.entityInn}` : ""}</td>
          </tr>
          {doc.warehouseName && (
            <tr>
              <td className="py-1 align-top text-slate-500">{doc.kind === "return" ? "Принят на склад" : "Склад"}</td>
              <td className="py-1">{doc.warehouseName}{doc.targetWarehouseName ? ` → ${doc.targetWarehouseName}` : ""}</td>
            </tr>
          )}
          {doc.cabinetName && (
            <tr>
              <td className="py-1 align-top text-slate-500">{doc.kind === "shipment" ? "Кому" : "Кабинет"}</td>
              <td className="py-1 font-medium">{doc.cabinetName}</td>
            </tr>
          )}
          {doc.note && (
            <tr><td className="py-1 align-top text-slate-500">Основание</td><td className="py-1">{doc.note}</td></tr>
          )}
        </tbody>
      </table>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-slate-400 text-xs uppercase tracking-wide text-slate-600">
            <th className="w-8 py-2 text-left font-semibold">№</th>
            <th className="py-2 text-left font-semibold">Товар</th>
            <th className="py-2 text-left font-semibold">Штрихкод</th>
            {showCabinetColumn && <th className="py-2 text-left font-semibold">Кабинет</th>}
            <th className="py-2 text-right font-semibold">Кол-во</th>
            <th className="py-2 text-right font-semibold">Сумма, ₽</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((row, index) => (
            <tr key={index} className="border-b border-slate-200">
              <td className="py-2 text-slate-500">{index + 1}</td>
              <td className="py-2">
                <span className="font-medium">{variantLabel(row.article, row.sizeLabel)}</span>
                {row.nmId && <span className="ml-2 text-xs text-slate-400">WB {row.nmId}</span>}
              </td>
              <td className="py-2 text-slate-500">{row.barcode ?? "—"}</td>
              {showCabinetColumn && <td className="py-2 text-slate-600">{row.cabinetName ?? "—"}</td>}
              <td className="py-2 text-right font-semibold tabular-nums">{formatNumber(Math.abs(row.qty))}</td>
              <td className="py-2 text-right tabular-nums">{formatNumber(Math.round(Math.abs(row.amount)))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-400 font-semibold">
            <td className="py-2" colSpan={showCabinetColumn ? 4 : 3}>Итого</td>
            <td className="py-2 text-right tabular-nums">{formatNumber(doc.totalQty)}</td>
            <td className="py-2 text-right tabular-nums">{formatNumber(Math.round(doc.totalAmount))}</td>
          </tr>
        </tfoot>
      </table>

      <p className="mt-2 text-xs text-slate-500">
        Всего наименований {lines.length}, количество {formatNumber(doc.totalQty)} шт
        {doc.totalAmount ? ` на сумму ${formatNumber(Math.round(doc.totalAmount))} ₽ по складской себестоимости` : ""}.
      </p>

      <div className="mt-12 grid grid-cols-2 gap-12 text-sm">
        <div>
          <p className="text-slate-500">Отпустил</p>
          <div className="mt-8 border-b border-slate-400" />
          <p className="mt-1 text-xs text-slate-400">подпись, расшифровка{doc.createdBy ? ` · провёл ${doc.createdBy}` : ""}</p>
        </div>
        <div>
          <p className="text-slate-500">Принял</p>
          <div className="mt-8 border-b border-slate-400" />
          <p className="mt-1 text-xs text-slate-400">подпись, расшифровка</p>
        </div>
      </div>
    </div>
  );
}
