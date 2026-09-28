"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Sigma, Table2 } from "lucide-react";

interface OzonOpiuChildRow {
  key: string;
  label: string;
  amount: number;
}

interface OzonOpiuSection {
  key: string;
  label: string;
  kind: "metric" | "stub";
  amount: number | null;
  children: OzonOpiuChildRow[];
}

interface OzonOpiuNewCategory {
  typeId: number;
  label: string;
}

interface OzonOpiuReport {
  sections: OzonOpiuSection[];
  total: number;
  newCategories: OzonOpiuNewCategory[];
}

interface Cabinet {
  id: string;
  name: string;
  marketplace: string;
}

// "orders" — воронка отправлений по статусам, показана только для
// наглядности и никогда не входит в «К выплате» (см. lib/ozon/opiuOzonReport.ts).
// Не в REVENUE_SECTIONS намеренно — иначе цвет строки намекал бы, что она
// участвует в сумме (finding I3 в финальном ревью).
const REVENUE_SECTIONS = new Set(["sales", "cogs"]);
const ALWAYS_OPEN_SECTIONS = new Set(["sales"]);
const INFORMATIONAL_SECTIONS = new Set(["orders"]);

function formatRub(value: number | null): string {
  if (value === null) return "—";
  const abs = Math.abs(value).toLocaleString("ru-RU");
  return (value < 0 ? "−" : "") + abs + " ₽";
}

