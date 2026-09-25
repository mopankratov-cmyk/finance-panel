"use client";

import { BarChart3, Building2, Download, FileSpreadsheet, Landmark, LayoutDashboard, ListChecks, Loader2, Plus, RefreshCw, Save, WalletCards } from "lucide-react";
import { BankStatementModal } from "./BankStatementModal";
import { ImportDdsModal } from "./ImportDdsModal";
import { OpiuPeriodAllocationModal } from "./OpiuPeriodAllocationModal";
import { PaymentChainModal, type PaymentChainSeed } from "./PaymentChainModal";
import { TransferBalancePanel } from "./TransferBalancePanel";
import { BankTransfersPanel } from "./BankTransfersPanel";
import { PaymentOperationsTable } from "./PaymentOperationsTable";
import { PaymentChainList } from "./PaymentChainList";
import { chainMetadata } from "@/lib/finance/paymentChains";
import { loadFinanceState } from "@/lib/db";
import { BankReviewPanel } from "./BankReviewPanel";
import { loadBankGoogleSyncData } from "./bankReviewStore";
import { BankReconciliationPanel } from "./BankReconciliationPanel";
import { DdsOverview } from "./DdsOverview";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { DdsReport, type DdsReportDrilldown } from "./DdsReport";
import {
  loadDdsCompanies,
  loadPaymentCompanyLinks,
  companyScopeOptions,
  UNASSIGNED_COMPANY_LABEL,
  createDdsCompany,
  savePaymentWithCompany,
  updateDdsCompany,
  type DdsCompany,
} from "./ddsCompanies";
import { ddsReviewTemplateRows, ddsTemplateRows, downloadDdsCsv, downloadGroupedDdsXlsx } from "./ddsExport";
import { syncDdsToGoogleSheets } from "./ddsGoogleSync";
import { ddsSheetNameForCompany } from "./ddsSheetGroups";
import { PaymentForm, type PaymentLoanLink } from "./PaymentForm";
import { TabPanel, useKeepAliveTabs } from "@/components/ui/KeepAliveTabs";
import { useFinance, useDdsCategories } from "@/components/providers/FinanceProvider";
import { ExpenseCategoryManager } from "./ExpenseCategoryManager";
import { Card, CardContent } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import {
  COMPANY_TAX_SYSTEMS,
  COMPANY_VAT_MODES,
  companyTaxSystemSupportsRate,
  companyTaxTotalRate,
  formatCompanyTaxRate,
  parseCompanyTaxRate,
  type CompanyTaxSystem,
  type CompanyVatMode,
} from "@/lib/finance/companyTax";
import { COMPANY_TAX_RATE_UNAVAILABLE, COMPANY_TAX_UNAVAILABLE } from "@/lib/finance/companySchema";
import { ddsEditableAccounts, isDdsActualPayment, manualDdsCashAccounts } from "@/lib/finance/bankDdsPayment";
import { formatMoney, generateId } from "@/lib/format";
import type { Payment } from "@/lib/types";
import { paymentIdFromSearch, shouldOpenCompanySettings } from "./paymentDeepLink";
import { closeLoanScheduleRows, loadLoanScheduleRows } from "@/components/loans/scheduleStore";
import type { ScheduleRowRecord } from "@/lib/loans/scheduleRows";

const WITHOUT_CATEGORY_FILTER = "__without_category__";

