"use client";

import { ArrowDownLeft, ArrowLeft, ArrowUpRight, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, Clock3, CloudUpload, FileSpreadsheet, FileUp, LayoutGrid, List, Loader2, Plus, Search, SlidersHorizontal, TrendingUp, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BulkPaymentModal } from "./BulkPaymentModal";
import { CalendarAgenda } from "./CalendarAgenda";
import { CalendarDayCell } from "./CalendarDayCell";
import { CashFlowSparkline } from "./CashFlowSparkline";
import { calendarPaymentsWithoutMatchedPlans, findPlanFactMatches, isCalendarCashFlow, isTechnicalTransfer, rejectedCalendarFactIds, withRejectedCalendarFactMatch, withoutRejectedCalendarFactMatch } from "./calendarPlan";
import { persistCalendarFactLink } from "./forecastPublication";
import { DayDetailPanel } from "./DayDetailPanel";
import { SalesForecastPanel } from "./SalesForecastPanel";
import { OzonForecastPanel } from "./OzonForecastPanel";
import { FinancialAlertsPanel } from "./FinancialAlertsPanel";
import { FinanceTasksPanel } from "./FinanceTasksPanel";
import { calendarTemplateSheets, downloadCalendarXlsx } from "./calendarExport";
import { parseRussianAmount, parseRussianDate } from "@/components/payments/ddsCsv";
import { ReplaceCalendarModal } from "./ReplaceCalendarModal";
import { importedMonths, matchesReplaceScope, plannedPaymentsToReplace } from "./calendarReplace";
import { OverdueLoanQueue } from "./OverdueLoanQueue";
import { WeekSummaryCell } from "./WeekSummaryCell";
import { chronologicalPaymentOrder, displayPaymentComment, getPaymentPriority, PRIORITY_META, type PaymentPriority, type PaymentPriorityScope } from "./paymentPriority";
import { loanScheduleKey, overdueLoanInstallmentsForReview, rescheduleLoanInstallment, rescheduleOverdueLoanInstallment, type OverdueLoanInstallment } from "./loanPaymentReschedule";
import { useDailyLoanCurrencyRefresh } from "@/components/loans/currencyRefresh";
import { loadLoanScheduleRows } from "@/components/loans/scheduleStore";
import { useFinance } from "@/components/providers/FinanceProvider";
import { loadDdsCompanies, loadPaymentCompanyLinks, savePaymentWithCompany, updatePaymentCompany, type DdsCompany } from "@/components/payments/ddsCompanies";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import {
  getDailyBalancesForMonth,
  type DayInfo,
} from "@/lib/calculations";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import type { ScheduleRowRecord } from "@/lib/loans/scheduleRows";
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

type TextCorrection = {
  payment: Payment;
  updates: Payment[];
  additions: Payment[];
  summary: string;
};

type TextScheduleLine = { date: string; amount: number; label: string };

const RUSSIAN_MONTHS: Record<string, number> = {
  января: 1, феврал: 2, марта: 3, апрел: 4, мая: 5, июня: 6,
  июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12,
};
const TEXT_STOP_WORDS = new Set(["исправ", "платеж", "платежи", "платежей", "пожалуйста", "нужно", "надо", "список", "дата", "назначение", "сумма", "оплат", "погашение", "проценты", "тело", "займа", "кредит"]);

function textDate(value: string) {
  return parseRussianDate(value) ?? null;
}

function correctionAmounts(text: string) {
  return [...text.matchAll(/(?:сумм[ауе]?\s*)?([+-]?[\d\s ]+(?:[,.]\d{1,2})?)\s*(?:₽|руб\.?|р\b)/gi)]
    .map((match) => parseRussianAmount(match[1])).filter((amount): amount is number => amount !== null);
}

function normalizedWords(value: string) {
  return value.toLowerCase().replace(/ё/g, "е").match(/[а-яa-z0-9]+/gi)?.filter((word) => word.length > 2 && ![...TEXT_STOP_WORDS].some((stop) => word.startsWith(stop))) ?? [];
}

function similarWord(left: string, right: string) {
  if (left === right) return true;
  const leftBase = left.replace(/[аеёиоуыэюяй]+$/i, "");
  const rightBase = right.replace(/[аеёиоуыэюяй]+$/i, "");
  return leftBase.length >= 4 && rightBase.length >= 4 && (leftBase.startsWith(rightBase) || rightBase.startsWith(leftBase));
}

function parseTextDate(value: string, fallbackYear: number) {
  const numeric = textDate(value);
  if (numeric) return numeric;
  const human = value.toLowerCase().replace(/ё/g, "е").match(/\b(\d{1,2})\s+(январ\w*|феврал\w*|март\w*|апрел\w*|мая|июн\w*|июл\w*|август\w*|сентябр\w*|октябр\w*|ноябр\w*|декабр\w*)(?:\s+(20\d{2}))?/i);
  if (!human) return null;
  const monthKey = Object.keys(RUSSIAN_MONTHS).find((key) => human[2].startsWith(key));
  if (!monthKey) return null;
  return `${human[3] ?? fallbackYear}-${String(RUSSIAN_MONTHS[monthKey]).padStart(2, "0")}-${human[1].padStart(2, "0")}`;
}

function parseTextSchedule(text: string, fallbackYear: number): TextScheduleLine[] {
  return text.split(/\r?\n/).flatMap((rawLine) => {
    const line = rawLine.trim();
    const dateMatch = line.match(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{4}|20\d{2}-\d{2}-\d{2}|\d{1,2}\s+(?:январ\w*|феврал\w*|март\w*|апрел\w*|мая|июн\w*|июл\w*|август\w*|сентябр\w*|октябр\w*|ноябр\w*|декабр\w*)(?:\s+20\d{2})?)/i);
    const amount = correctionAmounts(line)[0];
    if (!dateMatch || amount === undefined) return [];
    const label = line
      .replace(/^\s*\d+[.)]\s*/, "")
      .replace(dateMatch[0], "")
      .replace(/(?:сумма\s*платежа|назначение\s*платежа|дата\s*платежа)/gi, "")
      .replace(/[+-]?[\d\s ]+(?:[,.]\d{1,2})?\s*(?:₽|руб\.?|р\b)/gi, "")
      .replace(/\s+/g, " ").trim();
    const date = parseTextDate(dateMatch[1], fallbackYear);
    return date ? [{ date, amount, label }] : [];
  });
}

function paymentSearchText(payment: Payment) {
  return [payment.name, payment.counterparty, payment.comment, payment.category].filter(Boolean).join(" ");
}

function textOwnerWords(text: string) {
  const heading = text.split(/\r?\n/).filter((line) => !/\d{1,2}[./-]\d{1,2}|\d{1,2}\s+(январ|феврал|март|апрел|мая|июн|июл|август|сентябр|октябр|ноябр|декабр)/i.test(line)).join(" ");
  return normalizedWords(heading);
}

