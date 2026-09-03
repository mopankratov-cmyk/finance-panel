"use client";

import { AlertCircle, CheckCircle2, FileText, LoaderCircle, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { DdsCompany } from "@/components/payments/ddsCompanies";
import type { Account, Loan, LoanStatus, PaymentStatus } from "@/lib/types";
import type { LoanCurrency, RecognizedLoan } from "./loanRecognition";
import type { LoanDisbursement } from "./loanInterest";
import { roundLoanMoney } from "@/lib/opiu/loanCurrency";
import { emptyScheduleRow, normalizeScheduleMoney, type LoanScheduleDraft } from "@/lib/loans/schedule";
import type { LoanCorrectionsOutcome, LoanRecognitionOutcome } from "@/lib/loans/recognizeLoan";

// Распознавание и построение графика — на сервере (/api/opiu/loan-recognize).
// Форма только отправляет файл с описанием и показывает результат: у любого
// сотрудника по одному документу получается одно и то же.
export type { LoanScheduleDraft };

export interface LoanFormResult {
  loan: Omit<Loan, "id">;
  accountId: string;
  companyId: string;
  contractFileName: string;
  contractNumber: string;
  schedule: LoanScheduleDraft[];
  currency: LoanCurrency;
  originalPrincipal: number;
  exchangeRate: number;
  annualRate: number;
  originationFee: number;
  feeAmortizationMonths: number;
  interestFrequency: RecognizedLoan["interestFrequency"];
  monthlyRate: number;
  disbursements: LoanDisbursement[];
  paymentDays?: [number, number];
  contractFile?: File;
}

interface LoanFormProps {
  loan?: Loan;
  accounts: Account[];
  companies: DdsCompany[];
  companyId?: string | null;
  accountId?: string;
  contractFileName?: string;
  contractNumber?: string;
  schedule?: LoanScheduleDraft[];
  currency?: LoanCurrency;
  originalPrincipal?: number;
  exchangeRate?: number;
  annualRate?: number;
  originationFee?: number;
  feeAmortizationMonths?: number;
  interestFrequency?: RecognizedLoan["interestFrequency"];
  monthlyRate?: number;
  disbursements?: LoanDisbursement[];
  paymentDays?: [number, number];
  onSubmit: (result: LoanFormResult) => void | Promise<void>;
  onCancel: () => void;
}

const fieldClass = "mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100";
const emptySchedule = emptyScheduleRow;
const initialRecognition = (): RecognizedLoan => ({ contractNumber: "", creditorName: "", companyHint: "", accountHint: "", principalAmount: 0, currency: "RUB", annualRate: 0, originationFee: 0, feeAmortizationMonths: 36, startDate: "", dueDate: "", interestFrequency: "unknown", confidence: 0, warnings: [] });







function scheduleSourceAmount(row: LoanScheduleDraft, kind: "principal" | "interest" | "penalty" | "fine", currency: LoanCurrency, rate: number): number {
  if (currency === "RUB") return Number(row[kind] || 0);
  const original = row[`${kind}Original` as "principalOriginal" | "interestOriginal" | "penaltyOriginal" | "fineOriginal"];
  return Number.isFinite(original) ? Number(original) : Number(row[kind] || 0) / (rate || 1);
}

export function LoanForm({ loan, accounts, companies, companyId, accountId, contractFileName, contractNumber = "", schedule: initialSchedule, currency = "RUB", originalPrincipal, exchangeRate: initialExchangeRate = 1, annualRate, originationFee = 0, feeAmortizationMonths = 36, interestFrequency, monthlyRate = 0, disbursements = [], paymentDays, onSubmit, onCancel }: LoanFormProps) {
  const editing = Boolean(loan);
  const [stage, setStage] = useState<"source" | "review">(editing ? "review" : "source");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<RecognizedLoan>(() => loan ? {
    ...initialRecognition(),
    contractNumber,
    creditorName: loan.creditorName,
    principalAmount: roundLoanMoney(originalPrincipal ?? loan.principalAmount),
    currency,
    annualRate: annualRate ?? loan.interestRatePerDay * 365,
    originationFee: roundLoanMoney(originationFee),
    feeAmortizationMonths,
    startDate: loan.startDate,
    dueDate: loan.dueDate,
    interestFrequency: interestFrequency ?? (initialSchedule && initialSchedule.length > 1 ? "monthly" : "unknown"),
    monthlyRate,
    disbursements,
    paymentDays,
    confidence: 100,
  } : initialRecognition());
  const [selectedCompany, setSelectedCompany] = useState(companyId ?? "");
  const [selectedAccount, setSelectedAccount] = useState(accountId ?? accounts[0]?.id ?? "");
  const [exchangeRate, setExchangeRate] = useState(initialExchangeRate);
  const [rateDate, setRateDate] = useState("");
  const [schedule, setSchedule] = useState<LoanScheduleDraft[]>(initialSchedule?.length ? initialSchedule.map(normalizeScheduleMoney) : [emptySchedule()]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [correctionNotice, setCorrectionNotice] = useState("");
  const [correctionText, setCorrectionText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const totals = useMemo(() => schedule.reduce((sum, row) => ({ principal: sum.principal + Number(row.principal || 0), interest: sum.interest + Number(row.interest || 0), penalty: sum.penalty + Number(row.penalty || 0), fine: sum.fine + Number(row.fine || 0) }), { principal: 0, interest: 0, penalty: 0, fine: 0 }), [schedule]);
  const originalTotals = useMemo(() => schedule.reduce((sum, row) => ({
    principal: sum.principal + scheduleSourceAmount(row, "principal", data.currency, exchangeRate),
    interest: sum.interest + scheduleSourceAmount(row, "interest", data.currency, exchangeRate),
    penalty: sum.penalty + scheduleSourceAmount(row, "penalty", data.currency, exchangeRate),
    fine: sum.fine + scheduleSourceAmount(row, "fine", data.currency, exchangeRate),
  }), { principal: 0, interest: 0, penalty: 0, fine: 0 }), [data.currency, exchangeRate, schedule]);

  const updateData = (patch: Partial<RecognizedLoan>) => setData((current) => ({ ...current, ...patch }));
  const updateSchedule = (id: string, patch: Partial<LoanScheduleDraft>) => setSchedule((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  const updateScheduleMoney = (id: string, kind: "principal" | "interest" | "penalty" | "fine", value: number) => {
    const originalKey = `${kind}Original` as "principalOriginal" | "interestOriginal" | "penaltyOriginal" | "fineOriginal";
    const roundedValue = roundLoanMoney(value);
    setSchedule((current) => current.map((row) => row.id === id ? {
      ...row,
      [kind]: roundLoanMoney(data.currency === "RUB" ? roundedValue : roundedValue * exchangeRate),
      [originalKey]: roundedValue,
    } : row));
  };

  const loadRate = async (currency: LoanCurrency) => {
    if (currency === "RUB") {
      setExchangeRate(1);
      setRateDate("");
      return 1;
    }
    const response = await fetch(`/api/opiu/exchange-rate?currency=${currency}`);
    const result = await response.json() as { rate?: number; date?: string; error?: string };
    if (!response.ok || !result.rate) throw new Error(result.error || "Не удалось получить курс");
    setExchangeRate(result.rate);
    setRateDate(result.date ?? "");
    return result.rate;
  };

  const analyze = async () => {
    if (!file && !description.trim()) {
      setMessage("Добавьте договор или опишите займ текстом.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const body = new FormData();
      body.append("description", description.trim());
      if (file) body.append("file", file);
      const response = await fetch("/api/opiu/loan-recognize", { method: "POST", body });
      const result = await response.json().catch(() => null) as (LoanRecognitionOutcome & { error?: string }) | null;
      if (!response.ok || !result?.recognized) throw new Error(result?.error || "Не удалось прочитать документ");
      setData(result.recognized);
      setSchedule(result.schedule.map(normalizeScheduleMoney));
      setExchangeRate(result.exchangeRate || 1);
      setRateDate(result.rateDate ?? "");
      setCorrectionNotice(result.actions.join(". "));
      if (result.suggestedCompanyId) setSelectedCompany(result.suggestedCompanyId);
      if (result.suggestedAccountId) setSelectedAccount(result.suggestedAccountId);
      setStage("review");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось прочитать документ");
    } finally {
      setBusy(false);
    }
  };

  const applyCorrections = async () => {
    if (!correctionText.trim()) return;
    setBusy(true);
    setMessage("");
    setCorrectionNotice("");
    try {
      const response = await fetch("/api/opiu/loan-recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ corrections: correctionText, existingRecognition: data, schedule, exchangeRate }),
      });
      const result = await response.json().catch(() => null) as (LoanCorrectionsOutcome & { error?: string }) | null;
      if (!response.ok || !result?.recognized) throw new Error(result?.error || "Не удалось применить корректировки");
      setSchedule(result.schedule.map(normalizeScheduleMoney));
      setData(result.recognized);
      setExchangeRate(result.exchangeRate || exchangeRate);
      if (result.rateDate) setRateDate(result.rateDate);
      setCorrectionNotice(result.notice);
      setCorrectionText("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось применить корректировки");
    } finally {
      setBusy(false);
    }
  };

  const recalculate = async (currency = data.currency) => {
    setBusy(true);
    try {
      const previousRate = exchangeRate || 1;
      const rate = await loadRate(currency);
      setSchedule((rows) => rows.map((row) => {
        if (row.status !== "planned") return row;
        const source = (kind: "principal" | "interest" | "penalty" | "fine") => {
          const original = row[`${kind}Original` as "principalOriginal" | "interestOriginal" | "penaltyOriginal" | "fineOriginal"];
          return Number.isFinite(original) ? Number(original) : Number(row[kind] || 0) / previousRate;
        };
        const principalOriginal = source("principal");
        const interestOriginal = source("interest");
        const penaltyOriginal = source("penalty");
        const fineOriginal = source("fine");
        return {
          ...row,
          principalOriginal: roundLoanMoney(principalOriginal),
          interestOriginal: roundLoanMoney(interestOriginal),
          penaltyOriginal: roundLoanMoney(penaltyOriginal),
          fineOriginal: roundLoanMoney(fineOriginal),
          principal: roundLoanMoney(principalOriginal * rate),
          interest: roundLoanMoney(interestOriginal * rate),
          penalty: roundLoanMoney(penaltyOriginal * rate),
          fine: roundLoanMoney(fineOriginal * rate),
        };
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось пересчитать график");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanSchedule = [...schedule.reduce((byDate, row) => {
      if (!row.date || Number(row.principal) + Number(row.interest) + Number(row.penalty) + Number(row.fine) <= 0) return byDate;
      const current = byDate.get(row.date);
      if (!current) byDate.set(row.date, normalizeScheduleMoney(row));
      else byDate.set(row.date, {
        ...current,
        principal: roundLoanMoney(current.principal + Number(row.principal || 0)),
        interest: roundLoanMoney(current.interest + Number(row.interest || 0)),
        penalty: roundLoanMoney(current.penalty + Number(row.penalty || 0)),
        fine: roundLoanMoney(current.fine + Number(row.fine || 0)),
        principalOriginal: roundLoanMoney(Number(current.principalOriginal || 0) + Number(row.principalOriginal || 0)),
        interestOriginal: roundLoanMoney(Number(current.interestOriginal || 0) + Number(row.interestOriginal || 0)),
        penaltyOriginal: roundLoanMoney(Number(current.penaltyOriginal || 0) + Number(row.penaltyOriginal || 0)),
        fineOriginal: roundLoanMoney(Number(current.fineOriginal || 0) + Number(row.fineOriginal || 0)),
        status: current.status === "done" && row.status === "done" ? "done" : "planned",
      });
      return byDate;
    }, new Map<string, LoanScheduleDraft>()).values()].sort((left, right) => left.date.localeCompare(right.date));
    if (!data.creditorName.trim() || !selectedCompany || !selectedAccount) {
      setMessage("Проверьте кредитора, компанию и счёт оплаты.");
      return;
    }
    if (!cleanSchedule.length) {
      setMessage("Добавьте хотя бы один платёж в график.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await onSubmit({
        loan: {
          creditorName: data.creditorName.trim(),
          principalAmount: roundLoanMoney(data.principalAmount * exchangeRate),
          interestRatePerDay: data.annualRate / 365,
          startDate: data.startDate,
          dueDate: data.dueDate,
          status: (loan?.status ?? "active") as LoanStatus,
        },
        accountId: selectedAccount,
        companyId: selectedCompany,
        contractFileName: file?.name ?? contractFileName ?? "",
        contractNumber: data.contractNumber.trim(),
        schedule: cleanSchedule,
        currency: data.currency,
        originalPrincipal: roundLoanMoney(data.principalAmount),
        exchangeRate,
        annualRate: data.annualRate,
        originationFee: roundLoanMoney(data.originationFee),
        feeAmortizationMonths: data.feeAmortizationMonths,
        interestFrequency: data.interestFrequency,
        monthlyRate: Number(data.monthlyRate || 0),
        disbursements: (data.disbursements ?? []).map((item) => ({ ...item, amount: roundLoanMoney(item.amount) })),
        paymentDays: data.paymentDays,
        contractFile: file ?? undefined,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить договор");
    } finally {
      setBusy(false);
    }
  };

  if (stage === "source") return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5">
        <div className="flex items-start gap-3"><div className="rounded-xl bg-violet-600 p-2 text-white"><Sparkles className="h-5 w-5" /></div><div><h3 className="font-bold text-slate-950">Добавьте договор — поля заранее заполнять не нужно</h3><p className="mt-1 text-sm text-slate-600">Система прочитает документ, предложит компанию, счёт, кредитора и условия. Сохранение произойдёт только после вашей проверки.</p></div></div>
      </section>
      <input ref={fileRef} type="file" accept=".pdf,.docx,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp,.gif" className="hidden" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <button type="button" onClick={() => fileRef.current?.click()} className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50/40 p-5 text-violet-700 hover:bg-violet-50">
        <Upload className="h-6 w-6" /><span className="font-bold">{file ? file.name : "Выбрать договор или график"}</span><span className="text-xs text-slate-500">PDF, DOCX, Excel, CSV или изображение JPG/PNG/WEBP</span>
      </button>
      <label className="block text-sm font-semibold text-slate-700">Или опишите займ обычным текстом
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} className={`${fieldClass} resize-y py-3`} />
      </label>
      {message && <p className="flex gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700"><AlertCircle className="h-5 w-5 shrink-0" />{message}</p>}
      <div className="flex justify-end gap-3"><button type="button" onClick={onCancel} className="min-h-11 rounded-xl px-4 font-semibold text-slate-600">Отмена</button><button type="button" disabled={busy} onClick={() => void analyze()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-5 font-bold text-white disabled:opacity-60">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Обработать и проверить</button></div>
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /><div><p className="font-bold text-emerald-900">Данные подготовлены — проверьте перед сохранением</p><p className="text-sm text-emerald-800">Любое поле можно исправить. Компания и счёт требуют вашего подтверждения.</p></div></div>
      {data.warnings.length > 0 && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><b>Нужно проверить:</b> {data.warnings.join("; ")}.</div>}
      <section className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
        <label className="block text-sm font-semibold text-slate-800">Изменить договор или график обычным текстом<textarea value={correctionText} onChange={(event) => setCorrectionText(event.target.value)} rows={4} className={`${fieldClass} resize-y py-3`} placeholder="Например: с декабря 2024 по февраль 2025 не платили; перенести платёж с декабря на март" /></label>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><p className="max-w-2xl text-xs leading-5 text-slate-500">Можно перенести платёж, отметить период неоплаченным, изменить условия или вставить новый график. Для нового графика начните с «Заменить график» и укажите строки: дата; тело; проценты; пени; штрафы.</p><button type="button" disabled={busy || !correctionText.trim()} onClick={() => void applyCorrections()} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Применить к графику</button></div>
        {correctionNotice && <p role="status" className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{correctionNotice}. Нажмите «Сохранить изменения», чтобы записать результат.</p>}
      </section>
      <section className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">Номер договора<input value={data.contractNumber} onChange={(e) => updateData({ contractNumber: e.target.value })} className={fieldClass} placeholder="Например, 2026020800236" /></label>
        <label className="text-sm font-medium text-slate-700 md:col-span-2">Кредитор / займодавец<input required value={data.creditorName} onChange={(e) => updateData({ creditorName: e.target.value })} className={fieldClass} placeholder="ФИО или название организации" /></label>
        <label className="text-sm font-medium text-slate-700">Компания<select required value={selectedCompany} onChange={(e) => setSelectedCompany(e.target.value)} className={fieldClass}><option value="">Проверьте и выберите</option>{companies.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-sm font-medium text-slate-700">Счёт оплаты<select required value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)} className={fieldClass}><option value="">Проверьте и выберите</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-sm font-medium text-slate-700">Сумма в валюте договора<input required type="number" min="0" step="0.01" value={data.principalAmount || ""} onChange={(e) => updateData({ principalAmount: roundLoanMoney(Number(e.target.value)) })} className={fieldClass} /></label>
        <label className="text-sm font-medium text-slate-700">Валюта<select value={data.currency} onChange={(e) => { const currency = e.target.value as LoanCurrency; updateData({ currency }); void recalculate(currency); }} className={fieldClass}><option value="RUB">Рубли</option><option value="USD">Доллары США</option><option value="EUR">Евро</option><option value="CNY">Юани</option></select></label>
        {data.interestFrequency === "semi_monthly"
          ? <label className="text-sm font-medium text-slate-700">Ставка, % в месяц<input required type="number" min="0" step="0.001" value={data.monthlyRate || ""} onChange={(e) => { const value = Number(e.target.value); updateData({ monthlyRate: value, annualRate: value * 12 }); }} className={fieldClass} /><span className="mt-1 block text-xs text-slate-500">Месячная ставка делится между платежами 16-го и 30-го пропорционально дням.</span></label>
          : <label className="text-sm font-medium text-slate-700">Ставка, % годовых<input required type="number" min="0" step="0.001" value={data.annualRate} onChange={(e) => updateData({ annualRate: Number(e.target.value) })} className={fieldClass} />{data.interestFrequency === "monthly" && <span className="mt-1 block text-xs text-slate-500">Фиксированные проценты за месяц: сумма займа × ставка ÷ 12.</span>}</label>}
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm"><p className="text-xs text-slate-500">Курс для планового графика</p><p className="mt-1 font-bold">{exchangeRate.toLocaleString("ru-RU")} ₽ за {data.currency === "RUB" ? "1 ₽" : `1 ${data.currency}`}</p><button type="button" disabled={busy} onClick={() => void recalculate()} className="mt-2 text-xs font-bold text-violet-700">Обновить курс и график</button>{rateDate && <p className="mt-1 text-xs text-slate-400">Банк России, {rateDate}</p>}</div>
        <label className="text-sm font-medium text-slate-700">Дата получения<input required type="date" value={data.startDate} onChange={(e) => updateData({ startDate: e.target.value })} className={fieldClass} /></label>
        <label className="text-sm font-medium text-slate-700">Дата возврата тела<input required type="date" value={data.dueDate} onChange={(e) => updateData({ dueDate: e.target.value })} className={fieldClass} /></label>
        <label className="text-sm font-medium text-slate-700">Комиссия за выдачу, ₽<input type="number" min="0" step="0.01" value={data.originationFee || ""} onChange={(e) => updateData({ originationFee: roundLoanMoney(Number(e.target.value)) })} className={fieldClass} /><span className="mt-1 block text-xs text-slate-500">Попадает в ОПиУ частями, но не создаёт платёж в календаре.</span></label>
        <label className="text-sm font-medium text-slate-700">Распределить комиссию, месяцев<input type="number" min="1" max="120" value={data.feeAmortizationMonths} onChange={(e) => updateData({ feeAmortizationMonths: Number(e.target.value) })} className={fieldClass} /></label>
      </section>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold">График платежей {data.currency === "RUB" ? "в рублях" : `в ${data.currency} и рублях`}</h3><p className="text-xs text-slate-500">Все суммы автоматически округляются до копеек. Валютные плановые строки пересчитываются по свежему курсу; оплаченные фиксируются.</p></div><button type="button" onClick={() => setSchedule((rows) => [...rows, emptySchedule()])} className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-bold"><Plus className="h-4 w-4" />Добавить платёж</button></div>
        {schedule.map((row, index) => <div key={row.id} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1.1fr_1fr_1fr_1fr_1fr_1fr_44px]">
          <label className="text-xs font-medium">Дата<input type="date" value={row.date} onChange={(e) => updateSchedule(row.id, { date: e.target.value })} className={fieldClass} /></label>
          {(["principal", "interest", "penalty", "fine"] as const).map((kind) => {
            const labels = { principal: "Тело", interest: "Проценты", penalty: "Пени", fine: "Штрафы" };
            return <label key={kind} className="text-xs font-medium">{labels[kind]}, {data.currency}<input type="number" min="0" step="0.01" value={roundLoanMoney(scheduleSourceAmount(row, kind, data.currency, exchangeRate)) || ""} onChange={(e) => updateScheduleMoney(row.id, kind, Number(e.target.value))} className={fieldClass} />{data.currency !== "RUB" && <span className="mt-1 block text-[10px] font-normal text-slate-500">≈ {roundLoanMoney(row[kind]).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</span>}</label>;
          })}
          <label className="text-xs font-medium">Состояние<select value={row.status} onChange={(e) => updateSchedule(row.id, { status: e.target.value as PaymentStatus })} className={fieldClass}><option value="planned">Запланировано</option><option value="done">Оплачено</option><option value="cancelled">Отменено</option></select></label>
          <button type="button" aria-label={`Удалить платёж ${index + 1}`} onClick={() => setSchedule((rows) => rows.filter((item) => item.id !== row.id))} className="mt-5 flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
        </div>)}
        <div className="grid gap-2 rounded-xl bg-slate-900 p-4 text-white sm:grid-cols-5">{(["principal", "interest", "penalty", "fine"] as const).map((kind) => <div key={kind}><p className="text-xs text-slate-400">{{ principal: "Тело", interest: "Проценты", penalty: "Пени", fine: "Штрафы" }[kind]}</p><b>{roundLoanMoney(totals[kind]).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</b>{data.currency !== "RUB" && <p className="text-xs text-slate-400">{roundLoanMoney(originalTotals[kind]).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {data.currency}</p>}</div>)}<div><p className="text-xs text-slate-400">Всего выплат</p><b>{roundLoanMoney(totals.principal + totals.interest + totals.penalty + totals.fine).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</b>{data.currency !== "RUB" && <p className="text-xs text-slate-400">{roundLoanMoney(originalTotals.principal + originalTotals.interest + originalTotals.penalty + originalTotals.fine).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {data.currency}</p>}</div></div>
      </section>
      {file && <p className="flex items-center gap-2 text-sm text-slate-600"><FileText className="h-4 w-4" />Документ обработан: {file.name}</p>}
      {message && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{message}</p>}
      <div className="flex flex-wrap justify-between gap-3 border-t pt-4"><button type="button" disabled={busy} onClick={() => setStage("source")} className="min-h-11 rounded-xl px-4 font-semibold text-slate-600 disabled:opacity-50">{editing ? "Заменить документ / описание" : "Назад к документу"}</button><div className="flex gap-2"><button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-xl px-4 font-semibold text-slate-600 disabled:opacity-50">Отмена</button><button type="submit" disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-5 font-bold text-white disabled:opacity-60">{busy && <LoaderCircle className="h-4 w-4 animate-spin" />}{busy ? "Сохраняю…" : editing ? "Сохранить изменения" : "Подтвердить и создать"}</button></div></div>
    </form>
  );
}
