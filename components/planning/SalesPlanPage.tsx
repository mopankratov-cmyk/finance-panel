"use client";

import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileCheck2,
  Loader2,
  LockKeyhole,
  PackagePlus,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  calculateSalesPlanSummary,
  createEmptySalesPlan,
  salesPlanMonthLabel,
  type SalesPlanDocument,
  type SalesPlanMarketplace,
  type SalesPlanRow,
  type SalesPlanValidationIssue,
  validateSalesPlan,
  visibleSalesPlanMonths,
} from "@/lib/planning/salesPlan";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import { SalesPlanAddSkuModal, type SalesPlanCatalogSku } from "./SalesPlanAddSkuModal";
import { SalesPlanFactView } from "./SalesPlanFactView";
import { SalesPlanTable, type SalesPlanCellPosition, type SalesPlanFillState } from "./SalesPlanTable";

type ViewMode = "edit" | "approved" | "rnp";
type SaveAction = "save" | "submit" | "approve" | "return" | "new_version";

interface SalesPlanApiResponse {
  ok?: boolean;
  plan: SalesPlanDocument | null;
  approvedPlan: SalesPlanDocument | null;
  cabinet?: string;
  error?: string;
  conflict?: boolean;
  issues?: SalesPlanValidationIssue[];
}

interface SalesPlanUser {
  email: string;
  role: "director" | "finance" | "manager";
}

const number = (value: number) => Math.round(value || 0).toLocaleString("ru-RU");
const money = (value: number) => `${number(value)} ₽`;