function scheduleCandidate(line: TextScheduleLine, payments: Payment[], ownerWords: string[], usedPaymentIds: Set<string>) {
  const labelWords = normalizedWords(line.label);
  const ranked = payments.filter((payment) => !usedPaymentIds.has(payment.id)).map((payment) => {
    const paymentWords = new Set(normalizedWords(paymentSearchText(payment)));
    const ownerScore = ownerWords.length && ownerWords.every((word) => [...paymentWords].some((candidate) => similarWord(word, candidate))) ? 20 : 0;
    const labelScore = labelWords.filter((word) => [...paymentWords].some((candidate) => similarWord(word, candidate))).length * 3;
    const amountScore = Math.abs(Math.abs(payment.amount) - Math.abs(line.amount)) < 0.01 ? 8 : 0;
    const dateScore = payment.date === line.date ? 12 : 0;
    return { payment, score: ownerScore + labelScore + amountScore + dateScore };
  }).filter(({ score }) => score >= 8).sort((left, right) => right.score - left.score);
  if (!ranked.length || (ranked[1] && ranked[0].score === ranked[1].score)) return null;
  return ranked[0].payment;
}

function recognizeTextSchedule(text: string, payments: Payment[], fallbackYear: number): { correction?: TextCorrection; error?: string } | null {
  const lines = parseTextSchedule(text, fallbackYear);
  if (!lines.length) return null;
  const ownerWords = textOwnerWords(text);
  const planned = payments.filter((payment) => payment.status === "planned");
  const usedPaymentIds = new Set<string>();
  const updates: Payment[] = [];
  const unchanged: TextScheduleLine[] = [];
  const notFound: TextScheduleLine[] = [];
  for (const line of lines) {
    const candidate = scheduleCandidate(line, planned, ownerWords, usedPaymentIds);
    if (!candidate) {
      notFound.push(line);
      continue;
    }
    usedPaymentIds.add(candidate.id);
    const nextAmount = candidate.amount < 0 ? -Math.abs(line.amount) : Math.abs(line.amount);
    if (candidate.date === line.date && Math.abs(candidate.amount - nextAmount) < 0.01) unchanged.push(line);
    else updates.push({ ...candidate, date: line.date, amount: nextAmount });
  }
  if (notFound.length) {
    return { error: `Не удалось однозначно сопоставить строки: ${notFound.map((line) => `${formatDate(line.date)} · ${formatMoney(line.amount)}${line.label ? ` · ${line.label}` : ""}`).join("; ")}. Проверьте имя получателя, сумму или назначение.` };
  }
  const sourcePayment = updates[0] ?? planned.find((payment) => payment.date === lines[0].date && Math.abs(Math.abs(payment.amount) - Math.abs(lines[0].amount)) < 0.01) ?? planned[0];
  if (!sourcePayment) return { error: "В календаре нет плановых платежей для сверки." };
  const parts = [updates.length ? `будет исправлено: ${updates.length}` : "изменения не требуются", unchanged.length ? `уже совпадают: ${unchanged.length}` : ""];
  return { correction: { payment: sourcePayment, updates, additions: [], summary: `Список распознан — ${parts.filter(Boolean).join(", ")}.` } };
}

function findPlannedCorrectionPayment(payments: Payment[], date: string, amount?: number) {
  return payments.filter((payment) => payment.status === "planned" && payment.date === date && (amount === undefined || Math.abs(Math.abs(payment.amount) - Math.abs(amount)) < 0.01));
}

