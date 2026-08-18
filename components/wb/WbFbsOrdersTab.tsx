"use client";

import { AlertTriangle, Search, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalyticsTable, type Column } from "@/components/analytics/AnalyticsTable";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { formatRub } from "@/lib/analytics/format";
import type { FbsKizStatus, FbsOrderRow, FbsOrdersResponse } from "@/app/api/supplies/fbs-orders/route";
import type { WbFbsBucket } from "@/lib/wb/fbsMarketplace";
import { WbEmptyState, WbErrorState } from "./WbModuleHeader";

const PERIODS = [1, 3, 7, 14, 30, 60] as const;
type Period = (typeof PERIODS)[number];

const BUCKET_TONE: Record<WbFbsBucket, string> = {
  new: "bg-violet-100 text-violet-700",
  assembling: "bg-amber-100 text-amber-700",
  delivering: "bg-sky-100 text-sky-700",
  archive: "bg-slate-100 text-slate-600",
  cancelled: "bg-rose-100 text-rose-700",
};

const KIZ_LABEL: Record<FbsKizStatus, string> = {
  present: "код есть",
  missing: "кода нет",
  not_required: "не требуется",
  unknown: "не проверен",
};

const fmt = (value: number) => value.toLocaleString("ru-RU");

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function KizCell({ row }: { row: FbsOrderRow }) {
  if (row.kizStatus === "missing") {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-rose-600">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        кода нет
      </span>
    );
  }
  if (row.kizStatus === "present") {
    return <span className="font-mono text-[11px] text-slate-600" title={row.kizCode ?? undefined}>{(row.kizCode ?? "").slice(0, 31) || "код есть"}</span>;
  }
  if (row.kizStatus === "not_required") return <span className="text-slate-400">не требуется</span>;
  return <span className="text-amber-600">не проверен</span>;
}