export function PaymentsPage() {
  const { categories: DDS_CATEGORIES, customCategoryNames } = useDdsCategories();
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const { state, dispatch } = useFinance();
  const [chainVersion, setChainVersion] = useState(0);
  const [chainSeed, setChainSeed] = useState<PaymentChainSeed | null>(null);
  const closeChain = useCallback(()=>setChainSeed(null),[]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Payment | null>(null);
  const [mode, setMode] = useState<"overview" | "ledger" | "dds" | "review" | "reconciliation" | "chains">("overview");
  const panel = useKeepAliveTabs<"overview" | "ledger" | "dds" | "review" | "reconciliation" | "chains">(mode);
  const [bankImportOpen, setBankImportOpen] = useState(false);
  const [historyImportOpen, setHistoryImportOpen] = useState(false);
  const [opiuAllocationPayment, setOpiuAllocationPayment] = useState<Payment | null>(null);
  const [companiesOpen, setCompaniesOpen] = useState(false);
  const [syncingGoogle, setSyncingGoogle] = useState(false);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterAccount, setFilterAccount] = useState("");
  const [filterCompany, setFilterCompany] = useState("");
  const [companies, setCompanies] = useState<DdsCompany[]>([]);
  const [companyByPayment, setCompanyByPayment] = useState<Map<string, string | null>>(new Map());
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [highlightedPaymentId, setHighlightedPaymentId] = useState<string | null>(null);
  const [loanScheduleRows, setLoanScheduleRows] = useState<ScheduleRowRecord[]>([]);
  const [loanScheduleLoading, setLoanScheduleLoading] = useState(false);
  const [loanScheduleError, setLoanScheduleError] = useState("");

  useEffect(() => {
    if (shouldOpenCompanySettings(window.location.search)) setCompaniesOpen(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadDdsCompanies(), loadPaymentCompanyLinks()])
      .then(([loadedCompanies, links]) => {
        if (cancelled) return;
        setCompanies(loadedCompanies);
        setCompanyByPayment(new Map(links.map((link) => [link.paymentId, link.companyId])));
        setCompanyError(null);
      })
      .catch((error) => {
        if (!cancelled) setCompanyError(error instanceof Error ? error.message : "Не удалось загрузить компании");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const companyNameById = useMemo(
    () => new Map(companies.map((company) => [company.id, company.name] as const)),
    [companies],
  );
  const companyById = useMemo(
    () => new Map(companies.map((company) => [company.id, company] as const)),
    [companies],
  );
  const accountNameById = useMemo(
    () => new Map(state.accounts.map((account) => [account.id, account.name] as const)),
    [state.accounts],
  );
  const companyScope = useMemo(() => companyScopeOptions(companies), [companies]);

  const paymentsWithCompany = useMemo(
    () =>
      state.payments.map((payment) => ({
        ...payment,
        companyId: payment.companyId ?? companyByPayment.get(payment.id) ?? null,
      })),
    [state.payments, companyByPayment],
  );

  // ДДС — подтверждённый банковский факт, созданные из него части и ручные
  // операции наличными. Остальные ручные/старые строки без источника сюда не
  // попадают: по ним невозможно отличить факт от технической строки календаря.
  // Календарь и графики займов используют ту же таблицу payments, поэтому
  // фильтра по status=done недостаточно: завершённые строки плана попадали в
  // реестр и приносили сюда технические кошельки вроде PANKSTER GROUP.
  const ddsPayments = useMemo(
    () => paymentsWithCompany.filter(isDdsActualPayment),
    [paymentsWithCompany],
  );

  useEffect(() => {
    const paymentId = paymentIdFromSearch(window.location.search);
    if (!paymentId) return;
    const payment = ddsPayments.find((item) => item.id === paymentId);
    if (!payment) return;
    setMode("ledger");
    setDateFrom(payment.date);
    setDateTo(payment.date);
    setFilterCategory("");
    setFilterAccount("");
    setFilterCompany("");
    setHighlightedPaymentId(paymentId);
    const timer = window.setTimeout(() => document.getElementById(`payment-${paymentId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
    return () => window.clearTimeout(timer);
  }, [ddsPayments]);
  const ddsAccountIds = useMemo(() => new Set(ddsPayments.map((payment) => payment.accountId)), [ddsPayments]);
  const ddsAccounts = useMemo(() => state.accounts.filter((account) => ddsAccountIds.has(account.id)), [state.accounts, ddsAccountIds]);
  const manualCashAccounts = useMemo(
    () => manualDdsCashAccounts(state.accounts, state.payments),
    [state.accounts, state.payments],
  );
  const editableDdsAccounts = useMemo(
    () => ddsEditableAccounts(state.accounts, state.payments),
    [state.accounts, state.payments],
  );

  const filtered = useMemo(() => {
    return ddsPayments
      .filter((p) => {
        if (dateFrom && p.date < dateFrom) return false;
        if (dateTo && p.date > dateTo) return false;
        if (filterCategory === WITHOUT_CATEGORY_FILTER && p.category.trim()) return false;
        if (filterCategory && filterCategory !== WITHOUT_CATEGORY_FILTER && p.category.trim() !== filterCategory) return false;
        if (filterAccount && p.accountId !== filterAccount) return false;
        if (filterCompany === "unassigned" && p.companyId !== null && !companyScope.unassignedCompanyIds.includes(p.companyId)) return false;
        if (filterCompany.startsWith("group:") && (!p.companyId || companyById.get(p.companyId)?.groupName !== filterCompany.slice(6))) return false;
        if (filterCompany && filterCompany !== "unassigned" && !filterCompany.startsWith("group:") && p.companyId !== filterCompany) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [ddsPayments, dateFrom, dateTo, filterCategory, filterAccount, filterCompany, companyById, companyScope]);

  const activeFilters = [dateFrom, dateTo, filterCategory, filterAccount, filterCompany].filter(Boolean).length;
  const resetFilters = () => {
    setDateFrom("");
    setDateTo("");
    setFilterCategory("");
    setFilterAccount("");
    setFilterCompany("");
  };

  // В фильтре должны быть и статьи вне справочника (старые выгрузки) — иначе их не отобрать.
  const filterCategories = useMemo(() => {
    const known = new Set(DDS_CATEGORIES);
    const extra = [...new Set(ddsPayments.map((payment) => payment.category.trim()).filter((category) => category && !known.has(category)))]
      .sort((a, b) => a.localeCompare(b, "ru"));
    return [...DDS_CATEGORIES, ...extra];
  }, [ddsPayments, DDS_CATEGORIES]);

  const openDdsPayments = useCallback(({ category, from, to, scope }: DdsReportDrilldown) => {
    setDateFrom(from);
    setDateTo(to);
    setFilterCategory(category === "Без статьи" ? WITHOUT_CATEGORY_FILTER : category);
    setFilterAccount("");
    setFilterCompany(scope === "all" ? "" : scope);
    setMode("ledger");
  }, []);

  const openAdd = () => {
    if (!manualCashAccounts.length) {
      alert("Нет доступного наличного кошелька. Создайте наличный счёт в разделе «Счета».");
      return;
    }
    setEditing(null);
    setLoanScheduleRows([]);
    setLoanScheduleError("");
    setLoanScheduleLoading(true);
    void loadLoanScheduleRows()
      .then((result) => setLoanScheduleRows(result.rows))
      .catch((error) => setLoanScheduleError(error instanceof Error ? error.message : "Не удалось загрузить графики"))
      .finally(() => setLoanScheduleLoading(false));
    setModalOpen(true);
  };

  const openEdit = (payment: Payment) => {
    if(chainMetadata(payment.comment)){setChainSeed({paymentId:payment.id});return;}
    setEditing(payment);
    setModalOpen(true);
  };

  const handleSubmit = async (data: Omit<Payment, "id">, companyId: string, loanLink?: PaymentLoanLink) => {
    const id = editing?.id ?? generateId("pay");
    const payment = {
      id,
      ...data,
      importSource: editing?.importSource ?? `manual-dds:${id}`,
    };
    try {
      await savePaymentWithCompany(payment, companyId);
      if (loanLink) {
        try {
          if (loanLink.rowIds.length) {
            await closeLoanScheduleRows(loanLink.rowIds, id, loanLink.confirmed);
          } else {
            const legacyRows = state.payments.filter((item) => loanLink.legacyPaymentIds.includes(item.id) && item.status === "planned");
            if (legacyRows.length !== loanLink.legacyPaymentIds.length) throw new Error("Строка графика уже закрыта или не найдена");
            await Promise.all(legacyRows.map((planned) => savePaymentWithCompany({
              ...planned,
              status: "cancelled",
              comment: `${planned.comment ?? ""} [paid-by:${id}]`.trim(),
            }, companyByPayment.get(planned.id) ?? planned.companyId ?? companyId)));
          }
        } catch (error) {
          alert(`Операция наличными сохранена, но график кредита не обновлён: ${error instanceof Error ? error.message : "неизвестная ошибка"}. Её можно привязать на экране кредита.`);
          window.location.reload();
          return;
        }
      }
      setModalOpen(false);
      setEditing(null);
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось сохранить платёж");
    }
  };

  const handleDelete = async (id: string) => {
    const payment=state.payments.find(p=>p.id===id);
    if(payment && chainMetadata(payment.comment)){setChainSeed({paymentId:id});return;}
    if (!confirm("Удалить этот платёж? Если он закрывает кредит, календарный план или зарплату, обязательство снова станет неоплаченным.")) return;
    try {
      const response = await fetch(`/api/finance/payments/${encodeURIComponent(id)}`, { method: "DELETE" });
      const result = await response.json().catch(() => null) as { error?: string; deleted?: boolean; reopenedLoanRows?: number; reopenedCalendarPlans?: number } | null;
      if (!response.ok || !result?.deleted) throw new Error(result?.error ?? "Не удалось удалить платёж");
      dispatch({ type: "LOAD", payload: await loadFinanceState() });
      setCompanyByPayment((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      const reopened = Number(result.reopenedLoanRows ?? 0) + Number(result.reopenedCalendarPlans ?? 0);
      alert(reopened > 0 ? `Платёж удалён. Связанные обязательства возвращены в план: ${reopened}.` : "Платёж удалён.");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось удалить платёж");
    }
  };

  const handleGoogleSync = async () => {
    setSyncingGoogle(true);
    try {
      const bankSync = await loadBankGoogleSyncData();
      const companyById = new Map(companies.map((company) => [company.id, company] as const));
      const sheetNames = new Set<string>();
      for (const payment of ddsPayments) {
        sheetNames.add(ddsSheetNameForCompany(payment.companyId ? companyById.get(payment.companyId) : null));
      }
      for (const item of bankSync.items) sheetNames.add(ddsSheetNameForCompany(item.companyId ? companyById.get(item.companyId) : null));
      const sheets = [...sheetNames].sort((a, b) => a.localeCompare(b, "ru")).map((name) => {
        const facts = ddsPayments
          .filter((payment) => ddsSheetNameForCompany(payment.companyId ? companyById.get(payment.companyId) : null) === name)
          .sort((a, b) => a.date.localeCompare(b.date));
        const reviewItems = bankSync.items.filter((item) => ddsSheetNameForCompany(item.companyId ? companyById.get(item.companyId) : null) === name);
        const confirmed = ddsTemplateRows({ payments: facts, accountNameById, companyNameById, customExpenseNames: customCategoryNames });
        const review = ddsReviewTemplateRows(reviewItems, accountNameById, companyNameById);
        return {
          name,
          rows: [confirmed[0], ...confirmed.slice(1), ...review.rows],
          rowIds: [...facts.map((payment) => bankSync.sourceByPaymentId.get(payment.id) ?? payment.id), ...review.rowIds],
        };
      });
      const result = await syncDdsToGoogleSheets(sheets);
      alert(`Google Таблица обновлена. Строк: ${result.rows}. Листы: ${result.sheets.join(", ")}.`);
      if (result.spreadsheetUrl && confirm("Открыть Google Таблицу?")) window.open(result.spreadsheetUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось обновить Google Таблицу");
    } finally {
      setSyncingGoogle(false);
    }
  };

  // уникальные контрагенты — для подсказок в форме
  const counterparties = useMemo(
    () =>
      Array.from(new Set(ddsPayments.map((p) => p.counterparty).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "ru"),
      ),
    [ddsPayments],
  );

  // Если данные изменились в другой вкладке или административной операцией,
  // при возвращении не держим старый снимок до ручного F5.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void loadFinanceState().then((payload) => dispatch({ type: "LOAD", payload })).catch(() => undefined);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [dispatch]);


  return (
    <div className="space-y-5">
      <ExpenseCategoryManager open={categoriesOpen} onClose={() => setCategoriesOpen(false)} />
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-5">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white">
              <WalletCards className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-950">Движение денег</h1>
              <p className="text-sm text-slate-500">Факт, проверка, компании и банковская сверка</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setCompaniesOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Building2 className="h-4 w-4" />
            Компании
          </button>
          <button type="button" onClick={() => setCategoriesOpen(true)} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-violet-300"><ListChecks className="h-4 w-4" />Статьи расходов</button>
          <button
            onClick={() => setHistoryImportOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-violet-300 px-3 text-sm font-semibold text-violet-700 hover:bg-violet-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Импорт истории ДДС
          </button>
          <button
            onClick={() => setBankImportOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Выписка банка
          </button>
        </div>
        </div>
        <div className="overflow-x-auto border-t border-slate-100 px-2">
          <div className="flex min-w-max gap-1">
            {([
              ["overview", "Обзор", LayoutDashboard],
              ["ledger", "Платежи", ListChecks],
              ["chains", "Разбитые операции", ListChecks],
              ["dds", "Отчёт ДДС", BarChart3],
              ["review", "На проверке", FileSpreadsheet],
              ["reconciliation", "Сверка банка", Landmark],
            ] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={`inline-flex min-h-12 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors ${
                  mode === value
                    ? "border-violet-600 text-violet-700"
                    : "border-transparent text-slate-500 hover:text-slate-900"
                }`}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => downloadDdsCsv({ payments: ddsPayments, accountNameById, companyNameById, customExpenseNames: customCategoryNames })}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            <Download className="h-4 w-4" /> CSV
          </button>
          <button
            onClick={() => {
              const companyById = new Map(companies.map((company) => [company.id, company] as const));
              const names = new Set(ddsPayments.map((payment) => ddsSheetNameForCompany(payment.companyId ? companyById.get(payment.companyId) : null)));
              downloadGroupedDdsXlsx([...names].sort((a, b) => a.localeCompare(b, "ru")).map((name) => ({
                name,
                rows: ddsTemplateRows({
                  payments: ddsPayments.filter((payment) => ddsSheetNameForCompany(payment.companyId ? companyById.get(payment.companyId) : null) === name),
                  accountNameById,
                  companyNameById,
                  customExpenseNames: customCategoryNames,
                }),
              })));
            }}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            <Download className="h-4 w-4" /> Excel
          </button>
          <button
            onClick={handleGoogleSync}
            disabled={syncingGoogle}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncingGoogle ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Google Таблица
          </button>
          {mode === "ledger" && (
            <button
              onClick={openAdd}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700"
            >
              <Plus className="h-4 w-4" />
              Операция наличными
            </button>
          )}
      </div>

      {companyError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {companyError}
        </div>
      )}

      {mode === "overview" && (
        <DdsOverview
          payments={ddsPayments}
          accounts={ddsAccounts}
          companies={companies}
          onOpenLedger={() => setMode("ledger")}
          onOpenReview={() => setMode("review")}
          onOpenReconciliation={() => setMode("reconciliation")}
        />
      )}
      {/* Режимы не размонтируем: «Разбор» на каждом заходе перечитывал очередь
          и терял отметки выбранных операций вместе с недописанным текстом
          менеджеру. Ключ сброса не нужен — источник данных здесь один на весь
          экран. */}
      <TabPanel {...panel("dds")}>
        <DdsReport payments={ddsPayments} companies={companies} onOpenPayments={openDdsPayments} />
      </TabPanel>
      <TabPanel {...panel("review")}>
        <BankReviewPanel accounts={state.accounts} companies={companies} paymentCompanies={companyByPayment} />
      </TabPanel>
      <TabPanel {...panel("reconciliation")}>
        <BankReconciliationPanel accounts={state.accounts} payments={ddsPayments} onImportStatement={() => setBankImportOpen(true)} onOpenReview={() => setMode("review")} />
      </TabPanel>

      {mode === "chains" && <PaymentChainList onOpen={setChainSeed} version={chainVersion}/>}
      {mode === "ledger" && (
        <>
      <Card>
        <CardContent className="pt-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="block text-xs text-slate-500 mb-1">С даты</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">По дату</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">
                Статья
              </label>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                <option value="">Все</option>
                <option value={WITHOUT_CATEGORY_FILTER}>Без статьи</option>
                {filterCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Кошелёк</label>
              <select
                value={filterAccount}
                onChange={(e) => setFilterAccount(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                <option value="">Все</option>
                {ddsAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Компания</label>
              <select
                value={filterCompany}
                onChange={(e) => setFilterCompany(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                <option value="">Все компании</option>
                <option value="unassigned">{UNASSIGNED_COMPANY_LABEL}</option>
                {companyScope.groups.map((group) => <option key={group.name} value={`group:${group.name}`}>{group.label}</option>)}
                {companyScope.companies.map((company) => (
                  <option key={company.id} value={company.id}>{company.name}</option>
                ))}
              </select>
            </div>
          </div>
          {/* На телефоне пять полей занимают экран целиком, и список платежей
              уезжает за нижний край: без этой строки человек видит пустой
              реестр и не понимает, что его отфильтровали. */}
          {activeFilters > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-sm">
              <span className="text-slate-500">Фильтров включено: <b className="text-slate-800">{activeFilters}</b> · записей в списке: {filtered.length}</span>
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Сбросить фильтры
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* До 1024px реестр читают записями, а не колонками, поэтому строка
          разворачивается в карточку (table-cards-lg). Раньше здесь вместо этого
          прятались три колонки — компания, контрагент и назначение платежа
          были недоступны с телефона и с планшета в портрете вовсе. */}
      <TransferBalancePanel payments={ddsPayments} accounts={ddsAccounts} onEdit={openEdit}/>
      <BankTransfersPanel/>
      <Card>
        <PaymentOperationsTable visible={filtered} all={ddsPayments} accounts={ddsAccounts} companies={companies} highlightedPaymentId={highlightedPaymentId} onEdit={openEdit} onDelete={handleDelete} onOpen={setChainSeed} onAllocateOpiu={setOpiuAllocationPayment}/>
      </Card>
        </>
      )}

      {chainSeed&&<PaymentChainModal seed={chainSeed} accounts={state.accounts} companies={companies} onClose={closeChain} onSaved={async()=>{dispatch({type:"LOAD",payload:await loadFinanceState()});const links=await loadPaymentCompanyLinks();setCompanyByPayment(new Map(links.map(l=>[l.paymentId,l.companyId])));setChainVersion(v=>v+1);}}/>}
      <OpiuPeriodAllocationModal payment={opiuAllocationPayment} onClose={() => setOpiuAllocationPayment(null)} />
      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        title={editing ? "Редактировать платёж" : "Операция наличными"}
      >
        <PaymentForm
          payment={editing ?? undefined}
          accounts={editing ? editableDdsAccounts : manualCashAccounts}
          counterparties={counterparties}
          companies={companies}
          companyId={editing ? companyByPayment.get(editing.id) : null}
          loans={state.loans}
          payments={state.payments}
          paymentCompanies={companyByPayment}
          scheduleRows={loanScheduleRows}
          scheduleLoading={loanScheduleLoading}
          scheduleError={loanScheduleError}
          onSubmit={handleSubmit}
          onCancel={() => {
            setModalOpen(false);
            setEditing(null);
          }}
        />
      </Modal>

      <CompaniesModal
        open={companiesOpen}
        companies={companies}
        onClose={() => setCompaniesOpen(false)}
        onCreated={(company) => setCompanies((current) => [...current, company])}
        onUpdated={(company) => setCompanies((current) => current.map((item) => item.id === company.id ? company : item))}
      />
      <BankStatementModal
        open={bankImportOpen}
        onClose={() => setBankImportOpen(false)}
        accounts={state.accounts}
        companies={companies}
        existingPayments={paymentsWithCompany}
        onQueued={() => setMode("review")}
      />
      <ImportDdsModal
        open={historyImportOpen}
        onClose={() => setHistoryImportOpen(false)}
        existingAccounts={state.accounts}
        existingPayments={paymentsWithCompany}
        companies={companies}
        onCompanyCreated={(company) => setCompanies((current) => [...current, company])}
      />
    </div>
  );
}

function CompaniesModal({ open, companies, onClose, onCreated, onUpdated }: {
  open: boolean;
  companies: DdsCompany[];
  onClose: () => void;
  onCreated: (company: DdsCompany) => void;
  onUpdated: (company: DdsCompany) => void;
}) {
  const [name, setName] = useState("");
  const [groupName, setGroupName] = useState("Основная группа");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !groupName.trim()) return;
    setSaving(true);
    setError("");
    try {
      const company = await createDdsCompany(name.trim(), groupName.trim());
      onCreated(company);
      setName("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось добавить компанию");
    } finally {
      setSaving(false);
    }
  };

  return <Modal open={open} onClose={onClose} title="Компании ДДС" size="xl">
    <div className="space-y-5">
      <p className="text-sm text-slate-600">Добавляйте компании здесь, до загрузки выписки. ИП Митриченко входит в «Основную группу» вместе с РИО, ИП Панкратова и ИП Кучеренко.</p>
      <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(event) => void submit(event)}>
        <label className="text-sm font-semibold text-slate-700">Компания
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, ИП Митриченко" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm" />
        </label>
        <label className="text-sm font-semibold text-slate-700">Группа
          <input value={groupName} onChange={(event) => setGroupName(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm" />
        </label>
        <button type="submit" disabled={saving || !name.trim() || !groupName.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}Добавить
        </button>
      </form>
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {companies.some((company) => company.taxSettingsAvailable === false) && <p role="status" id="company-tax-unavailable" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">{COMPANY_TAX_UNAVAILABLE}</p>}
      {companies.some((company) => company.taxRatesAvailable === false) && <p role="status" id="company-tax-rate-unavailable" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">{COMPANY_TAX_RATE_UNAVAILABLE}</p>}
      {companies.length === 0
        ? <p className="rounded-xl border border-slate-200 px-3 py-8 text-center text-sm text-slate-500">Компаний пока нет</p>
        : <div className="grid gap-3 xl:grid-cols-2">{companies.map((company) => <CompanySettingsRow key={company.id} company={company} onUpdated={onUpdated} />)}</div>}
    </div>
  </Modal>;
}

function CompanySettingsRow({ company, onUpdated }: { company: DdsCompany; onUpdated: (company: DdsCompany) => void }) {
  const [isActive, setIsActive] = useState(company.isActive);
  const [taxSystem, setTaxSystem] = useState<CompanyTaxSystem | null>(company.taxSystem ?? null);
  const [vatMode, setVatMode] = useState<CompanyVatMode | null>(company.vatMode ?? null);
  const [taxRateInput, setTaxRateInput] = useState(formatCompanyTaxRate(company.taxRate));
  const [taxAdditionalRateInput, setTaxAdditionalRateInput] = useState(formatCompanyTaxRate(company.taxAdditionalRate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const supportsRate = companyTaxSystemSupportsRate(taxSystem);
  const parsedTaxRate = supportsRate ? parseCompanyTaxRate(taxRateInput) : null;
  const parsedTaxAdditionalRate = supportsRate ? parseCompanyTaxRate(taxAdditionalRateInput) : null;
  const totalRate = parsedTaxRate === undefined || parsedTaxAdditionalRate === undefined
    ? undefined
    : companyTaxTotalRate(parsedTaxRate, parsedTaxAdditionalRate);
  const invalidRate = parsedTaxRate === undefined || parsedTaxAdditionalRate === undefined ||
    (parsedTaxRate === null && parsedTaxAdditionalRate !== null) || (totalRate ?? 0) > 100;
  const rateDirty = company.taxRatesAvailable !== false && (
    parsedTaxRate === undefined || parsedTaxAdditionalRate === undefined ||
    parsedTaxRate !== (company.taxRate ?? null) || parsedTaxAdditionalRate !== (company.taxAdditionalRate ?? null)
  );
  const dirty = isActive !== company.isActive || taxSystem !== (company.taxSystem ?? null) ||
    vatMode !== (company.vatMode ?? null) || rateDirty;

  const save = async () => {
    setError("");
    if (invalidRate) {
      setError(parsedTaxRate === null && parsedTaxAdditionalRate !== null
        ? "Сначала укажите основную ставку"
        : "Ставки должны быть от 0 до 100%, содержать не более трёх знаков после запятой, а их сумма не должна превышать 100%");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateDdsCompany({
        ...company,
        isActive,
        taxSystem,
        vatMode,
        taxRate: parsedTaxRate,
        taxAdditionalRate: parsedTaxAdditionalRate,
      });
      onUpdated(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки компании");
    } finally {
      setSaving(false);
    }
  };

  const controlClass = "min-h-11 w-full min-w-[150px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100";

  return <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex flex-col gap-1 border-b border-slate-100 pb-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h3 className="font-semibold text-slate-900">{company.name}</h3>
        <p className="mt-0.5 text-sm text-slate-500">{company.groupName}</p>
      </div>
      {error && <p role="alert" className="max-w-sm text-xs font-normal leading-5 text-rose-700">{error}</p>}
    </div>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-semibold text-slate-600">Статус
        <select aria-label={`Статус компании ${company.name}`} value={isActive ? "active" : "inactive"} onChange={(event) => setIsActive(event.target.value === "active")} className={`${controlClass} mt-1`}><option value="active">Активна</option><option value="inactive">Отключена</option></select>
      </label>
      <label className="text-xs font-semibold text-slate-600">Налогообложение
        <select disabled={saving || company.taxSettingsAvailable === false} aria-describedby={company.taxSettingsAvailable === false ? "company-tax-unavailable" : undefined} aria-label={`Система налогообложения компании ${company.name}`} value={taxSystem ?? ""} onChange={(event) => setTaxSystem((event.target.value || null) as CompanyTaxSystem | null)} className={`${controlClass} mt-1 disabled:cursor-not-allowed disabled:bg-slate-100`}><option value="">{company.taxSettingsAvailable === false ? "Недоступно до обновления базы" : "Не указано"}</option>{COMPANY_TAX_SYSTEMS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      </label>
      <label className="text-xs font-semibold text-slate-600">НДС
        <select disabled={saving || company.taxSettingsAvailable === false} aria-describedby={company.taxSettingsAvailable === false ? "company-tax-unavailable" : undefined} aria-label={`НДС компании ${company.name}`} value={vatMode ?? ""} onChange={(event) => setVatMode((event.target.value || null) as CompanyVatMode | null)} className={`${controlClass} mt-1 disabled:cursor-not-allowed disabled:bg-slate-100`}><option value="">{company.taxSettingsAvailable === false ? "Недоступно до обновления базы" : "Не указано"}</option>{COMPANY_VAT_MODES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      </label>
      <div className="sm:col-span-2">
      {supportsRate ? <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-600">Основная, %
          <input type="text" inputMode="decimal" value={taxRateInput} onChange={(event) => setTaxRateInput(event.target.value)} disabled={saving || company.taxRatesAvailable === false} aria-invalid={invalidRate || undefined} aria-describedby={company.taxRatesAvailable === false ? "company-tax-rate-unavailable" : undefined} className={`${controlClass} mt-1 min-w-0 tabular-nums disabled:cursor-not-allowed disabled:bg-slate-100`} placeholder="Например, 1" />
        </label>
        <label className="text-xs font-medium text-slate-600">Доплата, %
          <input type="text" inputMode="decimal" value={taxAdditionalRateInput} onChange={(event) => setTaxAdditionalRateInput(event.target.value)} disabled={saving || company.taxRatesAvailable === false} aria-invalid={invalidRate || undefined} aria-describedby={company.taxRatesAvailable === false ? "company-tax-rate-unavailable" : undefined} className={`${controlClass} mt-1 min-w-0 tabular-nums disabled:cursor-not-allowed disabled:bg-slate-100`} placeholder="Например, 1" />
        </label>
        <p className={`text-xs font-semibold sm:col-span-2 ${invalidRate ? "text-rose-700" : "text-slate-600"}`} aria-live="polite">
          {invalidRate ? "Проверьте ставки" : totalRate === null ? "Итоговая ставка не указана" : `Итого: ${formatCompanyTaxRate(totalRate)}%`}
        </p>
      </div> : <span className="text-sm text-slate-400">Для этого режима единая ставка не задаётся</span>}
      </div>
    </div>
    <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
      <button type="button" onClick={() => void save()} disabled={saving || !dirty} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto">{saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Save className="h-4 w-4" />}Сохранить</button>
    </div>
  </article>;
}
