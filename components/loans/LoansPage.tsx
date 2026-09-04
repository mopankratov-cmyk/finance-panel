"use client";

import { AlertTriangle, CalendarClock, ChevronRight, Download, ExternalLink, FileText, Pencil, Plus, RefreshCw, Sparkles, Trash2, WalletCards, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoanForm, type LoanFormResult, type LoanScheduleDraft } from "./LoanForm";
import { deleteLoanDocument, downloadLoanDocument, listLoanDocuments, openListedLoanDocument, saveLoanDocument, type LoanDocumentInfo } from "./loanDocuments";
import { useFinance } from "@/components/providers/FinanceProvider";
import { loadDdsCompanies, loadPaymentCompanyLinks, savePaymentWithCompany, updatePaymentCompany, type DdsCompany } from "@/components/payments/ddsCompanies";
import { downloadSimpleXlsx } from "@/components/payments/ddsExport";
import { Card, CardContent } from "@/components/ui/Card";
import { LOAN_CATEGORIES } from "@/lib/finance/categories";
import { consumedFactIds } from "@/lib/finance/factLinks";
import { formatDate, formatMoney, generateId, todayISO } from "@/lib/format";
import type { Loan, Payment } from "@/lib/types";
import { originalLoanPaymentAmount, roundLoanMoney } from "@/lib/opiu/loanCurrency";
import { useDailyLoanCurrencyRefresh } from "./currencyRefresh";
import { closeLoanScheduleRows, closeLoanScheduleRowWithWb, loadLoanScheduleRows, saveLoanScheduleRows } from "./scheduleStore";
import { loadFinanceState } from "@/lib/db";
import { scheduleDraftFromRows, type ScheduleRowRecord } from "@/lib/loans/scheduleRows";
import { actualLoanBalance, buildMonthlyLoanSummary, projectedLoanBalances } from "@/lib/loans/portfolioSummary";

type SummaryKey = "outstanding" | "interest" | "next30" | "overdue" | "active";

type MarketplaceFact = {
  source: string; cabinetId: string; rrdId: string; date: string; amountRub: number; contractNumber: string | null;
  kind: "principal" | "interest" | "penalty" | "fine" | "fee" | "unknown"; reason: string;
  loanId: string | null; loanName: string | null; scheduleRowId: string | null; state: "recorded" | "ready" | "review" | "unassigned";
};

async function loadMarketplaceFacts(): Promise<MarketplaceFact[]> {
  const response = await fetch("/api/finance/loans/marketplace-facts", { cache: "no-store" });
  const body = await response.json().catch(() => ({})) as { facts?: MarketplaceFact[]; error?: string };
  if (!response.ok) throw new Error(body.error || "Не удалось прочитать удержания WB");
  return body.facts ?? [];
}

const marker = (loanId: string) => `[loan:${loanId}:`;
const receiptMarker = (loanId: string) => `[loan:${loanId}:receipt]`;
const scheduleMarker = (loanId: string, rowId: string, kind: "principal" | "interest" | "penalty" | "fine") => `[loan:${loanId}:schedule:${rowId}:${kind}]`;

function commentValue(comment: string | undefined, key: string): string {
  return comment?.match(new RegExp(`\\[${key}:([^\\]]*)\\]`))?.[1] ?? "";
}

function linkedRows(payments: Payment[], loanId: string) {
  return payments.filter((payment) => payment.comment?.includes(marker(loanId)));
}