function valueColorClass(value: number | null): string {
  if (value === null) return "text-slate-400";
  if (value < 0) return "text-red-600";
  if (value > 0) return "text-emerald-700";
  return "text-slate-400";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthAgoIso(): string {
  return new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
}

function CabinetMultiSelect({
  cabinets,
  selected,
  onToggle,
}: {
  cabinets: Cabinet[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const buttonLabel =
    selected.length === 0 || selected.length === cabinets.length
      ? `Все кабинеты (${cabinets.length})`
      : `Кабинеты (${selected.length})`;

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-500">Кабинеты</label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-11 min-w-[180px] items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
      >
        <span className="truncate">{buttonLabel}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute left-0 top-full z-20 mt-1 min-w-[220px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {cabinets.map((cabinet) => {
            const checked = selected.includes(cabinet.id);
            return (
              <button
                key={cabinet.id}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => onToggle(cabinet.id)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    checked ? "border-sky-600 bg-sky-600" : "border-slate-300 bg-white"
                  }`}
                >
                  {checked && <span className="h-1.5 w-1.5 rounded-sm bg-white" />}
                </span>
                {cabinet.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function OzonOpiuPage() {
  const [dateFrom, setDateFrom] = useState(monthAgoIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [cabinets, setCabinets] = useState<Cabinet[]>([]);
  const [selectedCabinets, setSelectedCabinets] = useState<string[]>([]);
  const [report, setReport] = useState<OzonOpiuReport | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Дата/кабинет можно поменять быстрее, чем успевает ответить предыдущий
  // запрос — без этой защиты медленный старый ответ мог прилететь позже
  // нового и показать цифры не за тот период/набор кабинетов, что стоит в
  // фильтрах (finding I6 в финальном ревью).
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/cabinets")
      .then((res) => res.json())
      .then((data: { cabinets?: Cabinet[] }) => {
        setCabinets((data.cabinets ?? []).filter((c) => c.marketplace === "ozon"));
      })
      .catch(() => setCabinets([]));
  }, []);

  const load = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;

    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ dateFrom, dateTo });
    for (const id of selectedCabinets) params.append("cabinetId", id);
    fetch(`/api/opiu/ozon?${params.toString()}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data: { report: OzonOpiuReport | null; error?: string; warning?: string | null }) => {
        if (requestId !== requestIdRef.current) return; // устаревший ответ — игнорируем
        if (data.error && !data.report) setError(data.error);
        setReport(data.report);
        setWarning(data.warning ?? null);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (requestId !== requestIdRef.current) return;
        setError("Не удалось загрузить отчёт");
        setReport(null);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [dateFrom, dateTo, selectedCabinets]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleCabinet = (id: string) => {
    setSelectedCabinets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSection = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const rowsHaveNewCategories = useMemo(() => (report?.newCategories.length ?? 0) > 0, [report]);

  return (
    <div className="bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-[110rem] flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
            <Table2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">Финансовый отчёт Ozon</h1>
            <p className="text-xs text-gray-500">По факту начислений Ozon, в разбивке по кабинетам</p>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[110rem] flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-500">Период с</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-11 rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-500">по</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-11 rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
            />
          </div>
          <CabinetMultiSelect cabinets={cabinets} selected={selectedCabinets} onToggle={toggleCabinet} />
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="ml-auto h-11 rounded-lg bg-sky-700 px-5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? "Загрузка…" : "Обновить"}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {warning && (
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">{warning}</div>
        )}

        {rowsHaveNewCategories && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Ozon прислал начисления по {report!.newCategories.length === 1 ? "новой категории" : "новым категориям"}:{" "}
              {report!.newCategories.map((c) => c.label).join(", ")}. Учтено в «Прочих удержаниях» и в итоге
              полностью — просто ещё нет в справочнике имён.
            </div>
          </div>
        )}

        {report && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center bg-slate-900 px-5 py-3 text-sm font-semibold text-white">
              <div className="flex flex-grow items-center gap-2">
                <Sigma className="h-4 w-4" />
                Статья
              </div>
              <div className="w-40 text-right">Период, ₽</div>
            </div>

            {report.sections.map((section) => {
              const isRevenue = REVENUE_SECTIONS.has(section.key);
              const isInformational = INFORMATIONAL_SECTIONS.has(section.key);
              const bg = section.kind === "stub" || isInformational ? "bg-white" : isRevenue ? "bg-sky-50" : "bg-rose-50";
              const hasChildren = section.children.length > 0;
              const alwaysOpen = ALWAYS_OPEN_SECTIONS.has(section.key);
              const isOpen = alwaysOpen || !!expanded[section.key];
              const canToggle = hasChildren && !alwaysOpen;

              return (
                <div key={section.key}>
                  {canToggle ? (
                    <button
                      type="button"
                      onClick={() => toggleSection(section.key)}
                      aria-expanded={isOpen}
                      className={`flex w-full items-center border-b border-slate-100 px-5 py-2.5 text-left ${bg}`}
                    >
                      <div className="flex flex-grow items-center gap-2 text-sm font-bold text-slate-900">
                        <span className="inline-block w-3 text-slate-400">{isOpen ? "▾" : "▸"}</span>
                        {section.label}
                        {isInformational && (
                          <span className="text-xs font-normal italic text-slate-400">не входит в сумму</span>
                        )}
                      </div>
                      <div className={`w-40 text-right text-sm font-bold tabular-nums ${valueColorClass(section.amount)}`}>
                        {formatRub(section.amount)}
                      </div>
                    </button>
                  ) : (
                    <div className={`flex w-full items-center border-b border-slate-100 px-5 py-2.5 ${bg}`}>
                      <div className="flex-grow text-sm font-bold text-slate-900">
                        {section.label}
                        {section.kind === "stub" && (
                          <span className="ml-2 text-xs font-normal italic text-slate-400">не подключено</span>
                        )}
                        {isInformational && (
                          <span className="ml-2 text-xs font-normal italic text-slate-400">не входит в сумму</span>
                        )}
                      </div>
                      <div className={`w-40 text-right text-sm font-bold tabular-nums ${valueColorClass(section.amount)}`}>
                        {section.kind === "stub" ? "—" : formatRub(section.amount)}
                      </div>
                    </div>
                  )}
                  {isOpen &&
                    section.children.map((child) => (
                      <div
                        key={child.key}
                        className="flex w-full items-center border-b border-slate-100 bg-white px-5 py-2 pl-10"
                      >
                        <div className="flex-grow text-xs italic text-slate-500">{child.label}</div>
                        <div className={`w-40 text-right text-xs tabular-nums ${valueColorClass(child.amount)}`}>
                          {formatRub(child.amount)}
                        </div>
                      </div>
                    ))}
                </div>
              );
            })}

            <div className="flex items-center border-t-2 border-emerald-200 bg-emerald-50 px-5 py-3.5">
              <div className="flex-grow text-[15px] font-extrabold text-slate-900">К выплате</div>
              <div className="w-40 text-right text-[15px] font-extrabold tabular-nums text-slate-900">
                {formatRub(report.total)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
