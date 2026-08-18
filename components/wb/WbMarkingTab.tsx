"use client";

import { ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { AnalyticsTable, type Column } from "@/components/analytics/AnalyticsTable";
import type { MarkingResponse, MarkingRow } from "@/app/api/supplies/marking/route";
import { WbEmptyState, WbErrorState } from "./WbModuleHeader";

const fmt = (value: number) => value.toLocaleString("ru-RU");

const KPIS: { key: keyof MarkingResponse["kpis"]; label: string; tone: string; hint: string }[] = [
  { key: "introduced", label: "Введено в оборот", tone: "text-emerald-600", hint: "за период" },
  { key: "atAgent", label: "Передано агенту", tone: "text-amber-600", hint: "УПД · Оптима" },
  { key: "retired", label: "Выбыло (продано)", tone: "text-slate-600", hint: "FBO авто · FBS вручную" },
  { key: "stuck", label: "Зависло / расхождения", tone: "text-rose-600", hint: "требуют действия" },
];

function SchemeChip({ scheme }: { scheme: MarkingRow["scheme"] }) {
  return scheme === "FBO" ? (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">FBO</span>
  ) : (
    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">FBS</span>
  );
}

function PermChip({ permission }: { permission: MarkingRow["permission"] }) {
  if (permission === "ok") return <span className="font-semibold text-emerald-600">✓ готовы</span>;
  if (permission === "warn") return <span className="font-semibold text-amber-600">⚠ проверить</span>;
  return <span className="text-slate-400">—</span>;
}

const columns: Column<MarkingRow>[] = [
  {
    key: "article",
    label: "SKU / артикул",
    render: (row) => (
      <div>
        <div className="font-semibold text-violet-700">{row.article || row.nmId}</div>
        <div className="text-[11px] tabular-nums text-slate-400">nm {row.nmId}</div>
      </div>
    ),
    csv: (row) => row.article || String(row.nmId),
  },
  { key: "supply", label: "Поставка", render: (row) => <span className="font-mono text-xs text-slate-500">{row.supply || "не передана"}</span>, csv: (row) => row.supply },
  { key: "scheme", label: "Схема", align: "center", render: (row) => <SchemeChip scheme={row.scheme} />, csv: (row) => row.scheme },
  { key: "introduced", label: "КМ", align: "right", sortable: true, render: (row) => <span className="tabular-nums">{fmt(row.introduced)}</span>, csv: (row) => String(row.introduced) },
  { key: "atAgent", label: "У агента", align: "right", sortable: true, render: (row) => <span className="tabular-nums">{fmt(row.atAgent)}</span>, csv: (row) => String(row.atAgent) },
  { key: "retired", label: "Выбыло", align: "right", sortable: true, render: (row) => <span className="tabular-nums">{fmt(row.retired)}</span>, csv: (row) => String(row.retired) },
  {
    key: "stuck",
    label: "Зависло",
    align: "right",
    sortable: true,
    render: (row) => <span className={`tabular-nums ${row.stuck > 0 ? "font-semibold text-rose-600" : ""}`}>{fmt(row.stuck)}</span>,
    csv: (row) => String(row.stuck),
  },
  { key: "permission", label: "Разреш. режим", render: (row) => <PermChip permission={row.permission} />, csv: (row) => row.permission },
];

export function WbMarkingTab({ cabinetId, cabinetName }: { cabinetId: string; cabinetName?: string }) {
  const [data, setData] = useState<MarkingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const requestId = useRef(0);
  const elapsed = useElapsedSeconds(loading);

  const load = useCallback(() => {
    const controller = new AbortController();
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    fetch(`/api/supplies/marking?cabinet=${encodeURIComponent(cabinetId || "all")}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as MarkingResponse;
        if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then((body) => { if (current === requestId.current) setData(body); })
      .catch((cause: unknown) => { if (current === requestId.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить маркировку"); })
      .finally(() => { if (current === requestId.current) setLoading(false); });
    return controller;
  }, [cabinetId]);

  useEffect(() => {
    const controller = load();
    return () => controller.abort();
  }, [load, retryKey]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <LoadingBanner seconds={elapsed} hint={`маркировка · ${cabinetName ?? "все кабинеты"}`} />
        <SkeletonTableRows rows={8} cols={8} />
      </div>
    );
  }
  if (error) return <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} />;
  if (!data) return <WbEmptyState>Нет данных маркировки.</WbEmptyState>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {KPIS.map((kpi) => (
          <div key={kpi.key} className={`rounded-xl border bg-white p-3 ${kpi.key === "stuck" && data.kpis.stuck > 0 ? "border-rose-200 bg-rose-50" : "border-slate-200"}`}>
            <div className="text-[11px] text-slate-500">{kpi.label}</div>
            <div className={`mt-1 text-2xl font-bold tabular-nums ${kpi.tone}`}>
              {fmt(data.kpis[kpi.key])}
              <span className="ml-1 text-xs font-semibold text-slate-400">КМ</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">{kpi.hint}</div>
          </div>
        ))}
      </div>

      {!data.connected ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <div className="font-semibold">Честный Знак не подключён</div>
            <div className="text-amber-700">
              Данные по кодам маркировки появятся после подключения токена ЧЗ для этого кабинета. Сверка статусов КМ (введено · у агента · выбыло · зависло) идёт через True API — интеграция в работе.
            </div>
          </div>
        </div>
      ) : null}

      <AnalyticsTable
        columns={columns}
        data={data.rows}
        filename={`markirovka-${cabinetName ?? "all"}.csv`}
        emptyMessage={data.connected
          ? "По выбранному кабинету и периоду кодов маркировки нет."
          : "Подключите Честный Знак, чтобы увидеть коды маркировки по поставкам."}
      />
    </div>
  );
}
