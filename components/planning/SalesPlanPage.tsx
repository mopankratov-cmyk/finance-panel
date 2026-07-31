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
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionableError } from "@/components/ui/ActionableError";
import {
  applySalesPlanSuggestion,
  buildSalesPlanSuggestion,
  canModerateSalesPlan,
  calculateSalesPlanSuggestedDailyOrders,
  calculateSalesPlanSummary,
  calculateSalesPlanStockRiskSummary,
  createEmptySalesPlan,
  getApprovedSalesPlanForMonth,
  getSalesPlanMonthState,
  isSalesPlanCatalogResponseCurrent,
  normalizeSalesPlanReturnComment,
  refreshSalesPlanMarketplaceStocks,
  salesPlanMonthLabel,
  type SalesPlanEnvelope,
  type SalesPlanDocument,
  type SalesPlanEvent,
  type SalesPlanMarketplace,
  type SalesPlanRow,
  type SalesPlanStatus,
  type SalesPlanSuggestion,
  type SalesPlanSuggestionBasis,
  type SalesPlanValidationIssue,
  validateSalesPlanMonth,
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
  approvedByMonth?: SalesPlanEnvelope["approvedByMonth"];
  events?: SalesPlanEvent[];
  cabinet?: string;
  error?: string;
  conflict?: boolean;
  issues?: SalesPlanValidationIssue[];
}

