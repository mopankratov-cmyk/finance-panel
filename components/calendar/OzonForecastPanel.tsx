"use client";

import { BarChart3, CalendarPlus, Loader2, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { formatMoney, generateId } from "@/lib/format";
import type { Account, Payment } from "@/lib/types";
import type { DdsCompany } from "@/components/payments/ddsCompanies";
import { payoutLinkMarker, payoutReportKey, type PayoutReport } from "@/lib/opiu/payoutReconciliation";

type PayoutMode = "standard" | "weekly";

interface ForecastData {
  cabinetId: string;
  scope: string;
  cabinets: { id: string; name: string }[];
  planRows: number;
  planSource: "approved_sales_plan" | "working_sales_plan" | "none";
  planApproved: boolean;
  planRevenue: number;
  plannedOrders: number;
  adaptivePlannedOrders: number;
  adaptivePlanRevenue: number;
  orderAdjustmentApplied: boolean;
  orderDeviationDays: number;
  orderDeviationPercent: number;
  plannedBuyouts: number;
  actualOrders: number;
  actualRevenue: number;
  expectedPayout: number;
  actualPayout: number;
  remainingPayout: number;
  reportDataStatus: "available" | "degraded";
  confirmedPayouts: PayoutReport[];
  payoutSchedule: { id: string; reportId?: string; periodFrom?: string; periodTo?: string; reportAmount?: number; date: string; amount: number; source: "forecast" | "financial_report"; state: "accrual" | "report_confirmed"; dateIsEstimated: boolean }[];
  reconciliationQueue: { bankReceiptId: string; reason: "ambiguous" | "partial" | "unlinked" | "over_allocation"; amount?: number; date: string; name: string; paymentAmount: number }[];
  financialAdjustments: { metric: string; plannedRate: number; actualRate: number; impact: number; observedDays: number; message: string }[];
  planAudit: { cabinetId: string; responsible: string; updatedAt: string; events: { actor: string; role: string; at: string; type: string; version: number; revision: number }[] }[];
  warnings: string[];
  dataNotices: string[];
  error?: string;
}

export function OzonForecastPanel({ year, month, accounts, companies, existingPayments, companyByPayment, onAddPayment, onUpdatePayment }: {
  year: number;
  month: number;
  accounts: Account[];
  companies: DdsCompany[];
  existingPayments: Payment[];
  companyByPayment: Map<string, string | null>;
  onAddPayment: (payment: Payment, companyId?: string | null) => void;
  onUpdatePayment: (payment: Payment, companyId: string | null) => void | Promise<void>;
}) {
  const [mode, setMode] = useState<PayoutMode>("standard");
  const [cabinetId, setCabinetId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [weeklyDay, setWeeklyDay] = useState(2);
  const [standardDelayDays, setStandardDelayDays] = useState(24);
  const [approvedRules, setApprovedRules] = useState({ mode: "standard" as PayoutMode, weeklyDay: 2, standardDelayDays: 24 });
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [schedule, setSchedule] = useState<ForecastData["payoutSchedule"]>([]);
  const [baseSchedule, setBaseSchedule] = useState<ForecastData["payoutSchedule"]>([]);
  const [financeEdited, setFinanceEdited] = useState(false);
  const [currentActor, setCurrentActor] = useState("Финансовый отдел");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [linkDrafts, setLinkDrafts] = useState<Record<string, Record<string, number>>>({});
  const [linkingReceiptId, setLinkingReceiptId] = useState("");

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json()).then((payload: { user?: { email?: string } }) => {
      if (payload.user?.email) setCurrentActor(payload.user.email);
    }).catch(() => undefined);
  }, []);

  const applyCabinetSettings = (nextCabinetId: string) => {
    setCabinetId(nextCabinetId);
    setCompanyId(window.localStorage.getItem(`finance:ozon-forecast-company:${nextCabinetId}`) ?? "");
    const saved = window.localStorage.getItem(`finance:ozon-payout-rules:${nextCabinetId}`);
    if (!saved) {
      const defaults = { mode: "standard" as PayoutMode, weeklyDay: 2, standardDelayDays: 24 };
      setMode(defaults.mode); setWeeklyDay(defaults.weeklyDay); setStandardDelayDays(defaults.standardDelayDays); setApprovedRules(defaults);
      return;
    }
    try {
      const parsed = JSON.parse(saved) as Partial<{ mode: PayoutMode; weeklyDay: number; standardDelayDays: number }>;
      if (parsed.mode) setMode(parsed.mode);
      if (parsed.weeklyDay != null) setWeeklyDay(parsed.weeklyDay);
      if (parsed.standardDelayDays != null) setStandardDelayDays(parsed.standardDelayDays);
      setApprovedRules({ mode: parsed.mode ?? "standard", weeklyDay: parsed.weeklyDay ?? 2, standardDelayDays: parsed.standardDelayDays ?? 24 });
    } catch {
      window.localStorage.removeItem(`finance:ozon-payout-rules:${nextCabinetId}`);
    }
  };

  useEffect(() => {
    const query = new URLSearchParams({
      year: String(year),
      month: String(month + 1),
      mode,
      weeklyDay: String(weeklyDay),
      standardDelayDays: String(standardDelayDays),
    });
    if (cabinetId) query.set("cabinet", cabinetId);
    if (companyId) query.set("company", companyId);
    let cancelled = false;
    setLoading(true);
    fetch(`/api/opiu/ozon-forecast?${query}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as ForecastData;
        if (!response.ok) throw new Error(result.error ?? "Не удалось рассчитать прогноз Ozon");
        if (!cancelled) {
          setData(result);
          if (!cabinetId && result.cabinetId) applyCabinetSettings(result.cabinetId);
          const nextSchedule = result.payoutSchedule;
          setSchedule(nextSchedule);
          setBaseSchedule(nextSchedule);
          setFinanceEdited(false);
          setError("");
          setLoading(false);
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "Не удалось рассчитать прогноз Ozon");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [cabinetId, companyId, mode, month, refreshNonce, standardDelayDays, weeklyDay, year]);

  const total = useMemo(() => schedule.reduce((sum, item) => sum + item.amount, 0), [schedule]);
  const payoutRulesConfirmed = mode === approvedRules.mode && weeklyDay === approvedRules.weeklyDay && standardDelayDays === approvedRules.standardDelayDays;
  const marker = companyId ? `[forecast:ozon:${cabinetId}:${companyId}]` : "";
  const previousRows = useMemo(() => marker
    ? existingPayments.filter((payment) => payment.status === "planned" && payment.comment?.includes(marker))
    : [], [existingPayments, marker]);
  const calendarNeedsUpdate = previousRows.length > 0 && (
    previousRows.length !== schedule.filter((item) => item.amount > 0).length
    || schedule.some((item) => !previousRows.some((payment) => payment.date === item.date && Math.abs(payment.amount - item.amount) < 0.01))
  );
  const confirmReceiptLinks = async (receiptId: string) => {
    if (!data || !companyId) return;
    const payment = existingPayments.find((row) => row.id === receiptId && row.status === "done");
    if (!payment || companyByPayment.get(payment.id) !== companyId) return;
    const draft = linkDrafts[receiptId] ?? {};
    const markers = data.confirmedPayouts.flatMap((report) => {
      const amount = Number(draft[payoutReportKey(report)] ?? 0);
      return amount > 0 ? [payoutLinkMarker(report, amount)] : [];
    });
    const allocated = Object.values(draft).reduce((sum, amount) => sum + (Number(amount) || 0), 0);
    if (!markers.length || allocated <= 0 || allocated > payment.amount + 0.01) {
      window.alert("Распределите сумму платежа по одному или нескольким отчётам. Общая сумма не должна превышать платёж.");
      return;
    }
    const exceedsReport = data.confirmedPayouts.some((report) => {
      const reportKey = payoutReportKey(report);
      const allocation = Number(draft[reportKey] ?? 0);
      const remaining = data.payoutSchedule.find((row) => row.id === reportKey)?.amount ?? report.amount;
      return allocation > remaining + 0.01;
    });
    if (exceedsReport) {
      window.alert("Сумма распределения не может быть больше остатка по отчёту.");
      return;
    }
    setLinkingReceiptId(receiptId);
    try {
      const cleanComment = (payment.comment ?? "").replace(/\s*\[payout-link:[^\]]+\]/g, "").trim();
      await onUpdatePayment({ ...payment, comment: `${cleanComment}${cleanComment ? " " : ""}${markers.join(" ")}` }, companyId);
      for (const report of data.confirmedPayouts) {
        const reportKey = payoutReportKey(report);
        const allocation = Number(draft[reportKey] ?? 0);
        if (allocation <= 0) continue;
        const expectedRow = existingPayments.find((row) => row.status === "planned" && row.comment?.includes(`[ozon-report:${report.cabinetId}:${report.companyId}:${report.reportId}:${report.periodFrom}:${report.periodTo}]`));
        if (!expectedRow) continue;
        const currentRemaining = data.payoutSchedule.find((row) => row.id === reportKey)?.amount ?? report.amount;
        await onUpdatePayment({
          ...expectedRow,
          amount: Math.max(0, currentRemaining - allocation),
          status: allocation + 0.01 >= currentRemaining ? "cancelled" : "planned",
          comment: `${expectedRow.comment ?? ""} [reconciled-by:${payment.id}:${allocation}]`,
        }, companyId);
      }
      setRefreshNonce((value) => value + 1);
    } catch (linkError) {
      window.alert(linkError instanceof Error ? linkError.message : "Не удалось сохранить связь с ДДС");
    } finally {
      setLinkingReceiptId("");
    }
  };
  const addToCalendar = () => {
    if (!accountId || !companyId || !data?.planApproved || !payoutRulesConfirmed || data.reportDataStatus === "degraded") return;
    let added = 0;
    let skipped = 0;
    const marker = `[forecast:ozon:${cabinetId}:${companyId}]`;
    const managerActor = data?.planAudit.find((item) => item.cabinetId === cabinetId)?.events[0]?.actor ?? data?.planAudit.find((item) => item.cabinetId === cabinetId)?.responsible ?? "Менеджер";
    const previousRows = existingPayments.filter((payment) => payment.status === "planned" && payment.comment?.includes(marker));
    const usedPreviousIds = new Set<string>();
    for (const item of schedule) {
      if (!item.date || item.amount <= 0) continue;
      const managerBase = baseSchedule.find((row) => row.id === item.id) ?? item;
      const auditMarkers = `[plan-owner:${financeEdited ? "finance" : "manager"}] [manager-actor:${safeMarker(managerActor)}]${financeEdited ? ` [finance-actor:${safeMarker(currentActor)}]` : ""} [manager-plan:${managerBase.date}:${managerBase.amount}]${financeEdited ? ` [finance-plan:${item.date}:${item.amount}]` : ""}`;
      const itemMarker = item.reportId ? `[ozon-report:${cabinetId}:${companyId}:${item.reportId}:${item.periodFrom}:${item.periodTo}]` : `[ozon-forecast-item:${item.id}]`;
      const previous = previousRows.find((payment) => payment.comment?.includes(itemMarker));
      if (previous) {
        usedPreviousIds.add(previous.id);
        const correctionAudit = previous.date !== item.date || Math.abs(previous.amount - item.amount) >= 0.01
          ? ` [previous:${previous.date}:${previous.amount}] [corrected-at:${new Date().toISOString()}]`
          : "";
        void onUpdatePayment({ ...previous, date: item.date, amount: item.amount, accountId, comment: `${marker} ${itemMarker} ${item.reportAmount ? `[report-total:${item.reportAmount}] ` : ""}${auditMarkers}${correctionAudit} [state:${item.state}] [date:estimated] ${item.source === "financial_report" ? "Сумма подтверждена отчётом Ozon; дата поступления расчётная до факта банка." : "Расчётный прогноз Ozon по утверждённому плану заказов."}` }, companyId);
        added += 1;
        continue;
      }
      const duplicate = !item.reportId && existingPayments.some((payment) => payment.status === "planned" && payment.accountId === accountId && payment.date === item.date && Math.abs(payment.amount - item.amount) < 0.01 && /ozon|озон/i.test(`${payment.name} ${payment.category}`));
      if (duplicate) { skipped += 1; continue; }
      onAddPayment({
        id: generateId("ozon-plan"),
        date: item.date,
        name: "Плановое поступление от Ozon",
        amount: item.amount,
        category: "Поступления от маркетплейсов",
        accountId,
        status: "planned",
        counterparty: "Ozon",
        comment: `${marker} ${itemMarker} ${item.reportAmount ? `[report-total:${item.reportAmount}] ` : ""}${auditMarkers} [state:${item.state}] [date:estimated] ${item.source === "financial_report" ? "Сумма подтверждена отчётом Ozon; дата поступления расчётная до факта банка." : `Расчётный прогноз Ozon по утверждённому плану заказов за ${String(month + 1).padStart(2, "0")}.${year}`}`,
      }, companyId);
      added += 1;
    }
    for (const previous of previousRows) {
      if (!usedPreviousIds.has(previous.id) && previous.date >= new Date().toISOString().slice(0, 10)) {
        void onUpdatePayment({ ...previous, status: "cancelled", comment: `${previous.comment ?? marker} Заменено новой версией плана.` }, companyId);
      }
    }
    window.alert(skipped ? `Добавлено: ${added}. Дубли пропущены: ${skipped}.` : `Добавлено поступлений: ${added}.`);
  };

  return <Card>
    <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-700"><BarChart3 className="h-5 w-5" /></div>
      <div><h2 className="font-semibold text-slate-900">Прогноз поступлений Ozon</h2><p className="text-sm text-slate-500">Отдельный план Ozon, фактические заказы и собственный график выплат.</p></div>
    </div>
    <CardContent className="space-y-4 pt-5">
      <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4">
        <h3 className="font-semibold text-sky-950">Как выплаты настроены в кабинете Ozon</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm text-sky-950">Кабинет<select value={cabinetId || data?.cabinetId || ""} onChange={(event) => applyCabinetSettings(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-sky-200 bg-white px-3">{data?.cabinets.map((cabinet) => <option key={cabinet.id} value={cabinet.id}>{cabinet.name}</option>)}</select></label>
          <label className="text-sm text-sky-950">Компания получатель<select value={companyId} onChange={(event) => { setCompanyId(event.target.value); if (cabinetId) window.localStorage.setItem(`finance:ozon-forecast-company:${cabinetId}`, event.target.value); }} className="mt-1 min-h-11 w-full rounded-lg border border-sky-200 bg-white px-3"><option value="">Выберите компанию</option>{companies.filter((company) => company.isActive).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
          <label className="text-sm text-sky-950">Режим<select value={mode} onChange={(event) => setMode(event.target.value as PayoutMode)} className="mt-1 min-h-11 w-full rounded-lg border border-sky-200 bg-white px-3"><option value="standard">Стандартный график Ozon</option><option value="weekly">Особый еженедельный график</option></select></label>
          {mode === "standard" ? <label className="text-sm text-sky-950">Дней после конца недельного периода<input type="number" min={0} max={60} value={standardDelayDays} onChange={(event) => setStandardDelayDays(Number(event.target.value) || 24)} className="mt-1 min-h-11 w-full rounded-lg border border-sky-200 bg-white px-3" /></label> : <label className="text-sm text-sky-950">День выплаты<select value={weeklyDay} onChange={(event) => setWeeklyDay(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-sky-200 bg-white px-3"><option value={1}>Понедельник</option><option value={2}>Вторник</option><option value={3}>Среда</option><option value={4}>Четверг</option><option value={5}>Пятница</option></select></label>}
        </div>
        {!payoutRulesConfirmed && <div className="mt-3 rounded-lg border border-sky-200 bg-white p-3 text-sm text-sky-950"><p><b>Было:</b> {describeOzonRules(approvedRules)}</p><p className="mt-1"><b>Станет:</b> {describeOzonRules({ mode, weeklyDay, standardDelayDays })}</p><button type="button" onClick={() => { const next = { mode, weeklyDay, standardDelayDays }; setApprovedRules(next); if (cabinetId) window.localStorage.setItem(`finance:ozon-payout-rules:${cabinetId}`, JSON.stringify(next)); }} className="mt-3 min-h-10 rounded-lg bg-sky-600 px-3 font-semibold text-white">Подтвердить правила для календаря</button></div>}
      </div>
      {loading ? <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Считаю прогноз Ozon…</div> : error ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : data && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="План заказов менеджера" value={`${Math.round(data.plannedOrders).toLocaleString("ru-RU")} шт.`} />
          <Metric label="Адаптивный план системы" value={`${Math.round(data.adaptivePlannedOrders).toLocaleString("ru-RU")} шт.`} green={data.orderAdjustmentApplied} />
          <Metric label="Плановая выручка" value={formatMoney(data.planRevenue)} />
          <Metric label="Фактические заказы" value={`${Math.round(data.actualOrders).toLocaleString("ru-RU")} шт.`} />
          <Metric label="Ожидаемое перечисление" value={formatMoney(data.expectedPayout)} green />
        </div>
        <div className={`rounded-xl border p-4 text-sm ${data.orderAdjustmentApplied ? "border-violet-200 bg-violet-50 text-violet-950" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
          <b>Контроль динамики заказов:</b> {data.orderAdjustmentApplied
            ? ` отклонение держится 3 дня, поэтому финансовый прогноз рассчитан по ${Math.round(data.adaptivePlannedOrders).toLocaleString("ru-RU")} заказам вместо ${Math.round(data.plannedOrders).toLocaleString("ru-RU")}. Исходный план менеджера сохранён.`
            : ` отклонение наблюдается ${data.orderDeviationDays} дн. подряд. План менеджера пока не меняется; перерасчёт финансового прогноза начнётся после трёх дней устойчивого отклонения не менее 10%.`}
        </div>
        <div>
          <div className={`rounded-xl border p-4 ${calendarNeedsUpdate ? "border-blue-200 bg-blue-50" : "border-emerald-200 bg-emerald-50"}`}><p className="text-xs uppercase tracking-wide text-slate-500">Связь с планом менеджера</p><p className={`mt-1 font-bold ${calendarNeedsUpdate ? "text-blue-900" : "text-emerald-900"}`}>{calendarNeedsUpdate ? "План изменился — календарь нужно обновить" : previousRows.length ? "Календарь соответствует текущему плану" : "План ещё не утверждён в календарь"}</p></div>
        </div>
        {data.financialAdjustments.length > 0 && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><h3 className="font-semibold text-rose-950">Финансовый отчёт скорректировал прогноз</h3><div className="mt-2 space-y-2 text-sm text-rose-900">{data.financialAdjustments.map((item) => <div key={item.metric}><b>{item.metric}:</b> было {(item.plannedRate * 100).toFixed(1)}%, фактически {(item.actualRate * 100).toFixed(1)}% · влияние {formatMoney(item.impact)}. {item.message}</div>)}</div><p className="mt-2 text-xs text-rose-700">Исходный план менеджера сохранён; эта корректировка применяется только к прогнозу денег.</p></div>}
        {!data.planRows && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">В плане Ozon нет заполненных строк за выбранный месяц.</p>}
        {data.planRows > 0 && !data.planApproved && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Показан рабочий план менеджера. Его можно просматривать, но перенос в платёжный календарь доступен только после утверждения плана.</p>}
        {data.reportDataStatus === "degraded" && <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-900">Ozon временно не вернул полный набор отчётов. Последние подтверждённые строки сохранены, но обновление календаря заблокировано до восстановления API.</p>}
        {data.reconciliationQueue.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><h3 className="font-semibold">Ручная сверка поступлений ДДС</h3><p className="mt-1 text-xs text-amber-800">Укажите, какую часть банковского платежа отнести к каждому отчёту. До подтверждения платёж не считается закрытием отчёта.</p><div className="mt-3 space-y-3">{data.reconciliationQueue.map((receipt) => <div key={receipt.bankReceiptId} className="rounded-lg border border-amber-200 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium text-slate-900">{receipt.date} · {receipt.name || "Поступление Ozon"}</p><p className="text-xs text-slate-500">Сумма платежа: {formatMoney(receipt.paymentAmount)} · {reconciliationReason(receipt.reason)}</p></div><button type="button" disabled={linkingReceiptId === receipt.bankReceiptId} onClick={() => void confirmReceiptLinks(receipt.bankReceiptId)} className="min-h-10 rounded-lg bg-amber-600 px-3 font-semibold text-white disabled:opacity-50">{linkingReceiptId === receipt.bankReceiptId ? "Сохраняю…" : "Подтвердить связь"}</button></div><div className="mt-3 grid gap-2">{data.confirmedPayouts.map((report) => { const key = payoutReportKey(report); return <label key={key} className="grid grid-cols-[1fr_150px] items-center gap-3 rounded-md bg-slate-50 p-2"><span className="text-xs text-slate-700">Отчёт {report.reportId} · {report.periodFrom}—{report.periodTo} · {formatMoney(report.amount)}</span><input type="number" min={0} max={Math.min(report.amount, receipt.paymentAmount)} step="0.01" value={linkDrafts[receipt.bankReceiptId]?.[key] ?? 0} onChange={(event) => setLinkDrafts((current) => ({ ...current, [receipt.bankReceiptId]: { ...(current[receipt.bankReceiptId] ?? {}), [key]: Math.max(0, Number(event.target.value) || 0) } }))} className="min-h-10 rounded-lg border border-slate-300 px-2 text-right" /></label>; })}</div></div>)}</div></div>}
        {data.dataNotices.length > 0 && <details className="rounded-xl border border-sky-200 bg-sky-50 text-sm text-sky-900"><summary className="cursor-pointer px-4 py-3 font-semibold">Источник фактических данных: основная панель Ozon</summary><ul className="space-y-1 border-t border-sky-200 px-6 py-3 text-xs">{data.dataNotices.map((notice) => <li key={notice}>{notice}</li>)}</ul></details>}
        {data.warnings.length > 0 && <details className="rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-900"><summary className="cursor-pointer px-4 py-3 font-semibold"><TriangleAlert className="mr-2 inline h-4 w-4" />Не хватает данных для части расчёта</summary><ul className="space-y-1 border-t border-amber-200 px-6 py-3 text-xs">{data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="grid grid-cols-[1fr_1fr_180px_44px] gap-3 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><span>Дата поступления</span><span>Сумма</span><span>Источник</span><span /></div>
          {schedule.map((item) => <div key={item.id} className="grid grid-cols-[1fr_1fr_180px_44px] items-center gap-3 border-t border-slate-100 px-4 py-3"><input type="date" value={item.date} onChange={(event) => { setFinanceEdited(true); setSchedule((rows) => rows.map((row) => row.id === item.id ? { ...row, date: event.target.value } : row)); }} className="min-h-11 rounded-lg border border-slate-300 px-3" /><input type="number" value={item.amount} onChange={(event) => { setFinanceEdited(true); setSchedule((rows) => rows.map((row) => row.id === item.id ? { ...row, amount: Number(event.target.value) || 0 } : row)); }} className="min-h-11 rounded-lg border border-slate-300 px-3 text-right" /><span className={`rounded-full px-3 py-1 text-center text-xs font-semibold ${item.source === "financial_report" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{item.source === "financial_report" ? "Сумма отчёта · дата расчётная" : financeEdited ? "Корректировка фин отдела" : "Расчётный прогноз"}</span><button aria-label="Удалить" onClick={() => { setFinanceEdited(true); setSchedule((rows) => rows.filter((row) => row.id !== item.id)); }} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></div>)}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="font-semibold">Итого: {formatMoney(total)}</p><div className="flex flex-wrap items-center gap-3"><select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3">{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><button onClick={addToCalendar} disabled={!payoutRulesConfirmed || data.reportDataStatus === "degraded" || !data.planApproved || !schedule.length || !accountId || !companyId} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-sky-600 px-4 font-semibold text-white hover:bg-sky-700 disabled:opacity-50"><CalendarPlus className="h-4 w-4" /> {previousRows.length ? "Подтвердить обновление календаря" : "Подтвердить и добавить"}</button></div></div>
      </>}
    </CardContent>
  </Card>;
}

function safeMarker(value: string) {
  return value.replace(/[\[\]]/g, "").slice(0, 120);
}

function reconciliationReason(reason: ForecastData["reconciliationQueue"][number]["reason"]) {
  if (reason === "ambiguous") return "подходит несколько отчётов";
  if (reason === "partial") return "часть суммы не распределена";
  if (reason === "over_allocation") return "распределение превышает допустимую сумму";
  return "связь с отчётом не указана";
}

function describeOzonRules(rules: { mode: PayoutMode; weeklyDay: number; standardDelayDays: number }) {
  return rules.mode === "weekly" ? `особый еженедельный график, день недели ${rules.weeklyDay}` : `стандартный расчёт, задержка ${rules.standardDelayDays} дн.`;
}

function Metric({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return <div className={`rounded-xl p-4 ${green ? "bg-emerald-50" : "bg-slate-50"}`}><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 text-xl font-bold ${green ? "text-emerald-800" : "text-slate-950"}`}>{value}</p></div>;
}
