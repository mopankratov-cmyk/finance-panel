"use client";

import { Plus, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useDraft } from "@/lib/warehouse/useDraft";
import { DraftNotice } from "@/components/warehouse/DraftNotice";
import { formatNumber } from "@/lib/analytics/format";
import { WbProductImage } from "@/components/wb/WbProductImage";
import type { WriteoffRow, WriteoffsResponse } from "@/app/api/warehouse/writeoffs/route";
import type { StockBalancesResponse } from "@/app/api/warehouse/balances/route";
import type { WarehouseRow } from "@/app/api/warehouse/warehouses/route";
import { writeoffReason, writeoffSource } from "@/lib/warehouse/reasons";
import { variantLabel } from "@/lib/warehouse/variantLabel";
import { newDocKey } from "@/lib/warehouse/docKey";

interface Draft { warehouseId: string; date: string; reason: string; lines: { variantId: string; qty: string }[] }

const money = (value: number) => `${formatNumber(Math.round(value))} ₽`;
const stamp = (value: string) =>
  new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Сегодня в местном времени: `toISOString` даёт UTC, и вечером дата брака
 *  уехала бы на завтра. */
const todayIso = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

export function DefectsTab({
  entityId,
  warehouses,
  refreshKey,
  canManage,
  onChanged,
}: {
  entityId: string;
  warehouses: WarehouseRow[];
  refreshKey: number;
  /** Вернуть брак в остаток (сторно) могут админ и менеджер; оператор — только создать. */
  canManage: boolean;
  onChanged: () => void;
}) {
  const [data, setData] = useState<WriteoffsResponse | null>(null);
  const [stock, setStock] = useState<StockBalancesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/writeoffs?entity=${entityId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить списания");
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить списания");
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const loadStock = useCallback(async () => {
    try {
      const res = await fetch(`/api/warehouse/balances?entity=${entityId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить остатки");
      setStock(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить остатки");
    }
  }, [entityId]);

  const openDraft = async () => {
    // Брак находят на реальном складе, не «В пути».
    setDraft({ warehouseId: (warehouses.find((row) => row.kind !== "transit") ?? warehouses[0])?.id ?? "", date: todayIso(), reason: "", lines: [{ variantId: "", qty: "" }] });
    if (!stock) await loadStock();
  };

  // Незаконченное списание переживает перезагрузку: форма открывается там же,
  // где её оставили, вместе с позициями и причиной. Дата пустоты не отменяет:
  // она стоит по умолчанию, и черновик из одной даты — не черновик.
  const { restoredAt, forget } = useDraft(
    loading ? null : `warehouse:writeoff:${entityId}`,
    draft,
    useCallback((value: Draft | null) =>
      !value || (!value.reason && value.lines.every((line) => !line.variantId && !line.qty)), []),
    useCallback((value: Draft | null) => {
      setDraft(value ? { ...value, date: value.date || todayIso() } : null);
      void loadStock();
    }, [loadStock]),
  );

  const submit = async () => {
    if (!draft) return;
    const lines = draft.lines
      .filter((line) => line.variantId && Number(line.qty) > 0)
      .map((line) => ({ variantId: line.variantId, qty: Number(line.qty) }));
    if (lines.length === 0) { setError("Добавьте позиции с количеством"); return; }
    setSaving(true);
    setError(null);
    setNotice(null);
    setDone(null);
    try {
      const res = await fetch("/api/warehouse/writeoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          warehouseId: draft.warehouseId,
          reason: draft.reason,
          occurredAt: draft.date || undefined,
          lines,
          docKey: newDocKey(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось списать");
      // База без миграции не умеет дату брака: списание прошло сегодняшним
      // числом, и человек должен это знать, а не обнаружить в журнале.
      if (json.data?.dateIgnored) setNotice("Дата не сохранена: база ещё без миграции — брак записан сегодняшним числом");
      setDraft(null);
      forget();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось списать");
    } finally {
      setSaving(false);
    }
  };

  // Сторно документа списания: товар возвращается в остаток, а сама запись
  // остаётся в журнале приглушённой — история не переписывается.
  const revert = async (row: WriteoffRow) => {
    if (!row.docId) return;
    const label = row.docNumber ?? "списание";
    if (!window.confirm(`Вернуть в остаток ${label}? Документ останется в журнале с пометкой.`)) return;
    setBusy(row.id);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/warehouse/docs/${row.docId}/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось вернуть в остаток");
      setDone(`${formatNumber(json.data.qty)} шт вернулись в остаток · ${json.data.number} отменяет ${json.data.reverses}`);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось вернуть в остаток");
    } finally {
      setBusy(null);
    }
  };

  const available = (stock?.rows ?? []).filter((row) => !draft?.warehouseId || row.warehouseId === draft.warehouseId);
  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {notice && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{notice}</div>}
      {done && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{done}</div>}
      <DraftNotice at={restoredAt} onForget={() => { setDraft(null); forget(); }} />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Списано за месяц</p>
          <p className="text-xl font-bold text-red-600">{data ? formatNumber(data.monthQty) : "—"}</p>
          <p className="mt-1 text-xs text-slate-400">{data ? money(data.monthAmount) : ""}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Записей в журнале</p>
          <p className="text-xl font-bold text-slate-900">{data ? formatNumber(data.rows.length) : "—"}</p>
          <p className="mt-1 text-xs text-slate-400">{data?.truncated ? "показаны последние 200" : "все"}</p>
        </div>
        <div className="flex items-center justify-end rounded-xl border border-slate-200 bg-white p-4">
          <button
            onClick={() => void openDraft()}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            <Plus className="h-4 w-4" /> Создать брак
          </button>
        </div>
      </div>

      {draft && (
        <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-900">Новый брак</p>
            <button onClick={() => { setDraft(null); forget(); }} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select
              value={draft.warehouseId}
              onChange={(e) => setDraft({ ...draft, warehouseId: e.target.value, lines: [{ variantId: "", qty: "" }] })}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
            >
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">Дата</span>
              <input
                type="date"
                value={draft.date}
                max={todayIso()}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                title="Когда брак обнаружен: журнал и итог месяца считаются по этой дате"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
              />
            </label>
            <input
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
              placeholder="Причина: разошёлся шов, пятно, бой"
              className="min-w-56 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-300"
            />
          </div>

          <div className="space-y-2">
            {draft.lines.map((line, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <select
                  value={line.variantId}
                  onChange={(e) => setDraft({
                    ...draft,
                    lines: draft.lines.map((item, i) => i === index ? { ...item, variantId: e.target.value } : item),
                  })}
                  className="min-w-64 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
                >
                  <option value="">выберите позицию со склада</option>
                  {available.map((row) => (
                    <option key={row.variantId} value={row.variantId}>
                      {variantLabel(row.article, row.sizeLabel)} — на складе {row.qty}
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
              onClick={() => setDraft({ ...draft, lines: [...draft.lines, { variantId: "", qty: "" }] })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600"
            >
              + позиция
            </button>
            <button
              onClick={() => void submit()}
              disabled={saving}
              className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? "Списываю…" : "Списать"}
            </button>
            <p className="text-xs text-slate-400">Причина обязательна: «просто пропало» не бывает.</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Загружаю журнал…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-700">Списаний не было</p>
          <p className="mt-1 text-sm text-slate-400">Брак при приёмке попадает сюда сам, отдельной строкой.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 text-left font-medium">Документ</th>
                <th className="px-4 py-3 text-left font-medium"></th>
                <th className="px-4 py-3 text-left font-medium">Артикул</th>
                <th className="px-4 py-3 text-left font-medium">Когда</th>
                <th className="px-4 py-3 text-left font-medium">Откуда</th>
                <th className="px-4 py-3 text-left font-medium">Причина</th>
                <th className="px-4 py-3 text-right font-medium">Кол-во</th>
                <th className="px-4 py-3 text-right font-medium">Сумма</th>
                <th className="px-4 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={`border-b border-slate-100 last:border-0 ${row.reversed ? "bg-slate-50/60 opacity-60" : ""}`}>
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-900">
                    {row.docNumber ?? <span className="font-normal text-slate-300">—</span>}
                    {row.reversed && (
                      <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-normal text-slate-600">возвращено</span>
                    )}
                  </td>
                  <td className="py-2 pl-4 pr-0">
                    <WbProductImage
                      nm={row.nmId ?? undefined}
                      alt={row.article}
                      className="h-9 w-9 rounded-lg border border-slate-100 bg-slate-50 object-cover"
                    />
                  </td>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{variantLabel(row.article, row.sizeLabel) || "—"}</td>
                  <td className="px-4 py-2.5 text-slate-500">{stamp(row.occurredAt)}</td>
                  <td className="px-4 py-2.5 text-slate-600">{writeoffSource(row.docType)}</td>
                  <td className="max-w-xs truncate px-4 py-2.5 text-slate-500">{writeoffReason(row.reason)}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${row.reversed ? "text-slate-500" : "text-red-600"}`}>{formatNumber(row.qty)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700">{money(row.amount)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    {row.canRevert && canManage ? (
                      <button
                        onClick={() => void revert(row)}
                        disabled={busy === row.id}
                        title="Сторно: товар вернётся в остаток, запись останется в журнале с пометкой"
                        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-violet-700 disabled:opacity-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {busy === row.id ? "Возвращаю…" : "Вернуть в остаток"}
                      </button>
                    ) : !row.reversed && (row.docType === "purchase_receipt" || row.docType === "receipt_correction") ? (
                      <span className="text-xs text-slate-400">через коррекцию прихода</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