interface SalesPlanUser {
  email: string;
  role: "director" | "finance" | "manager" | "seller";
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
  canRead,
  canWrite,
  user,
}: {
  marketplace: SalesPlanMarketplace;
  cabinetId: string;
  cabinetName: string;
  ready: boolean;
  cabinetLoading: boolean;
  cabinetError: string | null;
  canRead?: boolean;
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
  const [approvedByMonth, setApprovedByMonth] = useState<SalesPlanEnvelope["approvedByMonth"]>({});
  const [events, setEvents] = useState<SalesPlanEvent[]>([]);
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
  const [stockRiskOnly, setStockRiskOnly] = useState(false);
  const [basisOpen, setBasisOpen] = useState(false);
  const [suggestionPreview, setSuggestionPreview] = useState<SalesPlanSuggestion | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedCell, setSelectedCell] = useState<SalesPlanCellPosition | null>(null);
  const [fill, setFill] = useState<SalesPlanFillState | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [catalog, setCatalog] = useState<SalesPlanCatalogSku[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogPeriod, setCatalogPeriod] = useState<string | null>(null);
  const catalogRequestScope = useRef("");
  const catalogRequestSerial = useRef(0);
  const catalogContextScope = `${marketplace}:${cabinetId}:${year}-${activeMonth}`;
  const currentCatalogContextScope = useRef(catalogContextScope);
  currentCatalogContextScope.current = catalogContextScope;
  const editSerial = useRef(0);
  const serverRevision = useRef(0);
  const exactCabinet = (canRead ?? canWrite) && Boolean(cabinetId) && cabinetId !== "all" && !cabinetId.startsWith("group:");
  const elevated = canModerateSalesPlan(user);
  const accent = marketplace === "wb" ? "violet" : "sky";

  useEffect(() => {
    if (!visibleMonths.includes(activeMonth)) setActiveMonth(visibleMonths[0]);
  }, [activeMonth, visibleMonths]);

  useEffect(() => {
    if (!ready || !exactCabinet) {
      setPlan(null);
      setApprovedPlan(null);
      setApprovedByMonth({});
      setEvents([]);
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
        setApprovedByMonth(body.approvedByMonth ?? {});
        setEvents(body.events ?? []);
        serverRevision.current = body.plan?.revision ?? 0;
        editSerial.current = 0;
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : "Не удалось загрузить план"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cabinetId, exactCabinet, marketplace, ready, reloadKey, year]);

  const persist = useCallback(async (action: SaveAction, source: SalesPlanDocument | null, autosave = false, options?: { comment?: string }) => {
    if (!exactCabinet || !canWrite || saving) return null;
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
        body: JSON.stringify({ action, expectedRevision: serverRevision.current, monthKey: activeMonth, plan: source, comment: options?.comment }),
      });
      const body = await response.json() as SalesPlanApiResponse;
      if (!response.ok || !body.plan) {
        if (body.conflict) setConflict(true);
        if (body.issues) setIssues(body.issues);
        throw new Error(body.error || `Ошибка ${response.status}`);
      }
      serverRevision.current = body.plan.revision;
      setApprovedPlan(body.approvedPlan);
      setApprovedByMonth(body.approvedByMonth ?? {});
      setEvents(body.events ?? []);
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
  }, [activeMonth, cabinetId, canWrite, exactCabinet, marketplace, saving, year]);

  useEffect(() => {
    if (!dirty || !plan || getSalesPlanMonthState(plan, activeMonth).status !== "draft" || saving || conflict) return;
    const timer = window.setTimeout(() => { void persist("save", plan, true); }, 850);
    return () => window.clearTimeout(timer);
  }, [activeMonth, conflict, dirty, persist, plan, saving]);

  const editPlan = useCallback((mutate: (current: SalesPlanDocument) => SalesPlanDocument) => {
    setPlan((current) => {
      if (!current || getSalesPlanMonthState(current, activeMonth).status !== "draft") return current;
      return mutate(current);
    });
    editSerial.current += 1;
    setDirty(true);
    setSaveError(null);
  }, [activeMonth]);

  const applyMarketplaceStockRefresh = useCallback((
    rows: SalesPlanCatalogSku[],
    failed = false,
    request = { contextScope: catalogContextScope, requestScope: catalogRequestScope.current },
  ) => {
    const currentScope = () => ({
      contextScope: currentCatalogContextScope.current,
      requestScope: catalogRequestScope.current,
    });
    if (!isSalesPlanCatalogResponseCurrent(request, currentScope())) return;
    setPlan((current) => {
      if (!isSalesPlanCatalogResponseCurrent(request, currentScope())) return current;
      if (!current) return current;
      if (current.marketplace !== marketplace || current.cabinetId !== cabinetId || current.year !== year) return current;
      const next = refreshSalesPlanMarketplaceStocks(current, activeMonth, rows, {
        failed,
        asOf: new Date().toISOString(),
      });
      if (next === current) return current;
      editSerial.current += 1;
      setDirty(true);
      setSaveError(null);
      return next;
    });
  }, [activeMonth, cabinetId, catalogContextScope, marketplace, year]);

  const loadCatalog = useCallback(() => {
    const targetPeriod = catalogContextScope;
    if (!exactCabinet || catalogLoading || catalogPeriod === targetPeriod) return;
    const request = {
      contextScope: targetPeriod,
      requestScope: `${targetPeriod}:${++catalogRequestSerial.current}`,
    };
    catalogRequestScope.current = request.requestScope;
    const requestIsCurrent = () => isSalesPlanCatalogResponseCurrent(request, {
      contextScope: currentCatalogContextScope.current,
      requestScope: catalogRequestScope.current,
    });
    const controller = new AbortController();
    setCatalogLoading(true);
    setCatalogError(null);
    const url = marketplace === "wb"
      ? `/api/planning/skus?cabinet=${encodeURIComponent(cabinetId)}&year=${year}&month=${activeMonth}`
      : `/api/ozon/stocks?cabinet=${encodeURIComponent(cabinetId)}`;
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as {
          error?: string;
          wb_stock_date?: string | null;
          skus?: {
            external_id?: string;
            nm_id?: number;
            art: string;
            name: string;
            wb_stock?: number;
            orders_week?: number;
            orders_sum_week?: number;
            orders_month?: number;
            orders_sum_month?: number;
            avg_daily_7?: number;
            avg_price_month?: number;
            seasonality_factor?: number;
            seasonality_raw_factor?: number;
            seasonality_source?: string;
            seasonality_subject?: string;
            seasonality_note?: string;
            demand_factor?: number;
          }[];
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
              ordersWeek: Number(sku.orders_week ?? 0),
              revenueWeek: Number(sku.orders_sum_week ?? 0),
              ordersMonth: Number(sku.orders_month ?? 0),
              revenueMonth: Number(sku.orders_sum_month ?? 0),
              avgDaily7: Number(sku.avg_daily_7 ?? 0),
              avgPriceMonth: Number(sku.avg_price_month ?? 0),
              seasonalityFactor: Number(sku.seasonality_factor ?? 1),
              seasonalityRawFactor: Number(sku.seasonality_raw_factor ?? sku.seasonality_factor ?? 1),
              seasonalitySource: sku.seasonality_source ?? "",
              seasonalitySubject: sku.seasonality_subject ?? "",
              seasonalityNote: sku.seasonality_note ?? "",
              demandFactor: Number(sku.demand_factor ?? 1),
              stockAsOf: body.wb_stock_date ?? new Date().toISOString(),
            };
          })
          : (body.rows ?? []).map((sku): SalesPlanCatalogSku => ({ externalId: sku.external_id || "", variant: sku.art, name: sku.name, stock: Number(sku.free ?? 0), image: sku.img_url ?? null }));
      })
      .then((rows) => {
        if (!requestIsCurrent()) return;
        setCatalog(rows);
        setCatalogPeriod(targetPeriod);
        applyMarketplaceStockRefresh(rows, false, request);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && requestIsCurrent()) {
          setCatalogPeriod(targetPeriod);
          setCatalogError(cause instanceof Error ? cause.message : "Не удалось загрузить каталог");
          applyMarketplaceStockRefresh([], true, request);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && requestIsCurrent()) setCatalogLoading(false);
      });
  }, [activeMonth, applyMarketplaceStockRefresh, cabinetId, catalogContextScope, catalogLoading, catalogPeriod, exactCabinet, marketplace, year]);

  useEffect(() => {
    if (addOpen) loadCatalog();
  }, [addOpen, loadCatalog]);

  useEffect(() => {
    if (plan && exactCabinet && mode === "edit") loadCatalog();
  }, [exactCabinet, loadCatalog, mode, plan]);

  useEffect(() => {
    catalogRequestScope.current = "";
    setCatalog([]);
    setCatalogLoading(false);
    setCatalogPeriod(null);
    setCatalogError(null);
    setAddOpen(false);
  }, [activeMonth, cabinetId, marketplace, year]);

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
    if (saving || dirty || saveError || conflict) {
      setActionError("Дождитесь успешного автосохранения перед отправкой на согласование");
      return;
    }
    const nextIssues = validateSalesPlanMonth(plan, activeMonth);
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

  const returnPlan = async () => {
    if (!plan) return;
    const rawComment = window.prompt("Почему возвращаем план? Укажите, что нужно исправить.");
    const comment = normalizeSalesPlanReturnComment(rawComment);
    if (!comment) {
      setActionError("Укажите комментарий возврата: что исправить в плане");
      return;
    }
    await persist("return", plan, false, { comment });
  };

  const newVersion = async () => {
    const saved = await persist("new_version", plan);
    if (saved) setMode("edit");
  };

  if (cabinetLoading || !ready) return <PageLoading marketplace={marketplace} />;
  if (cabinetError) return <PageError message={cabinetError} onRetry={() => setReloadKey((value) => value + 1)} />;
  if (!exactCabinet) return <CabinetRequired marketplace={marketplace} />;

  const approvedEnvelope: SalesPlanEnvelope = { working: plan, approved: approvedPlan, approvedByMonth, events };
  const activeApprovedPlan = getApprovedSalesPlanForMonth(approvedEnvelope, activeMonth);
  const activeMonthState = plan ? getSalesPlanMonthState(plan, activeMonth) : null;
  const activeApprovedMonthState = activeApprovedPlan ? getSalesPlanMonthState(activeApprovedPlan, activeMonth) : null;
  const displayPlan = mode === "approved" ? activeApprovedPlan : plan;
  const displayMonthState = displayPlan ? getSalesPlanMonthState(displayPlan, activeMonth) : null;
  const readOnly = !canWrite || mode !== "edit" || displayMonthState?.status !== "draft";
  const summary = displayPlan ? calculateSalesPlanSummary(displayPlan, visibleMonths) : null;
  const stockRisk = displayPlan ? calculateSalesPlanStockRiskSummary(displayPlan, activeMonth) : null;
  const monthCountWord = visibleMonths.length === 1 ? "месяц" : visibleMonths.length < 5 ? "месяца" : "месяцев";
  const status = activeMonthState?.status ?? "empty";
  const statusLabel = status === "draft" ? "Черновик" : status === "review" ? "На согласовании" : status === "approved" ? "Утверждён" : "Не создан";
  const statusTone = status === "draft" ? "bg-amber-500" : status === "review" ? "bg-blue-500" : status === "approved" ? "bg-emerald-500" : "bg-slate-400";
  const workflowStep = status === "review" ? 2 : status === "approved" ? 3 : 1;
  const activeDraftIssues = plan && status === "draft" ? validateSalesPlanMonth(plan, activeMonth) : [];
  const primary = accent === "violet" ? "bg-violet-600 hover:bg-violet-700 focus-visible:ring-violet-500" : "bg-sky-600 hover:bg-sky-700 focus-visible:ring-sky-500";
  const selectedTab = accent === "violet" ? "bg-violet-600 text-white shadow-sm" : "bg-sky-600 text-white shadow-sm";
  const soft = accent === "violet" ? "bg-violet-50 text-violet-700 border-violet-200" : "bg-sky-50 text-sky-700 border-sky-200";
  const submitDisabled = saving || dirty || Boolean(saveError) || conflict;
  const submitDisabledHint = conflict
    ? "Разрешите конфликт с серверной версией"
    : saveError
      ? "Исправьте ошибку автосохранения"
      : dirty || saving
        ? "Дождитесь успешного автосохранения"
        : undefined;
  const catalogByExternalId = new Map(catalog.map((sku) => [sku.externalId, sku]));
  const catalogByVariant = new Map(catalog.map((sku) => [sku.variant.toLocaleLowerCase("ru-RU"), sku]));
  const basisByRowId = displayPlan?.rows.reduce<Record<string, SalesPlanSuggestionBasis | undefined>>((acc, row) => {
    const sku = catalogByExternalId.get(row.externalId) ?? catalogByVariant.get(row.variant.toLocaleLowerCase("ru-RU"));
    acc[row.id] = sku ? {
      stock: sku.stock,
      ordersWeek: Number(sku.ordersWeek ?? 0),
      revenueWeek: Number(sku.revenueWeek ?? 0),
      ordersMonth: Number(sku.ordersMonth ?? 0),
      revenueMonth: Number(sku.revenueMonth ?? 0),
      seasonalityFactor: Number(sku.seasonalityFactor ?? 1),
      seasonalityRawFactor: Number(sku.seasonalityRawFactor ?? sku.seasonalityFactor ?? 1),
      seasonalitySource: sku.seasonalitySource ?? "",
      seasonalitySubject: sku.seasonalitySubject ?? "",
      seasonalityNote: sku.seasonalityNote ?? "",
      demandFactor: Number(sku.demandFactor ?? 1),
    } : undefined;
    return acc;
  }, {}) ?? {};
  const liveStock = displayPlan?.rows.reduce(
    (total, row) => {
      const sku = catalogByExternalId.get(row.externalId) ?? catalogByVariant.get(row.variant.toLocaleLowerCase("ru-RU"));
      if (!sku) return total;
      total.value += Math.max(0, Number(sku.stock) || 0);
      total.matchedRows += 1;
      return total;
    },
    { value: 0, matchedRows: 0 },
  ) ?? { value: 0, matchedRows: 0 };
  const stockDetail = stockRisk
    ? liveStock.matchedRows > 0
      ? `на начало: ${number(stockRisk.currentStock)} шт. · факт сейчас: ${number(liveStock.value)} шт. (${liveStock.matchedRows}/${displayPlan?.rows.length ?? 0} SKU)`
      : `плановый остаток на начало: ${number(stockRisk.currentStock)} шт.`
    : "";

  const openSuggestionPreview = () => {
    if (!plan) return;
    if (catalogLoading) {
      setActionError("Дождитесь загрузки основания плана");
      return;
    }
    setActionError(null);
    setSuggestionPreview(buildSalesPlanSuggestion(plan, activeMonth, basisByRowId));
  };
  const applySuggestion = (replaceFilled: boolean) => {
    if (!plan) return;
    if (replaceFilled && !window.confirm("Заменить все дневные ячейки выбранного месяца расчётным предложением? Ручные значения будут перезаписаны.")) return;
    editPlan((current) => applySalesPlanSuggestion(
      current,
      buildSalesPlanSuggestion(current, activeMonth, basisByRowId, { replaceFilled }),
    ));
    setSuggestionPreview(null);
  };

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
            <strong className="text-slate-800">{statusLabel}{activeMonthState ? ` · ${salesPlanMonthLabel(year, activeMonth, false)} · v${activeMonthState.version}` : ""}</strong>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">Шаг {workflowStep} из 3</span>
            {plan ? <span className="text-slate-400">Ответственный: {plan.responsible || user?.email || "—"}</span> : null}
            {plan && status === "draft" ? <span className={`inline-flex items-center gap-1 font-medium ${activeDraftIssues.length > 0 ? "text-amber-700" : "text-emerald-700"}`}>{activeDraftIssues.length > 0 ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{activeDraftIssues.length > 0 ? activeDraftIssues[0].message : "Можно отправлять на согласование"}</span> : null}
            {activeApprovedMonthState?.approvedAt && mode !== "edit" ? <span className="inline-flex items-center gap-1 text-emerald-700"><LockKeyhole className="h-3.5 w-3.5" /> {activeApprovedMonthState.approvedBy} · {new Date(activeApprovedMonthState.approvedAt).toLocaleString("ru-RU")}</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {plan ? <span aria-live="polite" className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium ${saveError ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : dirty ? <Clock3 className="h-3.5 w-3.5 text-amber-500" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}{saving ? "Сохраняем…" : saveError ? "Ошибка автосохранения" : dirty ? "Есть изменения" : "Сохранено автоматически"}</span> : null}
            {activeMonthState?.status === "review" && elevated ? <button type="button" disabled={saving} onClick={() => void returnPlan()} className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 sm:min-h-9">Вернуть</button> : null}
            {canWrite && mode === "edit" ? !plan ? <ActionButton primary={primary} disabled={saving} onClick={() => void createPlan()} icon={PackagePlus}>Создать план</ActionButton>
              : activeMonthState?.status === "draft" ? <ActionButton primary={primary} disabled={submitDisabled} title={submitDisabledHint} onClick={() => void submitPlan()} icon={Send}>На согласование</ActionButton>
                : activeMonthState?.status === "review" && elevated ? <ActionButton primary={primary} disabled={saving} onClick={() => void approvePlan()} icon={FileCheck2}>Утвердить</ActionButton>
                  : activeMonthState?.status === "approved" && elevated ? <ActionButton primary={primary} disabled={saving} onClick={() => void newVersion()} icon={RefreshCw}>Новая версия</ActionButton>
                    : null : null}
          </div>
        </section>

        {activeMonthState?.status === "draft" && activeMonthState.returnComment ? <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><span className="font-semibold">Месяц возвращён на доработку</span>{activeMonthState.returnedBy ? ` · ${activeMonthState.returnedBy}` : ""}{activeMonthState.returnedAt ? ` · ${new Date(activeMonthState.returnedAt).toLocaleString("ru-RU")}` : ""}: {activeMonthState.returnComment}</div> : null}
        {saveError || actionError ? <div role="alert" className="flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between"><span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{saveError || actionError}</span>{conflict ? <button type="button" onClick={() => setReloadKey((value) => value + 1)} className="min-h-9 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold hover:bg-rose-100">Загрузить серверную версию</button> : null}</div> : null}
        {issues.length > 0 ? <ValidationSummary issues={issues} /> : null}
        {events.length > 0 ? <SalesPlanHistory events={events} activeMonth={activeMonth} year={year} /> : null}

        {loading ? <div className="flex min-h-[420px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" /> Загружаем план…</div>
          : loadError ? <PageError message={loadError} onRetry={() => setReloadKey((value) => value + 1)} />
            : mode === "rnp" ? <>
              {approvedPlan || Object.keys(approvedByMonth).length > 0 ? <section className="rounded-xl border border-slate-200 bg-white p-3" aria-label="Период план-факт">
                  <div className="max-w-full overflow-x-auto overscroll-x-contain pb-1">
                    <div className="flex w-max min-w-full gap-1" role="tablist" aria-label="Месяц план-факт">
                      {visibleMonths.map((monthKey) => {
                        const monthPlan = getApprovedSalesPlanForMonth(approvedEnvelope, monthKey);
                        const monthTotal = monthPlan ? calculateSalesPlanSummary(monthPlan, [monthKey]).orders : 0;
                        return <button key={monthKey} type="button" role="tab" aria-selected={activeMonth === monthKey} onClick={() => setActiveMonth(monthKey)} className={`min-h-8 min-w-[104px] whitespace-nowrap rounded-md border px-2 text-[11px] font-semibold transition ${activeMonth === monthKey ? `${selectedTab} border-transparent` : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{salesPlanMonthLabel(year, monthKey, false)} <span className={`ml-1 rounded px-1 py-0.5 text-[9px] ${activeMonth === monthKey ? "bg-white/20" : "bg-slate-100 text-slate-500"}`}>{monthPlan ? number(monthTotal) : "—"}</span></button>;
                      })}
                    </div>
                  </div>
              </section> : null}
              <SalesPlanFactView marketplace={marketplace} cabinetId={cabinetId} monthKey={activeMonth} approvedPlan={activeApprovedPlan} onOpenPlan={() => setMode("edit")} />
            </>
              : !displayPlan ? canWrite
                ? <EmptyPlan mode={mode} marketplace={marketplace} workingStatus={activeMonthState?.status ?? null} onCreate={() => void createPlan()} onOpenEdit={() => setMode("edit")} />
                : <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Утверждённый план ещё не создан.</div>
                : <>
                  {summary ? <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5" aria-label="Показатели плана">
                    <Metric label="План заказов" value={`${number(summary.orders)} шт.`} detail={`${summary.variants} цветов · ${visibleMonths.length} ${monthCountWord}`} />
                    <Metric label={marketplace === "wb" ? "Ожидаемый выкуп" : "Ожидаемое завершение"} value={`${number(summary.buyouts)} шт.`} detail={`${summary.buyoutPct.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}% по каждому цвету`} />
                    <Metric label="Плановая выручка" value={money(summary.revenue)} detail={`${marketplace === "wb" ? "выкуп" : "завершение"} × цена`} />
                    <Metric label="Рекламный бюджет" value={money(summary.ads)} detail={`${summary.adPct.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}% от заказной выручки`} tone="amber" />
                    {stockRisk ? <Metric label="Остаток на конец" value={stockRisk.forecastAvailable ? `${number(stockRisk.endingStock)} шт.` : "Недоступен"} detail={!stockRisk.forecastAvailable ? `Прогноз недоступен: ${stockRisk.unavailableReason}` : stockRisk.shortageRows > 0 ? `${stockRisk.shortageRows} SKU покажут дефицит с ${stockRisk.shortageDay} числа · ${stockDetail}` : stockDetail} tone={stockRisk.shortageRows > 0 ? "rose" : "slate"} /> : null}
                  </section> : null}

                  <SalesPlanBasisPanel
                    open={basisOpen}
                    onToggle={() => setBasisOpen((value) => !value)}
                    plan={displayPlan}
                    basisByRowId={basisByRowId}
                    loading={catalogLoading}
                    error={catalogError}
                    onReload={() => setCatalogPeriod(null)}
                  />

                  <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex flex-col gap-3">
                      <div className="max-w-full overflow-x-auto overscroll-x-contain pb-1">
                        <div className="flex w-max min-w-full gap-1" role="tablist" aria-label="Месяц плана">
                          {visibleMonths.map((monthKey) => {
                            const monthTotal = calculateSalesPlanSummary(displayPlan, [monthKey]).orders;
                            const state = getSalesPlanMonthState(displayPlan, monthKey);
                            const badge = state.status === "approved" ? "утв" : state.status === "review" ? "согл" : number(monthTotal);
                            return <button key={monthKey} type="button" role="tab" aria-selected={activeMonth === monthKey} onClick={() => setActiveMonth(monthKey)} className={`min-h-8 min-w-[104px] whitespace-nowrap rounded-md border px-2 text-[11px] font-semibold transition ${activeMonth === monthKey ? `${selectedTab} border-transparent` : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{salesPlanMonthLabel(year, monthKey, false)} <span className={`ml-1 rounded px-1 py-0.5 text-[9px] ${activeMonth === monthKey ? "bg-white/20" : "bg-slate-100 text-slate-500"}`}>{badge}</span></button>;
                          })}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                        {!readOnly ? <button type="button" onClick={openSuggestionPreview} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 sm:min-h-9 ${soft}`}><Wand2 className="h-4 w-4" /> Предложить план</button> : null}
                        {stockRisk ? <button type="button" aria-pressed={stockRiskOnly} onClick={() => setStockRiskOnly((value) => !value)} className={`inline-flex min-h-11 items-center justify-center rounded-lg border px-3 text-xs font-semibold transition sm:min-h-9 ${stockRiskOnly ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>Покажет дефицит <span className="ml-1 rounded bg-white/70 px-1.5 py-0.5 text-[10px]">{stockRisk.shortageRows}</span></button> : null}
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
                    stockRiskOnly={stockRiskOnly}
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

      {suggestionPreview && plan ? <SalesPlanSuggestionModal suggestion={suggestionPreview} onClose={() => setSuggestionPreview(null)} onApplyEmpty={() => applySuggestion(false)} onReplaceAll={() => applySuggestion(true)} /> : null}
      {addOpen && activeMonthState?.status === "draft" && plan ? <SalesPlanAddSkuModal marketplace={marketplace} year={year} monthKey={activeMonth} catalog={catalog} catalogLoading={catalogLoading} catalogError={catalogError} existingVariants={plan.rows.map((row) => row.variant)} onClose={() => setAddOpen(false)} onAdd={addRows} /> : null}
    </div>
  );
}

function ModeButton({ active, selectedClass, onClick, children }: { active: boolean; selectedClass: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`min-h-9 rounded-md px-2.5 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:min-h-7 ${active ? selectedClass : "text-slate-500 hover:bg-white hover:text-slate-800"}`}>{children}</button>;
}

function ActionButton({ primary, disabled, title, onClick, icon: Icon, children }: { primary: string; disabled: boolean; title?: string; onClick: () => void; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return <button type="button" disabled={disabled} title={title} onClick={onClick} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-55 sm:min-h-9 ${primary}`}><Icon className="h-4 w-4" />{children}</button>;
}

function Metric({ label, value, detail, tone = "slate" }: { label: string; value: string; detail: string; tone?: "slate" | "amber" | "rose" }) {
  const toneClass = tone === "amber" ? "border-amber-200 bg-amber-50" : tone === "rose" ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white";
  return <div className={`rounded-xl border p-4 ${toneClass}`}><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{value}</div><div className={`mt-1 text-[11px] ${tone === "rose" ? "text-rose-700" : "text-slate-500"}`}>{detail}</div></div>;
}

function SalesPlanBasisPanel({
  open,
  onToggle,
  plan,
  basisByRowId,
  loading,
  error,
  onReload,
}: {
  open: boolean;
  onToggle: () => void;
  plan: SalesPlanDocument;
  basisByRowId: Record<string, SalesPlanSuggestionBasis | undefined>;
  loading: boolean;
  error: string | null;
  onReload: () => void;
}) {
  const rows = plan.rows.map((row) => ({ row, basis: basisByRowId[row.id] }));
  const known = rows.filter((item) => item.basis).length;
  const ordersWeek = rows.reduce((sum, item) => sum + Number(item.basis?.ordersWeek ?? 0), 0);
  const ordersMonth = rows.reduce((sum, item) => sum + Number(item.basis?.ordersMonth ?? 0), 0);
  const stock = rows.reduce((sum, item) => sum + Number(item.basis?.stock ?? item.row.stock ?? 0), 0);
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span>
          <span className="block text-sm font-bold text-slate-900">Основание плана</span>
          <span className="mt-0.5 block text-xs text-slate-500">Заказы RNP за 7 дней × сезонность MPSTATS по предмету. Рыночные пики ограничиваются; коэффициент спроса пока 1,0</span>
        </span>
        <span className="flex items-center gap-2 text-[11px] text-slate-500">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : null}
          {known}/{plan.rows.length} SKU
          <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
        </span>
      </button>
      {open ? (
        <div className="border-t border-slate-100 p-3">
          {error ? <ActionableError message={error} label="Основание плана" onRetry={onReload} compact tone="amber" className="mb-3" /> : null}
          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            <MiniMetric label="Факт 7 дней" value={`${number(ordersWeek)} шт.`} detail={`${number(ordersWeek / 7)} шт./день`} />
            <MiniMetric label="Факт 30 дней" value={`${number(ordersMonth)} шт.`} detail="по RNP-агрегату" />
            <MiniMetric label="Остаток сейчас" value={`${number(stock)} шт.`} detail="по товарным строкам" />
          </div>
          <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-[11px]">
              <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                <tr><th className="px-3 py-2 text-left">SKU</th><th className="px-3 py-2 text-right">30д</th><th className="px-3 py-2 text-right">7д/день</th><th className="px-3 py-2 text-left">Сезонность</th><th className="px-3 py-2 text-right">Остаток</th><th className="px-3 py-2 text-right">Предложение</th></tr>
              </thead>
              <tbody>
                {rows.map(({ row, basis }) => {
                  const suggested = calculateSalesPlanSuggestedDailyOrders(basis);
                  const rawFactor = Number(basis?.seasonalityRawFactor ?? basis?.seasonalityFactor ?? 1);
                  const appliedFactor = Number(basis?.seasonalityFactor ?? 1);
                  return (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-3 py-2"><span className="block font-semibold text-slate-800">{row.variant}</span><span className="block text-[10px] text-slate-400">{row.color}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums">{basis ? `${number(basis.ordersMonth)} / ${money(basis.revenueMonth)}` : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{basis ? `${number(basis.ordersWeek)} / ${number(basis.ordersWeek / 7)}` : "—"}</td>
                      <td className="px-3 py-2"><span className="block font-medium text-slate-700">{basis?.seasonalitySubject || "—"}</span><span className="block text-[10px] tabular-nums text-slate-400">{basis ? rawFactor > appliedFactor + 0.01 ? `рынок ${rawFactor.toLocaleString("ru-RU")}× → план ${appliedFactor.toLocaleString("ru-RU")}×` : `${appliedFactor.toLocaleString("ru-RU")}×` : "—"}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums">{number(basis?.stock ?? row.stock)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-violet-700">{suggested ? `${number(suggested)} шт./день` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function MiniMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 text-base font-bold tabular-nums text-slate-900">{value}</div><div className="text-[10px] text-slate-500">{detail}</div></div>;
}

const confidenceLabels: Record<SalesPlanSuggestion["rows"][number]["confidence"], string> = {
  high: "высокая",
  medium: "средняя",
  low: "низкая",
  unavailable: "нет базы",
};

function SalesPlanSuggestionModal({
  suggestion,
  onClose,
  onApplyEmpty,
  onReplaceAll,
}: {
  suggestion: SalesPlanSuggestion;
  onClose: () => void;
  onApplyEmpty: () => void;
  onReplaceAll: () => void;
}) {
  const changedRows = suggestion.rows.filter((row) => row.changedCells > 0);
  const previewRows = changedRows.length ? changedRows : suggestion.rows.slice(0, 8);
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="sales-plan-suggestion-title">
      <button type="button" aria-label="Закрыть предложение плана" className="absolute inset-0 bg-slate-950/50" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-4 py-4 sm:px-6">
          <h2 id="sales-plan-suggestion-title" className="text-lg font-bold text-slate-900">Предложить план</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Заказы RNP за 7 дней делятся на 7 и умножаются на сезонность предмета из MPSTATS. Слишком резкие рыночные пики ограничиваются безопасным пределом. Коэффициент спроса пока равен 1,0; по умолчанию заполняются только пустые ячейки.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="grid gap-2 sm:grid-cols-4">
            <MiniMetric label="Текущий план" value={`${number(suggestion.currentOrders)} шт.`} detail="выбранный месяц" />
            <MiniMetric label="Предложение" value={`${number(suggestion.proposedOrders)} шт.`} detail={`${suggestion.deltaOrders >= 0 ? "+" : ""}${number(suggestion.deltaOrders)} шт.`} />
            <MiniMetric label="Изменится ячеек" value={number(suggestion.changedCells)} detail="ручные заполненные не трогаем" />
            <MiniMetric label="SKU в расчёте" value={number(suggestion.rows.length)} detail={`${changedRows.length} с изменениями`} />
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <table className="min-w-full text-[11px]">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                <tr><th className="px-3 py-2 text-left">SKU</th><th className="px-3 py-2 text-right">База 7д</th><th className="px-3 py-2 text-left">MPSTATS</th><th className="px-3 py-2 text-right">План</th><th className="px-3 py-2 text-left">Сигналы</th></tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr key={row.rowId} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-semibold text-slate-800">{row.variant}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{number(row.avgDaily7)} шт./день</td>
                    <td className="px-3 py-2"><span className="block font-medium text-slate-700">{row.seasonalitySubject || "Предмет не определён"}</span><span className="block text-[10px] tabular-nums text-slate-400">{row.seasonalityRawFactor > row.seasonalityFactor + 0.01 ? `рынок ${row.seasonalityRawFactor.toLocaleString("ru-RU")}× → применено ${row.seasonalityFactor.toLocaleString("ru-RU")}×` : `применено ${row.seasonalityFactor.toLocaleString("ru-RU")}×`} · спрос {row.demandFactor.toLocaleString("ru-RU")}×</span></td>
                    <td className="px-3 py-2 text-right tabular-nums"><span className="font-semibold">{number(row.currentOrders)} → {number(row.proposedOrders)}</span><span className="block text-[10px] text-slate-400">{number(row.dailyOrders)} шт./день</span></td>
                    <td className="px-3 py-2"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{confidenceLabels[row.confidence]}</span>{row.warnings.length ? <span className="ml-1 text-amber-700">{row.warnings.join(" · ")}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {suggestion.changedCells === 0 ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Нет пустых ячеек для безопасного заполнения. Можно заменить все значения отдельным подтверждением.</p> : null}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100">Отмена</button>
          <button type="button" onClick={onReplaceAll} className="min-h-11 rounded-lg border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50">Заменить все</button>
          <button type="button" onClick={onApplyEmpty} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700"><Wand2 className="h-4 w-4" /> Заполнить пустые</button>
        </div>
      </div>
    </div>
  );
}

function ValidationSummary({ issues }: { issues: SalesPlanValidationIssue[] }) {
  return <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"><div className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" />Нужно исправить: {issues.length}</div><ul className="mt-2 grid gap-1 text-xs text-amber-800 sm:grid-cols-2">{issues.slice(0, 8).map((issue, index) => <li key={`${issue.field}-${issue.rowId}-${index}`}>• {issue.message}</li>)}</ul>{issues.length > 8 ? <p className="mt-1 text-xs text-amber-700">И ещё {issues.length - 8}</p> : null}</div>;
}

const eventLabels: Record<SalesPlanEvent["type"], string> = {
  created: "Создан",
  saved: "Сохранён",
  submitted: "Отправлен",
  resubmitted: "Повторно отправлен",
  returned: "Возвращён",
  approved: "Утверждён",
  new_version: "Новая версия",
};

function SalesPlanHistory({ events, activeMonth, year }: { events: SalesPlanEvent[]; activeMonth: string; year: number }) {
  const scoped = events
    .filter((event) => !event.monthKey || event.monthKey === activeMonth)
    .slice(-8)
    .reverse();
  if (scoped.length === 0) return null;
  return (
    <details className="group rounded-xl border border-slate-200 bg-white" aria-label="История плана">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-900">История месяца</h2>
          <p className="mt-0.5 text-xs text-slate-500">{salesPlanMonthLabel(year, activeMonth, false)} · последние события, сохранённые сервером</p>
        </div>
        <span className="flex items-center gap-2 text-[10px] font-bold text-slate-500"><span className="rounded-full bg-slate-100 px-2 py-1">{scoped.length} событий</span><ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" /></span>
      </summary>
      <ol className="grid gap-2 border-t border-slate-100 p-3 md:grid-cols-2 xl:grid-cols-4">
        {scoped.map((event) => (
          <li key={event.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800">{eventLabels[event.type]}</span>
              <span className="text-[10px] font-semibold text-slate-400">v{event.version} · r{event.revision}</span>
            </div>
            <div className="mt-1 truncate text-[11px] text-slate-500">{event.actor} · {event.role}</div>
            <time className="mt-1 block text-[10px] text-slate-400" dateTime={event.at}>{new Date(event.at).toLocaleString("ru-RU")}</time>
            {event.comment ? <p className="mt-1 line-clamp-2 text-[11px] text-amber-800">{event.comment}</p> : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

function EmptyPlan({ mode, marketplace, workingStatus, onCreate, onOpenEdit }: { mode: ViewMode; marketplace: SalesPlanMarketplace; workingStatus: SalesPlanStatus | null; onCreate: () => void; onOpenEdit: () => void }) {
  const hasWorkingPlan = workingStatus !== null;
  const title = mode === "approved"
    ? workingStatus === "review" ? "План на согласовании" : hasWorkingPlan ? "Версия ещё не утверждена" : "План не создан"
    : "План не создан";
  const description = mode === "approved" && hasWorkingPlan
    ? workingStatus === "review"
      ? "После утверждения руководителем зафиксированная версия появится здесь и станет доступна в план‑факте."
      : "Черновик уже создан. Проверьте значения и отправьте выбранный месяц на согласование."
    : `Создайте отдельный план для текущего кабинета ${marketplace === "wb" ? "Wildberries" : "Ozon"} и добавьте цветовые вариации из каталога.`;
  return <div className="grid min-h-[360px] place-items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 text-center"><div className="max-w-md"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-500"><CalendarRange className="h-6 w-6" /></div><h2 className="mt-4 text-lg font-bold text-slate-900">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>{mode === "edit" ? <button type="button" onClick={onCreate} className={`mt-5 min-h-11 rounded-lg px-5 text-sm font-semibold text-white ${marketplace === "wb" ? "bg-violet-600 hover:bg-violet-700" : "bg-sky-600 hover:bg-sky-700"}`}>Создать план</button> : <button type="button" onClick={onOpenEdit} className={`mt-5 min-h-11 rounded-lg px-5 text-sm font-semibold text-white ${marketplace === "wb" ? "bg-violet-600 hover:bg-violet-700" : "bg-sky-600 hover:bg-sky-700"}`}>{workingStatus === "review" ? "Открыть отправленный план" : hasWorkingPlan ? "Открыть черновик" : "Перейти к созданию"}</button>}</div></div>;
}

function CabinetRequired({ marketplace }: { marketplace: SalesPlanMarketplace }) {
  return <div className="grid min-h-[calc(100vh-54px)] place-items-center bg-[#f6f7f9] p-6"><div className="max-w-md rounded-2xl border border-amber-200 bg-white p-7 text-center shadow-sm"><LockKeyhole className="mx-auto h-8 w-8 text-amber-500" /><h1 className="mt-4 text-lg font-bold text-slate-900">Выберите один кабинет {marketplace === "wb" ? "WB" : "Ozon"}</h1><p className="mt-2 text-sm leading-6 text-slate-500">Общий план «Все кабинеты» и план группы нельзя редактировать или утверждать. Выберите конкретное юридическое лицо в переключателе сверху.</p></div></div>;
}

function PageLoading({ marketplace }: { marketplace: SalesPlanMarketplace }) { return <div className="flex min-h-[calc(100vh-54px)] items-center justify-center gap-2 bg-[#f6f7f9] text-sm text-slate-500"><Loader2 className={`h-5 w-5 animate-spin motion-reduce:animate-none ${marketplace === "wb" ? "text-violet-600" : "text-sky-600"}`} /> Загружаем кабинеты…</div>; }
function PageError({ message, onRetry }: { message: string; onRetry: () => void }) { return <ActionableError message={message} label="План продаж" onRetry={onRetry} className="mx-3 my-4 sm:mx-6" />; }
