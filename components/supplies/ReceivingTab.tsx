"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { AnalyticsTable, type Column } from "@/components/analytics/AnalyticsTable";
import { formatNumber, formatTime } from "@/lib/analytics/format";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { NewReceiptModal } from "@/components/supplies/NewReceiptModal";
import type { SupplyRow, WarehouseSummary } from "@/app/api/supplies/route";
import type { PurchaseReceiptRow } from "@/app/api/supplies/receipts/route";

function Thumb({ nmId }: { nmId: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <div className="h-9 w-9 shrink-0 rounded bg-slate-100" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={wbCardImageUrl(nmId)} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded border border-slate-200 object-cover" onError={() => setBroken(true)} />;
}

function waitDaysColor(d: number): string {
  if (d <= 7) return "text-slate-500";
  if (d <= 14) return "text-amber-500";
  return "text-red-600";
}

interface Cabinet { id: string; marketplace: string }

export function ReceivingTab({ skus, cabId, warehouses }: { skus: SupplyRow[]; cabId: string; warehouses: WarehouseSummary[] }) {
  const [cabinets, setCabinets] = useState<Cabinet[]>([]);
  const [expected, setExpected] = useState<PurchaseReceiptRow[]>([]);
  const [received, setReceived] = useState<PurchaseReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [receivedInputs, setReceivedInputs] = useState<Record<number, string>>({});
  const elapsed = useElapsedSeconds(loading);

  useEffect(() => {
    fetch("/api/cabinets", { cache: "no-store" }).then((r) => r.json())
      .then((d: { cabinets?: Cabinet[] }) => setCabinets((d.cabinets ?? []).filter((c) => c.marketplace === "wb")))
      .catch(() => {});
  }, []);

  const wbCabinets = cabinets;
  const resolvedCabinetId = cabId || (wbCabinets.length === 1 ? wbCabinets[0].id : "");

  const load = useCallback(async () => {
    if (!resolvedCabinetId) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/supplies/receipts?cabinet=${resolvedCabinetId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) setError(json.error);
      else { setExpected(json.data?.expected ?? []); setReceived(json.data?.received ?? []); }
    } catch {
      setError("Не удалось загрузить приёмку");
    } finally {
      setLoading(false);
    }
  }, [resolvedCabinetId]);

  useEffect(() => { load(); }, [load]);

  const openNmIds = useMemo(() => new Set(expected.map((r) => r.nmId)), [expected]);

  const runAction = async (req: () => Promise<Response>) => {
    try {
      const res = await req();
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) { setError(json.error || `HTTP ${res.status}`); return; }
      load();
    } catch {
      setError("Действие не выполнено — проверьте соединение");
    }
  };

  const markReceived = (id: number, qty: number) => {
    if (!Number.isFinite(qty) || qty < 0) { setError("Некорректное количество"); return; }
    runAction(() => fetch(`/api/supplies/receipts/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receivedQty: qty }),
    }));
  };
  const removeLine = (id: number) => {
    runAction(() => fetch(`/api/supplies/receipts/${id}`, { method: "DELETE" }));
  };
  const closeBatch = (batchId: string) => {
    runAction(() => fetch(`/api/supplies/receipts/batch/${batchId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "close" }),
    }));
  };

  const now = Date.now();
  const totalExpectedQty = expected.reduce((s, r) => s + r.expectedQty, 0);
  const suggestedCount = skus.filter((s) => s.need45 > 0 && !openNmIds.has(s.nmId)).length;
  const receivedRecent = received.filter((r) => r.receivedAt && now - new Date(r.receivedAt).getTime() < 30 * 86400000);
  const receivedRecentQty = receivedRecent.reduce((s, r) => s + (r.receivedQty ?? 0), 0);

  const expectedColumns: Column<PurchaseReceiptRow>[] = [
    { key: "article", label: "Товар", render: (r) => (
      <div className="flex items-center gap-2">
        <Thumb nmId={r.nmId} />
        <p className="font-medium text-slate-900">{r.article || r.nmId}</p>
      </div>
    ), csv: (r) => r.article || String(r.nmId) },
    { key: "batch", label: "Партия", render: (r) => (
      <div>
        <p className="text-xs text-slate-500">{r.batchId.slice(0, 8)}</p>
        {r.expectedAt && <p className="text-[11px] text-slate-400">{r.expectedAt}</p>}
      </div>
    ), csv: (r) => r.batchId },
    { key: "warehouse", label: "Склад", render: (r) => r.warehouse || "—", csv: (r) => r.warehouse || "" },
    { key: "expectedQty", label: "К заказу", align: "right", render: (r) => <span className="font-semibold">{formatNumber(r.expectedQty)}</span>, csv: (r) => String(r.expectedQty) },
    { key: "wait", label: "Дней в ожидании", align: "right", render: (r) => {
      const d = Math.floor((now - new Date(r.createdAt).getTime()) / 86400000);
      return <span className={waitDaysColor(d)}>{d}</span>;
    }, csv: (r) => String(Math.floor((now - new Date(r.createdAt).getTime()) / 86400000)) },
    { key: "receive", label: "Принято (факт)", align: "right", render: (r) => (
      <div className="flex items-center justify-end gap-1.5">
        <input type="number" min={0} value={receivedInputs[r.id] ?? String(r.expectedQty)}
          onChange={(e) => setReceivedInputs((s) => ({ ...s, [r.id]: e.target.value }))}
          className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-xs text-right" />
        <button onClick={() => markReceived(r.id, Number(receivedInputs[r.id] ?? r.expectedQty))}
          className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-700">
          Принять
        </button>
      </div>
    ), csv: () => "" },
    { key: "actions", label: "Действия", render: (r) => (
      <div className="flex items-center justify-end gap-2 text-xs">
        <button onClick={() => closeBatch(r.batchId)} className="text-slate-500 hover:text-slate-700">Закрыть поставку</button>
        <button onClick={() => removeLine(r.id)} className="text-red-500 hover:text-red-700">Удалить</button>
      </div>
    ), align: "right", csv: () => "" },
  ];

  const receivedColumns: Column<PurchaseReceiptRow>[] = [
    { key: "article", label: "Товар", render: (r) => r.article || r.nmId, csv: (r) => r.article || String(r.nmId) },
    { key: "batch", label: "Партия", render: (r) => (
      <div>
        <p className="text-xs text-slate-500">{r.batchId.slice(0, 8)}</p>
        {r.expectedAt && <p className="text-[11px] text-slate-400">{r.expectedAt}</p>}
      </div>
    ), csv: (r) => r.batchId },
    { key: "expectedQty", label: "Заказано", align: "right", render: (r) => formatNumber(r.expectedQty), csv: (r) => String(r.expectedQty) },
    { key: "receivedQty", label: "Принято", align: "right", render: (r) => formatNumber(r.receivedQty ?? 0), csv: (r) => String(r.receivedQty ?? 0) },
    { key: "diff", label: "Расхождение", align: "right", render: (r) => {
      const diff = (r.receivedQty ?? 0) - r.expectedQty;
      const color = diff === 0 ? "text-emerald-600" : diff < 0 ? "text-red-600" : "text-amber-600";
      return <span className={color}>{diff > 0 ? `+${diff}` : diff}</span>;
    }, csv: (r) => String((r.receivedQty ?? 0) - r.expectedQty) },
    { key: "receivedAt", label: "Дата приёмки", align: "right", render: (r) => (r.receivedAt ? formatTime(r.receivedAt) : "—"), csv: (r) => r.receivedAt || "" },
  ];

  if (!resolvedCabinetId) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        Выберите кабинет вверху страницы — приёмка ведётся по конкретному кабинету.
      </div>
    );
  }

  if (loading) {
    return (
      <>
        <LoadingBanner seconds={elapsed} hint="приёмка поставок" />
        <SkeletonTableRows rows={6} cols={6} />
      </>
    );
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Ожидаем поставку</p>
          <p className="text-xl font-bold text-slate-900">{expected.length}</p>
          <p className="text-xs text-slate-400 mt-1">{formatNumber(totalExpectedQty)} шт заказано</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Предложено к заказу</p>
          <p className="text-xl font-bold text-violet-700">{suggestedCount}</p>
          <p className="text-xs text-slate-400 mt-1">SKU нужно дозаказать (не в поставке)</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Принято за 30 дней</p>
          <p className="text-xl font-bold text-emerald-700">{receivedRecent.length}</p>
          <p className="text-xs text-slate-400 mt-1">{formatNumber(receivedRecentQty)} шт</p>
        </div>
      </div>

      <button onClick={() => setModalOpen(true)}
        className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700">
        <Plus className="h-4 w-4" /> Новая поставка
      </button>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Ожидаем поставку</h3>
        <AnalyticsTable columns={expectedColumns} data={expected} filename="receiving-expected.csv" emptyMessage="Нет ожидаемых поставок." />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">История приёмки</h3>
        <AnalyticsTable columns={receivedColumns} data={received} filename="receiving-history.csv" emptyMessage="Ещё ничего не принято." />
      </div>

      <NewReceiptModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={load}
        cabinetId={resolvedCabinetId} skus={skus} warehouses={warehouses} openNmIds={openNmIds} />
    </div>
  );
}
