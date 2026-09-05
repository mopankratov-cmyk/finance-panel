"use client";

import { PackageSearch, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalyticsTable, type Column } from "@/components/analytics/AnalyticsTable";
import { LoadingBanner, useElapsedSeconds } from "@/components/ui/LoadingState";
import type { WbSupplyRow } from "@/app/api/supplies/wb-supplies/route";
import { WbEmptyState, WbErrorState } from "./WbModuleHeader";

const isSingleCabinet = (value: string) => Boolean(value) && value !== "all" && !value.startsWith("group:");
const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ru-RU") : "—");

/** Статусы, при которых поставка ещё едет: их продавец смотрит первыми. */
const LIVE_STATUS = new Set([1, 2, 3, 4]);

const statusChip = (statusId: number) =>
  statusId === 5 ? "bg-emerald-100 text-emerald-700"
    : statusId === 6 ? "bg-sky-100 text-sky-700"
    : LIVE_STATUS.has(statusId) ? "bg-amber-100 text-amber-700"
    : "bg-slate-100 text-slate-600";

const columns: Column<WbSupplyRow>[] = [
  {
    key: "id",
    label: "Поставка",
    sortable: true,
    render: (row) => (
      <div>
        <div className="font-semibold tabular-nums text-violet-700">{row.supplyId ?? "—"}</div>
        {row.preorderId ? <div className="text-[11px] tabular-nums text-slate-400">предзаказ {row.preorderId}</div> : null}
      </div>
    ),
    csv: (row) => String(row.supplyId ?? ""),
    sortValue: (row) => row.supplyId ?? 0,
  },
  {
    key: "warehouse",
    label: "Склад",
    sortable: true,
    render: (row) => (
      row.warehouse
        ? <span className="text-slate-600">{row.warehouse}</span>
        // Пусто ≠ «склада нет»: WB отдаёт склад только по одной поставке за
        // запрос, и до части строк опрос не дошёл.
        : <span className="text-slate-300">не запрашивали</span>
    ),
    csv: (row) => row.warehouse ?? "",
  },
  {
    key: "status",
    label: "Статус",
    sortable: true,
    render: (row) => (
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusChip(row.statusId)}`}>{row.status}</span>
    ),
    csv: (row) => row.status,
  },
  {
    key: "quantity",
    label: "Товаров",
    sortable: true,
    render: (row) => (
      row.quantity === null
        ? <span className="text-slate-300">—</span>
        : <span className="tabular-nums text-slate-700">{row.quantity.toLocaleString("ru-RU")}</span>
    ),
    csv: (row) => (row.quantity === null ? "" : String(row.quantity)),
    sortValue: (row) => row.quantity ?? -1,
  },
  { key: "created", label: "Создана", sortable: true, render: (row) => <span className="tabular-nums text-slate-500">{formatDate(row.createdAt)}</span>, csv: (row) => formatDate(row.createdAt) },
  { key: "planned", label: "Плановая", sortable: true, render: (row) => <span className="tabular-nums text-slate-500">{formatDate(row.plannedAt)}</span>, csv: (row) => formatDate(row.plannedAt) },
  {
    key: "fact",
    label: "Фактическая",
    sortable: true,
    render: (row) => (
      row.factAt
        ? <span className="tabular-nums text-slate-700">{formatDate(row.factAt)}</span>
        : <span className="text-slate-300">—</span>
    ),
    csv: (row) => formatDate(row.factAt),
  },
];

interface Payload {
  meta: { generatedAt: string; total: number; warnings: string[] };
  data: { rows: WbSupplyRow[] };
}

/**
 * «Мои поставки» — история и статусы поставок на склады WB.
 *
 * Панель умела вести поставку до отправки (заказы фабрике, к поставке,
 * приёмка), но что с ней стало у WB — не показывала. Раздел закрывает
 * именно это: где поставка, приняли ли её и когда.
 */
export function WbSuppliesListTab({ cabinetId, cabinetName }: { cabinetId: string; cabinetName?: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [onlyLive, setOnlyLive] = useState(false);
  const requestId = useRef(0);
  const elapsed = useElapsedSeconds(loading);
  const singleCabinet = isSingleCabinet(cabinetId);

  const load = useCallback(() => {
    const controller = new AbortController();
    if (!singleCabinet) return controller;
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    fetch(`/api/supplies/wb-supplies?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body?.meta) throw new Error(body?.error || `Ошибка ${response.status}`);
        return body as Payload;
      })
      .then((body) => { if (current === requestId.current) setData(body); })
      .catch((cause: unknown) => {
        if (current === requestId.current && !controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Не удалось загрузить поставки");
        }
      })
      .finally(() => { if (current === requestId.current) setLoading(false); });
    return controller;
  }, [cabinetId, singleCabinet]);

  useEffect(() => {
    const controller = load();
    return () => controller.abort();
  }, [load, retryKey]);

  const rows = useMemo(() => {
    const all = data?.data?.rows ?? [];
    return onlyLive ? all.filter((row) => LIVE_STATUS.has(row.statusId)) : all;
  }, [data, onlyLive]);

  if (!singleCabinet) {
    return <WbEmptyState>Поставки читаются по одному реальному кабинету. Выберите кабинет в верхней панели.</WbEmptyState>;
  }

  const warnings = data?.meta.warnings ?? [];
  const snapshotAt = data?.meta.generatedAt ? new Date(data.meta.generatedAt).toLocaleString("ru-RU") : null;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <PackageSearch className="h-4 w-4 text-violet-600" aria-hidden="true" />
          <div className="text-[13px] font-semibold text-slate-700">Поставки на склады WB</div>
          <button
            type="button"
            onClick={() => setOnlyLive((value) => !value)}
            className={`ml-auto min-h-11 rounded-lg border px-3 text-[12px] font-semibold lg:min-h-0 lg:py-1 ${onlyLive ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-600 hover:border-violet-300"}`}
          >
            {onlyLive ? "Показаны едущие" : "Только едущие"}
          </button>
        </div>
        <div className="mt-1 text-[11px] text-slate-400">
          История и статусы · {cabinetName ?? "кабинет"}
          {data ? ` · всего ${data.meta.total}` : ""}
          {snapshotAt ? ` · срез ${snapshotAt}` : ""}
        </div>
      </div>

      {error ? <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} /> : null}
      {loading ? <LoadingBanner seconds={elapsed} hint={`поставки · ${cabinetName ?? "кабинет"}`} /> : null}

      {warnings.length ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <ul className="space-y-0.5">{warnings.map((text) => <li key={text}>· {text}</li>)}</ul>
        </div>
      ) : null}

      {!loading && !error ? (
        <AnalyticsTable
          columns={columns}
          data={rows}
          filename={`postavki-${cabinetName ?? "cabinet"}.csv`}
          emptyMessage="Поставок за период нет."
        />
      ) : null}
    </div>
  );
}
