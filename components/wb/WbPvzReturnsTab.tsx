"use client";

import { PackageX, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalyticsTable, type Column } from "@/components/analytics/AnalyticsTable";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import type { PvzReturnRow, PvzReturnsResponse, PvzReturnsScope } from "@/app/api/supplies/pvz-returns/route";
import { formatRub } from "@/lib/analytics/format";
import { WbEmptyState, WbErrorState } from "./WbModuleHeader";

type SubTab = "returns" | "anonymized";

const SUB_TABS: [SubTab, string][] = [
  ["returns", "Возвраты на ПВЗ"],
  ["anonymized", "Обезличка"],
];

const SCOPES: [PvzReturnsScope, string][] = [
  ["work", "В работе"],
  ["all", "Все"],
];

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ru-RU") : "—");

/** Дата для сортировки: непарсируемая дата — это null (уедет в конец), а не 0. */
const timeValue = (iso: string | null): number | null => {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
};

const columns: Column<PvzReturnRow>[] = [
  {
    key: "product",
    label: "Товар",
    render: (row) => (
      <div>
        <div className="font-semibold text-violet-700">{row.article || row.product || (row.nmId ?? "—")}</div>
        <div className="text-[11px] tabular-nums text-slate-400">{row.nmId !== null ? `nm ${row.nmId}` : "nm не передан"}</div>
      </div>
    ),
    csv: (row) => row.article || row.product || (row.nmId !== null ? String(row.nmId) : ""),
  },
  { key: "brand", label: "Бренд", render: (row) => <span className="text-slate-600">{row.brand || "—"}</span>, csv: (row) => row.brand ?? "" },
  {
    key: "status",
    label: "Статус",
    render: (row) => (
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${row.archived ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-700"}`}>
        {row.status}
      </span>
    ),
    csv: (row) => row.status,
  },
  { key: "claimType", label: "Тип заявки", render: (row) => <span className="text-slate-600">{row.claimType}</span>, csv: (row) => row.claimType },
  {
    key: "reason",
    label: "Причина покупателя",
    render: (row) => <span className="text-slate-600">{row.reason || "—"}</span>,
    csv: (row) => row.reason,
  },
  {
    key: "wbComment",
    label: "Комментарий WB",
    render: (row) => <span className="text-slate-500">{row.wbComment || "—"}</span>,
    csv: (row) => row.wbComment,
  },
  {
    key: "createdAt",
    label: "Заявка",
    sortable: true,
    render: (row) => <span className="tabular-nums text-slate-600">{formatDate(row.createdAt)}</span>,
    csv: (row) => row.createdAt ?? "",
    // Дату сортируем числом: у текста ISO-даты числовая часть — это год,
    // из-за чего все заявки одного года считались бы равными.
    sortValue: (row) => timeValue(row.createdAt),
  },
  {
    key: "price",
    label: "Сумма",
    align: "right",
    sortable: true,
    render: (row) => <span className="tabular-nums">{row.price === null ? "—" : formatRub(row.price)}</span>,
    csv: (row) => (row.price === null ? "" : String(row.price)),
  },
];

function isSingleCabinet(cabinetId: string): boolean {
  return Boolean(cabinetId) && cabinetId !== "all" && !cabinetId.startsWith("group:");
}

export function WbPvzReturnsTab({ cabinetId, cabinetName }: { cabinetId: string; cabinetName?: string }) {
  const [subTab, setSubTab] = useState<SubTab>("returns");
  const [scope, setScope] = useState<PvzReturnsScope>("work");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [data, setData] = useState<PvzReturnsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const requestId = useRef(0);
  const elapsed = useElapsedSeconds(loading);
  const singleCabinet = isSingleCabinet(cabinetId);

  const load = useCallback(() => {
    const controller = new AbortController();
    if (!singleCabinet) return controller;
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    fetch(`/api/supplies/pvz-returns?cabinet=${encodeURIComponent(cabinetId)}&scope=${scope}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as PvzReturnsResponse | { error?: string };
        if (!response.ok || !("meta" in body) || !body.meta) {
          throw new Error(("error" in body && body.error) || `Ошибка ${response.status}`);
        }
        return body as PvzReturnsResponse;
      })
      .then((body) => { if (current === requestId.current) setData(body); })
      .catch((cause: unknown) => {
        if (current === requestId.current && !controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Не удалось загрузить возвраты");
        }
      })
      .finally(() => { if (current === requestId.current) setLoading(false); });
    return controller;
  }, [cabinetId, scope, singleCabinet]);

  useEffect(() => {
    const controller = load();
    return () => controller.abort();
  }, [load, retryKey]);

  useEffect(() => { setStatusFilter(null); }, [scope, cabinetId]);

  const rows = useMemo(() => {
    const all = data?.data?.returns ?? [];
    return statusFilter ? all.filter((row) => row.status === statusFilter) : all;
  }, [data, statusFilter]);

  if (!singleCabinet) {
    return <WbEmptyState>Возвраты на ПВЗ читаются по одному реальному кабинету. Выберите кабинет в верхней панели.</WbEmptyState>;
  }

  const statuses = data?.data?.statuses ?? [];
  const warnings = data?.meta.warnings ?? [];
  // Время среза: вкладка остаётся смонтированной при переключении, поэтому
  // без этой строки старые данные выглядели бы только что загруженными.
  const snapshotAt = data?.meta.generatedAt ? new Date(data?.meta.generatedAt).toLocaleString("ru-RU") : null;
  const anonymized = data?.data?.anonymized ?? null;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px] text-slate-600">
        <PackageX className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <div>
          <div className="font-semibold text-slate-700">Товар, который WB везёт обратно вам</div>
          {snapshotAt ? <div className="text-[11px] text-slate-400">Данные на {snapshotAt}</div> : null}
          <div className="text-slate-500">
            Брак, неверное вложение, возврат по вашей инициативе. Источник — заявки покупателей на возврат в API WB;
            статусы и типы заявок показаны так, как их передал WB, без наших переводов.
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Разделы возвратов" className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
          {SUB_TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={subTab === value}
              onClick={() => setSubTab(value)}
              className={`min-h-10 rounded-md px-3 text-[10px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-8 ${subTab === value ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {subTab === "returns" ? (
          <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
            {SCOPES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
                className={`min-h-10 rounded-md px-3 text-[10px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-8 ${scope === value ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {subTab === "returns" && !loading ? (
          <span className="text-[11px] text-slate-400">
            {scope === "work" ? "Активные заявки WB" : "Активные заявки WB и архив"} · {rows.length} стр.
          </span>
        ) : null}
      </div>

      {subTab === "anonymized" ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <div>
              <div className="font-semibold">Обезличка — товар, потерявший опознание на складе WB</div>
              <div className="text-amber-700">{anonymized?.note ?? "Источник по обезличке пока недоступен."}</div>
            </div>
          </div>
          <WbEmptyState>
            {anonymized && anonymized.available
              ? "Обезличенных товаров по кабинету нет."
              : "Источника по обезличке нет — списка здесь не будет, пока WB не отдаст его через API."}
          </WbEmptyState>
        </div>
      ) : loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <LoadingBanner seconds={elapsed} hint={`возвраты ПВЗ · ${cabinetName ?? "кабинет"}`} />
          <SkeletonTableRows rows={8} cols={8} />
        </div>
      ) : error ? (
        <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} />
      ) : (
        <div className="space-y-3">
          {data?.error ? (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
              <div>
                <div className="font-semibold">WB не отдал возвраты</div>
                <div className="text-rose-600">{data.error}</div>
              </div>
              <button
                type="button"
                onClick={() => setRetryKey((value) => value + 1)}
                className="min-h-9 shrink-0 rounded-lg border border-rose-200 bg-white px-3 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
              >
                Повторить
              </button>
            </div>
          ) : null}

          {warnings.length ? (
            <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
              {warnings.map((warning) => <li key={warning}>· {warning}</li>)}
            </ul>
          ) : null}

          {statuses.length ? (
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setStatusFilter(null)}
                aria-pressed={statusFilter === null}
                className={`min-h-9 rounded-lg border px-3 text-[11px] font-semibold ${statusFilter === null ? "border-violet-200 bg-violet-50 text-violet-700" : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"}`}
              >
                Все статусы · {data?.data?.returns.length ?? 0}
              </button>
              {statuses.map((status) => (
                <button
                  key={status.key}
                  type="button"
                  onClick={() => setStatusFilter((current) => (current === status.key ? null : status.key))}
                  aria-pressed={statusFilter === status.key}
                  className={`min-h-9 rounded-lg border px-3 text-[11px] font-semibold ${statusFilter === status.key ? "border-violet-200 bg-violet-50 text-violet-700" : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"}`}
                >
                  {status.label} · {status.count}
                </button>
              ))}
            </div>
          ) : null}

          <AnalyticsTable
            columns={columns}
            data={rows}
            filename={`wb-vozvraty-pvz-${cabinetName ?? cabinetId}-${new Date().toISOString().slice(0, 10)}.csv`}
            emptyMessage={data?.error
              ? "Список пуст: WB не отдал заявки на возврат — причина выше."
              : scope === "work"
                ? "Возвратов в работе нет."
                : "Возвратов за выборку нет."}
          />
        </div>
      )}
    </div>
  );
}
