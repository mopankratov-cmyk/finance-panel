"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import { plural } from "@/lib/warehouse/plural";
import type { StockMoveRow } from "@/app/api/warehouse/moves/route";
import { WbProductImage } from "@/components/wb/WbProductImage";

const KIND_LABEL: Record<StockMoveRow["kind"], string> = {
  receipt: "приёмка",
  shipment: "отгрузка",
  writeoff: "списание",
  return: "возврат",
  adjustment: "корректировка",
  transfer: "перемещение",
  sale: "продажа FBS",
};

/** Неизвестный вид показываем сырым кодом, а не пустотой: следующая новая
 *  операция в базе иначе снова пропадёт из журнала молча — так и случилось с
 *  продажами FBS. */
const kindLabel = (kind: string) => KIND_LABEL[kind as StockMoveRow["kind"]] ?? kind;

/** Тип документа по-русски. Показываем его, только когда номера нет: код вроде
 *  `purchase_receipt` в колонке «Документ» человеку ничего не говорит. */
const DOC_TYPE_LABEL: Record<string, string> = {
  purchase_receipt: "приёмка",
  shipment: "отгрузка",
  transfer: "перемещение",
  writeoff: "списание",
  return: "возврат",
  adjustment: "корректировка",
  sale: "продажа FBS",
};
const docLabel = (row: StockMoveRow) => row.docNumber ?? DOC_TYPE_LABEL[row.docType] ?? row.docType;

const stamp = (value: string) =>
  new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

export function MovesTab({ entityId, refreshKey }: { entityId: string; refreshKey: number }) {
  const [rows, setRows] = useState<StockMoveRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Журнал без поиска отвечает на вопрос «куда делись 20 штук NV-01-44»
  // листанием. Фильтруем на клиенте: строки уже здесь, лишний круг к серверу
  // на этом экране стоит секунды (см. замер: /api/warehouse/moves — 5 с).
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | StockMoveRow["kind"]>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/moves?entity=${entityId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить движения");
      setRows(json.data?.rows ?? []);
      setTruncated(Boolean(json.data?.truncated));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить движения");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (kind !== "all" && row.kind !== kind) return false;
      if (!needle) return true;
      return [row.article, row.warehouseName, row.docNumber, docLabel(row), row.createdBy, row.note, String(row.nmId)]
        .some((field) => String(field ?? "").toLowerCase().includes(needle));
    });
  }, [rows, query, kind]);
  const kinds = useMemo(() => [...new Set(rows.map((row) => row.kind))], [rows]);

    // Заглушка — только пока данных нет ВООБЩЕ. Раньше она подменяла собой уже
  // показанное на каждое «Обновить»: экран мигал пустотой, а вкладка, которая
  // теперь остаётся смонтированной, теряла бы вид при любом обновлении соседней.
  if (loading && rows.length === 0) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Загружаю журнал…</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm font-medium text-slate-700">Журнал пуст</p>
        <p className="mt-1 text-sm text-slate-400">Первая запись появится, когда проведёте приёмку.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Артикул, склад, документ или кто"
          className="min-h-11 w-full max-w-sm rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-violet-400 sm:min-h-9"
        />
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as typeof kind)}
          className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-violet-400 sm:min-h-9"
        >
          <option value="all">Все операции</option>
          {kinds.map((value) => <option key={value} value={value}>{kindLabel(value)}</option>)}
        </select>
        <span className="text-xs text-slate-400">
          {visible.length === rows.length
            ? `${formatNumber(rows.length)} ${plural(rows.length, "запись", "записи", "записей")}`
            : `${formatNumber(visible.length)} из ${formatNumber(rows.length)}`}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 text-left font-medium">Когда</th>
              <th className="px-4 py-3 text-left font-medium">Что</th>
              <th className="px-4 py-3 text-left font-medium"></th>
              <th className="px-4 py-3 text-left font-medium">Артикул</th>
              <th className="px-4 py-3 text-left font-medium">Склад</th>
              <th className="px-4 py-3 text-left font-medium">Документ</th>
              <th className="px-4 py-3 text-left font-medium">Кто</th>
              <th className="px-4 py-3 text-right font-medium">Кол-во</th>
              <th className="px-4 py-3 text-right font-medium">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2.5 text-slate-500">{stamp(row.occurredAt)}</td>
                <td className="px-4 py-2.5 text-slate-700">{kindLabel(row.kind)}</td>
                <td className="py-2 pl-4 pr-0">
                  <WbProductImage
                    nm={row.nmId ?? undefined}
                    alt={row.article}
                    label={row.article}
                    className="h-9 w-9 rounded-lg border border-slate-100 bg-slate-50 object-cover"
                  />
                </td>
                <td className="px-4 py-2.5 font-medium text-slate-900">{row.article || row.nmId}</td>
                <td className="px-4 py-2.5 text-slate-600">{row.warehouseName}</td>
                <td className="px-4 py-2.5 text-slate-600">
                  {/* Строку «списание −12» без документа и автора нечем объяснить
                      бухгалтеру: приходилось идти на «Документы» и сверять по времени. */}
                  {row.docId ? (
                    <a href={`/warehouse/print/${row.docId}`} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-slate-900">
                      {docLabel(row)}
                    </a>
                  ) : <span className="text-slate-400">{docLabel(row)}</span>}
                  {row.note ? <span className="block text-[11px] text-slate-400">{row.note}</span> : null}
                </td>
                <td className="px-4 py-2.5 text-slate-500">{row.createdBy || <span className="text-slate-300">—</span>}</td>
                <td className={`px-4 py-2.5 text-right font-semibold ${row.qty > 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {row.qty > 0 ? "+" : ""}{formatNumber(row.qty)}
                </td>
                <td className="px-4 py-2.5 text-right text-slate-600">
                  {row.amount === 0 ? <span className="text-slate-300">—</span> : `${formatNumber(Math.round(row.amount))} ₽`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && (
        <p className="text-xs text-amber-600">
          Показаны последние 200 движений.
        </p>
      )}
    </div>
  );
}
