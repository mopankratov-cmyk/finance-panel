"use client";

import { Printer } from "lucide-react";
import { formatNumber } from "@/lib/analytics/format";
import { variantLabel } from "@/lib/warehouse/variantLabel";
import { plural } from "@/lib/warehouse/plural";

export interface DiscrepancyLine {
  article: string;
  sizeLabel: string;
  nmId: number | null;
  barcode: string | null;
  expectedQty: number;
  receivedQty: number;
  defectQty: number;
  /** false, пока строку никто не пересчитал (purchase_receipts.status='expected').
   *  Пересчёт партии может идти по частям — счётчик пишет "пересчитано" в шапку
   *  уже по первой сохранённой строке, а остальные ждут своей очереди. Печатать
   *  такую строку как «принято 0» значит подписывать недостачу, которой,
   *  возможно, не было — просто её ещё не смотрели. */
  counted: boolean;
}

export interface DiscrepancyDoc {
  batchId: string;
  entityName: string;
  entityInn: string | null;
  warehouseName: string | null;
  expectedAt: string | null;
  receivedAt: string | null;
  note: string | null;
  createdBy: string | null;
  lines: DiscrepancyLine[];
}

const date = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" }) : "—";

/** Акт расхождений: то, чем спорят с фулфилментом и с фабрикой.
 *
 *  В таблицу идут только позиции, где факт разошёлся с ожиданием или нашёлся
 *  брак. Полный список приехавшего — это накладная, а не акт: подпись ставят
 *  под спорным, и лист на сто строк с одной проблемой посередине эту подпись
 *  обесценивает. */