export function SalesPlanPage({
  marketplace,
  cabinetId,
  cabinetName,
  ready,
  cabinetLoading,
  cabinetError,
  canWrite,
  user,
}: {
  marketplace: SalesPlanMarketplace;
  cabinetId: string;
  cabinetName: string;
  ready: boolean;
  cabinetLoading: boolean;
  cabinetError: string | null;
  canWrite: boolean;
  user: SalesPlanUser | null;
}) {
  const currentDate = useMemo(() => new Date(), []);
  const [year, setYear] = useState(currentDate.getFullYear());
  const visibleMonths = useMemo(
    () => visibleSalesPlanMonths(year, year === currentDate.getFullYear() ? currentDate.getMonth() + 1 : 1),
    [currentDate, year],
  );
  const [activeMonth, setActiveMonth] = useState(visibleMonths[0]);
  const [mode, setMode] = useState<ViewMode>("edit");
  const [plan, setPlan] = useState<SalesPlanDocument | null>(null);
  const [approvedPlan, setApprovedPlan] = useState<SalesPlanDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [issues, setIssues] = useState<SalesPlanValidationIssue[]>([]);
  const [conflict, setConflict] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedCell, setSelectedCell] = useState<SalesPlanCellPosition | null>(null);
  const [fill, setFill] = useState<SalesPlanFillState | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [catalog, setCatalog] = useState<SalesPlanCatalogSku[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const editSerial = useRef(0);
  const serverRevision = useRef(0);
  const exactCabinet = canWrite && Boolean(cabinetId) && cabinetId !== "all" && !cabinetId.startsWith("group:");
  const elevated = !user || user.role === "director" || user.role === "finance";
  const accent = marketplace === "wb" ? "violet" : "sky";

  useEffect(() => {
    if (!visibleMonths.includes(activeMonth)) setActiveMonth(visibleMonths[0]);
  }, [activeMonth, visibleMonths]);

  useEffect(() => {
    if (!ready || !exactCabinet) {
      setPlan(null);
      setApprovedPlan(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    setDirty(false);
    setSaveError(null);
    setActionError(null);
    setIssues([]);
    setConflict(false);
    const params = new URLSearchParams({ marketplace, cabinet: cabinetId, year: String(year) });
    fetch(`/api/sales-plan?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as SalesPlanApiResponse;
        if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then((body) => {
        setPlan(body.plan);
        setApprovedPlan(body.approvedPlan);
        serverRevision.current = body.plan?.revision ?? 0;
        editSerial.current = 0;
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : "Не удалось загрузить план"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cabinetId, exactCabinet, marketplace, ready, reloadKey, year]);

  const persist = useCallback(async (action: SaveAction, source: SalesPlanDocument | null, autosave = false) => {
    if (!exactCabinet || saving) return null;
    const serial = editSerial.current;
    setSaving(true);
    if (!autosave) {
      setActionError(null);
      setIssues([]);
    }
    setSaveError(null);
    try {
      const params = new URLSearchParams({ marketplace, cabinet: cabinetId, year: String(year) });
      const response = await fetch(`/api/sales-plan?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedRevision: serverRevision.current, plan: source }),
      });
      const body = await response.json() as SalesPlanApiResponse;
      if (!response.ok || !body.plan) {
        if (body.conflict) setConflict(true);
        if (body.issues) setIssues(body.issues);
        throw new Error(body.error || `Ошибка ${response.status}`);
      }
      serverRevision.current = body.plan.revision;
      setApprovedPlan(body.approvedPlan);
      if (serial === editSerial.current || action !== "save") {
        setPlan(body.plan);
        setDirty(false);
      } else {
        setPlan((current) => current ? { ...current, revision: body.plan!.revision, updatedAt: body.plan!.updatedAt } : body.plan);
      }
      setConflict(false);
      return body.plan;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Не удалось сохранить план";
      if (autosave) setSaveError(message); else setActionError(message);
      return null;
    } finally {
      setSaving(false);
    }
  }, [cabinetId, exactCabinet, marketplace, saving, year]);

  useEffect(() => {
    if (!dirty || !plan || plan.status !== "draft" || saving || conflict) return;
    const timer = window.setTimeout(() => { void persist("save", plan, true); }, 850);
    return () => window.clearTimeout(timer);
  }, [conflict, dirty, persist, plan, saving]);

  const editPlan = useCallback((mutate: (current: SalesPlanDocument) => SalesPlanDocument) => {
    setPlan((current) => {
      if (!current || current.status !== "draft") return current;
      return mutate(current);
    });
    editSerial.current += 1;
    setDirty(true);
    setSaveError(null);
  }, []);

  const loadCatalog = useCallback(() => {
    if (!exactCabinet || catalogLoading || catalog.length > 0) return;
    const controller = new AbortController();
    setCatalogLoading(true);
    setCatalogError(null);
    const url = marketplace === "wb"
      ? `/api/planning/skus?cabinet=${encodeURIComponent(cabinetId)}`
      : `/api/ozon/stocks?cabinet=${encodeURIComponent(cabinetId)}`;
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as {
          error?: string;
          skus?: { external_id?: string; nm_id?: number; art: string; name: string; wb_stock?: number }[];
          rows?: { external_id?: string; art: string; name: string; free: number; img_url?: string | null }[];
        };
        if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
        return marketplace === "wb"
          ? (body.skus ?? []).map((sku): SalesPlanCatalogSku => {
            const nmId = Number(sku.nm_id ?? sku.external_id ?? 0);
            return {
              externalId: sku.external_id || String(sku.nm_id ?? ""),
              variant: sku.art,
              name: sku.name,
              stock: Number(sku.wb_stock ?? 0),
              image: Number.isInteger(nmId) && nmId > 0 ? wbCardImageUrl(nmId, "c246x328") : null,
            };
          })
          : (body.rows ?? []).map((sku): SalesPlanCatalogSku => ({ externalId: sku.external_id || "", variant: sku.art, name: sku.name, stock: Number(sku.free ?? 0), image: sku.img_url ?? null }));
      })
      .then(setCatalog)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setCatalogError(cause instanceof Error ? cause.message : "Не удалось загрузить каталог"); })
      .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
  }, [cabinetId, catalog.length, catalogLoading, exactCabinet, marketplace]);

  useEffect(() => {
    if (addOpen) loadCatalog();
  }, [addOpen, loadCatalog]);

  useEffect(() => {
    setCatalog([]);
    setCatalogError(null);
    setAddOpen(false);
  }, [cabinetId, marketplace]);

  useEffect(() => {
    if (!fill) return;
    const finish = () => {
      const currentFill = fill;
      editPlan((current) => ({
        ...current,
        rows: current.rows.map((row) => {
          if (row.id !== currentFill.rowId) return row;
          const values = [...(row.months[activeMonth] ?? [])];
          const from = Math.min(currentFill.day, currentFill.endDay);
          const to = Math.max(currentFill.day, currentFill.endDay);
          for (let day = from; day <= to; day++) values[day] = currentFill.value;
          return { ...row, months: { ...row.months, [activeMonth]: values } };
        }),
      }));
      setFill(null);
    };
    document.addEventListener("mouseup", finish, { once: true });
    return () => document.removeEventListener("mouseup", finish);
  }, [activeMonth, editPlan, fill]);

  const updateRow = (rowId: string, patch: Partial<SalesPlanRow>) => editPlan((current) => ({ ...current, rows: current.rows.map((row) => row.id === rowId ? { ...row, ...patch } : row) }));
  const updateDay = (rowId: string, day: number, value: number) => editPlan((current) => ({ ...current, rows: current.rows.map((row) => {
    if (row.id !== rowId) return row;
    const values = [...(row.months[activeMonth] ?? [])];
    values[day] = value;
    return { ...row, months: { ...row.months, [activeMonth]: values } };
  }) }));
  const removeRow = (rowId: string) => editPlan((current) => ({ ...current, rows: current.rows.filter((row) => row.id !== rowId) }));
  const addRows = (rows: SalesPlanRow[]) => {
    editPlan((current) => ({ ...current, rows: [...current.rows, ...rows.filter((row) => !current.rows.some((existing) => existing.variant.toLocaleLowerCase("ru-RU") === row.variant.toLocaleLowerCase("ru-RU")))] }));
    setAddOpen(false);
  };

  const createPlan = async () => {
    const empty = createEmptySalesPlan({ marketplace, cabinetId, year, responsible: user?.email || "Ответственный не указан" });
    serverRevision.current = 0;
    const saved = await persist("save", empty);
    if (saved) setMode("edit");
  };

  const submitPlan = async () => {
    if (!plan) return;
    const nextIssues = validateSalesPlan(plan);
    if (nextIssues.length) {
      setIssues(nextIssues);
      setActionError("Исправьте ошибки перед отправкой на согласование");
      return;
    }
    await persist("submit", plan);
  };

  const approvePlan = async () => {
    const saved = await persist("approve", plan);
    if (saved) setMode("approved");
  };

  const newVersion = async () => {
    const saved = await persist("new_version", plan);
    if (saved) setMode("edit");
  };

  if (cabinetLoading || !ready) return <PageLoading marketplace={marketplace} />;
  if (cabinetError) return <PageError message={cabinetError} onRetry={() => setReloadKey((value) => value + 1)} />;
  if (!exactCabinet) return <CabinetRequired marketplace={marketplace} />;

  const displayPlan = mode === "approved" ? approvedPlan : plan;
  const readOnly = mode !== "edit" || displayPlan?.status !== "draft";
  const summary = displayPlan ? calculateSalesPlanSummary(displayPlan, visibleMonths) : null;
  const monthCountWord = visibleMonths.length === 1 ? "месяц" : visibleMonths.length < 5 ? "месяца" : "месяцев";
  const status = plan?.status ?? "empty";
  const statusLabel = status === "draft" ? "Черновик" : status === "review" ? "На согласовании" : status === "approved" ? "Утверждён" : "Не создан";
  const statusTone = status === "draft" ? "bg-amber-500" : status === "review" ? "bg-blue-500" : status === "approved" ? "bg-emerald-500" : "bg-slate-400";
  const primary = accent === "violet" ? "bg-violet-600 hover:bg-violet-700 focus-visible:ring-violet-500" : "bg-sky-600 hover:bg-sky-700 focus-visible:ring-sky-500";
  const selectedTab = accent === "violet" ? "bg-violet-600 text-white shadow-sm" : "bg-sky-600 text-white shadow-sm";
  const soft = accent === "violet" ? "bg-violet-50 text-violet-700 border-violet-200" : "bg-sky-50 text-sky-700 border-sky-200";

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-20 md:pb-6">
      <header className="border-b border-slate-200 bg-white">
        <div className="flex flex-col gap-3 px-3 py-4 sm:px-6 xl:flex-row xl:items-center">
          <div className="flex min-w-0 items-start gap-3">
            <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${soft}`}><CalendarRange className="h-5 w-5" /></div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight text-slate-900">План продаж</h1>
              <p className="mt-0.5 text-xs text-slate-500">{cabinetName} · ежедневные заказы, цена, {marketplace === "wb" ? "выкуп" : "завершение"} и рекламный бюджет по каждому цвету</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
            <div className="flex h-11 items-center rounded-lg border border-slate-200 bg-slate-50 p-1 sm:h-9">
              <button type="button" onClick={() => setYear((value) => value - 1)} aria-label="Предыдущий год" className="grid h-9 w-9 place-items-center rounded-md text-slate-500 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:h-7 sm:w-7"><ChevronLeft className="h-4 w-4" /></button>
              <span className="min-w-12 text-center text-xs font-bold tabular-nums text-slate-700">{year}</span>
              <button type="button" onClick={() => setYear((value) => value + 1)} aria-label="Следующий год" className="grid h-9 w-9 place-items-center rounded-md text-slate-500 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:h-7 sm:w-7"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <div className="flex h-11 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 sm:h-9" role="tablist" aria-label="Режим плана">
              <ModeButton active={mode === "edit"} selectedClass={selectedTab} onClick={() => setMode("edit")}>Редактирование</ModeButton>
              <ModeButton active={mode === "approved"} selectedClass={selectedTab} onClick={() => setMode("approved")}>Утверждён</ModeButton>
              <ModeButton active={mode === "rnp"} selectedClass={selectedTab} onClick={() => setMode("rnp")}>РНП: план/факт</ModeButton>
            </div>
          </div>
        </div>
      </header>

      <div className="space-y-3 px-2 py-3 sm:px-6">
        <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between" aria-label="Статус плана">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`h-2.5 w-2.5 rounded-full ${statusTone}`} />
            <strong className="text-slate-800">{statusLabel}{plan ? ` · v${plan.version}` : ""}</strong>
            {plan ? <span className="text-slate-400">Ответственный: {plan.responsible || user?.email || "—"}</span> : null}
            {approvedPlan?.approvedAt && mode !== "edit" ? <span className="inline-flex items-center gap-1 text-emerald-700"><LockKeyhole className="h-3.5 w-3.5" /> {approvedPlan.approvedBy} · {new Date(approvedPlan.approvedAt).toLocaleString("ru-RU")}</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {plan ? <span aria-live="polite" className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium ${saveError ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : dirty ? <Clock3 className="h-3.5 w-3.5 text-amber-500" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}{saving ? "Сохраняем…" : saveError ? "Ошибка автосохранения" : dirty ? "Есть изменения" : "Сохранено автоматически"}</span> : null}
            {plan?.status === "review" && elevated ? <button type="button" disabled={saving} onClick={() => void persist("return", plan)} className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 sm:min-h-9">Вернуть</button> : null}
            {!plan ? <ActionButton primary={primary} disabled={saving} onClick={() => void createPlan()} icon={PackagePlus}>Создать план</ActionButton>
              : plan.status === "draft" ? <ActionButton primary={primary} disabled={saving} onClick={() => void submitPlan()} icon={Send}>На согласование</ActionButton>
                : plan.status === "review" && elevated ? <ActionButton primary={primary} disabled={saving} onClick={() => void approvePlan()} icon={FileCheck2}>Утвердить</ActionButton>
                  : plan.status === "approved" && elevated ? <ActionButton primary={primary} disabled={saving} onClick={() => void newVersion()} icon={RefreshCw}>Новая версия</ActionButton>
                    : null}
          </div>
        </section>

        {saveError || actionError ? <div role="alert" className="flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between"><span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{saveError || actionError}</span>{conflict ? <button type="button" onClick={() => setReloadKey((value) => value + 1)} className="min-h-9 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold hover:bg-rose-100">Загрузить серверную версию</button> : null}</div> : null}
        {issues.length > 0 ? <ValidationSummary issues={issues} /> : null}

        {loading ? <div className="flex min-h-[420px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" /> Загружаем план…</div>
          : loadError ? <PageError message={loadError} onRetry={() => setReloadKey((value) => value + 1)} />
            : mode === "rnp" ? <>
              {approvedPlan ? <section className="rounded-xl border border-slate-200 bg-white p-3" aria-label="Период план-факт">
                  <div className="max-w-full overflow-x-auto overscroll-x-contain pb-1">
                    <div className="flex w-max min-w-full gap-1" role="tablist" aria-label="Месяц план-факт">
                      {visibleMonths.map((monthKey) => {
                        const monthTotal = calculateSalesPlanSummary(approvedPlan, [monthKey]).orders;
                        return <button key={monthKey} type="button" role="tab" aria-selected={activeMonth === monthKey} onClick={() => setActiveMonth(monthKey)} className={`min-h-8 min-w-[104px] whitespace-nowrap rounded-md border px-2 text-[11px] font-semibold transition ${activeMonth === monthKey ? `${selectedTab} border-transparent` : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{salesPlanMonthLabel(year, monthKey, false)} <span className={`ml-1 rounded px-1 py-0.5 text-[9px] ${activeMonth === monthKey ? "bg-white/20" : "bg-slate-100 text-slate-500"}`}>{number(monthTotal)}</span></button>;
                      })}
                    </div>
                  </div>
              </section> : null}
              <SalesPlanFactView marketplace={marketplace} cabinetId={cabinetId} monthKey={activeMonth} approvedPlan={approvedPlan} />
            </>
              : !displayPlan ? <EmptyPlan mode={mode} marketplace={marketplace} onCreate={() => void createPlan()} />
                : <>
                  {summary ? <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Показатели плана">
                    <Metric label="План заказов" value={`${number(summary.orders)} шт.`} detail={`${summary.variants} цветов · ${visibleMonths.length} ${monthCountWord}`} />
                    <Metric label={marketplace === "wb" ? "Ожидаемый выкуп" : "Ожидаемое завершение"} value={`${number(summary.buyouts)} шт.`} detail={`${summary.buyoutPct.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}% по каждому цвету`} />
                    <Metric label="Плановая выручка" value={money(summary.revenue)} detail={`${marketplace === "wb" ? "выкуп" : "завершение"} × цена`} />
                    <Metric label="Рекламный бюджет" value={money(summary.ads)} detail={`${summary.adPct.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}% от заказной выручки`} tone="amber" />
                  </section> : null}

                  <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex flex-col gap-3">
                      <div className="max-w-full overflow-x-auto overscroll-x-contain pb-1">
                        <div className="flex w-max min-w-full gap-1" role="tablist" aria-label="Месяц плана">
                          {visibleMonths.map((monthKey) => {
                            const monthTotal = calculateSalesPlanSummary(displayPlan, [monthKey]).orders;
                            return <button key={monthKey} type="button" role="tab" aria-selected={activeMonth === monthKey} onClick={() => setActiveMonth(monthKey)} className={`min-h-8 min-w-[104px] whitespace-nowrap rounded-md border px-2 text-[11px] font-semibold transition ${activeMonth === monthKey ? `${selectedTab} border-transparent` : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{salesPlanMonthLabel(year, monthKey, false)} <span className={`ml-1 rounded px-1 py-0.5 text-[9px] ${activeMonth === monthKey ? "bg-white/20" : "bg-slate-100 text-slate-500"}`}>{number(monthTotal)}</span></button>;
                          })}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                        <label className="relative block min-w-[220px]"><span className="sr-only">Поиск в плане</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Артикул, цвет или ID" className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 sm:h-9" /></label>
                        {!readOnly ? <button type="button" onClick={() => setAddOpen(true)} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 sm:min-h-9 ${soft}`}><PackagePlus className="h-4 w-4" /> Добавить SKU</button> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-100 pt-3 text-[11px] text-slate-500"><span>Фиолетовая/голубая рамка — выбранная ячейка заказов</span><span>Потяните маркер в углу, чтобы заполнить диапазон</span><span>Раскройте цвет для выкупа, выручки и рекламы по дням</span></div>
                  </section>

                  <SalesPlanTable
                    plan={displayPlan}
                    monthKey={activeMonth}
                    readOnly={readOnly}
                    marketplace={marketplace}
                    query={query}
                    expanded={expanded}
                    selectedCell={selectedCell}
                    fill={fill}
                    onToggleExpand={(rowId) => setExpanded((current) => { const next = new Set(current); if (next.has(rowId)) next.delete(rowId); else next.add(rowId); return next; })}
                    onRowChange={updateRow}
                    onDayChange={updateDay}
                    onRemove={removeRow}
                    onSelectCell={setSelectedCell}
                    onFillStart={setFill}
                    onFillEnter={(position) => setFill((current) => current && current.rowId === position.rowId ? { ...current, endDay: position.day } : current)}
                  />
                </>}
      </div>

      {addOpen && plan?.status === "draft" ? <SalesPlanAddSkuModal marketplace={marketplace} year={year} catalog={catalog} catalogLoading={catalogLoading} catalogError={catalogError} existingVariants={plan.rows.map((row) => row.variant)} onClose={() => setAddOpen(false)} onAdd={addRows} /> : null}
    </div>
  );
}

