"use client";

import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import type { ReceiptBatchRow } from "@/app/api/warehouse/receipts/route";
import type { WarehouseRow } from "@/app/api/warehouse/warehouses/route";
import { warehouseKindSuffix } from "@/lib/warehouse/warehouseKind";
import type { LegalEntityRow } from "@/lib/warehouse/entityAccess";
import type { ProductRow } from "@/lib/warehouse/productRow";
import { WbProductImage } from "@/components/wb/WbProductImage";
import { ReceiveModal } from "@/components/warehouse/ReceiveModal";
import { costNote } from "@/lib/warehouse/reasons";

const STATE_LABEL: Record<ReceiptBatchRow["state"], { text: string; className: string }> = {
  expected: { text: "ждём", className: "bg-slate-100 text-slate-600" },
  received: { text: "принято, не в остатке", className: "bg-amber-100 text-amber-800" },
  posted: { text: "в остатке", className: "bg-emerald-100 text-emerald-700" },
};

const date = (value: string | null) => (value ? new Date(value).toLocaleDateString("ru-RU") : "—");

export function ReceiptsTab({
  entityId,
  entity,
  warehouses,
  refreshKey,
  onPosted,
}: {
  entityId: string;
  entity: LegalEntityRow | null;
  warehouses: WarehouseRow[];
  refreshKey: number;
  onPosted: () => void;
}) {
  const [rows, setRows] = useState<ReceiptBatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [target, setTarget] = useState<string>(warehouses[0]?.id ?? "");
  const [draft, setDraft] = useState<{ expectedAt: string; note: string; lines: { productId: string; qty: string }[] } | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<string | null>(null);

  useEffect(() => {
    if (!target && warehouses.length > 0) setTarget(warehouses[0].id);
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
  const openDraft = async () => {
    setDraft({ expectedAt: "", note: "", lines: [{ productId: "", qty: "" }] });
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
    const lines = draft.lines
      .filter((line) => line.productId && Number(line.qty) > 0)
      .map((line) => ({ productId: line.productId, qty: Number(line.qty) }));
    if (lines.length === 0) { setError("Добавьте позиции с количеством"); return; }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/warehouse/receipts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, expectedAt: draft.expectedAt || null, note: draft.note, lines }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось создать поставку");
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать поставку");
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

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Загружаю приёмки…</div>;

  const pending = rows.filter((row) => row.state === "received");

  return (
    <div className="space-y-4">
      {receiving && (
        <ReceiveModal
          batchId={receiving}
          onClose={() => setReceiving(null)}
          onDone={() => { void load(); onPosted(); }}
        />
      )}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

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
        {pending.length > 0 && (
          <span className="text-sm text-amber-700">
            {pending.length} {pending.length === 1 ? "партия ждёт" : "партий ждут"} проведения
          </span>
        )}
        <button
          onClick={() => void openDraft()}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
        >
          <Plus className="h-4 w-4" /> Новая поставка
        </button>
      </div>

      {draft && (
        <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-900">Новая поставка</p>
            <button onClick={() => setDraft(null)} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            <label className="text-sm">
              <span className="mr-2 text-slate-500">Ждём</span>
              <input
                type="date"
                value={draft.expectedAt}
                onChange={(e) => setDraft({ ...draft, expectedAt: e.target.value })}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
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
                  onChange={(e) => setDraft({
                    ...draft,
                    lines: draft.lines.map((item, i) => i === index ? { ...item, productId: e.target.value } : item),
                  })}
                  className="min-w-64 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
                >
                  <option value="">выберите товар</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.article}{product.name && product.name !== product.article ? ` · ${product.name}` : ""}
                    </option>
                  ))}
                </select>
                <input
                  inputMode="numeric"
                  value={line.qty}
                  onChange={(e) => setDraft({
                    ...draft,
                    lines: draft.lines.map((item, i) => i === index ? { ...item, qty: e.target.value.replace(/[^\d]/g, "") } : item),
                  })}
                  placeholder="кол-во"
                  className="w-28 rounded-lg border border-slate-200 px-3 py-1.5 text-right text-sm text-slate-700 placeholder:text-slate-300"
                />
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
              onClick={() => setDraft({ ...draft, lines: [...draft.lines, { productId: "", qty: "" }] })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600"
            >
              + позиция
            </button>
            <button
              onClick={() => void createReceipt()}
              disabled={creating}
              className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {creating ? "Создаю…" : "Создать поставку"}
            </button>
            <p className="text-xs text-slate-400">
              Отметьте факт приёмки, когда товар приедет.
            </p>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-700">Приёмок ещё не было</p>
          <p className="mt-1 text-sm text-slate-400">
            {entity && entity.cabinets.filter((link) => link.relation === "own").length === 0
              ? `У юрлица «${entity.name}» нет собственных кабинетов — приёмки заводить не в чем.`
              : "Партии приходят сюда из заказа фабрике — либо заводятся вручную во вкладке «Приёмка» раздела «Закупки»."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 text-left font-medium">Ждали</th>
                <th className="px-4 py-3 text-left font-medium">Состояние</th>
                <th className="px-4 py-3 text-left font-medium">Позиций</th>
                <th className="px-4 py-3 text-right font-medium">Ждали / приняли</th>
                <th className="px-4 py-3 text-right font-medium">Себестоимость</th>
                <th className="px-4 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const state = STATE_LABEL[row.state];
                const short = row.receivedQty < row.expectedQty && row.state !== "expected";
                return (
                  <tr key={row.batchId} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3">
                      <div className="text-slate-900">{date(row.expectedAt)}</div>
                      {row.note && <div className="mt-0.5 max-w-xs truncate text-xs text-slate-400">{row.note}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${state.className}`}>{state.text}</span>
                      {row.postedAt && <div className="mt-0.5 text-xs text-slate-400">{date(row.postedAt)}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.lineCount}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-slate-500">{formatNumber(row.expectedQty)}</span>
                      <span className="mx-1 text-slate-300">/</span>
                      <span className={`font-semibold ${short ? "text-amber-600" : "text-slate-900"}`}>
                        {formatNumber(row.receivedQty)}
                      </span>
                      {short && <div className="text-xs text-amber-600">недовоз {formatNumber(row.expectedQty - row.receivedQty)}</div>}
                      {row.defectQty > 0 && <div className="text-xs text-red-600">брак {formatNumber(row.defectQty)}</div>}
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
                      {row.state === "expected" && (
                        <button
                          onClick={() => setReceiving(row.batchId)}
                          className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-50"
                        >
                          Принять
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
