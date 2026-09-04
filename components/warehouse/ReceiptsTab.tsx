"use client";

import { FileWarning, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import type { ReceiptBatchRow } from "@/app/api/warehouse/receipts/route";
import type { WarehouseRow } from "@/app/api/warehouse/warehouses/route";
import { warehouseKindSuffix } from "@/lib/warehouse/warehouseKind";
import type { LegalEntityRow } from "@/lib/warehouse/entityAccess";
import type { ProductRow } from "@/lib/warehouse/productRow";
import { WbProductImage } from "@/components/wb/WbProductImage";
import { ReceiveModal } from "@/components/warehouse/ReceiveModal";
import { CorrectReceiptModal } from "@/components/warehouse/CorrectReceiptModal";
import { costNote } from "@/lib/warehouse/reasons";
import { plural } from "@/lib/warehouse/plural";
import type { VariantRow } from "@/app/api/warehouse/variants/route";

/** Строка новой приёмки. Количество живёт либо в `qty` — у безразмерного
 *  товара, либо в `sizes` — по одному числу на размер. «Новинка» — товар,
 *  которым ещё не торговали: флаг остаётся на карточке для запуска в РНП. */
interface DraftLine { productId: string; qty: string; sizes: Record<string, string>; novelty: boolean }

interface Draft {
  supplier: string;
  number: string;
  expectedAt: string;
  bagsCount: string;
  note: string;
  lines: DraftLine[];
}

const emptyLine = (): DraftLine => ({ productId: "", qty: "", sizes: {}, novelty: false });

/** «Не пересчитано» — красным: по ТЗ метка держится, пока фулфилмент не
 *  нажмёт «Пересчитано», и админ должен видеть её, не вчитываясь. */
const STATE_LABEL: Record<ReceiptBatchRow["state"], { text: string; className: string }> = {
  expected: { text: "не пересчитано", className: "bg-red-100 text-red-700" },
  received: { text: "пересчитано, не в остатке", className: "bg-amber-100 text-amber-800" },
  posted: { text: "в остатке", className: "bg-emerald-100 text-emerald-700" },
};

const date = (value: string | null | undefined) => (value ? new Date(value).toLocaleDateString("ru-RU") : "—");
const shortDate = (value: string) =>
  new Date(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });

/** Расхождение партии — недовоз и излишек порознь: −4 и +2 не схлопываются
 *  в «−2». Роут считает его по строкам; если шапки нет — по итогам партии,
 *  как экран делал раньше. */
function discrepancyOf(row: ReceiptBatchRow): { short: number; over: number } | null {
  if (row.discrepancy) return row.discrepancy;
  if (row.state === "expected") return null;
  return {
    short: Math.max(0, row.expectedQty - row.receivedQty),
    over: Math.max(0, row.receivedQty - row.expectedQty),
  };
}

const discrepancyText = (value: { short: number; over: number }) =>
  [
    value.short > 0 ? `недовоз −${formatNumber(value.short)}` : "",
    value.over > 0 ? `излишек +${formatNumber(value.over)}` : "",
  ].filter(Boolean).join(" · ");

