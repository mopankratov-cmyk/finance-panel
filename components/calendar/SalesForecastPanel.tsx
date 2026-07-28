"use client";

import { BarChart3, CalendarPlus, Loader2, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { formatMoney, generateId } from "@/lib/format";
import type { Account, Payment } from "@/lib/types";
import type { DdsCompany } from "@/components/payments/ddsCompanies";
import { canWriteForecastToCalendar } from "@/lib/opiu/payoutReconciliation";

interface ForecastItem {
  article: string;
  originalPlanRevenue: number;
  planRevenue: number;
  historicalRevenue: number;
  historicalPayout: number;
  payoutRate: number | null;
  forecastPayout: number | null;
  actualRevenue: number;
  actualOrders: number;
  actualBuyouts: number;
  planUnitPrice: number | null;
  actualUnitPrice: number | null;
  usedUnitPrice: number | null;
  projectedRevenue: number;
  adaptiveRevenue: number;
  weatherAdjustmentPercent: number;
  weatherReason: string | null;
}

interface ForecastResponse {
  cabinetId: string;
  cabinets: { id: string; name: string }[];
  historyFrom: string;
  historyTo: string;
  items: ForecastItem[];
  planRowsCount: number;
  availablePlanPeriods: { year: number; month: number }[];
  planRevenue: number;
  originalPlanRevenue: number;
  forecastPayout: number;
  articlesWithoutHistory: number;
  actualRevenue: number;
  actualOrders: number;
  actualBuyouts: number;
  projectedRevenue: number;
  adaptiveRevenue: number;
  elapsedDays: number;
  daysInMonth: number;
  payoutSchedule: { date: string; availableDate: string; amount: number }[];
  actualPayout: number;
  remainingPayout: number;
  weatherWarnings: { article: string; adjustmentPercent: number; reason: string | null }[];
  stableDeviationDays: number;
  automaticAdjustmentApplied: boolean;
  currentDeviation: number;
  planSource: "sales_plan" | "approved_sales_plan" | "working_sales_plan";
  plannedOrders: number;
  plannedBuyouts: number;
  marketplaceExpenses: number;
  cogs: number;
  advertising: number;
  tax: number;
  plannedProfit: number;
  unitEconomicsMissing: number;
  unitEconomicsMissingDetails: { article: string; reasons: string[] }[];
  orderToSaleLagDays: number;
  orderToSaleLagSource: "history" | "fallback" | "manual";
  orderToSaleLagScore: number;
  payoutRules: PayoutRules;
  dataWarnings: string[];
  error?: string;
}

interface PayoutRules {
  mode: "standard" | "daily_request" | "wb_bank_auto";
  withdrawalWaitDays: number;
  withdrawalIntervalDays: number;
  bankTransferDays: number;
  effectiveFrom: string;
}

export function SalesForecastPanel({ year, month, accounts, companies, existingPayments, onAddPayment, onUpdatePayment }: {
  year: number;
  month: number;
  accounts: Account[];
  companies: DdsCompany[];
  existingPayments: Payment[];
  companyByPayment: Map<string, string | null>;
  onAddPayment: (payment: Payment, companyId?: string | null) => void;
  onUpdatePayment: (payment: Payment, companyId: string | null) => void;
}) {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [cabinetId, setCabinetId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [draftSchedule, setDraftSchedule] = useState<Array<{ id: string; date: string; availableDate: string; expectedDate: string | null; amount: number }>>([]);
  const [changeDate, setChangeDate] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [changeType, setChangeType] = useState("commission_pct");
  const [oldChangeValue, setOldChangeValue] = useState(0);
  const [newChangeValue, setNewChangeValue] = useState(0);
  const [correctionText, setCorrectionText] = useState("");
  const [correctionResult, setCorrectionResult] = useState("");
  const [manualOrderToSaleLag, setManualOrderToSaleLag] = useState<number | null>(null);
  const [payoutRules, setPayoutRules] = useState<PayoutRules>({
    mode: "standard",
    withdrawalWaitDays: 14,
    withdrawalIntervalDays: 7,
    bankTransferDays: 7,
    effectiveFrom: `${year}-${String(month + 1).padStart(2, "0")}-01`,
  });
  const [approvedPayoutRules, setApprovedPayoutRules] = useState<PayoutRules>(payoutRules);

  const selectCabinet = useCallback((nextCabinetId: string, cabinetName = "") => {
    setCabinetId(nextCabinetId);
    const defaultRules: PayoutRules = {
      mode: "standard",
      withdrawalWaitDays: 14,
      withdrawalIntervalDays: 7,
      bankTransferDays: 7,
      effectiveFrom: `${year}-${String(month + 1).padStart(2, "0")}-01`,
    };
    const rulesKey = `finance:wb-payout-rules:${nextCabinetId}`;
    const savedRules = window.localStorage.getItem(rulesKey);
    if (savedRules) {
      try {
        const parsed = JSON.parse(savedRules) as Partial<PayoutRules>;
        setPayoutRules((current) => { const next = { ...current, ...parsed }; setApprovedPayoutRules(next); return next; });
      } catch {
        window.localStorage.removeItem(rulesKey);
        setPayoutRules(defaultRules);
        setApprovedPayoutRules(defaultRules);
      }
    } else {
      setPayoutRules(defaultRules);
      setApprovedPayoutRules(defaultRules);
    }
    const savedLag = window.localStorage.getItem(`finance:wb-order-to-sale-lag:${nextCabinetId}`);
    setManualOrderToSaleLag(savedLag !== null && Number.isFinite(Number(savedLag)) ? Number(savedLag) : null);
    const savedCompany = window.localStorage.getItem(`finance:wb-forecast-company:${nextCabinetId}`);
    const inferredCompany = inferCompanyForCabinet(cabinetName, companies);
    setCompanyId(savedCompany && companies.some((company) => company.id === savedCompany && company.isActive)
      ? savedCompany
      : inferredCompany?.id ?? "");
  }, [companies, month, year]);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({
      year: String(year),
      month: String(month + 1),
      payoutMode: payoutRules.mode,
      withdrawalWaitDays: String(payoutRules.withdrawalWaitDays),
      withdrawalIntervalDays: String(payoutRules.withdrawalIntervalDays),
      bankTransferDays: String(payoutRules.bankTransferDays),
      effectiveFrom: payoutRules.effectiveFrom,
    });
    if (manualOrderToSaleLag !== null) query.set("orderToSaleLagDays", String(manualOrderToSaleLag));
    if (cabinetId) query.set("cabinet", cabinetId);
    setLoading(true);
    fetch(`/api/opiu/forecast?${query}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as ForecastResponse;
        if (!response.ok) throw new Error(result.error ?? "Ошибка расчёта");
        if (!cancelled) {
          setData(result);
          if (!cabinetId && result.cabinetId) selectCabinet(result.cabinetId, result.cabinets.find((cabinet) => cabinet.id === result.cabinetId)?.name);
          setError("");
          setLoading(false);
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "Не удалось рассчитать прогноз");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [year, month, payoutRules, manualOrderToSaleLag, cabinetId, selectCabinet]);

  const isPercentChange = changeType.endsWith("_pct");
  const isScheduleChange = changeType === "payout_schedule";
  const adjustment = isScheduleChange || !data
    ? 0
    : isPercentChange
      ? -data.adaptiveRevenue * (newChangeValue - oldChangeValue) / 100
      : oldChangeValue - newChangeValue;
  const expectedPayout = Math.max(0, (data?.forecastPayout ?? 0) + adjustment);
  const articleRows = useMemo(() => data?.items.slice().sort((a, b) => b.planRevenue - a.planRevenue) ?? [], [data]);
  const scheduleTarget = Math.max(0, (data?.remainingPayout ?? 0) + adjustment);
  const selectedCabinetName = data?.cabinets.find((cabinet) => cabinet.id === (cabinetId || data.cabinetId))?.name ?? "Кабинет не выбран";
  const selectedCompanyName = companies.find((company) => company.id === companyId)?.name ?? "Компания не выбрана";
  const payoutRulesConfirmed = JSON.stringify(payoutRules) === JSON.stringify(approvedPayoutRules);
  const calendarWriteAllowed = canWriteForecastToCalendar(data?.planSource ?? "none", payoutRulesConfirmed);
  const approvalBlockReason = !companyId
    ? "Выберите компанию, на которую поступят деньги."
    : !accountId
      ? "Выберите банковский счёт получения."
      : data?.planSource !== "approved_sales_plan"
        ? "В календарь можно переносить только утверждённый кабинетный план менеджера."
      : !payoutRulesConfirmed
        ? "Подтвердите изменённые правила выплат перед обновлением календаря."
      : !draftSchedule.some((item) => item.date && item.amount > 0)
        ? "Нет положительной суммы для добавления: проверьте план, расчёт и будущие даты поступлений."
        : "";
  const observedBankDelayDays = useMemo(() => {
    const delays = existingPayments
      .filter((payment) => payment.status === "done" && payment.amount > 0 && /wildberries|вайлдберриз|вб\b/i.test(`${payment.name} ${payment.category} ${payment.counterparty ?? ""}`))
      .map((payment) => businessDaysFromMonday(payment.date))
      .filter((value) => value >= 0 && value <= 7)
      .sort((left, right) => left - right);
    return delays.length >= 3 ? delays[Math.floor(delays.length / 2)] : null;
  }, [existingPayments]);

  useEffect(() => {
    if (!data?.payoutSchedule.length) {
      setDraftSchedule([]);
      return;
    }
    const sourceTotal = data.payoutSchedule.reduce((sum, item) => sum + item.amount, 0);
    let allocated = 0;
    setDraftSchedule(data.payoutSchedule.map((item, index) => {
      const amount = index === data.payoutSchedule.length - 1
        ? Math.max(0, scheduleTarget - allocated)
        : Math.round(sourceTotal > 0 ? scheduleTarget * item.amount / sourceTotal : scheduleTarget / data.payoutSchedule.length);
      allocated += amount;
      return {
        id: `${item.date}-${index}`,
        date: item.date,
        availableDate: item.availableDate,
        expectedDate: observedBankDelayDays === null ? null : addBusinessDaysIso(item.availableDate, observedBankDelayDays),
        amount,
      };
    }));
  }, [data, observedBankDelayDays, scheduleTarget]);

  const applyTextCorrection = () => {
    const text = correctionText.trim().toLowerCase();
    const applied: string[] = [];
    const lagMatch = text.match(/(?:от\s+заказа\s+до\s+(?:продажи|выкупа)|срок[^\d]{0,20}(?:продажи|выкупа))[^\d]{0,20}(\d{1,2})\s*(?:дн|день|дня|дней)/i);
    if (lagMatch) {
      const days = Math.min(45, Math.max(0, Number(lagMatch[1])));
      setManualOrderToSaleLag(days);
      if (cabinetId) window.localStorage.setItem(`finance:wb-order-to-sale-lag:${cabinetId}`, String(days));
      applied.push(`срок от заказа до продажи — ${days} дн.`);
    }
    const availabilityMatch = text.match(/(?:доступност|можно\s+вывест)[^\d]{0,20}(\d{1,2})\s*(?:дн|день|дня|дней)/i);
    if (availabilityMatch) {
      const days = Math.min(45, Math.max(0, Number(availabilityMatch[1])));
      setPayoutRules((current) => ({ ...current, withdrawalWaitDays: days }));
      applied.push(`до доступности вывода — ${days} дн.`);
    }
    const bankMatch = text.match(/(?:банк|расч[её]тн)[^\d]{0,24}(\d{1,2})\s*(?:рабоч\w*\s*)?(?:дн|день|дня|дней)/i);
    if (bankMatch) {
      const days = Math.min(30, Math.max(0, Number(bankMatch[1])));
      setPayoutRules((current) => ({ ...current, bankTransferDays: days }));
      applied.push(`перевод в банк — ${days} раб. дн.`);
    }
    setCorrectionResult(applied.length ? `Применено: ${applied.join("; ")}` : "Не удалось уверенно распознать изменение. Напишите, например: «от заказа до продажи 10 дней». ");
  };

  const restoreAutomaticLag = () => {
    setManualOrderToSaleLag(null);
    if (cabinetId) window.localStorage.removeItem(`finance:wb-order-to-sale-lag:${cabinetId}`);
    setCorrectionResult("Возвращён автоматический расчёт срока по истории РНП.");
  };

  const addForecastSchedule = () => {
    if (!accountId || !companyId || !data || !calendarWriteAllowed || !draftSchedule.length) return;
    let added = 0;
    let skipped = 0;
    const marker = `[forecast:wb:${cabinetId}:${companyId}]`;
    const previousRows = existingPayments.filter((payment) => payment.status === "planned" && payment.comment?.includes(marker));
    const usedPreviousIds = new Set<string>();
    for (const item of draftSchedule) {
      if (!item.date || item.amount <= 0) continue;
      const previous = previousRows.find((payment) => payment.date === item.date);
      if (previous) {
        usedPreviousIds.add(previous.id);
        onUpdatePayment({ ...previous, amount: item.amount, accountId, comment: `${marker} Расчётная дата прихода денег с учётом срока до продажи, доступности вывода и банковского перевода.` }, companyId);
        added += 1;
        continue;
      }
      const duplicate = existingPayments.some((payment) =>
        payment.status === "planned" &&
        payment.accountId === accountId &&
        payment.date === item.date &&
        Math.abs(payment.amount - item.amount) < 0.01 &&
        payment.category === "Поступления от маркетплейсов");
      if (duplicate) {
        skipped += 1;
        continue;
      }
      onAddPayment({
        id: generateId("sales-plan"),
        date: item.date,
        name: "Плановое поступление от Wildberries по графику вывода",
        amount: item.amount,
        category: "Поступления от маркетплейсов",
        accountId,
        status: "planned",
        counterparty: "Маркетплейсы",
        comment: `${marker} Расчётная дата прихода денег с учётом срока до продажи, доступности вывода и банковского перевода. План ${formatMoney(data.planRevenue)}, адаптивный план ${formatMoney(data.adaptiveRevenue)}.`,
      }, companyId || null);
      added += 1;
    }
    for (const previous of previousRows) {
      if (!usedPreviousIds.has(previous.id) && previous.date >= new Date().toISOString().slice(0, 10)) {
        onUpdatePayment({ ...previous, status: "cancelled", comment: `${previous.comment ?? marker} Заменено новой версией плана.` }, companyId);
      }
    }
    window.alert(skipped ? `Добавлено: ${added}. Уже были в календаре и пропущены: ${skipped}.` : `Добавлено поступлений: ${added}.`);
  };

  return (
    <Card>
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><BarChart3 className="h-5 w-5" /></div>
        <div>
          <h2 className="font-semibold text-slate-900">Прогноз поступлений Wildberries</h2>
          <p className="text-sm text-slate-500">План заказов и выкупа × актуальная юнит-экономика. ОПиУ для расчёта не требуется.</p>
        </div>
      </div>
      <CardContent className="space-y-4 pt-5">
        {loading ? <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Считаю по отчётам…</div>
          : error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
          : data && <>
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Сейчас рассчитывается</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-medium text-violet-950">Кабинет Wildberries<select value={cabinetId || data.cabinetId} onChange={(event) => selectCabinet(event.target.value, data.cabinets.find((cabinet) => cabinet.id === event.target.value)?.name)} className="mt-1 min-h-11 w-full rounded-lg border border-violet-200 bg-white px-3">{data.cabinets.map((cabinet) => <option key={cabinet.id} value={cabinet.id}>{cabinet.name}</option>)}</select></label>
                <label className="text-sm font-medium text-violet-950">Компания получатель<select value={companyId} onChange={(event) => { setCompanyId(event.target.value); if (cabinetId || data.cabinetId) window.localStorage.setItem(`finance:wb-forecast-company:${cabinetId || data.cabinetId}`, event.target.value); }} className="mt-1 min-h-11 w-full rounded-lg border border-violet-200 bg-white px-3"><option value="">Выберите компанию</option>{companies.filter((company) => company.isActive).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
              </div>
              <p className="mt-3 text-sm text-violet-900">План и поступления ниже относятся к связке: <b>{selectedCabinetName}</b> → <b>{selectedCompanyName}</b>.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="План заказов" value={data.plannedOrders} unit="шт." />
              <Metric label="Ожидаемый выкуп" value={data.plannedBuyouts} unit="шт." />
              <Metric label="Выручка по цене из плана" value={data.originalPlanRevenue} />
              <Metric label="План по текущей цене продажи" value={data.planRevenue} />
              <Metric label={`Фактические заказы за ${data.elapsedDays} дн.`} value={data.actualOrders} unit="шт." />
              <Metric label="Фактические выкупы" value={data.actualBuyouts} unit="шт." />
              <Metric label="Фактические продажи по РНП" value={data.actualRevenue} />
              <Metric label="Прогноз продаж по темпу" value={data.projectedRevenue} />
              <Metric label="Ожидаемое перечисление WB" value={data.forecastPayout} green />
              <Metric label="Расходы маркетплейса" value={data.marketplaceExpenses} />
              <Metric label="Плановая прибыль" value={data.plannedProfit} green={data.plannedProfit >= 0} />
              {adjustment !== 0 && <Metric label="После изменений МП" value={expectedPayout} green={expectedPayout >= data.forecastPayout} />}
            </div>
            <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-4">
              <Expense label="Себестоимость" value={data.cogs} />
              <Expense label="Реклама" value={data.advertising} />
              <Expense label="Налог" value={data.tax} />
              <Expense label="Удержания WB" value={data.marketplaceExpenses} />
            </div>
            {data.unitEconomicsMissing > 0 && (
              <details className="rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-900">
                <summary className="cursor-pointer px-4 py-3 font-semibold"><TriangleAlert className="mr-2 inline h-5 w-5" />Для {data.unitEconomicsMissing} артикулов юнит-экономика заполнена не полностью</summary>
                <div className="max-h-72 overflow-auto border-t border-amber-200">
                  <table className="w-full text-sm"><thead className="bg-amber-100/60 text-left text-xs uppercase text-amber-900"><tr><th className="px-4 py-2">Артикул</th><th className="px-4 py-2">Чего не хватает</th></tr></thead><tbody className="divide-y divide-amber-200">{data.unitEconomicsMissingDetails.map((item) => <tr key={item.article}><td className="px-4 py-2 font-medium">{item.article}</td><td className="px-4 py-2">{item.reasons.join("; ")}</td></tr>)}</tbody></table>
                </div>
              </details>
            )}
            <p className="rounded-lg bg-violet-50 p-3 text-sm text-violet-900">
              От заказа до продажи заложено <b>{data.orderToSaleLagDays} дн.</b> {data.orderToSaleLagSource === "manual" ? "Используется ваша ручная корректировка." : data.orderToSaleLagSource === "history" ? "Срок рассчитан по динамике заказов и продаж РНП и будет обновляться вместе с историей." : "Пока используется безопасное значение 8 дней: истории недостаточно для уверенного расчёта."}
            </p>
            <div className="rounded-xl border border-violet-200 bg-white p-4">
              <h3 className="font-semibold text-slate-900">Скорректировать расчёт текстом</h3>
              <p className="mt-1 text-sm text-slate-500">Напишите обычной фразой, что изменить. Панель применит распознанные сроки и сразу пересчитает даты.</p>
              <textarea value={correctionText} onChange={(event) => setCorrectionText(event.target.value)} rows={2} placeholder="Например: от заказа до продажи 10 дней" className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={applyTextCorrection} disabled={!correctionText.trim()} className="min-h-10 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50">Применить и пересчитать</button>
                {manualOrderToSaleLag !== null && <button type="button" onClick={restoreAutomaticLag} className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Вернуть автоматический расчёт</button>}
                {correctionResult && <span className="text-sm text-slate-600">{correctionResult}</span>}
              </div>
            </div>
            {data.dataWarnings.length > 0 && (
              <details className="rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-900">
                <summary className="cursor-pointer px-4 py-3 font-semibold">Часть данных временно недоступна — расчёт выполнен по доступным источникам</summary>
                <ul className="space-y-1 border-t border-amber-200 px-6 py-3 text-xs">
                  {data.dataWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </details>
            )}
            {data.planRowsCount === 0 && (
              <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="font-semibold">План продаж за {String(month + 1).padStart(2, "0")}.{year} не найден</p>
                <p className="mt-1 text-amber-800">
                  В общем плане заказов нет заполненных строк Wildberries за выбранный месяц. Откройте план заказов, выберите нужный кабинет и проверьте июль.
                  {data.availablePlanPeriods.length > 0
                    ? ` Дополнительно найдены старые планы за периоды: ${data.availablePlanPeriods.map((period) => `${String(period.month).padStart(2, "0")}.${period.year}`).join(", ")}.`
                    : " Ни в утверждённой, ни в рабочей версии плана строк этого месяца нет."}
                </p>
              </div>
            )}
            {data.planRowsCount > 0 && data.planSource === "working_sales_plan" && (
              <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
                Расчёт выполнен по рабочей версии плана. После утверждения месяца прогноз автоматически переключится на утверждённую версию.
              </div>
            )}
            {data.planRowsCount > 0 && data.planRevenue === 0 && (
              <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="font-semibold">План найден, но плановая выручка равна нулю</p>
                <p className="mt-1 text-amber-800">Заполните поле <code>plan_revenue</code> у артикулов выбранного месяца.</p>
              </div>
            )}
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              Адаптивный план продаж: <b>{formatMoney(data.adaptiveRevenue)}</b>. Расчётный прогноз поступлений: <b>{formatMoney(data.remainingPayout)}</b>. Сверка с конкретными финансовыми отчётами WB будет подключена отдельно; здесь факт выплаты не заявляется.
            </p>
            {!data.automaticAdjustmentApplied && data.stableDeviationDays > 0 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <b>Пока календарь не меняем.</b> По текущему темпу продажи идут {data.currentDeviation >= 0 ? "выше" : "ниже"} плана на {Math.abs(data.currentDeviation * 100).toFixed(1)}%. Такая динамика наблюдается {data.stableDeviationDays} дн. подряд. Если она сохранится ещё {Math.max(0, 3 - data.stableDeviationDays)} дн., панель пересчитает будущие поступления.
              </p>
            )}
            {data.articlesWithoutHistory > 0 && (
              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <TriangleAlert className="h-5 w-5 shrink-0" />
                Для {data.articlesWithoutHistory} артикулов нет достаточной истории. Они не включены в прогноз и требуют ручной оценки.
              </div>
            )}
            {data.weatherWarnings.length > 0 && (
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
                <h3 className="font-semibold text-sky-950">Погода влияет на сезонные товары</h3>
                <div className="mt-2 space-y-1 text-sm text-sky-900">
                  {data.weatherWarnings.map((warning) => (
                    <p key={warning.article}><b>{warning.article}</b>: прогноз увеличен на {warning.adjustmentPercent.toFixed(1)}% · {warning.reason}</p>
                  ))}
                </div>
              </div>
            )}
            <details className="rounded-xl border border-slate-200">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">Показать расчёт по артикулам ({articleRows.length})</summary>
              <div className="max-h-72 overflow-auto border-t border-slate-100">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-2 text-left">Артикул</th><th className="px-4 py-2 text-right">Цена в плане</th><th className="px-4 py-2 text-right">Цена сейчас</th><th className="px-4 py-2 text-right">План</th><th className="px-4 py-2 text-right">Факт продаж</th><th className="px-4 py-2 text-right">Темп месяца</th><th className="px-4 py-2 text-right">Доля выплаты</th><th className="px-4 py-2 text-right">Прогноз</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">{articleRows.map((item) => (
                    <tr key={item.article}><td className="px-4 py-2 font-medium">{item.article}</td><td className="px-4 py-2 text-right tabular-nums">{item.planUnitPrice === null ? "—" : formatMoney(item.planUnitPrice)}</td><td className={`px-4 py-2 text-right tabular-nums ${item.actualUnitPrice && item.planUnitPrice && Math.abs(item.actualUnitPrice - item.planUnitPrice) / item.planUnitPrice > 0.05 ? "font-semibold text-violet-700" : ""}`}>{item.actualUnitPrice === null ? "Нет продаж" : formatMoney(item.actualUnitPrice)}</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(item.planRevenue)}</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(item.actualRevenue)}</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(item.projectedRevenue)}</td><td className="px-4 py-2 text-right tabular-nums">{item.payoutRate === null ? "Нет ставок" : `${(item.payoutRate * 100).toFixed(1)}%`}</td><td className="px-4 py-2 text-right font-semibold tabular-nums">{item.forecastPayout === null ? "—" : formatMoney(item.forecastPayout)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </details>
            <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4">
              <h3 className="font-semibold text-violet-950">Правила перечисления Wildberries</h3>
              <p className="mt-1 text-sm text-violet-800">
                Для обычного режима продажи собираются в еженедельный отчёт, вывод становится доступен через {payoutRules.withdrawalWaitDays} дней после отчёта, а поступление в банк может занять до {payoutRules.bankTransferDays} рабочих дней.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <label className="text-sm text-violet-950">Режим выплаты<select value={payoutRules.mode} onChange={(event) => setPayoutRules((current) => ({ ...current, mode: event.target.value as PayoutRules["mode"] }))} className="mt-1 min-h-11 w-full rounded-lg border border-violet-200 bg-white px-3"><option value="standard">Обычный — действует сейчас</option><option value="daily_request">Запрос вывода в любой день</option><option value="wb_bank_auto">Автовывод в WB Банк</option></select></label>
                {payoutRules.mode === "standard" && <RuleField label="Дней от отчёта до доступности" value={payoutRules.withdrawalWaitDays} onChange={(value) => setPayoutRules((current) => ({ ...current, withdrawalWaitDays: value }))} />}
                {payoutRules.mode !== "wb_bank_auto" && <RuleField label="Рабочих дней до прихода в банк" value={payoutRules.bankTransferDays} onChange={(value) => setPayoutRules((current) => ({ ...current, bankTransferDays: value }))} />}
                <label className="text-sm text-violet-950">Правило действует с<input type="date" value={payoutRules.effectiveFrom} onChange={(event) => setPayoutRules((current) => ({ ...current, effectiveFrom: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-violet-200 bg-white px-3" /></label>
              </div>
              <p className="mt-3 text-xs text-violet-700">Это пользовательские расчётные настройки, а не автоматически подтверждённые правила WB. Изменение сразу пересчитывает предварительный просмотр.</p>
              {!payoutRulesConfirmed && <div className="mt-3 rounded-lg border border-violet-200 bg-white p-3 text-sm text-violet-950"><p><b>Было:</b> {describePayoutRules(approvedPayoutRules)}</p><p className="mt-1"><b>Станет:</b> {describePayoutRules(payoutRules)}</p><button type="button" onClick={() => { setApprovedPayoutRules(payoutRules); if (cabinetId) window.localStorage.setItem(`finance:wb-payout-rules:${cabinetId}`, JSON.stringify(payoutRules)); }} className="mt-3 min-h-10 rounded-lg bg-violet-600 px-3 font-semibold text-white">Подтвердить правила для календаря</button></div>}
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
              <h3 className="font-semibold text-blue-950">Известное изменение маркетплейса</h3>
              <p className="mt-1 text-sm text-blue-800">Укажите старое и новое условие — влияние на поступление панель рассчитает сама.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <label className="text-sm text-blue-950">Что изменилось<select value={changeType} onChange={(event) => setChangeType(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-blue-200 bg-white px-3"><option value="commission_pct">Комиссия, %</option><option value="logistics_pct">Логистика, %</option><option value="storage_pct">Хранение, %</option><option value="acquiring_pct">Эквайринг, %</option><option value="other_pct">Другой расход, %</option><option value="fixed_rub">Фиксированный расход, ₽</option><option value="payout_schedule">График перечисления</option></select></label>
                <label className="text-sm text-blue-950">Действует с<input type="date" value={changeDate} onChange={(event) => setChangeDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-blue-200 bg-white px-3" /></label>
                {!isScheduleChange && <label className="text-sm text-blue-950">Было, {isPercentChange ? "%" : "₽"}<input type="number" value={oldChangeValue} onChange={(event) => setOldChangeValue(Number(event.target.value) || 0)} className="mt-1 min-h-11 w-full rounded-lg border border-blue-200 bg-white px-3" /></label>}
                {!isScheduleChange && <label className="text-sm text-blue-950">Стало, {isPercentChange ? "%" : "₽"}<input type="number" value={newChangeValue} onChange={(event) => setNewChangeValue(Number(event.target.value) || 0)} className="mt-1 min-h-11 w-full rounded-lg border border-blue-200 bg-white px-3" /></label>}
                <label className="text-sm text-blue-950">Пояснение<input value={changeReason} onChange={(event) => setChangeReason(event.target.value)} placeholder="Например, новое условие WB" className="mt-1 min-h-11 w-full rounded-lg border border-blue-200 bg-white px-3" /></label>
              </div>
              {isScheduleChange
                ? <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-sm text-blue-900">Сумма выплаты не изменится. Новые сроки внесите в блок «Правила перечисления Wildberries» выше.</p>
                : <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-sm text-blue-900">Расчётное влияние: <b>{adjustment > 0 ? "+" : ""}{formatMoney(adjustment)}</b>. Ожидаемое перечисление после изменения: <b>{formatMoney(expectedPayout)}</b>.</p>}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3">
                <h3 className="font-semibold text-slate-900">Проверить будущие поступления</h3>
                <p className="mt-1 text-sm text-slate-500">Проверьте даты и суммы. При необходимости исправьте их, затем подтвердите добавление в календарь.</p>
              </div>
              <label className="block text-sm font-medium text-slate-700">Счёт получения<select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 sm:max-w-md">{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
              <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                <div className="grid grid-cols-[1fr_1fr_1fr_1fr_44px] gap-3 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><span>Можно вывести</span><span>Ожидаем по истории</span><span>На счёте не позднее</span><span>Сумма</span><span /></div>
                {draftSchedule.length ? <div className="divide-y divide-slate-100">{draftSchedule.map((item) => (
                  <div key={item.id} className="grid grid-cols-[1fr_1fr_1fr_1fr_44px] items-center gap-3 px-4 py-3">
                    <input aria-label="Дата доступности вывода" type="date" value={item.availableDate} readOnly className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 text-slate-600" />
                    {item.expectedDate ? <input aria-label="Ожидаемая дата по истории" type="date" value={item.expectedDate} readOnly className="min-h-11 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-emerald-800" /> : <span className="flex min-h-11 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">Мало истории</span>}
                    <input aria-label="Дата поступления" type="date" value={item.date} onChange={(event) => setDraftSchedule((rows) => rows.map((row) => row.id === item.id ? { ...row, date: event.target.value } : row))} className="min-h-11 rounded-lg border border-slate-300 px-3" />
                    <input aria-label="Сумма поступления" type="number" min={0} step="0.01" value={item.amount} onChange={(event) => setDraftSchedule((rows) => rows.map((row) => row.id === item.id ? { ...row, amount: Number(event.target.value) || 0 } : row))} className="min-h-11 rounded-lg border border-slate-300 px-3 text-right tabular-nums" />
                    <button type="button" onClick={() => setDraftSchedule((rows) => rows.filter((row) => row.id !== item.id))} aria-label="Убрать поступление" className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}</div> : <p className="px-4 py-6 text-center text-sm text-slate-500">Нет будущих поступлений для добавления.</p>}
              </div>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-600">Итого: <b className="tabular-nums text-slate-950">{formatMoney(draftSchedule.reduce((sum, item) => sum + item.amount, 0))}</b></p>
                <button onClick={addForecastSchedule} disabled={Boolean(approvalBlockReason)} title={approvalBlockReason || undefined} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><CalendarPlus className="h-4 w-4" /> Утвердить для {selectedCompanyName} и добавить</button>
              </div>
              <p className={`mt-3 text-xs ${approvalBlockReason ? "font-medium text-amber-700" : "text-slate-500"}`}>{approvalBlockReason || "Перед добавлением система проверит дату, сумму и счёт и пропустит уже существующие записи."}</p>
            </div>
          </>}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, green, unit }: { label: string; value: number; green?: boolean; unit?: string }) {
  return <div className={`rounded-xl p-4 ${green ? "bg-emerald-50" : "bg-slate-50"}`}><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 text-xl font-bold tabular-nums ${green ? "text-emerald-800" : "text-slate-950"}`}>{unit ? `${Math.round(value).toLocaleString("ru-RU")} ${unit}` : formatMoney(value)}</p></div>;
}

function businessDaysFromMonday(isoDate: string) {
  const date = new Date(`${isoDate}T12:00:00`);
  const weekday = date.getDay();
  if (weekday === 0 || weekday === 6) return 7;
  return weekday - 1;
}

function addBusinessDaysIso(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00`);
  let remaining = Math.max(0, Math.round(days));
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) remaining -= 1;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function Expense({ label, value }: { label: string; value: number }) {
  return <div><p className="text-xs text-slate-500">{label}</p><p className="mt-0.5 font-semibold tabular-nums text-slate-800">{formatMoney(value)}</p></div>;
}

function inferCompanyForCabinet(cabinetName: string, companies: DdsCompany[]) {
  const normalize = (value: string) => value
    .toLowerCase()
    .replace(/[«»"'()]/g, " ")
    .replace(/\b(?:ооо|ип|кабинет|wildberries|wb)\b/g, " ")
    .replace(/[^а-яa-z0-9]+/g, " ")
    .trim();
  const cabinet = normalize(cabinetName).replace(/филиппов/g, "коровкин");
  if (!cabinet) return null;
  const matches = companies.filter((company) => {
    if (!company.isActive) return false;
    const name = normalize(company.name).replace(/филиппов/g, "коровкин");
    return name && (cabinet.includes(name) || name.includes(cabinet));
  });
  return matches.length === 1 ? matches[0] : null;
}

function RuleField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="text-sm text-violet-950">{label}<input type="number" min={0} max={90} value={value} onChange={(event) => onChange(Math.min(90, Math.max(0, Number(event.target.value) || 0)))} className="mt-1 min-h-11 w-full rounded-lg border border-violet-200 bg-white px-3" /></label>;
}

function describePayoutRules(rules: PayoutRules) {
  const mode = rules.mode === "standard" ? "обычный режим" : rules.mode === "daily_request" ? "вывод по запросу" : "автовывод в WB Банк";
  return `${mode}; ожидание ${rules.withdrawalWaitDays} дн.; банк ${rules.bankTransferDays} раб. дн.; действует с ${rules.effectiveFrom}`;
}