function recognizeCalendarCorrection(text: string, payments: Payment[], fallbackYear: number): { correction?: TextCorrection; error?: string } {
  const scheduleResult = recognizeTextSchedule(text, payments, fallbackYear);
  if (scheduleResult) return scheduleResult;
  const dates = [...text.matchAll(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{4}|20\d{2}-\d{2}-\d{2})\b/g)].map((match) => textDate(match[1])).filter((date): date is string => Boolean(date));
  const amounts = correctionAmounts(text);
  if (!dates.length) {
    return { error: "Укажите дату планового платежа в формате 05.10.2026." };
  }

  const sourceDate = dates[0];
  const initialAmount = amounts[0];
  const candidates = findPlannedCorrectionPayment(payments, sourceDate, initialAmount);
  if (candidates.length !== 1) {
    return { error: candidates.length ? "Нашла несколько плановых платежей. Добавьте сумму и назначение платежа." : "Плановый платёж с такой датой и суммой не найден. Проверьте дату и сумму." };
  }
  const payment = candidates[0];

  if (/раздел|распредел|разбить/i.test(text)) {
    if (loanScheduleKey(payment)) {
      return { error: "Платёж по кредиту или займу нельзя распределить здесь: откройте договор, чтобы сохранить целостность графика." };
    }
    const parts = [...text.matchAll(/([+-]?[\d\s ]+(?:[,.]\d{1,2})?)\s*(?:₽|руб\.?|р\b)\s*(?:на|в)?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4}|20\d{2}-\d{2}-\d{2})/gi)]
      .map((match) => ({ amount: parseRussianAmount(match[1]), date: textDate(match[2]) }))
      .filter((part): part is { amount: number; date: string } => part.amount !== null && Boolean(part.date));
    if (parts.length < 2) {
      return { error: "Для распределения укажите минимум две части: «разделить 50 000 ₽ с 05.10.2026 на 20 000 ₽ 12.10.2026 и 30 000 ₽ 20.10.2026»." };
    }
    const total = parts.reduce((sum, part) => sum + Math.abs(part.amount), 0);
    if (Math.abs(total - Math.abs(payment.amount)) >= 0.01) {
      return { error: `Сумма частей ${formatMoney(total)} не равна исходному платежу ${formatMoney(Math.abs(payment.amount))}. Календарь не изменён.` };
    }
    const sign = payment.amount < 0 ? -1 : 1;
    const [first, ...rest] = parts;
    const updates = [{ ...payment, date: first.date, amount: sign * Math.abs(first.amount) }];
    const additions = rest.map((part) => ({ ...payment, id: crypto.randomUUID(), date: part.date, amount: sign * Math.abs(part.amount), settledByPaymentId: null }));
    return { correction: { payment, updates, additions, summary: `${formatMoney(payment.amount)} · ${formatDate(sourceDate)} будет распределён на ${parts.length} дат: ${parts.map((part) => `${formatMoney(sign * Math.abs(part.amount))} · ${formatDate(part.date)}`).join(", ")}` } };
  }

  if (/(измен.*сумм|сумм.*измен|постав.*сумм)/i.test(text) && amounts.length >= 2) {
    const nextAmount = amounts[amounts.length - 1];
    return { correction: { payment, updates: [{ ...payment, amount: payment.amount < 0 ? -Math.abs(nextAmount) : Math.abs(nextAmount) }], additions: [], summary: `${formatMoney(payment.amount)} → ${formatMoney(payment.amount < 0 ? -Math.abs(nextAmount) : Math.abs(nextAmount))} · ${formatDate(sourceDate)} · ${payment.name || payment.category}` } };
  }

  const targetDate = dates[1];
  if (/перенест|сдвин|передвин|измен.*дат/i.test(text) && targetDate) {
    return { correction: { payment, updates: [{ ...payment, date: targetDate }], additions: [], summary: `${formatMoney(payment.amount)} · ${formatDate(sourceDate)} → ${formatDate(targetDate)} · ${payment.name || payment.category}` } };
  }
  return { error: "Понимаю перенос даты, изменение суммы и распределение платежа. Например: «изменить сумму 50 000 ₽ 05.10.2026 на 62 500 ₽» или «разделить 50 000 ₽ с 05.10.2026 на 20 000 ₽ 12.10.2026 и 30 000 ₽ 20.10.2026»." };
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
  const [view, setView] = useState<"calendar" | "expense" | "income" | "forecast" | "ozon-forecast">("calendar");
  const [companyScope, setCompanyScope] = useState("all");
  const [companies, setCompanies] = useState<DdsCompany[]>([]);
  const [companyByPayment, setCompanyByPayment] = useState<Map<string, string | null>>(new Map());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFlow, setBulkFlow] = useState<"expense" | "income">("expense");
  const [calendarLayout, setCalendarLayout] = useState<"agenda" | "grid">("grid");
  const [loanScheduleRows, setLoanScheduleRows] = useState<ScheduleRowRecord[] | null>(null);
  const [scheduleLinksError, setScheduleLinksError] = useState("");
  const [textCorrection, setTextCorrection] = useState("");
  const [textCorrectionPreview, setTextCorrectionPreview] = useState<TextCorrection | null>(null);
  const [textCorrectionError, setTextCorrectionError] = useState<string | null>(null);

  // Сетка месяца на телефоне даёт колонку в 34px: в неё не помещается ни
  // сумма, ни число операций — ячейка превращается в вертикальную полоску с
  // обрезанным текстом. Список по дням показывает те же данные и те же
  // действия, поэтому на узком экране он и открывается первым.
  //
  // Выбор ставится ОДИН раз при первом заходе и запоминается: переключатель
  // никуда не делся, и если человек сознательно выбрал сетку, поворот экрана
  // или следующий заход её не отменят.
  // localStorage бросает SecurityError, когда браузеру запрещено хранить данные
  // для сайта («Блокировать все cookie», корпоративная политика, часть режимов
  // приватного просмотра). Без перехвата исключение в эффекте монтирования
  // оставляло вместо календаря пустой экран, а в обработчике переключателя
  // роняло клик. Не запомнили выбор — не беда, календарь работать обязан.
  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem("calendar-layout"); } catch { saved = null; }
    if (saved === "agenda" || saved === "grid") { setCalendarLayout(saved); return; }
    if (window.matchMedia("(max-width: 767px)").matches) setCalendarLayout("agenda");
  }, []);

  const chooseLayout = (next: "agenda" | "grid") => {
    setCalendarLayout(next);
    try { window.localStorage.setItem("calendar-layout", next); } catch { /* хранилище запрещено — выбор просто не переживёт перезагрузку */ }
  };
  const [replaceCalendarOpen, setReplaceCalendarOpen] = useState(false);
  const [priorityScope, setPriorityScope] = useState<PaymentPriorityScope>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [flowScope, setFlowScope] = useState<"all" | "expense" | "income">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [planFactOpen, setPlanFactOpen] = useState(false);
  const [googleSyncing, setGoogleSyncing] = useState(false);
  const googleSyncRef = useRef<Promise<{ ok: boolean; error?: string }> | null>(null);
  const isForecastView = view === "forecast" || view === "ozon-forecast";

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = todayISO();

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadDdsCompanies(), loadPaymentCompanyLinks()]).then(([loadedCompanies, links]) => {
      if (cancelled) return;
      setCompanies(loadedCompanies);
      setCompanyByPayment(new Map(links.map((link) => [link.paymentId, link.companyId])));
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    loadLoanScheduleRows()
      .then((result) => {
        if (cancelled) return;
        if (result.missingTable) throw new Error("не применена структура графиков кредитов");
        setLoanScheduleRows(result.rows);
        setScheduleLinksError("");
      })
      .catch((error) => {
        if (!cancelled) setScheduleLinksError(error instanceof Error ? error.message : "не удалось загрузить связи кредитов");
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
  const overdueLoanInstallments = useMemo(
    () => overdueLoanInstallmentsForReview(scopedPayments, today),
    [scopedPayments, today],
  );
  const overdueLoanPaymentIds = useMemo(
    () => new Set(overdueLoanInstallments.flatMap((installment) => installment.payments.map((payment) => payment.id))),
    [overdueLoanInstallments],
  );
  const activeCalendarScopedPayments = useMemo(
    () => scopedPayments.filter((payment) => !overdueLoanPaymentIds.has(payment.id)),
    [overdueLoanPaymentIds, scopedPayments],
  );
  const calendarSheets = useMemo(() => calendarTemplateSheets({
    payments: activeCalendarScopedPayments,
    accountNames: new Map(state.accounts.map((account) => [account.id, account.name])),
    companyNames: new Map(companies.map((company) => [company.id, company.name])),
    companyByPayment,
  }), [activeCalendarScopedPayments, state.accounts, companies, companyByPayment]);
  const syncCalendarToGoogle = useCallback(() => {
    if (googleSyncRef.current) return googleSyncRef.current;
    setGoogleSyncing(true);
    const promise = fetch("/api/opiu/google-sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheets: calendarSheets.map((sheet) => ({
          rows: sheet.rows,
          rowIds: sheet.rowIds,
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
  // Выгрузка в Google Таблицу — только по кнопке. Раньше эффект отправлял весь
  // календарь наружу через 3 секунды после любой правки, без подтверждения.
  const allPlanFactMatching = useMemo(
    () => loanScheduleRows === null
      ? { matched: [], review: [] }
      : findPlanFactMatches(scopedPayments, companyByPayment, loanScheduleRows),
    [scopedPayments, companyByPayment, loanScheduleRows],
  );
  const planFactMatching = useMemo(() => {
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    return {
      matched: allPlanFactMatching.matched.filter((match) => match.planned.date.startsWith(prefix)),
      review: allPlanFactMatching.review.filter((match) => match.planned.date.startsWith(prefix)),
    };
  }, [allPlanFactMatching, year, month]);
  const planFactMatches = planFactMatching.matched;
  const planFactReview = planFactMatching.review;
  const rejectedPlanFactLinks = useMemo(() => {
    const factsById = new Map(state.payments.filter((payment) => payment.status === "done").map((payment) => [payment.id, payment]));
    return state.payments.flatMap((planned) => [...rejectedCalendarFactIds(planned)].flatMap((factId) => {
      const fact = factsById.get(factId);
      return fact ? [{ planned, fact }] : [];
    }));
  }, [state.payments]);
  const factLinkRequests = useRef(new Set<string>());
  const [factLinkError, setFactLinkError] = useState<string | null>(null);
  const [manualFactLinkError, setManualFactLinkError] = useState<{ key: string; message: string } | null>(null);
  const [confirmingFactLinkKey, setConfirmingFactLinkKey] = useState<string | null>(null);
  const [aligningCompanyKey, setAligningCompanyKey] = useState<string | null>(null);
  const [factLinkNotice, setFactLinkNotice] = useState<string | null>(null);
  useEffect(() => {
    for (const match of allPlanFactMatching.matched) {
      if (match.source !== "automatic") continue;
      const requestKey = `${match.planned.id}:${match.fact.id}`;
      if (factLinkRequests.current.has(requestKey)) continue;
      factLinkRequests.current.add(requestKey);
      void persistCalendarFactLink(match.planned.id, match.fact.id, "automatic")
        .then((payment) => {
          dispatch({ type: "UPDATE_PAYMENT", payload: payment });
          setFactLinkError(null);
        })
        .catch((error: unknown) => {
          factLinkRequests.current.delete(requestKey);
          setFactLinkError(error instanceof Error ? error.message : "Не удалось отметить поступление фактическим");
        });
    }
  }, [allPlanFactMatching.matched, dispatch]);
  useDailyLoanCurrencyRefresh(state.payments, dispatch, (error) => {
    setFactLinkError(error instanceof Error ? error.message : "Не удалось обновить валютный график кредитов");
  });
  const planFactPeriod = useMemo(() => {
    const dates = planFactMatches.flatMap((match) => [match.planned.date, match.fact.date]).sort();
    return dates.length ? { from: dates[0], to: dates.at(-1)! } : null;
  }, [planFactMatches]);
  const accountNames = useMemo(() => new Map(state.accounts.map((account) => [account.id, account.name])), [state.accounts]);
  const calendarPayments = useMemo(
    () => calendarPaymentsWithoutMatchedPlans(activeCalendarScopedPayments, allPlanFactMatching.matched),
    [activeCalendarScopedPayments, allPlanFactMatching.matched],
  );
  const allVisibleCalendarPayments = useMemo(
    () => calendarPayments.filter(isCalendarCashFlow),
    [calendarPayments],
  );
  const searchedCalendarPayments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase().replace(/ё/g, "е");
    return allVisibleCalendarPayments.filter((payment) => {
      if (flowScope === "expense" && payment.amount >= 0) return false;
      if (flowScope === "income" && payment.amount <= 0) return false;
      if (dateFrom && payment.date < dateFrom) return false;
      if (dateTo && payment.date > dateTo) return false;
      if (!query) return true;
      const companyId = companyByPayment.get(payment.id);
      const searchable = [
        payment.date,
        formatDate(payment.date),
        payment.amount,
        Math.abs(payment.amount),
        payment.category,
        payment.name,
        payment.counterparty,
        displayPaymentComment(payment.comment),
        accountNames.get(payment.accountId),
        companyId ? companyById.get(companyId)?.name : "без компании",
      ].filter((value) => value !== undefined && value !== null).join(" ").toLowerCase().replace(/ё/g, "е");
      return searchable.includes(query);
    });
  }, [accountNames, allVisibleCalendarPayments, companyById, companyByPayment, dateFrom, dateTo, flowScope, searchQuery]);
  const visibleCalendarPayments = useMemo(
    () => searchedCalendarPayments.filter((payment) => priorityScope === "all" || getPaymentPriority(payment) === priorityScope),
    [searchedCalendarPayments, priorityScope],
  );
  const hasCalendarFilters = Boolean(searchQuery.trim() || flowScope !== "all" || dateFrom || dateTo);
  const activeCalendarFilterCount = Number(Boolean(searchQuery.trim())) + Number(flowScope !== "all") + Number(Boolean(dateFrom)) + Number(Boolean(dateTo));
  const searchResults = useMemo(
    () => visibleCalendarPayments.filter((payment) => payment.status !== "cancelled").sort(chronologicalPaymentOrder).slice(0, 50),
    [visibleCalendarPayments],
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
    () => getDailyBalancesForMonth(year, month, state.accounts, state.payments, visibleCalendarPayments),
    [year, month, state.accounts, state.payments, visibleCalendarPayments],
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

  const handleViewChange = (nextView: "calendar" | "expense" | "income" | "forecast" | "ozon-forecast") => {
    if (nextView === "forecast" || nextView === "ozon-forecast") {
      setSelectedDate(null);
      setQuickAddPending(false);
      setBulkOpen(false);
      setReplaceCalendarOpen(false);
    }
    setView(nextView);
  };

  const handleAddPayment = (payment: Payment, companyId?: string | null) => {
    dispatch({ type: "ADD_PAYMENT", payload: payment });
    if (companyId) {
      setCompanyByPayment((current) => new Map(current).set(payment.id, companyId));
      void savePaymentWithCompany(payment, companyId);
    }
  };

  const handleUpdatePayment = (payment: Payment, companyId: string | null) => {
    const previous = state.payments.find((item) => item.id === payment.id);
    const updates = previous && loanScheduleKey(previous) && previous.date !== payment.date
      ? rescheduleLoanInstallment(state.payments, previous, payment.date).map((part) => {
          if (part.id !== payment.id) return part;
          const originalDueMarker = part.comment?.match(/\[original-due:[^\]]+\]/)?.[0];
          const editedComment = payment.comment ?? "";
          return {
            ...part,
            ...payment,
            date: part.date,
            comment: originalDueMarker && !editedComment.includes("[original-due:")
              ? `${editedComment}${editedComment ? " " : ""}${originalDueMarker}`
              : editedComment,
          };
        })
      : [payment];
    for (const update of updates) dispatch({ type: "UPDATE_PAYMENT", payload: update });
    setCompanyByPayment((current) => {
      const next = new Map(current);
      for (const update of updates) next.set(update.id, update.id === payment.id ? companyId : current.get(update.id) ?? null);
      return next;
    });
    void Promise.all(updates.map(async (update) => {
      const linkedCompanyId = update.id === payment.id ? companyId : companyByPayment.get(update.id) ?? null;
      await updatePaymentCompany(update.id, linkedCompanyId);
      if (linkedCompanyId) await savePaymentWithCompany(update, linkedCompanyId);
    }));
  };

  const handleRescheduleOverdueLoan = async (installment: OverdueLoanInstallment, targetDate: string) => {
    const updates = rescheduleOverdueLoanInstallment(state.payments, installment, targetDate, today);
    if (!updates.length) throw new Error("Выберите сегодняшнюю или будущую дату.");
    await Promise.all(updates.map((payment) => {
      const companyId = companyByPayment.get(payment.id);
      return companyId ? savePaymentWithCompany(payment, companyId) : Promise.resolve();
    }));
    for (const payment of updates) dispatch({ type: "UPDATE_PAYMENT", payload: payment });
    setFactLinkError(null);
  };

  const handleRescheduleCriticalPayment = async (sourcePayment: Payment, targetDate: string) => {
    if (!targetDate || targetDate < today) throw new Error("Выберите сегодняшнюю или будущую дату.");
    const scheduleKey = loanScheduleKey(sourcePayment);
    const overdueInstallment = scheduleKey
      ? overdueLoanInstallments.find((installment) => installment.key === scheduleKey)
      : undefined;
    const updates = overdueInstallment
      ? rescheduleOverdueLoanInstallment(state.payments, overdueInstallment, targetDate, today)
      : scheduleKey
        ? rescheduleLoanInstallment(state.payments, sourcePayment, targetDate)
        : [{ ...sourcePayment, date: targetDate }];
    if (!updates.length) throw new Error("Не удалось подготовить платёж к переносу.");
    await Promise.all(updates.map((payment) => {
      const companyId = companyByPayment.get(payment.id);
      return companyId ? savePaymentWithCompany(payment, companyId) : Promise.resolve();
    }));
    for (const payment of updates) dispatch({ type: "UPDATE_PAYMENT", payload: payment });
    setFactLinkError(null);
  };

  const handleDeletePayment = (payment: Payment): boolean => {
    const scheduleKey = loanScheduleKey(payment);
    const paymentsToDelete = scheduleKey
      ? state.payments.filter((item) => loanScheduleKey(item) === scheduleKey)
      : [payment];
    const message = scheduleKey
      ? "Удалить весь платёж графика кредита, включая тело, проценты, пени и штрафы на эту дату?"
      : "Удалить этот платёж из календаря?";
    if (!window.confirm(`${message}\n\nДействие нельзя отменить.`)) return false;
    for (const item of paymentsToDelete) dispatch({ type: "DELETE_PAYMENT", payload: item.id });
    setCompanyByPayment((current) => {
      const next = new Map(current);
      for (const item of paymentsToDelete) next.delete(item.id);
      return next;
    });
    return true;
  };

  const confirmPlanFactMatch = async (planned: Payment, fact: Payment) => {
    const requestKey = `${planned.id}:${fact.id}`;
    if (confirmingFactLinkKey === requestKey) return;
    setConfirmingFactLinkKey(requestKey);
    setManualFactLinkError(null);
    setFactLinkNotice(null);
    try {
      const payment = await persistCalendarFactLink(planned.id, fact.id, "confirmed");
      dispatch({ type: "UPDATE_PAYMENT", payload: payment });
      setFactLinkError(null);
      setFactLinkNotice("Совпадение подтверждено: план отмечен как оплаченный.");
    } catch (error) {
      setManualFactLinkError({
        key: requestKey,
        message: error instanceof Error ? error.message : "Не удалось подтвердить совпадение",
      });
    } finally {
      setConfirmingFactLinkKey(null);
    }
  };

  const rejectPlanFactMatch = (planned: Payment, fact: Payment) => {
    if (!window.confirm("Отметить, что это не совпадение? Эта пара больше не будет предлагаться автоматически. Её можно вернуть из списка отклонённых совпадений ниже.")) return;
    dispatch({ type: "UPDATE_PAYMENT", payload: withRejectedCalendarFactMatch(planned, fact.id) });
    setManualFactLinkError(null);
    setFactLinkNotice("Пара исключена из проверки. План и факт остались без изменений.");
  };

  const restoreRejectedPlanFactMatch = (planned: Payment, fact: Payment) => {
    dispatch({ type: "UPDATE_PAYMENT", payload: withoutRejectedCalendarFactMatch(planned, fact.id) });
    setFactLinkNotice("Пара возвращена в проверку совпадений.");
  };

  const alignPaymentCompanyForMatch = async (payment: Payment, companyId: string, requestKey: string, paymentLabel: "плана" | "факта") => {
    if (aligningCompanyKey === requestKey) return;
    const companyName = companyById.get(companyId)?.name ?? "выбранную компанию";
    if (!window.confirm(`Назначить для ${paymentLabel} компанию «${companyName}»?\n\nПосле этого совпадение можно будет подтвердить.`)) return;
    setAligningCompanyKey(requestKey);
    setManualFactLinkError(null);
    try {
      await updatePaymentCompany(payment.id, companyId);
      setCompanyByPayment((current) => new Map(current).set(payment.id, companyId));
      setFactLinkNotice(`Компания ${paymentLabel} изменена на «${companyName}». Теперь проверьте и подтвердите совпадение.`);
    } catch (error) {
      setManualFactLinkError({
        key: requestKey,
        message: error instanceof Error ? error.message : "Не удалось изменить компанию платежа",
      });
    } finally {
      setAligningCompanyKey(null);
    }
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
            <button aria-label="Предыдущий месяц" onClick={prevMonth} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-white hover:shadow-sm"><ChevronLeft className="h-5 w-5" /></button>
            {/* Заголовок укладывается в ~110px, а min-w-40 отбирал у стрелок
                половину их ширины на узком экране — они сжимались до 32px. */}
            <h2 className="text-center font-semibold text-slate-900 sm:min-w-40">{MONTHS[month]} {year}</h2>
            <button aria-label="Следующий месяц" onClick={nextMonth} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-white hover:shadow-sm"><ChevronRight className="h-5 w-5" /></button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile icon={TrendingUp} label="План поступлений" value={plannedIncome} tone="emerald" />
        <SummaryTile icon={CircleDollarSign} label="План расходов" value={plannedExpense} tone="rose" />
        <SummaryTile icon={CheckCircle2} label="План совпал с фактом" value={planFactMatches.length} count tone="violet" onClick={() => setPlanFactOpen((open) => !open)} expanded={planFactOpen} />
        <SummaryTile icon={negativeDays > 0 ? TriangleAlert : Clock3} label="Дней с кассовым разрывом" value={negativeDays} count tone={negativeDays > 0 ? "amber" : "slate"} />
      </div>

      {!isForecastView && (
        <OverdueLoanQueue
          installments={overdueLoanInstallments}
          today={today}
          accounts={state.accounts}
          companies={companies}
          companyByPayment={companyByPayment}
          onReschedule={handleRescheduleOverdueLoan}
        />
      )}

      {planFactOpen && (
        <Card>
          <CardHeader>
            <div>
              <h2 className="font-semibold text-slate-950">Платежи, у которых план совпал с фактом</h2>
              <p className="mt-1 text-sm text-slate-500">
                {planFactPeriod
                  ? `Найдено ${planFactMatches.length} пар за период ${formatDate(planFactPeriod.from)} — ${formatDate(planFactPeriod.to)}.`
                  : "Совпадений пока нет."}
                {" "}Сравниваются плановые и фактические поступления и расходы. Переводы между собственными счетами исключены.
              </p>
            </div>
          </CardHeader>
          <CardContent>
            {planFactMatches.length > 0 && (
              <div className="scroll-x rounded-xl border border-slate-200">
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

      {planFactReview.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <h2 className="font-semibold text-slate-950">Нужно проверить совпадения плана и факта</h2>
              <p className="mt-1 text-sm text-slate-500">Сумма, дата или реквизиты отличаются. Подтвердите только правильные пары — после этого план будет считаться оплаченным.</p>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {planFactReview.map((match) => (
                <div key={`${match.planned.id}-${match.fact.id}`} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  {(() => {
                    const requestKey = `${match.planned.id}:${match.fact.id}`;
                    const confirming = confirmingFactLinkKey === requestKey;
                    const aligningCompany = aligningCompanyKey === requestKey;
                    const error = manualFactLinkError?.key === requestKey ? manualFactLinkError.message : null;
                    const plannedCompanyId = companyByPayment.get(match.planned.id) ?? match.planned.companyId ?? null;
                    const factCompanyId = companyByPayment.get(match.fact.id) ?? match.fact.companyId ?? null;
                    const plannedCompanyName = plannedCompanyId ? companyById.get(plannedCompanyId)?.name ?? "неизвестная компания" : "не назначена";
                    const factCompanyName = factCompanyId ? companyById.get(factCompanyId)?.name ?? "неизвестная компания" : "не назначена";
                    const companiesDiffer = !plannedCompanyId || !factCompanyId || plannedCompanyId !== factCompanyId;
                    return <>
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="grid min-w-0 flex-1 gap-2 text-sm sm:grid-cols-4">
                          <div><span className="block text-xs text-slate-500">План</span><b>{formatDate(match.planned.date)} · {formatMoney(match.planned.amount)}</b></div>
                          <div><span className="block text-xs text-slate-500">Факт</span><b>{formatDate(match.fact.date)} · {formatMoney(match.fact.amount)}</b></div>
                          <div className="sm:col-span-2"><span className="block text-xs text-slate-500">Платёж</span><span className="break-words">{match.fact.name || match.fact.counterparty}</span></div>
                        </div>
                        {!companiesDiffer && <button
                          type="button"
                          onClick={() => void confirmPlanFactMatch(match.planned, match.fact)}
                          disabled={confirming}
                          aria-busy={confirming}
                          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-wait disabled:opacity-70"
                        >
                          {confirming && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                          {confirming ? "Подтверждаем…" : "Подтвердить совпадение"}
                        </button>}
                        {!companiesDiffer && <button
                          type="button"
                          onClick={() => rejectPlanFactMatch(match.planned, match.fact)}
                          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Не совпадает
                        </button>}
                      </div>
                      {companiesDiffer && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-900">
                        <p><b>Совпадение пока нельзя подтвердить:</b> у плана — «{plannedCompanyName}», у факта — «{factCompanyName}».</p>
                        <p className="mt-1 text-rose-800">Выберите, у какой операции компания определена неверно. Данные платежа и сумма не изменятся.</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {factCompanyId && <button type="button" onClick={() => void alignPaymentCompanyForMatch(match.planned, factCompanyId, requestKey, "плана")} disabled={aligningCompany} className="min-h-11 rounded-lg border border-rose-300 bg-white px-3 text-sm font-semibold text-rose-800 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-70">У плана должна быть «{factCompanyName}»</button>}
                          {plannedCompanyId && <button type="button" onClick={() => void alignPaymentCompanyForMatch(match.fact, plannedCompanyId, requestKey, "факта")} disabled={aligningCompany} className="min-h-11 rounded-lg border border-rose-300 bg-white px-3 text-sm font-semibold text-rose-800 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-70">У факта должна быть «{plannedCompanyName}»</button>}
                          {(!plannedCompanyId || !factCompanyId) && <button type="button" onClick={() => { setSelectedDate(plannedCompanyId ? match.fact.date : match.planned.date); setQuickAddPending(false); }} className="min-h-11 rounded-lg border border-rose-300 bg-white px-3 text-sm font-semibold text-rose-800 hover:bg-rose-100">Открыть операцию и выбрать компанию</button>}
                        </div>
                      </div>}
                      {error && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
                    </>;
                  })()}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {rejectedPlanFactLinks.length > 0 && <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">Отклонённые совпадения ({rejectedPlanFactLinks.length})</summary>
        <p className="mt-2 text-sm text-slate-500">Эти пары не предлагаются автоматически. При необходимости их можно вернуть в проверку.</p>
        <div className="mt-3 space-y-2">
          {rejectedPlanFactLinks.map(({ planned, fact }) => <div key={`${planned.id}-${fact.id}`} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span><b>План:</b> {formatDate(planned.date)} · {formatMoney(planned.amount)} <span className="text-slate-400">↔</span> <b>Факт:</b> {formatDate(fact.date)} · {formatMoney(fact.amount)}</span>
            <button type="button" onClick={() => restoreRejectedPlanFactMatch(planned, fact)} className="min-h-11 shrink-0 rounded-lg border border-violet-300 bg-white px-3 font-semibold text-violet-700 hover:bg-violet-50">Вернуть в проверку</button>
          </div>)}
        </div>
      </details>}

      {factLinkNotice && (
        <div role="status" aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {factLinkNotice}
        </div>
      )}

      {factLinkError && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {factLinkError}
        </div>
      )}
      {scheduleLinksError && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Не удалось проверить платежи, уже привязанные к кредитам: {scheduleLinksError}. Сопоставление плана с фактом временно выключено.
        </div>
      )}

      {!isForecastView && <details className="rounded-xl border border-violet-200 bg-violet-50/60 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-violet-950">Корректировка календаря текстом</summary>
        <p className="mt-2 text-sm text-slate-600">Напишите фразой или вставьте список из таблицы. Понимаю даты с годом и без: «01.10.2026» и «1 октября». Система покажет найденные строки и не изменит календарь без подтверждения.</p>
        <textarea value={textCorrection} onChange={(event) => { setTextCorrection(event.target.value); setTextCorrectionPreview(null); setTextCorrectionError(null); }} placeholder="Например: «перенеси платёж 50 000 ₽ с 05.10.2026 на 12.10.2026» или вставьте: 1 октября | Погашение процентов | 36 000 ₽" className="mt-3 min-h-24 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm" />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => { const result = recognizeCalendarCorrection(textCorrection, state.payments, currentDate.getFullYear()); setTextCorrectionPreview(result.correction ?? null); setTextCorrectionError(result.error ?? null); }} className="min-h-11 rounded-lg border border-violet-300 bg-white px-4 text-sm font-semibold text-violet-700 hover:bg-violet-100">Распознать</button>
          {textCorrectionPreview && (textCorrectionPreview.updates.length > 0 || textCorrectionPreview.additions.length > 0) && <button type="button" onClick={() => {
            const companyId = companyByPayment.get(textCorrectionPreview.payment.id) ?? textCorrectionPreview.payment.companyId ?? null;
            for (const payment of textCorrectionPreview.updates) handleUpdatePayment(payment, companyId);
            for (const payment of textCorrectionPreview.additions) handleAddPayment(payment, companyId);
            setTextCorrection("");
            setTextCorrectionPreview(null);
          }} className="min-h-11 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700">Подтвердить изменение</button>}
        </div>
        {textCorrectionPreview && <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{textCorrectionPreview.summary}</p>}
        {textCorrectionError && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{textCorrectionError}</p>}
      </details>}

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1">
          {([
            ["calendar", "Календарь", CalendarDays],
            ["expense", "Все расходы", ArrowUpRight],
            ["income", "Все поступления", ArrowDownLeft],
            ["forecast", "Прогноз WB", TrendingUp],
            ["ozon-forecast", "Прогноз Ozon", TrendingUp],
          ] as const).map(([value, label, Icon]) => (
            <button key={value} onClick={() => handleViewChange(value)} className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${view === value ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        {!isForecastView && (
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
        )}
      </div>

      {view !== "forecast" && view !== "ozon-forecast" && <div className="rounded-xl border border-slate-200 bg-white p-3">
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
      </div>}

      {view !== "forecast" && view !== "ozon-forecast" && (
        <FinancialAlertsPanel
          accounts={state.accounts}
          payments={scopedPayments}
          today={today}
          onReschedulePayment={handleRescheduleCriticalPayment}
        />
      )}
      {!isForecastView && <FinanceTasksPanel />}

      <div id="calendar-main-content" className="scroll-mt-4">
      {view === "forecast" ? (
        <SalesForecastPanel key={`${year}-${month}`} year={year} month={month} accounts={state.accounts} companies={companies} payments={state.payments} companyByPayment={companyByPayment} />
      ) : view === "ozon-forecast" ? (
        <OzonForecastPanel key={`ozon-${year}-${month}`} year={year} month={month} accounts={state.accounts} companies={companies} />
      ) : view === "calendar" ? <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Денежный поток по дням</h2>
              <p className="mt-1 text-sm text-slate-500">Календарь по дням: суммы, статьи расходов и ожидаемый остаток.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)} className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${hasCalendarFilters ? "border-violet-300 bg-violet-50 text-violet-800" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}><SlidersHorizontal className="h-4 w-4" /> Фильтры{activeCalendarFilterCount > 0 && <span className="rounded-full bg-violet-600 px-2 py-0.5 text-xs text-white">{activeCalendarFilterCount}</span>}<ChevronDown className={`h-4 w-4 transition-transform ${filtersOpen ? "rotate-180" : ""}`} /></button>
            <div className="flex rounded-lg bg-slate-100 p-1">
              <button onClick={() => chooseLayout("grid")} className={`inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold ${calendarLayout === "grid" ? "bg-white text-violet-700 shadow-sm" : "text-slate-600"}`}><LayoutGrid className="h-4 w-4" /> Календарь</button>
              <button onClick={() => chooseLayout("agenda")} className={`inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold ${calendarLayout === "agenda" ? "bg-white text-violet-700 shadow-sm" : "text-slate-600"}`}><List className="h-4 w-4" /> Список</button>
            </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filtersOpen && <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="grid gap-2 md:grid-cols-[minmax(260px,1fr)_180px_170px_170px_auto]">
              <label className="relative"><span className="sr-only">Поиск в платёжном календаре</span><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Поиск по слову, сумме, статье, компании…" className="min-h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" /></label>
              <select value={flowScope} onChange={(event) => setFlowScope(event.target.value as typeof flowScope)} aria-label="Фильтр по типу платежа" className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="all">Все операции</option><option value="expense">Только расходы</option><option value="income">Только поступления</option></select>
              <label className="text-xs font-medium text-slate-600">С даты<input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm" /></label>
              <label className="text-xs font-medium text-slate-600">По дату<input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm" /></label>
              <button type="button" disabled={!hasCalendarFilters} onClick={() => { setSearchQuery(""); setFlowScope("all"); setDateFrom(""); setDateTo(""); }} className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"><X className="h-4 w-4" /> Сбросить</button>
            </div>
            <p className="mt-2 text-xs text-slate-500">Найдено операций: {visibleCalendarPayments.filter((payment) => payment.status !== "cancelled").length}</p>
            {hasCalendarFilters && <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white">{searchResults.length === 0 ? <p className="p-5 text-center text-sm text-slate-500">По заданным условиям ничего не найдено.</p> : searchResults.map((payment) => { const companyId = companyByPayment.get(payment.id); return <button key={payment.id} type="button" onClick={() => { setCurrentDate(new Date(`${payment.date}T00:00:00`)); setSelectedDate(payment.date); setQuickAddPending(false); setView("calendar"); }} className="grid min-h-14 w-full gap-1 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-violet-50 sm:grid-cols-[110px_130px_1fr_220px] sm:items-center"><span className="font-medium text-slate-700">{formatDate(payment.date)}</span><span className={`font-bold tabular-nums ${payment.amount < 0 ? "text-rose-700" : "text-emerald-700"}`}>{formatMoney(payment.amount)}</span><span className="min-w-0"><span className="block font-medium text-slate-900">{payment.category || "Без статьи"}</span><span className="block truncate text-xs text-slate-500">{payment.name || displayPaymentComment(payment.comment) || "Без назначения"}</span></span><span className="text-xs text-slate-500">{companyId ? companyById.get(companyId)?.name ?? "Неизвестная компания" : "Компания не назначена"}</span></button>; })}{visibleCalendarPayments.filter((payment) => payment.status !== "cancelled").length > 50 && <p className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">Показаны первые 50 операций. Уточните поиск или период.</p>}</div>}
          </div>}
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
          {/* Ниже 900px семь колонок перестают вмещать содержимое ячейки,
              поэтому сетка едет вбок ВНУТРИ своего блока, а не сжимается.
              Страница при этом вбок не едет. */}
          <div className="scroll-x w-full pb-2">
          <div className="w-full min-w-[860px] md:min-w-0">
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
                <WeekSummaryCell referenceDate={week.referenceDate} accounts={state.accounts} allPayments={state.payments} payments={visibleCalendarPayments} />
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

      {!isForecastView && (
      <DayDetailPanel
        dayInfo={selectedDay}
        allPayments={visibleCalendarPayments}
        accounts={state.accounts}
        companies={companies}
        companyByPayment={companyByPayment}
        onClose={handleClosePanel}
        onAddPayment={handleAddPayment}
        onUpdatePayment={handleUpdatePayment}
        onDeletePayment={handleDeletePayment}
        quickAddOpen={quickAddPending}
        onQuickAddConsumed={() => setQuickAddPending(false)}
      />
      )}
      {!isForecastView && (
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
      )}
      {/* Период нужен разбору сетки: без него даты из файла не к чему привязать.
          Он был по ошибке отдан DayDetailPanel, который о нём не знает вовсе. */}
      {!isForecastView && (
      <ReplaceCalendarModal
        open={replaceCalendarOpen}
        onClose={() => setReplaceCalendarOpen(false)}
        accounts={state.accounts}
        companies={companies}
        calendarPeriod={{ year, month: month + 1 }}
        countExisting={(imported, companyId, scope) => plannedPaymentsToReplace(state.payments, companyByPayment, { companyId, scope, months: importedMonths(imported) }).length}
        onReplace={async (payments, companyId, scope) => {
          // Удаляются планы только тех месяцев, что есть в файле, — по той же функции, что считала число в подтверждении.
          const oldPlanIds = plannedPaymentsToReplace(state.payments, companyByPayment, { companyId, scope, months: importedMonths(payments) }).map((payment) => payment.id);
          for (const paymentId of oldPlanIds) dispatch({ type: "DELETE_PAYMENT", payload: paymentId });
          const existingFacts = state.payments.filter((payment) => payment.status === "done");
          const normalized = (value: string) => value.toLowerCase().replace(/[^а-яa-z0-9]+/gi, "");
          const safePayments = payments.filter((payment) => matchesReplaceScope(payment, scope)).filter((payment) => payment.status !== "done" || !existingFacts.some((fact) =>
            fact.date === payment.date &&
            Math.abs(fact.amount - payment.amount) < 0.01 &&
            normalized(fact.name) === normalized(payment.name),
          ));
          for (const payment of safePayments) dispatch({ type: "ADD_PAYMENT", payload: payment });
          if (companyId) await Promise.all(safePayments.map((payment) => savePaymentWithCompany(payment, companyId)));
          setCompanyByPayment((current) => new Map([...current, ...safePayments.map((payment) => [payment.id, companyId] as const)]));
        }}
      />
      )}
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
    .filter((payment) => payment.status !== "cancelled" && !isTechnicalTransfer(payment) && (flow === "income" ? payment.amount > 0 : payment.amount < 0))
    .sort(chronologicalPaymentOrder);
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
          <button onClick={onCloseList} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 lg:min-h-10">
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
      {/* Реестр читают записью за записью, поэтому ниже 768px таблица
          рассыпается в карточки (`.table-cards`): подпись колонки берётся из
          data-label, и десять значений перестают наползать друг на друга.
          На планшете колонок всё ещё десять — там таблица едет вбок внутри
          своего блока вместо того, чтобы обрезаться, как было. */}
      <div className="table-cards scroll-x px-3 pb-3 md:px-0 md:pb-0">
        <table className="w-full table-fixed text-xs md:min-w-[900px] lg:min-w-0 xl:text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr>
            <th className="w-[6%] px-2 py-3 font-medium">Приор.</th><th className="w-[8%] px-2 py-3 font-medium">Дата</th><th className="w-[10%] px-2 py-3 text-right font-medium">Сумма</th><th className="w-[13%] px-2 py-3 font-medium">Название</th><th className="w-[19%] px-2 py-3 font-medium">Назначение платежа</th><th className="w-[13%] px-2 py-3 font-medium">Комментарий</th><th className="w-[10%] px-2 py-3 font-medium">Компания</th><th className="w-[9%] px-2 py-3 font-medium">Кошелёк</th><th className="w-[7%] px-2 py-3 font-medium">Статус</th><th className="w-[5%] px-1 py-3 text-center font-medium"></th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? <tr><td colSpan={10} className="px-5 py-10 text-center text-slate-500">Операций нет</td></tr> : rows.map((payment) => {
              const companyId = companyByPayment.get(payment.id);
              const priority = getPaymentPriority(payment);
              return <tr key={payment.id} onClick={() => onEdit(payment)} className="cursor-pointer hover:bg-slate-50">
                <td data-label="Приоритет" className="px-2 py-3"><span className={`inline-flex rounded-md border px-1.5 py-1 text-xs font-bold ${PRIORITY_META[priority].badge}`}>{priority}</span></td>
                <td data-label="Дата" className="px-2 py-3">{formatDate(payment.date)}</td>
                <td data-label="Сумма" className={`px-2 py-3 text-right font-semibold tabular-nums ${flow === "income" ? "text-emerald-700" : "text-rose-700"}`}>{formatMoney(payment.amount)}</td>
                <td data-cell="title" className="break-words px-2 py-3 font-medium text-slate-900">{payment.category}</td>
                <td data-label="Назначение платежа" className="break-words px-2 py-3 text-slate-700">{payment.name}</td>
                <td data-label="Комментарий" className="break-words px-2 py-3 text-slate-500">{displayPaymentComment(payment.comment) || "—"}</td>
                <td data-label="Компания" className="break-words px-2 py-3 text-slate-600">{companyId ? companyNames.get(companyId) ?? "Неизвестная" : "Не назначена"}</td>
                <td data-label="Кошелёк" className="break-words px-2 py-3 text-slate-600">{accountNames.get(payment.accountId) ?? "—"}</td>
                <td data-label="Статус" className="px-2 py-3"><span className={`inline-flex rounded-full px-1.5 py-1 text-[10px] font-medium ${payment.status === "done" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{payment.status === "done" ? "Факт" : "План"}</span></td>
                <td data-cell="actions" className="px-1 py-3 text-center"><button aria-label="Изменить платёж" title="Изменить" onClick={(event) => { event.stopPropagation(); onEdit(payment); }} className="tap-hit min-h-11 min-w-11 rounded-lg px-2 text-lg font-semibold text-violet-700 hover:bg-violet-50 md:min-h-9 md:min-w-0">⋯</button></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
