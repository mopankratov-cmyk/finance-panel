"use client";

import { ArrowDownLeft, ArrowLeft, ArrowUpRight, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CircleDollarSign, Clock3, CloudUpload, FileSpreadsheet, FileUp, LayoutGrid, List, Loader2, Plus, TrendingUp, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BulkPaymentModal } from "./BulkPaymentModal";
import { CalendarAgenda } from "./CalendarAgenda";
import { CalendarDayCell } from "./CalendarDayCell";
import { CashFlowSparkline } from "./CashFlowSparkline";
import { calendarPaymentsWithoutMatchedPlans, isCalendarCashFlow, isMarketplaceOrLoanIncome, matchPlannedToFacts } from "./calendarPlan";
import { DayDetailPanel } from "./DayDetailPanel";
import { SalesForecastPanel } from "./SalesForecastPanel";
import { FinancialAlertsPanel } from "./FinancialAlertsPanel";
import { FinanceTasksPanel } from "./FinanceTasksPanel";
import { calendarExportRows, calendarTemplateSheets, downloadCalendarXlsx } from "./calendarExport";
import { ReplaceCalendarModal } from "./ReplaceCalendarModal";
import { WeekSummaryCell } from "./WeekSummaryCell";
import { cleanPaymentComment, getPaymentPriority, PRIORITY_META, priorityRank, type PaymentPriority, type PaymentPriorityScope } from "./paymentPriority";
import { useFinance } from "@/components/providers/FinanceProvider";
import { loadDdsCompanies, loadPaymentCompanyLinks, savePaymentWithCompany, updatePaymentCompany, type DdsCompany } from "@/components/payments/ddsCompanies";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import {
  getDailyBalancesForMonth,
  getTotalBalance,
  type DayInfo,
} from "@/lib/calculations";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import type { Account, Payment } from "@/lib/types";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

interface CalendarDay {
  dateStr: string;
  day: number;
  info: DayInfo | undefined;
}

interface CalendarWeekRow {
  days: (CalendarDay | null)[];
  referenceDate: string;
}

function buildMonthWeeks(
  year: number,
  month: number,
  dailyMap: Map<string, DayInfo>,
): CalendarWeekRow[] {
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const rows: CalendarWeekRow[] = [];
  let week: (CalendarDay | null)[] = Array(7).fill(null);
  let dow = startOffset;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    week[dow] = { dateStr, day: d, info: dailyMap.get(dateStr) };
    dow++;

    if (dow === 7) {
      const ref = week.find((c) => c)?.dateStr ?? dateStr;
      rows.push({ days: week, referenceDate: ref });
      week = Array(7).fill(null);
      dow = 0;
    }
  }

  if (dow > 0) {
    const ref =
      week.find((c) => c)?.dateStr ??
      `${year}-${String(month + 1).padStart(2, "0")}-01`;
    rows.push({ days: week, referenceDate: ref });
  }

  return rows;
}