function scheduleFromPayments(payments: Payment[], loanId: string): LoanScheduleDraft[] {
  const grouped = new Map<string, LoanScheduleDraft>();
  for (const payment of linkedRows(payments, loanId)) {
    const match = payment.comment?.match(/\[loan:[^:]+:schedule:([^:]+):(principal|interest|penalty|fine)\]/);
    if (!match) continue;
    const [, rowId, kind] = match;
    const current = grouped.get(rowId) ?? { id: rowId, date: payment.date, principal: 0, interest: 0, penalty: 0, fine: 0, principalOriginal: 0, interestOriginal: 0, penaltyOriginal: 0, fineOriginal: 0, status: payment.status };
    current[kind as "principal" | "interest" | "penalty" | "fine"] = Math.abs(payment.amount);
    const savedRate = Number(commentValue(payment.comment, "fx-rate")) || 1;
    current[`${kind}Original` as "principalOriginal" | "interestOriginal" | "penaltyOriginal" | "fineOriginal"] = originalLoanPaymentAmount(payment, savedRate);
    if (payment.status === "done" || commentValue(payment.comment, "paid-by")) current.status = "done";
    grouped.set(rowId, current);
  }
  return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function contractName(payments: Payment[], loanId: string): string {
  return linkedRows(payments, loanId).map((payment) => commentValue(payment.comment, "contract")).find(Boolean) ?? "";
}

function contractNumber(payments: Payment[], loanId: string): string {
  return linkedRows(payments, loanId).map((payment) => commentValue(payment.comment, "contract-number")).find(Boolean) ?? "";
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function firstLoanComment(payments: Payment[], loanId: string) {
  return linkedRows(payments, loanId)[0]?.comment;
}

function metadataNumber(payments: Payment[], loanId: string, key: string, fallback = 0) {
  const value = Number(commentValue(firstLoanComment(payments, loanId), key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function metadataDisbursements(payments: Payment[], loanId: string) {
  return commentValue(firstLoanComment(payments, loanId), "tranches").split(";").flatMap((item) => {
    const [date, rawAmount] = item.split("=");
    const amount = Number(rawAmount);
    return /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") && Number.isFinite(amount) && amount > 0 ? [{ date, amount }] : [];
  });
}

function metadataPaymentDays(payments: Payment[], loanId: string): [number, number] | undefined {
  const values = commentValue(firstLoanComment(payments, loanId), "payment-days").split(",").map(Number);
  return values.length === 2 && values.every((value) => Number.isInteger(value) && value >= 1 && value <= 31)
    ? [values[0], values[1]]
    : undefined;
}

function monthCountInPeriod(startDate: string, months: number, periodStart: string, periodEnd: string) {
  if (!startDate || months <= 0) return 0;
  const startMonth = new Date(`${startDate.slice(0, 7)}-01T12:00:00`);
  let count = 0;
  for (let index = 0; index < months; index++) {
    const month = new Date(startMonth);
    month.setMonth(month.getMonth() + index);
    const iso = month.toISOString().slice(0, 7);
    if (`${iso}-01` <= periodEnd && `${iso}-31` >= periodStart) count++;
  }
  return count;
}

function daysBetween(left: string, right: string) {
  return Math.abs(new Date(`${left}T12:00:00`).getTime() - new Date(`${right}T12:00:00`).getTime()) / 86_400_000;
}

function paymentMatchesCreditor(payment: Payment, creditor: string) {
  const haystack = `${payment.name} ${payment.counterparty} ${payment.comment ?? ""}`.toLowerCase().replace(/[^a-zа-яё0-9]+/g, " ");
  const contractNumber = creditor.match(/\d{4,}(?:-\d+)?/)?.[0];
  if (contractNumber && haystack.includes(contractNumber.toLowerCase())) return true;
  const significant = creditor.toLowerCase().split(/[^a-zа-яё0-9]+/).filter((word) => word.length >= 5 && !/^\d+$/.test(word));
  return significant.some((word) => haystack.includes(word));
}

function exportRows(loans: Loan[], payments: Payment[], companies: DdsCompany[], companyByPayment: Map<string, string | null>) {
  const companyNames = new Map(companies.map((company) => [company.id, company.name]));
  const header: Array<string | number> = ["Компания", "Кредитор", "Дата платежа", "Валюта", "Тело в валюте", "Проценты в валюте", "Тело, ₽", "Проценты, ₽", "Всего, ₽", "Статус", "Остаток тела, ₽", "Договор"];
  const rows: Array<Array<string | number>> = [header];
  for (const loan of loans) {
    const schedule = scheduleFromPayments(payments, loan.id);
    const firstLinked = linkedRows(payments, loan.id)[0];
    const company = companyNames.get(companyByPayment.get(firstLinked?.id) ?? "") ?? "Не назначена";
    const currency = commentValue(firstLinked?.comment, "currency") || "RUB";
    let balance = loan.principalAmount;
    for (const item of schedule) {
      balance = Math.max(0, balance - item.principal);
      rows.push([company, loan.creditorName, item.date, currency, item.principalOriginal ?? item.principal, (item.interestOriginal ?? item.interest) + (item.penaltyOriginal ?? item.penalty) + (item.fineOriginal ?? item.fine), item.principal, item.interest + item.penalty + item.fine, item.principal + item.interest + item.penalty + item.fine, item.status === "done" ? "Оплачено" : item.status === "cancelled" ? "Отменено" : "План", balance, contractName(payments, loan.id)]);
    }
  }
  return rows;
}

function exportRowIds(loans: Loan[], payments: Payment[]) {
  return loans.flatMap((loan) => scheduleFromPayments(payments, loan.id).map(() => loan.id));
}

export function LoansPage() {
  const { state, dispatch } = useFinance();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [details, setDetails] = useState<Loan | null>(null);
  const [companies, setCompanies] = useState<DdsCompany[]>([]);
  const [companyByPayment, setCompanyByPayment] = useState<Map<string, string | null>>(new Map());
  const [companyScope, setCompanyScope] = useState<Set<string>>(new Set());
  const [periodMode, setPeriodMode] = useState<"months" | "year">("months");
  const [monthFrom, setMonthFrom] = useState(todayISO().slice(0, 7));
  const [monthTo, setMonthTo] = useState(todayISO().slice(0, 7));
  const [periodYear, setPeriodYear] = useState(todayISO().slice(0, 4));
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedSummary, setExpandedSummary] = useState<SummaryKey | null>(null);
  // Строки графиков из loan_schedule_rows; пока их нет (до миграции или у старых
  // договоров) — график читается по меткам платежей, как раньше.
  const [scheduleRows, setScheduleRows] = useState<ScheduleRowRecord[]>([]);
  const [marketplaceFacts, setMarketplaceFacts] = useState<MarketplaceFact[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const reconciledRef = useRef(false);
  const contractNumberBackfillRef = useRef(false);
  const today = todayISO();
  const next30Date = addDays(today, 30);

  useEffect(() => {
    Promise.all([loadDdsCompanies(), loadPaymentCompanyLinks()]).then(([loadedCompanies, links]) => {
      setCompanies(loadedCompanies);
      setCompanyByPayment(new Map(links.map((link) => [link.paymentId, link.companyId])));
    });
    loadLoanScheduleRows().then((result) => setScheduleRows(result.rows)).catch(() => setScheduleRows([]));
    loadMarketplaceFacts().then(setMarketplaceFacts).catch(() => setMarketplaceFacts([]));
  }, []);

  useDailyLoanCurrencyRefresh(state.payments, dispatch, (error) => {
    console.error("Не удалось обновить валютный график кредитов", error);
  });

  const loanCompany = (loanId: string) => {
    const linked = linkedRows(state.payments, loanId);
    return linked.map((payment) => companyByPayment.get(payment.id)).find(Boolean) ?? null;
  };
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredLoans = state.loans.filter((loan) => {
    if (companyScope.size > 0 && !companyScope.has(loanCompany(loan.id) ?? "")) return false;
    if (!normalizedSearch) return true;
    const company = companies.find((item) => item.id === loanCompany(loan.id))?.name ?? "";
    return `${loan.creditorName} ${company} ${contractNumber(state.payments, loan.id)}`.toLowerCase().includes(normalizedSearch);
  });
  const schedules = useMemo(() => new Map(state.loans.map((loan) => {
    const rows = scheduleRows.filter((row) => row.loanId === loan.id);
    return [loan.id, rows.length ? scheduleDraftFromRows(rows) : scheduleFromPayments(state.payments, loan.id)];
  })), [state.loans, state.payments, scheduleRows]);
  const loanBalances = new Map(filteredLoans.map((loan) => [loan.id, actualLoanBalance(loan.principalAmount, schedules.get(loan.id) ?? [], today)]));
  const outstanding = [...loanBalances.values()].reduce((sum, value) => sum + value, 0);
  const next30 = filteredLoans.flatMap((loan) => (schedules.get(loan.id) ?? []).map((row) => ({ loan, row })))
    .filter(({ row }) => row.status === "planned" && row.date >= today && row.date <= next30Date);
  const overdue = filteredLoans.flatMap((loan) => (schedules.get(loan.id) ?? []).map((row) => ({ loan, row })))
    .filter(({ row }) => row.status === "planned" && row.date < today);
  const periodStart = periodMode === "year" ? `${periodYear}-01-01` : `${monthFrom}-01`;
  const periodEnd = periodMode === "year"
    ? `${periodYear}-12-31`
    : `${monthTo}-${String(new Date(Number(monthTo.slice(0, 4)), Number(monthTo.slice(5, 7)), 0).getDate()).padStart(2, "0")}`;
  const periodSchedule = filteredLoans.flatMap((loan) => (schedules.get(loan.id) ?? []).map((row) => ({ loan, row })))
    .filter(({ row }) => row.status !== "cancelled" && row.date >= periodStart && row.date <= periodEnd);
  const periodInterest = periodSchedule.reduce((sum, item) => sum + item.row.interest + item.row.penalty + item.row.fine, 0);
  const periodFees = filteredLoans.reduce((sum, loan) => {
    const fee = metadataNumber(state.payments, loan.id, "origination-fee");
    const months = metadataNumber(state.payments, loan.id, "fee-months", 36);
    return sum + (months ? fee / months * monthCountInPeriod(loan.startDate, months, periodStart, periodEnd) : 0);
  }, 0);
  const monthlySummary = buildMonthlyLoanSummary(filteredLoans, schedules, periodStart, periodEnd);
  const rowsForExport = exportRows(filteredLoans, state.payments, companies, companyByPayment);
  const rowIdsForExport = exportRowIds(filteredLoans, state.payments);

  const reconcileWithDds = useCallback(async (showResult = true) => {
    // Факт, уже закрывший план календаря или другую строку графика, второй раз не используется.
    const consumed = consumedFactIds(state.payments);
    const actualPayments = state.payments.filter((payment) => payment.status === "done" && payment.amount < 0 && !payment.comment?.includes("[loan:") && !consumed.has(payment.id));
    const usedActual = new Set<string>();
    let matched = 0;
    let closedViaRows = 0;
    for (const loan of state.loans) {
      const rowsOfLoan = scheduleRows.filter((row) => row.loanId === loan.id);
      if (rowsOfLoan.length) {
        // Строки графика: сверяем по датам, закрываем все части даты одним фактом через роут (I1, I2 — на сервере).
        const expectedCompany = linkedRows(state.payments, loan.id).map((payment) => companyByPayment.get(payment.id)).find(Boolean) ?? null;
        if (!expectedCompany) continue;
        const byDate = new Map<string, typeof rowsOfLoan>();
        for (const row of rowsOfLoan) if (row.status === "planned") byDate.set(row.dueDate, [...(byDate.get(row.dueDate) ?? []), row]);
        for (const [dueDate, parts] of byDate) {
          const total = parts.reduce((sum, row) => sum + row.amountRub, 0);
          const candidates = actualPayments
            .filter((payment) => !usedActual.has(payment.id) && paymentMatchesCreditor(payment, loan.creditorName))
            .filter((payment) => companyByPayment.get(payment.id) === expectedCompany)
            .map((payment) => ({ payment, delta: Math.abs(Math.abs(payment.amount) - total), days: daysBetween(payment.date, dueDate) }))
            .filter((candidate) => candidate.days <= 14 && candidate.delta <= Math.max(1, total * 0.005))
            .sort((a, b) => a.delta - b.delta || a.days - b.days);
          const best = candidates[0];
          const second = candidates[1];
          const actual = best && (!second || best.delta !== second.delta || best.days !== second.days) ? best.payment : undefined;
          if (!actual) continue;
          try {
            await closeLoanScheduleRows(parts.map((row) => row.id), actual.id);
            usedActual.add(actual.id);
            closedViaRows++;
            matched++;
          } catch (error) {
            console.error("Не удалось закрыть строку графика фактом", error);
          }
        }
        continue;
      }
      const loanRows = scheduleFromPayments(state.payments, loan.id).filter((row) => row.status === "planned");
      for (const row of loanRows) {
        const total = row.principal + row.interest + row.penalty + row.fine;
        const expectedCompany = linkedRows(state.payments, loan.id)
          .map((payment) => companyByPayment.get(payment.id))
          .find(Boolean) ?? null;
        if (!expectedCompany) continue;
        const candidates = actualPayments
          .filter((payment) => !usedActual.has(payment.id) && paymentMatchesCreditor(payment, loan.creditorName))
          .filter((payment) => !expectedCompany || companyByPayment.get(payment.id) === expectedCompany)
          .map((payment) => ({ payment, delta: Math.abs(Math.abs(payment.amount) - total), days: daysBetween(payment.date, row.date) }))
          .filter((candidate) => candidate.days <= 14 && candidate.delta <= Math.max(1, total * 0.005))
          .sort((a, b) => a.delta - b.delta || a.days - b.days);
        const best = candidates[0];
        const second = candidates[1];
        const actual = best && (!second || best.delta !== second.delta || best.days !== second.days) ? best.payment : undefined;
        if (!actual) continue;
        const markerPart = `:schedule:${row.id}:`;
        const updates = linkedRows(state.payments, loan.id)
          .filter((payment) => payment.comment?.includes(markerPart))
          .map((linked) => ({
            ...linked,
            status: "cancelled" as const,
            comment: `${linked.comment ?? ""} [paid-by:${actual.id}]`,
          }));
        await Promise.all(updates.map((payment) => savePaymentWithCompany(payment, expectedCompany)));
        for (const payment of updates) {
          dispatch({
            type: "UPDATE_PAYMENT",
            payload: payment,
          });
        }
        usedActual.add(actual.id);
        matched++;
      }
    }
    if (closedViaRows) {
      const [fresh, schedule] = await Promise.all([loadFinanceState(), loadLoanScheduleRows()]);
      dispatch({ type: "LOAD", payload: fresh });
      setScheduleRows(schedule.rows);
    }
    if (showResult) alert(matched ? `Сверка завершена: ${matched} платежей по графикам найдены в ДДС и отмечены оплаченными.` : "Новых совпадений с фактическими платежами ДДС не найдено.");
  }, [companyByPayment, dispatch, scheduleRows, state.loans, state.payments]);

  const reconcileWithWb = useCallback(async () => {
    setMarketplaceLoading(true);
    try {
      const facts = await loadMarketplaceFacts();
      const ready = facts.filter((fact) => fact.state === "ready" && fact.scheduleRowId);
      let closed = 0;
      for (const fact of ready) {
        try {
          await closeLoanScheduleRowWithWb(fact.scheduleRowId!, fact.cabinetId, fact.rrdId);
          closed++;
        } catch (error) {
          console.error("Не удалось закрыть строку удержанием WB", error);
        }
      }
      const [freshFacts, fresh, schedule] = await Promise.all([loadMarketplaceFacts(), loadFinanceState(), loadLoanScheduleRows()]);
      setMarketplaceFacts(freshFacts);
      dispatch({ type: "LOAD", payload: fresh });
      setScheduleRows(schedule.rows);
      const review = freshFacts.filter((fact) => fact.state === "review" || fact.state === "unassigned").length;
      alert(closed ? `WB: автоматически отмечено оплатой ${closed} строк графика.${review ? ` Ещё ${review} удержаний ждут проверки.` : ""}` : review ? `WB: точных совпадений нет. ${review} удержаний ждут проверки в очереди.` : "Новых удержаний WB по кредитам не найдено.");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось сверить удержания WB");
    } finally {
      setMarketplaceLoading(false);
    }
  }, [dispatch]);

  useEffect(() => {
    if (reconciledRef.current || state.loans.length === 0 || state.payments.length === 0 || companyByPayment.size === 0) return;
    reconciledRef.current = true;
    void reconcileWithDds(false);
  }, [companyByPayment.size, reconcileWithDds, state.loans.length, state.payments.length]);

  useEffect(() => {
    if (contractNumberBackfillRef.current || state.loans.length === 0 || state.payments.length === 0) return;
    const loan = state.loans.find((item) => item.startDate === "2026-02-08" && /вб\s*финанс/i.test(item.creditorName));
    if (!loan || contractNumber(state.payments, loan.id)) return;
    contractNumberBackfillRef.current = true;
    for (const payment of linkedRows(state.payments, loan.id)) {
      dispatch({
        type: "UPDATE_PAYMENT",
        payload: { ...payment, comment: `${payment.comment ?? ""} [contract-number:2026020800236]` },
      });
    }
  }, [dispatch, state.loans, state.payments]);

  const handleSubmit = async (result: LoanFormResult) => {
    const loan: Loan = editing ? { ...editing, ...result.loan, terms: result.terms ?? editing.terms } : { id: generateId("loan"), ...result.loan, terms: result.terms };
    if (result.contractFile) {
      await saveLoanDocument(loan.id, result.contractFile, result.companyId);
    }
    const tranches = result.disbursements.map((item) => `${item.date}=${item.amount}`).join(";");
    const currencyMeta = ` [currency:${result.currency}] [principal-original:${result.originalPrincipal}] [fx-rate:${result.exchangeRate}] [annual-rate:${result.annualRate}] [interest-frequency:${result.interestFrequency}] [monthly-rate:${result.monthlyRate}]${result.terms?.paymentDay ? ` [payment-day:${result.terms.paymentDay}]` : ""}${result.paymentDays ? ` [payment-days:${result.paymentDays.join(",")}]` : ""}${tranches ? ` [tranches:${tranches}]` : ""} [origination-fee:${result.originationFee}] [fee-months:${result.feeAmortizationMonths}]${result.contractNumber ? ` [contract-number:${result.contractNumber.replace(/\]/g, "")}]` : ""}`;
    if (editing) dispatch({ type: "UPDATE_LOAN", payload: loan });
    else dispatch({ type: "ADD_LOAN", payload: loan });
    const existing = linkedRows(state.payments, loan.id);
    const desired: Payment[] = [{
      id: existing.find((payment) => payment.comment?.includes(receiptMarker(loan.id)))?.id ?? generateId("loan-receipt"),
      date: loan.startDate,
      name: `Получение кредита — ${loan.creditorName}`,
      amount: loan.principalAmount,
      category: LOAN_CATEGORIES.receipt,
      accountId: result.accountId,
      status: existing.find((payment) => payment.comment?.includes(receiptMarker(loan.id)))?.status ?? "planned",
      counterparty: loan.creditorName,
      comment: `${receiptMarker(loan.id)}${currencyMeta}${result.contractFileName ? ` [contract:${result.contractFileName}]` : ""}`,
    }];
    // Приход кредита — обычный платёж; график — строки loan_schedule_rows,
    // плановые платежи календаря сервер строит из них сам (PR-C по ТЗ).
    for (const payment of desired) {
      if (state.payments.some((item) => item.id === payment.id)) {
        dispatch({ type: "UPDATE_PAYMENT", payload: payment });
        await updatePaymentCompany(payment.id, result.companyId);
      } else {
        await savePaymentWithCompany(payment, result.companyId);
        dispatch({ type: "ADD_PAYMENT", payload: payment });
      }
      setCompanyByPayment((current) => new Map(current).set(payment.id, result.companyId));
    }
    const rate = result.exchangeRate || 1;
    const originalOf = (rub: number, original: number | undefined) => result.currency === "RUB" ? rub : Number.isFinite(original) ? Number(original) : rub / rate;
    const rowStatus = (status: LoanScheduleDraft["status"]) => status === "done" ? "paid" as const : status === "cancelled" ? "cancelled" as const : "planned" as const;
    const rows = result.schedule.flatMap((row) => (["principal", "interest", "penalty", "fine"] as const).flatMap((kind) => row[kind] > 0 ? [{
      dueDate: row.date, kind, amountRub: roundLoanMoney(Math.abs(row[kind])),
      amountOriginal: roundLoanMoney(originalOf(row[kind], row[`${kind}Original` as "principalOriginal"])),
      balanceBefore: row.balanceBefore ?? null, balanceAfter: row.balanceAfter ?? null, status: rowStatus(row.status),
    }] : []));
    try {
      await saveLoanScheduleRows({
        loanId: loan.id, accountId: result.accountId, companyId: result.companyId || null, currency: result.currency, exchangeRate: rate,
        creditorName: loan.creditorName, contractFileName: result.contractFileName || undefined, rows,
      });
      // Старые плановые строки по меткам (до миграции) сервер не знает — убираем их сами.
      for (const payment of existing.filter((payment) => payment.comment?.includes(":schedule:") && payment.status === "planned" && !payment.comment?.includes("[paid-by:"))) {
        dispatch({ type: "DELETE_PAYMENT", payload: payment.id });
      }
      const [fresh, schedule] = await Promise.all([loadFinanceState(), loadLoanScheduleRows()]);
      dispatch({ type: "LOAD", payload: fresh });
      setScheduleRows(schedule.rows);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось сохранить график кредита");
    }
    setModalOpen(false);
    setEditing(null);
  };

  const handleDelete = async (loan: Loan) => {
    if (!confirm(`Удалить договор «${loan.creditorName}» и связанные плановые строки календаря?`)) return;
    if (contractName(state.payments, loan.id)) {
      try {
        await deleteLoanDocument(loan.id);
      } catch (error) {
        alert(error instanceof Error ? error.message : "Не удалось удалить исходный файл договора");
        return;
      }
    }
    for (const payment of linkedRows(state.payments, loan.id)) dispatch({ type: "DELETE_PAYMENT", payload: payment.id });
    dispatch({ type: "DELETE_LOAN", payload: loan.id });
  };

  const syncGoogle = async () => {
    setSyncing(true);
    try {
      const response = await fetch("/api/opiu/google-sheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: rowsForExport, rowIds: rowIdsForExport, sheetName: "Учёт кредитов займов от сторонн", template: "loans" }) });
      const result = await response.json().catch(() => null) as { error?: string; spreadsheetUrl?: string; rows?: number; updated?: number; skipped?: number } | null;
      if (!response.ok) throw new Error(result?.error || "Не удалось выгрузить реестр кредитов");
      const added = Number(result?.rows ?? 0);
      const updated = Number(result?.updated ?? 0);
      const skipped = Number(result?.skipped ?? 0);
      const summary = added > 0 || updated > 0
        ? `Google Таблица обновлена: новых строк — ${added}, заменено существующих — ${updated}, пропущено — ${skipped}.`
        : `Новых кредитов для добавления не найдено. Пропущено существующих строк — ${skipped}.`;
      if (result?.spreadsheetUrl && confirm(`${summary}\n\nОткрыть Google Таблицу?`)) {
        window.open(result.spreadsheetUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось обновить Google Таблицу");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div><h1 className="text-2xl font-bold text-slate-950">Кредиты и займы</h1><p className="mt-1 text-sm text-slate-500">Договоры, графики, остаток долга и ближайшие оплаты</p></div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void reconcileWithDds(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"><RefreshCw className="h-4 w-4" /> Сверить с ДДС</button>
            <button onClick={() => void reconcileWithWb()} disabled={marketplaceLoading} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-300 bg-violet-50 px-4 text-sm font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${marketplaceLoading ? "animate-spin" : ""}`} /> Сверить удержания WB</button>
            <button onClick={() => downloadSimpleXlsx(rowsForExport, `Учёт_финансовой_деятельности_${today}.xlsx`, "Учёт кредитов займов от сторонн")} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download className="h-4 w-4" /> Excel</button>
            <button onClick={() => void syncGoogle()} disabled={syncing} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} /> Google Таблица</button>
            <button onClick={() => { setEditing(null); setModalOpen(true); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700"><Plus className="h-4 w-4" /> Новый договор</button>
          </div>
        </div>
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          <label className="block max-w-xl text-xs font-semibold uppercase tracking-wide text-slate-500">Поиск договора<input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal normal-case text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" placeholder="Номер договора, кредитор или компания" /></label>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Компании — можно выбрать несколько</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setCompanyScope(new Set())} className={`min-h-10 rounded-xl px-3 text-sm font-medium ${companyScope.size === 0 ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>Все компании</button>
              {companies.filter((company) => company.isActive).map((company) => {
                const selected = companyScope.has(company.id);
                return <button key={company.id} aria-pressed={selected} onClick={() => setCompanyScope((current) => {
                  const next = new Set(current);
                  if (next.has(company.id)) next.delete(company.id); else next.add(company.id);
                  return next;
                })} className={`min-h-10 rounded-xl px-3 text-sm font-medium ${selected ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-700"}`}>{selected ? "✓ " : ""}{company.name}</button>;
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex rounded-xl bg-slate-100 p-1">
              <button onClick={() => setPeriodMode("months")} className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${periodMode === "months" ? "bg-white text-violet-700 shadow-sm" : "text-slate-600"}`}>Месяц / период</button>
              <button onClick={() => setPeriodMode("year")} className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${periodMode === "year" ? "bg-white text-violet-700 shadow-sm" : "text-slate-600"}`}>Год</button>
            </div>
            {periodMode === "months" ? <>
              <label className="text-xs font-medium text-slate-600">С месяца<input type="month" value={monthFrom} onChange={(event) => setMonthFrom(event.target.value)} className="mt-1 block min-h-10 rounded-xl border border-slate-300 px-3 text-sm" /></label>
              <label className="text-xs font-medium text-slate-600">По месяц<input type="month" min={monthFrom} value={monthTo} onChange={(event) => setMonthTo(event.target.value)} className="mt-1 block min-h-10 rounded-xl border border-slate-300 px-3 text-sm" /></label>
            </> : <label className="text-xs font-medium text-slate-600">Год<input type="number" min="2020" max="2100" value={periodYear} onChange={(event) => setPeriodYear(event.target.value)} className="mt-1 block min-h-10 w-28 rounded-xl border border-slate-300 px-3 text-sm" /></label>}
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Summary icon={WalletCards} label="Остаток основного долга" value={formatMoney(outstanding)} tone="slate" expanded={expandedSummary === "outstanding"} onClick={() => setExpandedSummary((value) => value === "outstanding" ? null : "outstanding")} />
        <Summary icon={FileText} label="Проценты + комиссии · ОПиУ" value={formatMoney(periodInterest + periodFees)} tone="red" expanded={expandedSummary === "interest"} onClick={() => setExpandedSummary((value) => value === "interest" ? null : "interest")} />
        <Summary icon={CalendarClock} label="К оплате за 30 дней" value={formatMoney(next30.reduce((sum, item) => sum + item.row.principal + item.row.interest + item.row.penalty + item.row.fine, 0))} tone="violet" expanded={expandedSummary === "next30"} onClick={() => setExpandedSummary((value) => value === "next30" ? null : "next30")} />
        <Summary icon={AlertTriangle} label="Просрочено платежей" value={String(overdue.length)} tone={overdue.length ? "red" : "green"} expanded={expandedSummary === "overdue"} onClick={() => setExpandedSummary((value) => value === "overdue" ? null : "overdue")} />
        <Summary icon={FileText} label="Активных договоров" value={String(filteredLoans.filter((loan) => loan.status === "active").length)} tone="green" expanded={expandedSummary === "active"} onClick={() => setExpandedSummary((value) => value === "active" ? null : "active")} />
      </section>

      {expandedSummary && <SummaryBreakdown
        kind={expandedSummary}
        loans={filteredLoans}
        schedules={schedules}
        balances={loanBalances}
        next30={next30}
        overdue={overdue}
        payments={state.payments}
        periodStart={periodStart}
        periodEnd={periodEnd}
        onOpen={setDetails}
        onClose={() => setExpandedSummary(null)}
      />}

      {overdue.length > 0 && <button type="button" aria-expanded={expandedSummary === "overdue"} onClick={() => setExpandedSummary((value) => value === "overdue" ? null : "overdue")} className="w-full cursor-pointer rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-800 transition hover:border-red-300 hover:bg-red-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"><span className="block font-bold">Требуют внимания: {overdue.length} просроченных платежей</span><span className="mt-1 block">Нажмите, чтобы увидеть договоры и суммы без поиска по разделу.</span></button>}

      {marketplaceFacts.some((fact) => fact.state === "review" || fact.state === "unassigned") && <section className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/70 shadow-sm"><div className="flex flex-col gap-3 border-b border-amber-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold text-amber-950">Удержания WB ждут проверки</h2><p className="mt-1 text-sm text-amber-900">Точное совпадение закрывается автоматически. Здесь только строки, которые нельзя зачесть без риска.</p></div><button type="button" onClick={() => void reconcileWithWb()} disabled={marketplaceLoading} className="min-h-11 shrink-0 rounded-xl border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50">Обновить сверку</button></div><div className="max-h-60 overflow-y-auto">{marketplaceFacts.filter((fact) => fact.state === "review" || fact.state === "unassigned").slice(0, 20).map((fact) => <div key={fact.source} className="grid grid-cols-[1fr_auto] gap-3 border-b border-amber-100 px-4 py-3 last:border-b-0"><div className="min-w-0"><p className="font-semibold text-slate-950">{fact.loanName ?? `Договор WB № ${fact.contractNumber ?? "не определён"}`}</p><p className="mt-1 truncate text-xs text-slate-600">{formatDate(fact.date)} · {fact.kind === "unknown" ? "вид платежа не определён" : fact.kind} · {fact.reason}</p></div><span className="self-center whitespace-nowrap font-bold tabular-nums text-slate-950">{formatMoney(fact.amountRub)}</span></div>)}</div><p className="px-4 py-3 text-xs text-amber-900">Если деньги перечислялись вручную, внесите платёж в ДДС и нажмите «Сверить с ДДС» — удержание WB при этом не создаёт второй расход.</p></section>}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3"><h2 className="font-bold text-slate-950">Помесячный свод по кредитам</h2><p className="mt-1 text-xs text-slate-500">Начисления по графику, фактические выплаты и остаток тела на конец месяца.</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-3">Месяц</th><th className="p-3 text-right">Начислено процентов</th><th className="p-3 text-right">Остаток тела</th><th className="p-3 text-right">Начислено тело + проценты</th><th className="p-3 text-right">Выплачено по факту</th></tr></thead><tbody>{monthlySummary.map((row) => <tr key={row.month} className="border-t border-slate-100"><td className="p-3 font-semibold text-slate-900">{formatLoanMonth(row.month)}</td><td className="p-3 text-right tabular-nums">{formatMoney(row.interestAccrued)}</td><td className="p-3 text-right font-semibold tabular-nums">{formatMoney(row.principalBalance)}</td><td className="p-3 text-right tabular-nums">{formatMoney(row.scheduledTotal)}</td><td className="p-3 text-right font-semibold tabular-nums text-emerald-700">{formatMoney(row.paidTotal)}</td></tr>)}</tbody></table></div>
      </section>

      <section className="space-y-3">
        {filteredLoans.length === 0 ? <Card><CardContent className="py-14 text-center text-slate-500">Для выбранной компании договоров пока нет.</CardContent></Card> : filteredLoans.map((loan) => {
          const schedule = schedules.get(loan.id) ?? [];
          const balance = loanBalances.get(loan.id) ?? loan.principalAmount;
          const next = schedule.find((row) => row.status === "planned" && row.date >= today);
          const company = companies.find((item) => item.id === loanCompany(loan.id));
          const fee = metadataNumber(state.payments, loan.id, "origination-fee");
          return <article key={loan.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-lg font-bold text-slate-950">{loan.creditorName}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${loan.status === "active" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{loan.status === "active" ? "Активен" : "Закрыт"}</span></div><p className="mt-1 text-sm text-slate-500">{company?.name ?? "Компания не назначена"} · {contractNumber(state.payments, loan.id) ? `договор № ${contractNumber(state.payments, loan.id)} от ` : "договор от "}{formatDate(loan.startDate)}</p></div>
              <div className="flex flex-wrap gap-2"><button onClick={() => setDetails(loan)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-200 px-3 text-sm font-bold text-violet-700 hover:bg-violet-50">Подробнее<ChevronRight className="h-4 w-4" /></button><button onClick={() => { setEditing(loan); setModalOpen(true); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Sparkles className="h-4 w-4 text-violet-600" />Изменить график текстом</button><button aria-label="Редактировать договор вручную" onClick={() => { setEditing(loan); setModalOpen(true); }} className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"><Pencil className="h-4 w-4" /></button><button aria-label="Удалить договор" onClick={() => void handleDelete(loan)} className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Сумма договора" value={formatMoney(loan.principalAmount)} />
              <Metric label="Остаток тела" value={formatMoney(balance)} strong />
              <Metric label="Проценты по графику" value={formatMoney(schedule.reduce((sum, row) => sum + row.interest, 0))} />
              <Metric label="Следующий платёж" value={next ? `${formatDate(next.date)} · ${formatMoney(next.principal + next.interest + next.penalty + next.fine)}` : "Нет"} />
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-100 pt-3 text-xs text-slate-500"><span>Строк графика: {schedule.length}</span><span>Оплачено: {schedule.filter((row) => row.status === "done").length}</span>{fee > 0 && <span>Комиссия в ОПиУ: {formatMoney(fee)} / {metadataNumber(state.payments, loan.id, "fee-months", 36)} мес.</span>}<span className="font-medium text-violet-700">В календаре только реальные платежи</span>{contractName(state.payments, loan.id) && <span>Файл: {contractName(state.payments, loan.id)}</span>}</div>
          </article>;
        })}
      </section>

      {modalOpen && <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
        <button type="button" aria-label="Закрыть форму" className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => { setModalOpen(false); setEditing(null); }} />
        <div className="relative flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div><h2 className="text-lg font-bold text-slate-950">{editing ? "Редактировать договор и график" : "Новый кредит или займ"}</h2><p className="text-xs text-slate-500">Все поля и даты можно изменить позже</p></div>
            <button type="button" onClick={() => { setModalOpen(false); setEditing(null); }} className="min-h-11 rounded-xl px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100">Закрыть</button>
          </div>
          <div className="overflow-y-auto p-4 sm:p-6">
          <LoanForm
            loan={editing ?? undefined}
            accounts={state.accounts}
            companies={companies}
            companyId={editing ? loanCompany(editing.id) : null}
            accountId={editing ? linkedRows(state.payments, editing.id)[0]?.accountId : undefined}
            contractFileName={editing ? contractName(state.payments, editing.id) : ""}
            contractNumber={editing ? contractNumber(state.payments, editing.id) : ""}
            schedule={editing ? schedules.get(editing.id) : undefined}
            currency={editing ? (commentValue(linkedRows(state.payments, editing.id)[0]?.comment, "currency") as LoanFormResult["currency"] || "RUB") : "RUB"}
            originalPrincipal={editing ? Number(commentValue(linkedRows(state.payments, editing.id)[0]?.comment, "principal-original")) || editing.principalAmount : undefined}
            exchangeRate={editing ? Number(commentValue(linkedRows(state.payments, editing.id)[0]?.comment, "fx-rate")) || 1 : 1}
            annualRate={editing ? Number(commentValue(linkedRows(state.payments, editing.id)[0]?.comment, "annual-rate")) || editing.interestRatePerDay * 365 : undefined}
            originationFee={editing ? metadataNumber(state.payments, editing.id, "origination-fee") : 0}
            feeAmortizationMonths={editing ? metadataNumber(state.payments, editing.id, "fee-months", 36) : 36}
            interestFrequency={editing ? commentValue(firstLoanComment(state.payments, editing.id), "interest-frequency") as LoanFormResult["interestFrequency"] || undefined : undefined}
            monthlyRate={editing ? metadataNumber(state.payments, editing.id, "monthly-rate") : 0}
            disbursements={editing ? metadataDisbursements(state.payments, editing.id) : []}
            paymentDays={editing ? metadataPaymentDays(state.payments, editing.id) : undefined}
            terms={editing?.terms ? { ...editing.terms, paymentDay: metadataNumber(state.payments, editing.id, "payment-day") || editing.terms.paymentDay || null } : undefined}
            onSubmit={handleSubmit}
            onCancel={() => { setModalOpen(false); setEditing(null); }}
          />
          </div>
        </div>
      </div>}
      {details && <LoanDetails
        loan={details}
        company={companies.find((item) => item.id === loanCompany(details.id))?.name ?? "Компания не назначена"}
        schedule={schedules.get(details.id) ?? []}
        payments={state.payments}
        onClose={() => setDetails(null)}
        onEdit={() => { setDetails(null); setEditing(details); setModalOpen(true); }}
      />}
    </div>
  );
}

function LoanDetails({ loan, company, schedule, payments, onClose, onEdit }: { loan: Loan; company: string; schedule: LoanScheduleDraft[]; payments: Payment[]; onClose: () => void; onEdit: () => void }) {
  const [documents, setDocuments] = useState<LoanDocumentInfo[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState("");
  const paidPrincipal = schedule.filter((row) => row.status === "done").reduce((sum, row) => sum + row.principal, 0);
  const fee = metadataNumber(payments, loan.id, "origination-fee");
  const feeMonths = metadataNumber(payments, loan.id, "fee-months", 36);
  const currency = commentValue(firstLoanComment(payments, loan.id), "currency") || "RUB";
  const balance = actualLoanBalance(loan.principalAmount, schedule, todayISO());
  const projectedBalances = new Map(projectedLoanBalances(loan.principalAmount, schedule).map((item) => [item.rowId, item.balanceAfter]));
  const originalPrincipal = Number(commentValue(firstLoanComment(payments, loan.id), "principal-original")) || loan.principalAmount;
  useEffect(() => {
    let active = true;
    setDocumentsLoading(true);
    setDocumentsError("");
    listLoanDocuments(loan.id)
      .then((items) => { if (active) setDocuments(items); })
      .catch((error) => { if (active) setDocumentsError(error instanceof Error ? error.message : "Не удалось загрузить документы"); })
      .finally(() => { if (active) setDocumentsLoading(false); });
    return () => { active = false; };
  }, [loan.id]);
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
    <button type="button" aria-label="Закрыть карточку" className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />
    <div className="relative flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b p-5"><div><p className="text-xs font-bold uppercase tracking-wide text-violet-600">{company}</p><h2 className="mt-1 text-xl font-bold text-slate-950">{loan.creditorName}</h2><p className="mt-1 text-sm text-slate-500">{contractNumber(payments, loan.id) ? `Договор № ${contractNumber(payments, loan.id)} от ` : "Договор от "}{formatDate(loan.startDate)} · срок до {formatDate(loan.dueDate)}</p></div><button onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-slate-100"><X className="h-5 w-5" /></button></header>
      <div className="overflow-y-auto p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Сумма договора" value={currency === "RUB" ? formatMoney(loan.principalAmount) : `${roundLoanMoney(originalPrincipal).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency} · ${formatMoney(loan.principalAmount)}`} /><Metric label="Погашено тела" value={formatMoney(paidPrincipal)} /><Metric label="Остаток тела" value={formatMoney(balance)} strong /><Metric label="Проценты по графику" value={formatMoney(schedule.reduce((sum, row) => sum + row.interest, 0))} /><Metric label="Комиссия в ОПиУ" value={fee ? `${formatMoney(fee)} / ${feeMonths} мес.` : "Нет"} /></div>
        <section className="mt-5 rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <div><h3 className="font-bold text-slate-950">Документы договора</h3><p className="mt-1 text-sm text-slate-500">Все загруженные договоры, графики и дополнения сохраняются в истории.</p></div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{documents.length}</span>
          </div>
          {documentsLoading && <p className="mt-4 text-sm text-slate-500">Загружаю документы…</p>}
          {documentsError && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{documentsError}</p>}
          {!documentsLoading && !documentsError && documents.length === 0 && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Файлы ещё не прикреплены. Добавьте документ через редактирование кредита или займа.</p>}
          {documents.length > 0 && <div className="mt-4 space-y-2">{documents.map((document) => <div key={document.id} className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3"><FileText className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" /><div className="min-w-0"><p className="truncate font-semibold text-slate-900">{document.fileName}</p><p className="mt-1 text-xs text-slate-500">{new Date(document.createdAt).toLocaleString("ru-RU")} · {(document.sizeBytes / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} КБ</p></div></div>
            <div className="flex shrink-0 gap-2"><button type="button" onClick={() => openListedLoanDocument(document)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-200 px-3 font-semibold text-violet-700"><ExternalLink className="h-4 w-4" />Открыть</button><button type="button" onClick={() => downloadLoanDocument(document)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 font-semibold text-slate-700"><Download className="h-4 w-4" />Скачать</button></div>
          </div>)}</div>}
        </section>
        <div className="mt-5 overflow-x-auto rounded-xl border"><table className="w-full min-w-[1000px] text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-3">Дата</th>{currency !== "RUB" && <th className="p-3 text-right">В валюте договора</th>}<th className="p-3 text-right">Тело</th><th className="p-3 text-right">Проценты</th><th className="p-3 text-right">Пени</th><th className="p-3 text-right">Штрафы</th><th className="p-3 text-right">Всего к оплате</th><th className="p-3">Статус</th><th className="p-3 text-right">Остаток после оплаты</th></tr></thead><tbody>{schedule.map((row) => {
          const overdue = row.status === "planned" && row.date < todayISO();
          const originalTotal = Number(row.principalOriginal || 0) + Number(row.interestOriginal || 0) + Number(row.penaltyOriginal || 0) + Number(row.fineOriginal || 0);
          return <tr key={row.id} className={`border-t ${overdue ? "bg-red-50" : ""}`}><td className={`p-3 ${overdue ? "font-bold text-red-700" : ""}`}>{formatDate(row.date)}{overdue && <span className="ml-2 rounded-full bg-red-100 px-2 py-1 text-[10px]">Просрочено</span>}</td>{currency !== "RUB" && <td className="p-3 text-right font-semibold tabular-nums">{roundLoanMoney(originalTotal).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</td>}<td className="p-3 text-right tabular-nums">{formatMoney(row.principal)}</td><td className="p-3 text-right tabular-nums">{formatMoney(row.interest)}</td><td className="p-3 text-right tabular-nums">{formatMoney(row.penalty)}</td><td className="p-3 text-right tabular-nums">{formatMoney(row.fine)}</td><td className="p-3 text-right font-bold tabular-nums">{formatMoney(row.principal + row.interest + row.penalty + row.fine)}</td><td className="p-3">{row.status === "done" ? "Оплачено" : row.status === "cancelled" ? "Отменено" : overdue ? "Просрочено" : "Запланировано"}</td><td className="p-3 text-right font-semibold tabular-nums">{formatMoney(projectedBalances.get(row.id) ?? balance)}</td></tr>;
        })}</tbody></table></div>
      </div>
      <footer className="flex flex-wrap justify-end gap-2 border-t p-4"><button onClick={onClose} className="min-h-11 rounded-xl px-4 font-semibold text-slate-600">Закрыть</button><button onClick={onEdit} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 font-bold text-white"><Pencil className="h-4 w-4" />Редактировать</button></footer>
    </div>
  </div>;
}

function formatLoanMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date(year, value - 1, 1));
}

function SummaryBreakdown({ kind, loans, schedules, balances, next30, overdue, payments, periodStart, periodEnd, onOpen, onClose }: {
  kind: SummaryKey;
  loans: Loan[];
  schedules: ReadonlyMap<string, LoanScheduleDraft[]>;
  balances: ReadonlyMap<string, number>;
  next30: Array<{ loan: Loan; row: LoanScheduleDraft }>;
  overdue: Array<{ loan: Loan; row: LoanScheduleDraft }>;
  payments: Payment[];
  periodStart: string;
  periodEnd: string;
  onOpen: (loan: Loan) => void;
  onClose: () => void;
}) {
  const titles: Record<SummaryKey, string> = {
    outstanding: "Основной долг по договорам",
    interest: "Проценты и комиссии за выбранный период",
    next30: "Платежи на ближайшие 30 дней",
    overdue: "Просроченные платежи",
    active: "Активные договоры",
  };
  const loanRows = kind === "interest" ? loans.map((loan) => {
    const interest = (schedules.get(loan.id) ?? []).filter((row) => row.status !== "cancelled" && row.date >= periodStart && row.date <= periodEnd).reduce((sum, row) => sum + row.interest + row.penalty + row.fine, 0);
    const fee = metadataNumber(payments, loan.id, "origination-fee");
    const months = metadataNumber(payments, loan.id, "fee-months", 36);
    return { loan, value: interest + (months ? fee / months * monthCountInPeriod(loan.startDate, months, periodStart, periodEnd) : 0) };
  }).filter((item) => item.value > 0) : loans
    .filter((loan) => kind !== "active" || loan.status === "active")
    .map((loan) => ({ loan, value: balances.get(loan.id) ?? 0 }));
  const paymentRows = kind === "next30" ? next30 : kind === "overdue" ? overdue : [];
  return <section aria-live="polite" className="overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm">
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3"><div><h2 className="font-bold text-slate-950">{titles[kind]}</h2><p className="mt-0.5 text-xs text-slate-500">Нажмите на строку, чтобы открыть договор и его график.</p></div><button type="button" aria-label="Свернуть детализацию" onClick={onClose} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"><X className="h-5 w-5" /></button></div>
    <div className="max-h-80 overflow-y-auto">
      {paymentRows.length > 0 ? paymentRows.map(({ loan, row }) => <button type="button" key={`${loan.id}:${row.id}`} onClick={() => onOpen(loan)} className="grid min-h-14 w-full cursor-pointer grid-cols-[1fr_auto] items-center gap-3 border-b border-slate-100 px-4 py-3 text-left transition last:border-b-0 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500"><span><span className="block font-semibold text-slate-900">{loan.creditorName}</span><span className="block text-xs text-slate-500">{formatDate(row.date)} · тело {formatMoney(row.principal)} · проценты {formatMoney(row.interest + row.penalty + row.fine)}</span></span><span className="font-bold tabular-nums text-slate-950">{formatMoney(row.principal + row.interest + row.penalty + row.fine)}</span></button>)
        : loanRows.length > 0 ? loanRows.map(({ loan, value }) => <button type="button" key={loan.id} onClick={() => onOpen(loan)} className="grid min-h-14 w-full cursor-pointer grid-cols-[1fr_auto] items-center gap-3 border-b border-slate-100 px-4 py-3 text-left transition last:border-b-0 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500"><span><span className="block font-semibold text-slate-900">{loan.creditorName}</span><span className="block text-xs text-slate-500">{contractNumber(payments, loan.id) ? `Договор № ${contractNumber(payments, loan.id)}` : `Договор от ${formatDate(loan.startDate)}`}</span></span><span className="font-bold tabular-nums text-slate-950">{kind === "active" ? `Остаток ${formatMoney(value)}` : formatMoney(value)}</span></button>)
          : <p className="px-4 py-8 text-center text-sm text-slate-500">Для выбранных фильтров строк нет.</p>}
    </div>
  </section>;
}

function Summary({ icon: Icon, label, value, tone, expanded, onClick }: { icon: typeof WalletCards; label: string; value: string; tone: "slate" | "violet" | "red" | "green"; expanded: boolean; onClick: () => void }) {
  const colors = { slate: "bg-slate-100 text-slate-700", violet: "bg-violet-100 text-violet-700", red: "bg-red-100 text-red-700", green: "bg-emerald-100 text-emerald-700" };
  return <Card><button type="button" aria-expanded={expanded} onClick={onClick} className={`min-h-[84px] w-full cursor-pointer rounded-xl text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 ${expanded ? "bg-violet-50/60" : ""}`}><span className="flex items-center gap-2 px-3 py-3"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${colors[tone]}`}><Icon className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-medium leading-4 text-slate-500">{label}</span><span className="mt-1 block whitespace-nowrap text-lg font-bold leading-none tracking-tight tabular-nums text-slate-950 2xl:text-xl">{value}</span></span></span></button></Card>;
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 text-sm tabular-nums ${strong ? "font-bold text-violet-700" : "font-semibold text-slate-900"}`}>{value}</p></div>;
}
