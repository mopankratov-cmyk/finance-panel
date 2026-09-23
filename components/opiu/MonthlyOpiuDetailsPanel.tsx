"use client";

import { SlidePanel } from "@/components/ui/SlidePanel";
import { formatPct, formatRub } from "@/lib/analytics/format";
import { MONTHLY_RESULT_COMPONENTS, type MonthlyOpiuDetailsResponse } from "@/lib/opiu/monthlyDetails";
import type { MonthlyOpiuAmount, MonthlyOpiuDirection, MonthlyOpiuRow, MonthlyOpiuStatement } from "@/lib/opiu/monthlyStatement";
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export interface MonthlyOpiuDetailSelection {
  row: MonthlyOpiuRow;
  amount: MonthlyOpiuAmount;
  direction: MonthlyOpiuDirection | "total";
  columnLabel: string;
  statement: MonthlyOpiuStatement;
}

interface Props {
  selection: MonthlyOpiuDetailSelection | null;
  month: string;
  companyId: string;
  onClose: () => void;
}

const sectionBySubtotal: Record<string, MonthlyOpiuRow["section"]> = {
  revenue_total: "revenue",
  variable_total: "variable",
  direct_fixed_total: "direct_fixed",
  manufacturing_total: "manufacturing",
  administrative_total: "administrative",
  commercial_total: "commercial",
  below_income_total: "below_income",
  below_expense_total: "below_expense",
};

const money = (amount: MonthlyOpiuAmount) => formatRub(amount.value ?? amount.known);

function sourceLabel(source: MonthlyOpiuDetailsResponse["source"]) {
  return source === "dds" ? "ДДС" : source === "payroll" ? "Зарплатная ведомость" : source === "loan" ? "Кредиты" : source.toUpperCase();
}

export function MonthlyOpiuDetailsPanel({ selection, month, companyId, onClose }: Props) {
  const [details, setDetails] = useState<MonthlyOpiuDetailsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const row = selection?.row;
  const direction = selection?.direction ?? "total";

  const formulaRows = useMemo(() => {
    if (!selection || !row) return [];
    const section = sectionBySubtotal[row.id];
    if (section) return selection.statement.rows
      .filter((candidate) => candidate.kind === "article" && candidate.section === section)
      .map((candidate) => ({ row: candidate, sign: 1 as 1 | -1 }));
    const components = MONTHLY_RESULT_COMPONENTS[row.id];
    if (!components) return [];
    return components.flatMap((component) => {
      const candidate = selection.statement.rows.find((item) => item.id === component.id);
      return candidate ? [{ row: candidate, sign: component.sign }] : [];
    });
  }, [row, selection]);

  const shouldFetch = Boolean(selection && row?.kind === "article"
    && direction !== "wb" && direction !== "ozon"
    && !["taxes", "vat"].includes(row.id));

  useEffect(() => {
    if (!selection || !shouldFetch) {
      setDetails(null);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ month, article: selection.row.id });
    if (companyId) params.set("company", companyId);
    setLoading(true);
    setDetails(null);
    setError(null);
    void fetch(`/api/opiu/monthly-details?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as (MonthlyOpiuDetailsResponse & { error?: string }) | null;
        if (!response.ok || !payload) throw new Error(payload?.error || `HTTP ${response.status}`);
        setDetails(payload);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить расшифровку");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [companyId, month, selection, shouldFetch]);

  const expected = selection ? selection.amount.value ?? selection.amount.known : 0;
  const mismatch = details && Math.abs(details.total - expected) > 1;
  const isPercent = row?.kind === "percent";
  const marketplaceHref = direction === "ozon" ? "/opiu/ozon" : "/opiu";

  return (
    <SlidePanel
      open={Boolean(selection)}
      onClose={onClose}
      narrow
      title={row ? `Расшифровка: ${row.label}` : "Расшифровка"}
    >
      {selection && row ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{selection.columnLabel}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-950">
              {isPercent ? formatPct(expected) : formatRub(expected)}
            </p>
            {selection.amount.status !== "complete" ? <p className="mt-2 text-xs text-amber-700">Показана доступная часть суммы. {selection.amount.note}</p> : null}
          </div>

          {formulaRows.length ? (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Как рассчитано</h3>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {formulaRows.map(({ row: component, sign }, index) => {
                  const amount = component.amounts[direction];
                  const percentDenominator = isPercent && index === 1;
                  return (
                    <div key={component.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                      <span className="min-w-0 text-slate-600">{percentDenominator ? "÷ " : sign < 0 ? "− " : index ? "+ " : ""}{component.label}</span>
                      <b className="shrink-0 tabular-nums text-slate-900">{money(amount)}</b>
                    </div>
                  );
                })}
              </div>
              {isPercent ? <p className="mt-2 text-xs text-slate-500">Результат = показатель ÷ выручка × 100%.</p> : null}
            </section>
          ) : null}

          {row.kind === "article" && (direction === "wb" || direction === "ozon") ? (
            <section className="rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-900">Источник: финансовый отчёт {direction === "wb" ? "WB" : "Ozon"}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{row.description || row.source}. Сумма рассчитана по данным выбранного кабинета и месяца.</p>
              <Link href={marketplaceHref} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-emerald-300 px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
                Открыть отчёт <ExternalLink className="h-4 w-4" />
              </Link>
            </section>
          ) : null}

          {row.kind === "article" && ["taxes", "vat"].includes(row.id) ? (
            <section className="rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-900">Расчётная статья</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">{selection.amount.note || "Сумма рассчитана по налоговым настройкам компании и налоговой базе маркетплейсов."}</p>
            </section>
          ) : null}

          {loading ? <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> Загружаю операции…</div> : null}
          {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
          {details ? (
            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900">Операции: {sourceLabel(details.source)}</h3>
                <span className="text-xs tabular-nums text-slate-500">{formatRub(details.total)}</span>
              </div>
              {mismatch ? (
                <div role="status" className="mb-2 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0" /> Сумма расшифровки отличается от отчёта. Обновите страницу; если расхождение останется, источник был изменён после загрузки ОПиУ.
                </div>
              ) : null}
              {details.items.length ? (
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {details.items.map((item) => (
                    <div key={item.id} className="px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-medium text-slate-900">{item.title}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{[item.date, item.subtitle].filter(Boolean).join(" · ")}</p>
                        </div>
                        <b className="shrink-0 text-sm tabular-nums text-slate-900">{formatRub(item.amount)}</b>
                      </div>
                      {item.href ? <Link href={item.href} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline">Открыть источник <ExternalLink className="h-3.5 w-3.5" /></Link> : null}
                    </div>
                  ))}
                </div>
              ) : <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Подходящих операций в источнике не найдено.</p>}
            </section>
          ) : null}
        </div>
      ) : null}
    </SlidePanel>
  );
}