export function CalendarPage() {
  const { state, dispatch } = useFinance();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [quickAddPending, setQuickAddPending] = useState(false);
  const [view, setView] = useState<"calendar" | "expense" | "income">("calendar");
  const [companyScope, setCompanyScope] = useState("all");
  const [companies, setCompanies] = useState<DdsCompany[]>([]);
  const [companyByPayment, setCompanyByPayment] = useState<Map<string, string | null>>(new Map());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFlow, setBulkFlow] = useState<"expense" | "income">("expense");
  const [calendarLayout, setCalendarLayout] = useState<"agenda" | "grid">("grid");
  const [replaceCalendarOpen, setReplaceCalendarOpen] = useState(false);
  const [priorityScope, setPriorityScope] = useState<PaymentPriorityScope>("all");
  const [planFactOpen, setPlanFactOpen] = useState(false);
  const [googleSyncing, setGoogleSyncing] = useState(false);
  const googleSyncRef = useRef<Promise<{ ok: boolean; error?: string }> | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = todayISO();

  const totalBalance = getTotalBalance(state.accounts);
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadDdsCompanies(), loadPaymentCompanyLinks()]).then(([loadedCompanies, links]) => {
      if (cancelled) return;
      setCompanies(loadedCompanies);
      setCompanyByPayment(new Map(links.map((link) => [link.paymentId, link.companyId])));
    });
    return () => { cancelled = true; };
  }, []);
  const companyById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const groups = useMemo(() => [...new Set(companies.map((company) => company.groupName))].sort(), [companies]);
  const scopedPayments = useMemo(() => {
    if (companyScope === "all") return state.payments;
    return state.payments.filter((payment) => {
      const companyId = companyByPayment.get(payment.id);
      if (companyScope === "unassigned") return !companyId;
      if (companyScope.startsWith("group:")) return companyId && companyById.get(companyId)?.groupName === companyScope.slice(6);
      return companyId === companyScope;
    });
  }, [state.payments, companyScope, companyByPayment, companyById]);
  const calendarRows = useMemo(() => calendarExportRows({
    payments: scopedPayments,
    accountNames: new Map(state.accounts.map((account) => [account.id, account.name])),
    companyNames: new Map(companies.map((company) => [company.id, company.name])),
    companyByPayment,
  }), [scopedPayments, state.accounts, companies, companyByPayment]);
  const calendarSheets = useMemo(() => calendarTemplateSheets({
    payments: scopedPayments,
    accountNames: new Map(state.accounts.map((account) => [account.id, account.name])),
    companyNames: new Map(companies.map((company) => [company.id, company.name])),
    companyByPayment,
  }), [scopedPayments, state.accounts, companies, companyByPayment]);
  const syncCalendarToGoogle = useCallback(() => {
    if (googleSyncRef.current) return googleSyncRef.current;
    setGoogleSyncing(true);
    const promise = fetch("/api/opiu/google-sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheets: calendarSheets.map((sheet) => ({
          rows: sheet.rows,
          sheetName: sheet.name,
          template: "calendar",
        })),
      }),
    }).then(async (response) => {
      const data = await response.json().catch(() => null) as { error?: string } | null;
      return { ok: response.ok, error: data?.error };
    }).catch(() => ({ ok: false, error: "Не удалось связаться с сервером выгрузки" }))
      .finally(() => {
        googleSyncRef.current = null;
        setGoogleSyncing(false);
      });
    googleSyncRef.current = promise;
    return promise;
  }, [calendarSheets]);
  useEffect(() => {
    if (calendarRows.length <= 1) return;
    const timer = window.setTimeout(() => {
      void syncCalendarToGoogle();
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [calendarRows, syncCalendarToGoogle]);
  const planFactMatches = useMemo(() => {
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    return matchPlannedToFacts(scopedPayments).filter((match) => match.planned.date.startsWith(prefix));
  }, [scopedPayments, year, month]);
  const planFactPeriod = useMemo(() => {
    const dates = planFactMatches.flatMap((match) => [match.planned.date, match.fact.date]).sort();
    return dates.length ? { from: dates[0], to: dates.at(-1)! } : null;
  }, [planFactMatches]);
  const accountNames = useMemo(() => new Map(state.accounts.map((account) => [account.id, account.name])), [state.accounts]);
  const calendarPayments = useMemo(
    () => calendarPaymentsWithoutMatchedPlans(scopedPayments, planFactMatches),
    [scopedPayments, planFactMatches],
  );
  const allVisibleCalendarPayments = useMemo(
    () => calendarPayments.filter(isCalendarCashFlow),
    [calendarPayments],
  );
  const visibleCalendarPayments = useMemo(
    () => allVisibleCalendarPayments.filter((payment) => priorityScope === "all" || getPaymentPriority(payment) === priorityScope),
    [allVisibleCalendarPayments, priorityScope],
  );
  const prioritySummary = useMemo(() => (["A", "B", "C"] as PaymentPriority[]).map((priority) => {
    const payments = allVisibleCalendarPayments.filter((payment) => payment.status !== "cancelled" && getPaymentPriority(payment) === priority);
    return {
      priority,
      count: payments.length,
      plannedExpense: payments.filter((payment) => payment.status === "planned" && payment.amount < 0).reduce((sum, payment) => sum - payment.amount, 0),
      overdue: payments.filter((payment) => payment.status === "planned" && payment.amount < 0 && payment.date < today).length,
    };
  }), [allVisibleCalendarPayments, today]);

  const dailyMap = useMemo(
    () => getDailyBalancesForMonth(year, month, totalBalance, visibleCalendarPayments),
    [year, month, totalBalance, visibleCalendarPayments],
  );

  const paymentsByDate = useMemo(() => {
    const map = new Map<string, Payment[]>();
    for (const p of visibleCalendarPayments) {
      const list = map.get(p.date) ?? [];
      list.push(p);
      map.set(p.date, list);
    }
    return map;
  }, [visibleCalendarPayments]);

  const monthPayments = useMemo(
    () => visibleCalendarPayments.filter((payment) => {
      const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
      return payment.date.startsWith(prefix) && payment.status !== "cancelled";
    }),
    [visibleCalendarPayments, year, month],
  );
  const plannedIncome = monthPayments.filter((payment) => payment.status === "planned" && payment.amount > 0).reduce((sum, payment) => sum + payment.amount, 0);
  const plannedExpense = monthPayments.filter((payment) => payment.status === "planned" && payment.amount < 0).reduce((sum, payment) => sum - payment.amount, 0);
  const negativeDays = [...dailyMap.values()].filter((day) => day.isNegative && day.date >= today).length;

  const weeks = useMemo(
    () => buildMonthWeeks(year, month, dailyMap),
    [year, month, dailyMap],
  );
  const monthDays = useMemo(
    () => [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    [dailyMap],
  );

  const selectedDay: DayInfo | null = selectedDate
    ? (dailyMap.get(selectedDate) ?? null)
    : null;

  const changeMonth = (nextDate: Date) => {
    setCurrentDate(nextDate);
    setSelectedDate(null);
    setQuickAddPending(false);
  };
  const prevMonth = () => changeMonth(new Date(year, month - 1, 1));
  const nextMonth = () => changeMonth(new Date(year, month + 1, 1));

  const handleClosePanel = () => {
    setSelectedDate(null);
    setQuickAddPending(false);
  };

  const handleQuickAdd = useCallback((dateStr: string) => {
    setSelectedDate(dateStr);
    setQuickAddPending(true);
  }, []);

  const handleAddPayment = (payment: Payment, companyId?: string | null) => {
    dispatch({ type: "ADD_PAYMENT", payload: payment });
    if (companyId) {
      setCompanyByPayment((current) => new Map(current).set(payment.id, companyId));
      void savePaymentWithCompany(payment, companyId);
    }
  };

  const handleUpdatePayment = (payment: Payment, companyId: string | null) => {
    dispatch({ type: "UPDATE_PAYMENT", payload: payment });
    setCompanyByPayment((current) => new Map(current).set(payment.id, companyId));
    void updatePaymentCompany(payment.id, companyId);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 text-white">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-950">Платёжный календарь</h1>
              <p className="text-sm text-slate-500">Планы, факты и прогноз остатка по дням</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-1">
            <button aria-label="Предыдущий месяц" onClick={prevMonth} className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-white hover:shadow-sm"><ChevronLeft className="h-5 w-5" /></button>
            <h2 className="min-w-40 text-center font-semibold text-slate-900">{MONTHS[month]} {year}</h2>
            <button aria-label="Следующий месяц" onClick={nextMonth} className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-white hover:shadow-sm"><ChevronRight className="h-5 w-5" /></button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile icon={TrendingUp} label="План поступлений" value={plannedIncome} tone="emerald" />
        <SummaryTile icon={CircleDollarSign} label="План расходов" value={plannedExpense} tone="rose" />
        <SummaryTile icon={CheckCircle2} label="План совпал с фактом" value={planFactMatches.length} count tone="violet" onClick={() => setPlanFactOpen((open) => !open)} expanded={planFactOpen} />
        <SummaryTile icon={negativeDays > 0 ? TriangleAlert : Clock3} label="Дней с кассовым разрывом" value={negativeDays} count tone={negativeDays > 0 ? "amber" : "slate"} />
      </div>

      {planFactOpen && (
        <Card>
          <CardHeader>
            <div>
              <h2 className="font-semibold text-slate-950">Платежи, у которых план совпал с фактом</h2>
              <p className="mt-1 text-sm text-slate-500">
                {planFactPeriod
                  ? `Найдено ${planFactMatches.length} пар за период ${formatDate(planFactPeriod.from)} — ${formatDate(planFactPeriod.to)}.`
                  : "Совпадений пока нет."}
                {" "}Сравниваются только плановые и фактические поступления от маркетплейсов, займов и кредитов. Переводы между счетами и расходы исключены.
              </p>
            </div>
          </CardHeader>
          <CardContent>
            {planFactMatches.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr><th className="px-4 py-3">Плановая дата</th><th className="px-4 py-3">Фактическая дата</th><th className="px-4 py-3">Поступление</th><th className="px-4 py-3">Кошелёк</th><th className="px-4 py-3 text-right">План</th><th className="px-4 py-3 text-right">Факт</th><th className="px-4 py-3 text-right">Отклонение</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {planFactMatches.map((match) => (
                      <tr key={`${match.planned.id}-${match.fact.id}`}>
                        <td className="whitespace-nowrap px-4 py-3">{formatDate(match.planned.date)}</td>
                        <td className="whitespace-nowrap px-4 py-3">{formatDate(match.fact.date)}</td>
                        <td className="px-4 py-3"><p className="font-medium text-slate-900">{match.fact.name || match.planned.name}</p><p className="mt-0.5 text-xs text-slate-500">План: {match.planned.name}</p></td>
                        <td className="px-4 py-3 text-slate-600">{accountNames.get(match.fact.accountId) ?? accountNames.get(match.planned.accountId) ?? "Не указан"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatMoney(match.planned.amount)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{formatMoney(match.fact.amount)}</td>
                        <td className={`whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums ${match.fact.amount - match.planned.amount >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatMoney(match.fact.amount - match.planned.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1">
          {([
            ["calendar", "Календарь", CalendarDays],
            ["expense", "Все расходы", ArrowUpRight],
            ["income", "Все поступления", ArrowDownLeft],
          ] as const).map(([value, label, Icon]) => (
            <button key={value} onClick={() => setView(value)} className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${view === value ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
        <select value={companyScope} onChange={(event) => setCompanyScope(event.target.value)} aria-label="Компания в платёжном календаре" className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-medium sm:w-auto sm:min-w-64">
          <option value="all">Все компании</option>
          <option value="unassigned">Без назначенной компании</option>
          {groups.map((group) => <option key={group} value={`group:${group}`}>Группа: {group}</option>)}
          {companies.filter((company) => company.isActive).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
        </select>
        <button onClick={() => downloadCalendarXlsx(calendarSheets)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-emerald-200 px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"><FileSpreadsheet className="h-4 w-4" /> Excel</button>
        <button disabled={googleSyncing} onClick={async () => {
          const result = await syncCalendarToGoogle();
          alert(result.ok ? "Платёжный календарь выгружен в Google Таблицу" : result.error || "Не удалось выгрузить платёжный календарь");
        }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-blue-200 px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60">
          {googleSyncing ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <CloudUpload className="h-4 w-4" />}
          {googleSyncing ? "Выгружаю…" : "Google Таблица"}
        </button>
        <button onClick={() => setReplaceCalendarOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-rose-200 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"><FileUp className="h-4 w-4" /> Заменить из CSV</button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Приоритет платежей</h2>
            <p className="text-xs text-slate-500">Выберите категорию — календарь, списки и прогноз остатка пересчитаются.</p>
          </div>
          <select
            value={priorityScope}
            onChange={(event) => setPriorityScope(event.target.value as PaymentPriorityScope)}
            aria-label="Фильтр по приоритету платежей"
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 sm:w-auto sm:min-w-52"
          >
            <option value="all">Все приоритеты</option>
            <option value="A">A — критичные</option>
            <option value="B">B — важные</option>
            <option value="C">C — переносимые</option>
          </select>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {prioritySummary.map(({ priority, count, plannedExpense: amount, overdue }) => (
            <button
              key={priority}
              type="button"
              onClick={() => {
                setPriorityScope(priority);
                setView("expense");
                window.setTimeout(() => {
                  document.getElementById("calendar-main-content")?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  });
                }, 0);
              }}
              className={`rounded-xl border p-3 text-left transition ${priorityScope === priority ? "border-violet-500 ring-2 ring-violet-200" : "border-slate-200 hover:border-violet-300 hover:shadow-sm"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`rounded-md border px-2 py-1 text-xs font-bold ${PRIORITY_META[priority].badge}`}>{PRIORITY_META[priority].label}</span>
                <span className="text-xs text-slate-500">{count} платежей</span>
              </div>
              <p className="mt-2 text-lg font-bold tabular-nums text-slate-950">{formatMoney(amount)}</p>
              <p className={`mt-1 text-xs ${overdue ? "font-semibold text-rose-700" : "text-slate-500"}`}>{overdue ? `Просрочено: ${overdue}` : PRIORITY_META[priority].description}</p>
              <p className="mt-3 text-xs font-semibold text-violet-700">Нажмите, чтобы открыть список →</p>
            </button>
          ))}
        </div>
      </div>

      <SalesForecastPanel
        key={`${year}-${month}`}
        year={year}
        month={month}
        accounts={state.accounts}
        onAddPayment={handleAddPayment}
      />

      <FinancialAlertsPanel accounts={state.accounts} payments={scopedPayments} />
      <FinanceTasksPanel />

      <div id="calendar-main-content" className="scroll-mt-4">
      {view === "calendar" ? <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Денежный поток по дням</h2>
              <p className="mt-1 text-sm text-slate-500">Календарь по дням: суммы, статьи расходов и ожидаемый остаток.</p>
            </div>
            <div className="flex rounded-lg bg-slate-100 p-1">
              <button onClick={() => setCalendarLayout("grid")} className={`inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold ${calendarLayout === "grid" ? "bg-white text-violet-700 shadow-sm" : "text-slate-600"}`}><LayoutGrid className="h-4 w-4" /> Календарь</button>
              <button onClick={() => setCalendarLayout("agenda")} className={`inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold ${calendarLayout === "agenda" ? "bg-white text-violet-700 shadow-sm" : "text-slate-600"}`}><List className="h-4 w-4" /> Список</button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <CashFlowSparkline year={year} month={month} dailyMap={dailyMap} />

          {calendarLayout === "grid" && <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-emerald-100 border border-emerald-300" />
              Поступления
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-red-100 border border-red-300" />
              Расходы
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-slate-100 border border-slate-300" />
              Нейтральный
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-red-500 border border-red-600" />
              Отрицательный баланс
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-white border border-violet-300 border-l-violet-600 border-l-[3px]" />
              Итог недели
            </span>
          </div>}

          {calendarLayout === "agenda" ? (
            <CalendarAgenda
              days={monthDays}
              paymentsByDate={paymentsByDate}
              today={today}
              onSelect={(date) => {
                setQuickAddPending(false);
                setSelectedDate(date);
              }}
              onQuickAdd={handleQuickAdd}
            />
          ) : <>
          <div className="w-full pb-2">
          <div className="w-full">
          <div className="grid grid-cols-7 gap-2">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="text-center text-xs font-medium text-slate-400 py-2"
              >
                {d}
              </div>
            ))}
          </div>
          <div className="space-y-4">
            {weeks.map((week, weekIdx) => (
              <section key={weekIdx} className="space-y-2">
                <div className="grid grid-cols-7 gap-2">
                  {week.days.map((cell, dayIdx) => {
                    if (!cell) return <div key={`${weekIdx}-empty-${dayIdx}`} className="min-h-[210px] rounded-xl bg-slate-50/60" />;
                    const { dateStr, day, info } = cell;
                    return (
                      <CalendarDayCell
                        key={dateStr}
                        dateStr={dateStr}
                        day={day}
                        info={info}
                        dayPayments={paymentsByDate.get(dateStr) ?? []}
                        isToday={dateStr === today}
                        isSelected={selectedDate === dateStr}
                        onSelect={() => {
                          setQuickAddPending(false);
                          setSelectedDate(dateStr);
                        }}
                        onQuickAdd={() => handleQuickAdd(dateStr)}
                      />
                    );
                  })}
                </div>
                <WeekSummaryCell referenceDate={week.referenceDate} totalBalance={totalBalance} payments={visibleCalendarPayments} />
              </section>
            ))}
          </div>
          </div>
          </div>
          </>}
        </CardContent>
      </Card> : (
        <FlowList
          payments={visibleCalendarPayments}
          flow={view}
          accounts={state.accounts}
          companies={companies}
          companyByPayment={companyByPayment}
          priorityScope={priorityScope}
          onEdit={(payment) => {
            setCurrentDate(new Date(`${payment.date}T00:00:00`));
            setSelectedDate(payment.date);
            setView("calendar");
          }}
          onAdd={() => {
            const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
            const targetDate = today.startsWith(monthPrefix) ? today : `${monthPrefix}-01`;
            setSelectedDate(targetDate);
            setQuickAddPending(true);
            setView("calendar");
          }}
          onBulkAdd={() => {
            setBulkFlow(view);
            setBulkOpen(true);
          }}
          onCloseList={() => {
            setView("calendar");
            window.setTimeout(() => {
              document.getElementById("calendar-main-content")?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            }, 0);
          }}
        />
      )}
      </div>

      <DayDetailPanel
        dayInfo={selectedDay}
        allPayments={visibleCalendarPayments}
        accounts={state.accounts}
        companies={companies}
        companyByPayment={companyByPayment}
        onClose={handleClosePanel}
        onAddPayment={handleAddPayment}
        onUpdatePayment={handleUpdatePayment}
        quickAddOpen={quickAddPending}
        onQuickAddConsumed={() => setQuickAddPending(false)}
      />
      <BulkPaymentModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        initialFlow={bulkFlow}
        accounts={state.accounts}
        existingPayments={state.payments}
        onAddMany={(payments) => {
          for (const payment of payments) dispatch({ type: "ADD_PAYMENT", payload: payment });
        }}
      />
      <ReplaceCalendarModal
        open={replaceCalendarOpen}
        onClose={() => setReplaceCalendarOpen(false)}
        accounts={state.accounts}
        companies={companies}
        existingCount={state.payments.filter((payment) => payment.status === "planned" && !companyByPayment.get(payment.id)).length}
        onReplace={async (payments, companyId) => {
          const oldPlanIds = state.payments.filter((payment) => payment.status === "planned" && (companyId ? companyByPayment.get(payment.id) === companyId : !companyByPayment.get(payment.id))).map((payment) => payment.id);
          for (const paymentId of oldPlanIds) dispatch({ type: "DELETE_PAYMENT", payload: paymentId });
          const existingFacts = state.payments.filter((payment) => payment.status === "done");
          const normalized = (value: string) => value.toLowerCase().replace(/[^а-яa-z0-9]+/gi, "");
          const safePayments = payments.filter((payment) => payment.status !== "done" || !existingFacts.some((fact) =>
            fact.date === payment.date &&
            Math.abs(fact.amount - payment.amount) < 0.01 &&
            normalized(fact.name) === normalized(payment.name),
          ));
          for (const payment of safePayments) dispatch({ type: "ADD_PAYMENT", payload: payment });
          if (companyId) await Promise.all(safePayments.map((payment) => savePaymentWithCompany(payment, companyId)));
          setCompanyByPayment((current) => new Map([...current, ...safePayments.map((payment) => [payment.id, companyId] as const)]));
        }}
      />
    </div>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  count,
  tone,
  onClick,
  expanded,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: number;
  count?: boolean;
  tone: "emerald" | "rose" | "violet" | "amber" | "slate";
  onClick?: () => void;
  expanded?: boolean;
}) {
  const colors = {
    emerald: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-50 text-rose-700",
    violet: "bg-violet-50 text-violet-700",
    amber: "bg-amber-50 text-amber-700",
    slate: "bg-slate-100 text-slate-700",
  };
  const content = (
    <Card>
      <CardContent className={`flex items-center gap-3 pt-5 ${onClick ? "cursor-pointer transition hover:bg-violet-50/50" : ""}`}>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${colors[tone]}`}><Icon className="h-5 w-5" /></div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-slate-950">
            {count ? value.toLocaleString("ru-RU") : `${Math.round(value).toLocaleString("ru-RU")} ₽`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
  return onClick ? <button type="button" aria-expanded={expanded} onClick={onClick} className="w-full text-left">{content}</button> : content;
}

function FlowList({
  payments,
  flow,
  accounts,
  companies,
  companyByPayment,
  priorityScope,
  onEdit,
  onAdd,
  onBulkAdd,
  onCloseList,
}: {
  payments: Payment[];
  flow: "expense" | "income";
  accounts: Account[];
  companies: DdsCompany[];
  companyByPayment: Map<string, string | null>;
  priorityScope: PaymentPriorityScope;
  onEdit: (payment: Payment) => void;
  onAdd: () => void;
  onBulkAdd: () => void;
  onCloseList: () => void;
}) {
  const rows = payments
    .filter((payment) => payment.status !== "cancelled" && (flow === "income" ? isMarketplaceOrLoanIncome(payment) : payment.amount < 0))
    .sort((a, b) => priorityRank(a) - priorityRank(b) || b.date.localeCompare(a.date));
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const companyNames = new Map(companies.map((company) => [company.id, company.name]));
  const total = rows.reduce((sum, payment) => sum + Math.abs(payment.amount), 0);
  return (
    <Card>
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {flow === "income" ? "Все поступления" : "Все расходы"}
            {priorityScope !== "all" && ` · приоритет ${priorityScope}`}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            План и факт по выбранной компании · {rows.length} операций
            {priorityScope !== "all" && " · список отфильтрован"}
          </p>
          </div>
          <button onClick={onCloseList} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900">
            <ArrowLeft className="h-4 w-4" />
            К календарю
          </button>
        </div>
        <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Итого в списке</p>
            <p className={`mt-0.5 text-xl font-bold tabular-nums ${flow === "income" ? "text-emerald-700" : "text-rose-700"}`}>{formatMoney(total)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={onAdd} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-violet-200 bg-white px-4 text-sm font-semibold text-violet-700 hover:bg-violet-50">
              <Plus className="h-4 w-4" />
              Добавить платёж
            </button>
            <button onClick={onBulkAdd} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-violet-700">
              <FileUp className="h-4 w-4" />
              Списком или из файла
            </button>
          </div>
        </div>
      </div>
      <div className="w-full overflow-hidden">
        <table className="w-full table-fixed text-xs xl:text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr>
            <th className="w-[6%] px-2 py-3 font-medium">Приор.</th><th className="w-[8%] px-2 py-3 font-medium">Дата</th><th className="w-[10%] px-2 py-3 text-right font-medium">Сумма</th><th className="w-[13%] px-2 py-3 font-medium">Название</th><th className="w-[19%] px-2 py-3 font-medium">Назначение платежа</th><th className="w-[13%] px-2 py-3 font-medium">Комментарий</th><th className="w-[10%] px-2 py-3 font-medium">Компания</th><th className="w-[9%] px-2 py-3 font-medium">Кошелёк</th><th className="w-[7%] px-2 py-3 font-medium">Статус</th><th className="w-[5%] px-1 py-3 text-center font-medium"></th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? <tr><td colSpan={10} className="px-5 py-10 text-center text-slate-500">Операций нет</td></tr> : rows.map((payment) => {
              const companyId = companyByPayment.get(payment.id);
              const priority = getPaymentPriority(payment);
              return <tr key={payment.id} onClick={() => onEdit(payment)} className="cursor-pointer hover:bg-slate-50">
                <td className="px-2 py-3"><span className={`inline-flex rounded-md border px-1.5 py-1 text-xs font-bold ${PRIORITY_META[priority].badge}`}>{priority}</span></td>
                <td className="px-2 py-3">{formatDate(payment.date)}</td>
                <td className={`px-2 py-3 text-right font-semibold tabular-nums ${flow === "income" ? "text-emerald-700" : "text-rose-700"}`}>{formatMoney(payment.amount)}</td>
                <td className="break-words px-2 py-3 font-medium text-slate-900">{payment.category}</td>
                <td className="break-words px-2 py-3 text-slate-700">{payment.name}</td>
                <td className="break-words px-2 py-3 text-slate-500">{cleanPaymentComment(payment.comment) || "—"}</td>
                <td className="break-words px-2 py-3 text-slate-600">{companyId ? companyNames.get(companyId) ?? "Неизвестная" : "Не назначена"}</td>
                <td className="break-words px-2 py-3 text-slate-600">{accountNames.get(payment.accountId) ?? "—"}</td>
                <td className="px-2 py-3"><span className={`inline-flex rounded-full px-1.5 py-1 text-[10px] font-medium ${payment.status === "done" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{payment.status === "done" ? "Факт" : "План"}</span></td>
                <td className="px-1 py-3 text-center"><button aria-label="Изменить платёж" title="Изменить" onClick={(event) => { event.stopPropagation(); onEdit(payment); }} className="min-h-9 rounded-lg px-2 text-lg font-semibold text-violet-700 hover:bg-violet-50">⋯</button></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