const columns: Column<FbsOrderRow>[] = [
  {
    key: "id",
    label: "Задание",
    render: (row) => (
      <div>
        <div className="font-semibold tabular-nums text-slate-700">{row.id}</div>
        <div className="font-mono text-[10px] text-slate-400">{row.rid || "—"}</div>
      </div>
    ),
    csv: (row) => String(row.id),
  },
  {
    key: "createdAt",
    label: "Создано",
    sortable: true,
    // Сортируем по времени, а не по тексту ISO-даты: csv-значение здесь не число.
    sortValue: (row) => {
      const parsed = row.createdAt ? Date.parse(row.createdAt) : Number.NaN;
      return Number.isNaN(parsed) ? null : parsed;
    },
    render: (row) => <span className="whitespace-nowrap tabular-nums text-slate-500">{formatDate(row.createdAt)}</span>,
    csv: (row) => row.createdAt ?? "",
  },
  {
    key: "article",
    label: "Артикул",
    render: (row) => (
      <div>
        <div className="font-semibold text-violet-700">{row.article || row.nmId}</div>
        <div className="text-[11px] tabular-nums text-slate-400">nm {row.nmId}</div>
      </div>
    ),
    csv: (row) => row.article || String(row.nmId),
  },
  { key: "barcode", label: "Баркод", render: (row) => <span className="font-mono text-[11px] text-slate-500">{row.barcode || "—"}</span>, csv: (row) => row.barcode },
  {
    key: "statusLabel",
    label: "Статус",
    render: (row) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BUCKET_TONE[row.bucket]}`}>{row.statusLabel}</span>,
    csv: (row) => row.statusLabel,
  },
  { key: "kizStatus", label: "Код маркировки", render: (row) => <KizCell row={row} />, csv: (row) => row.kizCode ?? KIZ_LABEL[row.kizStatus] },
  { key: "supplyId", label: "Поставка", render: (row) => <span className="font-mono text-[11px] text-slate-500">{row.supplyId || "не передана"}</span>, csv: (row) => row.supplyId },
  { key: "price", label: "Цена", align: "right", sortable: true, render: (row) => <span className="tabular-nums">{row.price === null ? "—" : formatRub(row.price)}</span>, csv: (row) => (row.price === null ? "" : String(row.price)) },
];

export function WbFbsOrdersTab({ cabinetId, cabinetName }: { cabinetId: string; cabinetName?: string }) {
  const [days, setDays] = useState<Period>(7);
  const [bucket, setBucket] = useState<WbFbsBucket | "all">("all");
  const [onlyMissingKiz, setOnlyMissingKiz] = useState(false);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<FbsOrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const requestId = useRef(0);
  const elapsed = useElapsedSeconds(loading);
  const singleCabinet = Boolean(cabinetId) && cabinetId !== "all" && !cabinetId.startsWith("group:");

  const load = useCallback(() => {
    if (!singleCabinet) {
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    fetch(`/api/supplies/fbs-orders?cabinet=${encodeURIComponent(cabinetId)}&days=${days}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as FbsOrdersResponse;
        if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then((body) => { if (current === requestId.current) setData(body); })
      .catch((cause: unknown) => { if (current === requestId.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить сборочные задания"); })
      .finally(() => { if (current === requestId.current) setLoading(false); });
    return controller;
  }, [cabinetId, days, singleCabinet]);

  useEffect(() => {
    const controller = load();
    return () => controller?.abort();
  }, [load, retryKey]);

  const rows = useMemo(() => {
    const all = data?.data?.rows ?? [];
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return all.filter((row) => {
      if (bucket !== "all" && row.bucket !== bucket) return false;
      if (onlyMissingKiz && row.kizStatus !== "missing") return false;
      if (!needle) return true;
      return `${row.id} ${row.rid} ${row.article} ${row.nmId} ${row.barcode}`.toLocaleLowerCase("ru-RU").includes(needle);
    });
  }, [bucket, data?.data?.rows, onlyMissingKiz, query]);

  if (!singleCabinet) {
    return <WbEmptyState>Сборочные задания FBS читаются по одному реальному кабинету. Выберите кабинет в верхней панели.</WbEmptyState>;
  }
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <LoadingBanner seconds={elapsed} hint={`сборочные задания · ${cabinetName ?? "кабинет"}`} />
        <SkeletonTableRows rows={8} cols={8} />
      </div>
    );
  }
  if (error) return <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} />;
  if (!data?.data) return <WbEmptyState>Сборочных заданий за период нет.</WbEmptyState>;

  const { buckets, kizMissing, kizChecked, kizRequired, kizUnchecked } = data.data;
  const warnings = data.meta.warnings;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="text-sm font-semibold text-slate-800">Заказы на самовывоз из вашего склада (Маркетплейс)</div>
        <div className="mt-0.5 text-[11px] text-slate-500">
          Сборочные задания FBS/DBS за выбранный период. Код маркировки WB отдаёт по одному заданию за запрос — проверено {fmt(kizChecked)} из {fmt(kizRequired)}.
          {kizUnchecked > 0 ? (
            <span className="text-amber-700"> Без метаданных осталось {fmt(kizUnchecked)} заданий — они показаны как «не проверен», а не как «кода нет».</span>
          ) : null}
        </div>
        <div className="mt-2 flex flex-col gap-2 xl:flex-row xl:items-center">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
            {PERIODS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setDays(value)}
                className={`min-h-10 rounded-md px-3 text-[10px] font-semibold sm:min-h-8 ${days === value ? "bg-white text-violet-700 shadow-sm" : "text-slate-500"}`}
              >
                {value} дн
              </button>
            ))}
          </div>
          <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 focus-within:border-violet-400 sm:max-w-sm sm:min-h-9">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="задание, артикул или баркод" className="min-w-0 flex-1 bg-transparent text-xs outline-none" />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-[11px] font-semibold text-slate-600 sm:min-h-9">
            <input type="checkbox" checked={onlyMissingKiz} onChange={(event) => setOnlyMissingKiz(event.target.checked)} className="h-3.5 w-3.5 accent-rose-600" />
            только без кода маркировки
          </label>
        </div>
      </div>

      {kizMissing > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
          <div>
            <div className="font-semibold">{fmt(kizMissing)} заданий без кода маркировки</div>
            <div className="text-rose-700">
              WB требует код по этим позициям: без него товар не примут на ПВЗ и он вернётся вам. Привяжите код в сборочном задании до сборки — в ЛК WB или через ваш сканер.
            </div>
          </div>
        </div>
      ) : null}

      {warnings.length ? (
        <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          {warnings.map((warning) => <li key={warning}>· {warning}</li>)}
        </ul>
      ) : null}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <button
          type="button"
          onClick={() => setBucket("all")}
          className={`rounded-xl border bg-white p-3 text-left ${bucket === "all" ? "border-violet-300 ring-1 ring-violet-200" : "border-slate-200"}`}
        >
          <div className="text-[11px] text-slate-500">Все задания</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-slate-700">{fmt(data.data.rows.length)}</div>
        </button>
        {buckets.map((item) => (
          <button
            key={item.bucket}
            type="button"
            onClick={() => setBucket(item.bucket)}
            className={`rounded-xl border bg-white p-3 text-left ${bucket === item.bucket ? "border-violet-300 ring-1 ring-violet-200" : "border-slate-200"}`}
          >
            <div className="text-[11px] text-slate-500">{item.label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-slate-700">{fmt(item.count)}</div>
          </button>
        ))}
      </div>

      <AnalyticsTable
        columns={columns}
        data={rows}
        filename={`wb-fbs-orders-${cabinetName ?? cabinetId}-${new Date().toISOString().slice(0, 10)}.csv`}
        rowClassName={(row) => (row.kizStatus === "missing" ? "bg-rose-50" : "")}
        emptyMessage="За выбранный период и фильтры сборочных заданий нет."
      />
    </div>
  );
}