function ModeButton({ active, selectedClass, onClick, children }: { active: boolean; selectedClass: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`min-h-9 rounded-md px-2.5 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:min-h-7 ${active ? selectedClass : "text-slate-500 hover:bg-white hover:text-slate-800"}`}>{children}</button>;
}

function ActionButton({ primary, disabled, onClick, icon: Icon, children }: { primary: string; disabled: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-55 sm:min-h-9 ${primary}`}><Icon className="h-4 w-4" />{children}</button>;
}

function Metric({ label, value, detail, tone = "slate" }: { label: string; value: string; detail: string; tone?: "slate" | "amber" }) {
  return <div className={`rounded-xl border p-4 ${tone === "amber" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{value}</div><div className="mt-1 text-[11px] text-slate-500">{detail}</div></div>;
}

function ValidationSummary({ issues }: { issues: SalesPlanValidationIssue[] }) {
  return <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"><div className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" />Нужно исправить: {issues.length}</div><ul className="mt-2 grid gap-1 text-xs text-amber-800 sm:grid-cols-2">{issues.slice(0, 8).map((issue, index) => <li key={`${issue.field}-${issue.rowId}-${index}`}>• {issue.message}</li>)}</ul>{issues.length > 8 ? <p className="mt-1 text-xs text-amber-700">И ещё {issues.length - 8}</p> : null}</div>;
}

function EmptyPlan({ mode, marketplace, onCreate }: { mode: ViewMode; marketplace: SalesPlanMarketplace; onCreate: () => void }) {
  return <div className="grid min-h-[430px] place-items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 text-center"><div className="max-w-md"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-500"><CalendarRange className="h-6 w-6" /></div><h2 className="mt-4 text-lg font-bold text-slate-900">{mode === "approved" ? "Нет утверждённой версии" : "План не создан"}</h2><p className="mt-2 text-sm leading-6 text-slate-500">Создайте отдельный план для текущего кабинета {marketplace === "wb" ? "Wildberries" : "Ozon"} и добавьте цветовые вариации из каталога.</p>{mode === "edit" ? <button type="button" onClick={onCreate} className={`mt-5 min-h-11 rounded-lg px-5 text-sm font-semibold text-white ${marketplace === "wb" ? "bg-violet-600 hover:bg-violet-700" : "bg-sky-600 hover:bg-sky-700"}`}>Создать план</button> : null}</div></div>;
}

function CabinetRequired({ marketplace }: { marketplace: SalesPlanMarketplace }) {
  return <div className="grid min-h-[calc(100vh-54px)] place-items-center bg-[#f6f7f9] p-6"><div className="max-w-md rounded-2xl border border-amber-200 bg-white p-7 text-center shadow-sm"><LockKeyhole className="mx-auto h-8 w-8 text-amber-500" /><h1 className="mt-4 text-lg font-bold text-slate-900">Выберите один кабинет {marketplace === "wb" ? "WB" : "Ozon"}</h1><p className="mt-2 text-sm leading-6 text-slate-500">Общий план «Все кабинеты» и план группы нельзя редактировать или утверждать. Выберите конкретное юридическое лицо в переключателе сверху.</p></div></div>;
}

function PageLoading({ marketplace }: { marketplace: SalesPlanMarketplace }) { return <div className="flex min-h-[calc(100vh-54px)] items-center justify-center gap-2 bg-[#f6f7f9] text-sm text-slate-500"><Loader2 className={`h-5 w-5 animate-spin motion-reduce:animate-none ${marketplace === "wb" ? "text-violet-600" : "text-sky-600"}`} /> Загружаем кабинеты…</div>; }
function PageError({ message, onRetry }: { message: string; onRetry: () => void }) { return <div role="alert" className="mx-3 my-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 sm:mx-6"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span className="flex-1">{message}</span><button type="button" onClick={onRetry} className="min-h-9 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold hover:bg-rose-100">Повторить</button></div></div>; }