export function PrintableDiscrepancy({ doc }: { doc: DiscrepancyDoc }) {
  // Непересчитанная строка — тоже проблема акта (см. counted выше): её нельзя
  // молча признать «расхождений нет», даже если receivedQty совпал с expectedQty
  // по дефолту (для несчитанной строки это ноль, а не факт).
  const problems = doc.lines.filter((row) => !row.counted || row.receivedQty !== row.expectedQty || row.defectQty > 0);
  const uncounted = doc.lines.filter((row) => !row.counted);
  // Недовоз и излишек считаем порознь, а не одной разницей. Партия, где одного
  // размера не хватило, а другого приехало лишку, в сумме сходится — и итог
  // «расхождений нет» под строками с ±1 читался бы как опровержение акта.
  // Непересчитанные строки не участвуют в фактических суммах (принято/брак/
  // недовоз/излишек) — по ним факта ещё нет, и ноль в сумме был бы враньём,
  // тем же самым, которое чинит эта правка на уровне строки.
  const totals = doc.lines.reduce(
    (acc, row) => {
      // expected — по всей партии (это известно и по непересчитанным строкам);
      // остальное — только по пересчитанным, у непересчитанных факта ещё нет.
      acc.expected += row.expectedQty;
      if (!row.counted) return acc;
      acc.countedExpected += row.expectedQty;
      acc.received += row.receivedQty;
      acc.defect += row.defectQty;
      acc.short += Math.max(0, row.expectedQty - row.receivedQty);
      acc.over += Math.max(0, row.receivedQty - row.expectedQty);
      return acc;
    },
    { expected: 0, countedExpected: 0, received: 0, defect: 0, short: 0, over: 0 },
  );

  return (
    // Акт проверяют с планшета перед подписанием: на узком экране поля вдвое
    // меньше, а семь колонок едут внутри своего блока, а не тянут страницу.
    // Печать не страдает — под @media print прокрутка возвращается в поток.
    <div className="mx-auto max-w-[820px] bg-white p-4 text-slate-900 sm:p-8 print:p-0">
      <style>{`@media print { .no-print { display: none !important; } .scroll-x { overflow: visible !important; } @page { margin: 16mm; } }`}</style>

      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <p className="text-sm text-slate-500">Проверьте состав и подпишите оба экземпляра.</p>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
        >
          <Printer className="h-4 w-4" /> Печать
        </button>
      </div>

      <header className="mb-6">
        <h1 className="text-xl font-bold">Акт о расхождении по количеству и качеству</h1>
        <p className="mt-1 text-sm text-slate-600">приёмка от {date(doc.receivedAt)}</p>
      </header>

      <table className="mb-6 w-full text-sm">
        <tbody>
          <tr>
            <td className="w-40 py-1 align-top text-slate-500">Юрлицо</td>
            <td className="py-1 font-medium">{doc.entityName}{doc.entityInn ? `, ИНН ${doc.entityInn}` : ""}</td>
          </tr>
          {doc.warehouseName && (
            <tr><td className="py-1 align-top text-slate-500">Склад</td><td className="py-1">{doc.warehouseName}</td></tr>
          )}
          {doc.expectedAt && (
            <tr><td className="py-1 align-top text-slate-500">Ждали</td><td className="py-1">{date(doc.expectedAt)}</td></tr>
          )}
          {doc.note && (
            <tr><td className="py-1 align-top text-slate-500">Основание</td><td className="py-1">{doc.note}</td></tr>
          )}
          <tr>
            <td className="py-1 align-top text-slate-500">Партия</td>
            <td className="py-1 text-xs text-slate-500">{doc.batchId}</td>
          </tr>
        </tbody>
      </table>

      {uncounted.length > 0 && (
        // Печать по прямой ссылке из журнала документов раньше не смотрела на
        // статус партии вовсе (DocsTab отдавал ссылку и на "expected"). Пока
        // хоть одна строка ждёт пересчёта, акт — черновик: по ней ниже стоит
        // явная пометка вместо цифры, а не молчаливый ноль.
        <p className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 print:border-amber-500">
          Партия пересчитана не полностью: {uncounted.length}{" "}
          {plural(uncounted.length, "позиция ещё не пересчитана", "позиции ещё не пересчитаны", "позиций ещё не пересчитаны")}.
          Акт по ним предварительный — их пометили «не пересчитано», а не как недостачу.
        </p>
      )}

      {problems.length === 0 ? (
        <p className="rounded border border-slate-300 px-4 py-6 text-center text-sm">
          Расхождений нет: принято {formatNumber(totals.received)} шт из {formatNumber(totals.expected)} ожидаемых, брак не выявлен.
        </p>
      ) : (
        <div className="scroll-x">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-slate-400 text-xs uppercase tracking-wide text-slate-600">
                <th className="w-8 py-2 text-left font-semibold">№</th>
                <th className="py-2 text-left font-semibold">Товар</th>
                <th className="py-2 text-left font-semibold">Штрихкод</th>
                <th className="py-2 text-right font-semibold">Ждали</th>
                <th className="py-2 text-right font-semibold">Приняли</th>
                <th className="py-2 text-right font-semibold">Расхождение</th>
                <th className="py-2 text-right font-semibold">Брак</th>
              </tr>
            </thead>
            <tbody>
              {problems.map((row, index) => {
                // Непересчитанная строка не имеет факта — ни расхождения, ни
                // брака ей приписать нельзя, только явную пометку.
                if (!row.counted) {
                  return (
                    <tr key={index} className="border-b border-slate-200">
                      <td className="py-2 text-slate-500">{index + 1}</td>
                      <td className="py-2">
                        <span className="break-anywhere font-medium">{variantLabel(row.article, row.sizeLabel)}</span>
                        {row.nmId && <span className="ml-2 text-xs text-slate-400">WB {row.nmId}</span>}
                      </td>
                      <td className="break-anywhere py-2 text-slate-500">{row.barcode ?? "—"}</td>
                      <td className="py-2 text-right tabular-nums">{formatNumber(row.expectedQty)}</td>
                      <td className="py-2 text-right font-medium italic tabular-nums text-amber-700" colSpan={3}>
                        не пересчитано
                      </td>
                    </tr>
                  );
                }
                const gap = row.receivedQty - row.expectedQty;
                return (
                  <tr key={index} className="border-b border-slate-200">
                    <td className="py-2 text-slate-500">{index + 1}</td>
                    <td className="py-2">
                      <span className="break-anywhere font-medium">{variantLabel(row.article, row.sizeLabel)}</span>
                      {row.nmId && <span className="ml-2 text-xs text-slate-400">WB {row.nmId}</span>}
                    </td>
                    <td className="break-anywhere py-2 text-slate-500">{row.barcode ?? "—"}</td>
                    <td className="py-2 text-right tabular-nums">{formatNumber(row.expectedQty)}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{formatNumber(row.receivedQty)}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">
                      {gap === 0 ? "—" : `${gap > 0 ? "+" : "−"}${formatNumber(Math.abs(gap))}`}
                    </td>
                    <td className="py-2 text-right tabular-nums">{row.defectQty || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-400 font-semibold">
                <td className="py-2" colSpan={3}>Итого по партии{uncounted.length > 0 ? " (без непересчитанных)" : ""}</td>
                <td className="py-2 text-right tabular-nums">{formatNumber(totals.countedExpected)}</td>
                <td className="py-2 text-right tabular-nums">{formatNumber(totals.received)}</td>
                <td className="py-2 text-right tabular-nums">
                  {totals.short === 0 && totals.over === 0
                    ? "—"
                    : [totals.short ? `−${formatNumber(totals.short)}` : "", totals.over ? `+${formatNumber(totals.over)}` : ""].filter(Boolean).join(" / ")}
                </td>
                <td className="py-2 text-right tabular-nums">{totals.defect || "—"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {problems.length > 0 && (
        <p className="mt-2 text-sm">
          Расхождения по {problems.length} из {doc.lines.length} позиций партии:
          {totals.short > 0 ? ` недовоз ${formatNumber(totals.short)} шт;` : ""}
          {totals.over > 0 ? ` излишек ${formatNumber(totals.over)} шт;` : ""}
          {totals.defect > 0 ? ` брак ${formatNumber(totals.defect)} шт;` : ""}
          {" "}принято всего {formatNumber(totals.received)} шт из {formatNumber(totals.countedExpected)} пересчитанных
          {uncounted.length > 0 ? `; ещё ${formatNumber(uncounted.reduce((sum, row) => sum + row.expectedQty, 0))} шт (${uncounted.length}) не пересчитано` : ""}.
        </p>
      )}

      <div className="mt-12 grid gap-8 text-sm sm:grid-cols-2 sm:gap-12 print:grid-cols-2 print:gap-12">
        <div>
          <p className="text-slate-500">Принял</p>
          <div className="mt-8 border-b border-slate-400" />
          <p className="mt-1 text-xs text-slate-400">подпись, расшифровка{doc.createdBy ? ` · ${doc.createdBy}` : ""}</p>
        </div>
        <div>
          <p className="text-slate-500">Сдал</p>
          <div className="mt-8 border-b border-slate-400" />
          <p className="mt-1 text-xs text-slate-400">подпись, расшифровка</p>
        </div>
      </div>
    </div>
  );
}