export function ReceiptsTab({
  entityId,
  entity,
  warehouses,
  refreshKey,
  canManage,
  onPosted,
}: {
  entityId: string;
  entity: LegalEntityRow | null;
  warehouses: WarehouseRow[];
  refreshKey: number;
  /** Админ и менеджер правят принятое; оператору фулфилмента — только пересчёт. */
  canManage: boolean;
  onPosted: () => void;
}) {
  const [rows, setRows] = useState<ReceiptBatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Приходуют на реальный склад, а не на «В пути»: транзит — место для
  // перемещений, и приёмка туда по умолчанию — почти всегда ошибка выбора.
  const defaultTarget = (list: WarehouseRow[]) => (list.find((row) => row.kind !== "transit") ?? list[0])?.id ?? "";
  const [target, setTarget] = useState<string>(defaultTarget(warehouses));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  // Размеры выбранных моделей. Тянем по одной карточке: справочник вариантов
  // целиком — это тысячи строк ради трёх позиций в форме.
  const [sizes, setSizes] = useState<Record<string, VariantRow[]>>({});
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<ReceiptBatchRow | null>(null);
  const [correcting, setCorrecting] = useState<ReceiptBatchRow | null>(null);
  // Партия создана, но шапка легла не полностью (чаще всего занят номер).
  // Роут отвечает успехом — строки записаны, — и кладёт причину в error.
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!target && warehouses.length > 0) setTarget(defaultTarget(warehouses));
  }, [warehouses, target]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/receipts?entity=${entityId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить приёмки");
      setRows(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить приёмки");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  // Список товаров нужен только форме — тянем его при открытии, а не при каждом заходе.
  const loadSizes = useCallback(async (productId: string) => {
    if (!productId || sizes[productId]) return;
    try {
      const res = await fetch(`/api/warehouse/variants?product=${productId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить размеры");
      setSizes((prev) => ({ ...prev, [productId]: json.data ?? [] }));
    } catch {
      // Без размеров позиция останется безразмерной — приёмка на этом не встанет.
      setSizes((prev) => ({ ...prev, [productId]: [] }));
    }
  }, [sizes]);

  const openDraft = async () => {
    setDraft({ supplier: "", number: "", expectedAt: "", bagsCount: "", note: "", lines: [emptyLine()] });
    if (products.length > 0) return;
    try {
      const res = await fetch(`/api/warehouse/products?entity=${entityId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить товары");
      setProducts(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить товары");
    }
  };

  const createReceipt = async () => {
    if (!draft) return;
    // Размерная позиция разворачивается в строку на каждый размер: склад ведёт
    // остаток по размеру, и «40 штук куртки» на нём не лежат. Флаг новинки
    // уходит с каждой строкой — он про товар, и роут ставит его на карточку.
    const lines = draft.lines.flatMap((line): { productId: string; variantId: string | null; qty: number; novelty: boolean }[] => {
      if (!line.productId) return [];
      const bySize = Object.entries(line.sizes)
        .filter(([, qty]) => Number(qty) > 0)
        .map(([variantId, qty]) => ({ productId: line.productId, variantId, qty: Number(qty), novelty: line.novelty }));
      if (bySize.length > 0) return bySize;
      return Number(line.qty) > 0 ? [{ productId: line.productId, variantId: null, qty: Number(line.qty), novelty: line.novelty }] : [];
    });
    if (lines.length === 0) { setError("Добавьте позиции с количеством"); return; }
    setCreating(true);
    setError(null);
    try {
      const bags = Number(draft.bagsCount);
      const res = await fetch("/api/warehouse/receipts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          expectedAt: draft.expectedAt || null,
          note: draft.note,
          // Пустые поля шапки не шлём: номер тогда выдаст база, поставщик останется пустым.
          supplier: draft.supplier.trim() || undefined,
          number: draft.number.trim() || undefined,
          bagsCount: Number.isFinite(bags) && bags > 0 ? Math.round(bags) : undefined,
          lines,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось создать приёмку");
      setNotice(typeof json.error === "string" && json.error ? json.error : null);
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать приёмку");
    } finally {
      setCreating(false);
    }
  };

  const post = async (batchId: string) => {
    if (!target) { setError("Выберите склад, на который приходуем"); return; }
    setBusy(batchId);
    setError(null);
    try {
      const res = await fetch("/api/warehouse/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, batchId, warehouseId: target }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось провести приёмку");
      await load();
      onPosted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось провести приёмку");
    } finally {
      setBusy(null);
    }
  };

  /** Размеры модели, из которых выбирают. Базовый вариант безразмерного товара
   *  сюда не попадает: он представляет модель там, где размера просто нет. */
  const sized = (productId: string) => (sizes[productId] ?? []).filter((variant) => variant.isActive && !variant.isDefault);
  const lineTotal = (line: DraftLine) => Object.values(line.sizes).reduce((sum, qty) => sum + Number(qty || 0), 0);
  const updateLine = (index: number, patch: Partial<DraftLine>) =>
    setDraft((prev) => prev && ({ ...prev, lines: prev.lines.map((item, i) => (i === index ? { ...item, ...patch } : item)) }));

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Загружаю приёмки…</div>;

  const uncounted = rows.filter((row) => row.state === "expected");
  const pending = rows.filter((row) => row.state === "received");

  return (
    <div className="space-y-4">
      {receiving && (
        <ReceiveModal
          batchId={receiving.batchId}
          number={receiving.number}
          entityId={entityId}
          warehouseId={target}
          warehouseName={warehouses.find((warehouse) => warehouse.id === target)?.name ?? "не выбран"}
          onClose={() => setReceiving(null)}
          onDone={() => { void load(); onPosted(); }}
        />
      )}
      {correcting && (
        <CorrectReceiptModal
          batchId={correcting.batchId}
          number={correcting.number}
          entityId={entityId}
          onClose={() => setCorrecting(null)}
          onDone={() => { void load(); onPosted(); }}
        />
      )}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {notice && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{notice}</div>}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <span className="text-sm text-slate-500">Приходуем на склад</span>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
        >
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}{warehouseKindSuffix(warehouse.kind)}
            </option>
          ))}
        </select>
        {uncounted.length > 0 && (
          <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            {uncounted.length} {plural(uncounted.length, "партия не пересчитана", "партии не пересчитаны", "партий не пересчитаны")}
          </span>
        )}
        {pending.length > 0 && (
          <span className="text-sm text-amber-700">
            {pending.length} {plural(pending.length, "партия ждёт", "партии ждут", "партий ждут")} проведения
          </span>
        )}
        <button
          onClick={() => void openDraft()}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
        >
          <Plus className="h-4 w-4" /> Новая приёмка
        </button>
      </div>

      {draft && (
        <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-900">Новая приёмка</p>
            <button onClick={() => setDraft(null)} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Шапка партии из ТЗ: поставщик, номер, дата, мешки, комментарий. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">Поставщик</span>
              <input
                value={draft.supplier}
                onChange={(e) => setDraft({ ...draft, supplier: e.target.value })}
                placeholder="Фабрика"
                className="w-44 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-300"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">№</span>
              <input
                value={draft.number}
                onChange={(e) => setDraft({ ...draft, number: e.target.value })}
                placeholder="выдаётся сам: ПРМ-2026-…"
                className="w-48 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-300"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">Ждём</span>
              <input
                type="date"
                value={draft.expectedAt}
                onChange={(e) => setDraft({ ...draft, expectedAt: e.target.value })}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">Мешков</span>
              <input
                inputMode="numeric"
                value={draft.bagsCount}
                onChange={(e) => setDraft({ ...draft, bagsCount: e.target.value.replace(/[^\d]/g, "") })}
                className="w-20 rounded-lg border border-slate-200 px-3 py-1.5 text-right text-sm text-slate-700"
              />
            </label>
            <input
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              placeholder="Комментарий"
              className="min-w-48 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-300"
            />
          </div>

          <div className="space-y-2">
            {draft.lines.map((line, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <WbProductImage
                  nm={products.find((p) => p.id === line.productId)?.nmId ?? undefined}
                  src={products.find((p) => p.id === line.productId)?.photoUrl ?? undefined}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-lg border border-slate-200 bg-white object-cover"
                />
                <select
                  value={line.productId}
                  onChange={(e) => {
                    const productId = e.target.value;
                    void loadSizes(productId);
                    // Новинку подсказывает карточка: если товар уже помечен, галочка стоит сразу.
                    const novelty = products.find((p) => p.id === productId)?.isNovelty ?? false;
                    updateLine(index, { productId, qty: "", sizes: {}, novelty });
                  }}
                  className="min-w-64 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
                >
                  <option value="">выберите товар</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.article}{product.name && product.name !== product.article ? ` · ${product.name}` : ""}
                    </option>
                  ))}
                </select>
                {sized(line.productId).length === 0 ? (
                  <input
                    inputMode="numeric"
                    value={line.qty}
                    onChange={(e) => updateLine(index, { qty: e.target.value.replace(/[^\d]/g, "") })}
                    placeholder="кол-во"
                    className="w-28 rounded-lg border border-slate-200 px-3 py-1.5 text-right text-sm text-slate-700 placeholder:text-slate-300"
                  />
                ) : (
                  <div className="flex flex-wrap items-end gap-1.5">
                    {sized(line.productId).map((variant) => (
                      <label key={variant.id} className="w-16">
                        <span className="block text-center text-[11px] text-slate-400">{variant.sizeLabel}</span>
                        <input
                          inputMode="numeric"
                          value={line.sizes[variant.id] ?? ""}
                          onChange={(e) => updateLine(index, { sizes: { ...line.sizes, [variant.id]: e.target.value.replace(/[^\d]/g, "") } })}
                          className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-center text-sm text-slate-700"
                        />
                      </label>
                    ))}
                    <span className="pb-1.5 text-xs text-slate-400">
                      {lineTotal(line) > 0 ? `${formatNumber(lineTotal(line))} шт` : ""}
                    </span>
                  </div>
                )}
                {/* Новинка — отметка для запуска в РНП, то есть правка справочника.
                    Оператору фулфилмента она закрыта, и сервер её от него не примет. */}
                {canManage && (
                  <label
                    title="Товар, которым ещё не торговали: флаг остаётся на карточке для запуска в РНП"
                    className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs ${line.novelty ? "bg-violet-100 text-violet-700" : "text-slate-500"}`}
                  >
                    <input type="checkbox" checked={line.novelty} onChange={(e) => updateLine(index, { novelty: e.target.checked })} />
                    новинка
                  </label>
                )}
                {draft.lines.length > 1 && (
                  <button
                    onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })}
                    className="text-slate-400 hover:text-red-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setDraft({ ...draft, lines: [...draft.lines, emptyLine()] })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600"
            >
              + позиция
            </button>
            <button
              onClick={() => void createReceipt()}
              disabled={creating}
              className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {creating ? "Создаю…" : "Создать приёмку"}
            </button>
            <p className="text-xs text-slate-400">Фулфилмент пересчитает при разгрузке.</p>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-700">Приёмок ещё не было</p>
          <p className="mt-1 text-sm text-slate-400">
            {entity && entity.cabinets.filter((link) => link.relation === "own").length === 0
              ? `У юрлица «${entity.name}» нет собственных кабинетов — приёмки заводить не в чем.`
              : "Партии приходят сюда из заказа фабрике — либо заводятся вручную кнопкой «Новая приёмка»."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 text-left font-medium">Номер · поставщик</th>
                <th className="px-4 py-3 text-left font-medium">Ждали</th>
                <th className="px-4 py-3 text-left font-medium">Состояние</th>
                <th className="px-4 py-3 text-right font-medium">Ждали / приняли</th>
                <th className="px-4 py-3 text-right font-medium">Брак</th>
                <th className="px-4 py-3 text-right font-medium">Себестоимость</th>
                <th className="px-4 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const state = STATE_LABEL[row.state];
                const discrepancy = discrepancyOf(row);
                const hasDiscrepancy = Boolean(discrepancy && (discrepancy.short > 0 || discrepancy.over > 0));
                const counted = row.state !== "expected";
                const bags = row.bagsCount ?? 0;
                const subtitle = [
                  row.supplier ?? "",
                  bags > 0 ? `${bags} ${plural(bags, "мешок", "мешка", "мешков")}` : "",
                  `${row.lineCount} ${plural(row.lineCount, "позиция", "позиции", "позиций")}`,
                ].filter(Boolean).join(" · ");
                return (
                  <tr key={row.batchId} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={row.number ? "font-medium text-slate-900" : "text-slate-400"}>{row.number ?? "без номера"}</span>
                        {row.hasNovelty && (
                          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700">новинка</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400">{subtitle}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-900">{date(row.expectedAt)}</div>
                      {row.note && <div className="mt-0.5 max-w-xs truncate text-xs text-slate-400">{row.note}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${state.className}`}>{state.text}</span>
                      {counted && row.countedBy ? (
                        <div className="mt-0.5 text-xs text-slate-400">
                          пересчитал(а) {row.countedBy}{row.countedAt ? ` · ${shortDate(row.countedAt)}` : ""}
                        </div>
                      ) : row.postedAt ? (
                        <div className="mt-0.5 text-xs text-slate-400">{date(row.postedAt)}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-slate-500">{formatNumber(row.expectedQty)}</span>
                      <span className="mx-1 text-slate-300">/</span>
                      {counted ? (
                        <span className={`font-semibold ${hasDiscrepancy ? "text-amber-700" : "text-slate-900"}`}>
                          {formatNumber(row.receivedQty)}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                      {discrepancy && hasDiscrepancy && (
                        <div className="mt-1">
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                            {discrepancyText(discrepancy)}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!counted
                        ? <span className="text-slate-300">—</span>
                        : row.defectQty > 0
                          ? <span className="font-semibold text-red-600">{formatNumber(row.defectQty)}</span>
                          : <span className="text-slate-500">0</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.cost ? (
                        <>
                          <div className="font-medium text-slate-900">{formatNumber(Math.round(row.cost.total))} ₽</div>
                          <div className="text-xs text-slate-400">{row.cost.unit.toFixed(2)} ₽/шт</div>
                          {row.cost.basis === "estimated" && (
                            <div className="mt-0.5 text-xs text-amber-600" title={costNote(row.cost.note) ?? undefined}>
                              ≈ расчётная
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {counted && (hasDiscrepancy || row.defectQty > 0) && (
                          <a
                            href={`/warehouse/print/receipt/${row.batchId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                          >
                            <FileWarning className="h-3.5 w-3.5" /> Акт расхождений
                          </a>
                        )}
                        {row.state === "expected" && (
                          <button
                            onClick={() => setReceiving(row)}
                            className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-50"
                          >
                            Пересчитать
                          </button>
                        )}
                        {row.state === "received" && (
                          <button
                            onClick={() => void post(row.batchId)}
                            disabled={busy === row.batchId || !target}
                            className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                          >
                            {busy === row.batchId ? "Ставлю…" : "Поставить на остаток"}
                          </button>
                        )}
                        {canManage && (
                          <button
                            onClick={() => setCorrecting(row)}
                            title="Поправить принятое, брак или ожидание; проведённые строки правятся разницей в регистре"
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                          >
                            Скорректировать
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
