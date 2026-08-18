"use client";

import { AlertCircle, CheckCircle2, FileText, LoaderCircle, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { DdsCompany } from "@/components/payments/ddsCompanies";
import type { Account, Loan, LoanStatus, PaymentStatus } from "@/lib/types";
import { extractOfficeText } from "./officeText";
import { readFirstSheetXlsx } from "@/components/payments/bankStatement";
import { aggregateRecognizedSchedule, mergeRecognition, recognizeLoanSpreadsheet, recognizeLoanText, type LoanCurrency, type RecognizedLoan, type RecognizedScheduleRow } from "./loanRecognition";

export interface LoanScheduleDraft {
  id: string;
  date: string;
  principal: number;
  interest: number;
  penalty: number;
  status: PaymentStatus;
}

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
  onSubmit: (result: LoanFormResult) => void | Promise<void>;
  onCancel: () => void;
}

const fieldClass = "mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100";
const emptySchedule = (): LoanScheduleDraft => ({ id: crypto.randomUUID(), date: "", principal: 0, interest: 0, penalty: 0, status: "planned" });
const initialRecognition = (): RecognizedLoan => ({ contractNumber: "", creditorName: "", companyHint: "", accountHint: "", principalAmount: 0, currency: "RUB", annualRate: 0, originationFee: 0, feeAmortizationMonths: 36, startDate: "", dueDate: "", interestFrequency: "unknown", confidence: 0, warnings: [] });

function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

function imageMediaType(file: File) {
  const type = file.type.toLowerCase();
  if (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(type)) return type;
  if (/\.jpe?g$/i.test(file.name)) return "image/jpeg";
  if (/\.png$/i.test(file.name)) return "image/png";
  if (/\.gif$/i.test(file.name)) return "image/gif";
  if (/\.webp$/i.test(file.name)) return "image/webp";
  return "";
}

function monthlySchedule(data: RecognizedLoan, rate: number): LoanScheduleDraft[] {
  if (!data.startDate || !data.dueDate || data.principalAmount <= 0) return [emptySchedule()];
  const principalRub = data.principalAmount * rate;
  const start = new Date(`${data.startDate}T12:00:00`);
  const due = new Date(`${data.dueDate}T12:00:00`);
  if (data.interestFrequency !== "monthly") {
    const days = Math.max(1, Math.round((due.getTime() - start.getTime()) / 86_400_000));
    return [{ id: crypto.randomUUID(), date: data.dueDate, principal: principalRub, interest: principalRub * data.annualRate / 100 * days / 365, penalty: 0, status: "planned" }];
  }
  const rows: LoanScheduleDraft[] = [];
  let cursor = new Date(start);
  while (cursor < due && rows.length < 240) {
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + 1);
    if (next > due) next.setTime(due.getTime());
    const days = Math.max(1, Math.round((next.getTime() - cursor.getTime()) / 86_400_000));
    rows.push({
      id: crypto.randomUUID(),
      date: next.toISOString().slice(0, 10),
      principal: next.getTime() === due.getTime() ? principalRub : 0,
      interest: principalRub * data.annualRate / 100 * days / 365,
      penalty: 0,
      status: "planned",
    });
    cursor = next;
  }
  return rows.length ? rows : [emptySchedule()];
}

function recognizedSchedule(rows: RecognizedScheduleRow[] | undefined, rate: number) {
  return aggregateRecognizedSchedule(rows)
    .map((row) => ({
      id: crypto.randomUUID(),
      date: row.date,
      principal: Number(row.principal || 0) * rate,
      interest: Number(row.interest || 0) * rate,
      penalty: Number(row.penalty || 0) * rate,
      status: "planned" as PaymentStatus,
    }));
}

function companyMatchesHint(companyName: string, hint: string) {
  const company = companyName.toLowerCase();
  const recognized = hint.toLowerCase();
  if (/филиппов|коровкин/.test(recognized)) return /филиппов|коровкин/.test(company);
  return company.includes(recognized) || recognized.includes(company);
}

export function LoanForm({ loan, accounts, companies, companyId, accountId, contractFileName, contractNumber = "", schedule: initialSchedule, currency = "RUB", originalPrincipal, exchangeRate: initialExchangeRate = 1, annualRate, originationFee = 0, feeAmortizationMonths = 36, onSubmit, onCancel }: LoanFormProps) {
  const editing = Boolean(loan);
  const [stage, setStage] = useState<"source" | "review">(editing ? "review" : "source");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<RecognizedLoan>(() => loan ? {
    ...initialRecognition(),
    contractNumber,
    creditorName: loan.creditorName,
    principalAmount: originalPrincipal ?? loan.principalAmount,
    currency,
    annualRate: annualRate ?? loan.interestRatePerDay * 365,
    originationFee,
    feeAmortizationMonths,
    startDate: loan.startDate,
    dueDate: loan.dueDate,
    confidence: 100,
  } : initialRecognition());
  const [selectedCompany, setSelectedCompany] = useState(companyId ?? "");
  const [selectedAccount, setSelectedAccount] = useState(accountId ?? accounts[0]?.id ?? "");
  const [exchangeRate, setExchangeRate] = useState(initialExchangeRate);
  const [rateDate, setRateDate] = useState("");
  const [schedule, setSchedule] = useState<LoanScheduleDraft[]>(initialSchedule?.length ? initialSchedule : [emptySchedule()]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [correctionText, setCorrectionText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const totals = useMemo(() => schedule.reduce((sum, row) => ({ principal: sum.principal + Number(row.principal || 0), interest: sum.interest + Number(row.interest || 0), penalty: sum.penalty + Number(row.penalty || 0) }), { principal: 0, interest: 0, penalty: 0 }), [schedule]);

  const updateData = (patch: Partial<RecognizedLoan>) => setData((current) => ({ ...current, ...patch }));
  const updateSchedule = (id: string, patch: Partial<LoanScheduleDraft>) => setSchedule((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));

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
      let extractedText = description.trim();
      let pdfBase64 = "";
      let imageBase64 = "";
      let imageType = "";
      let spreadsheetRecognition: Partial<RecognizedLoan> | undefined;
      if (file) {
        if (file.name.toLowerCase().endsWith(".pdf")) pdfBase64 = await fileBase64(file);
        else if ((imageType = imageMediaType(file))) imageBase64 = await fileBase64(file);
        else {
          extractedText = `${extractedText}\n${await extractOfficeText(file)}`.trim();
          if (file.name.toLowerCase().endsWith(".xlsx")) {
            spreadsheetRecognition = recognizeLoanSpreadsheet(await readFirstSheetXlsx(file));
          }
        }
      }
      const local = mergeRecognition(recognizeLoanText(extractedText || file?.name || ""), spreadsheetRecognition);
      let remote: Partial<RecognizedLoan> | undefined;
      try {
        const response = await fetch("/api/opiu/loan-recognize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: extractedText, pdfBase64, imageBase64, imageMediaType: imageType, fileName: file?.name }),
        });
        const responseBody = await response.json() as Partial<RecognizedLoan> & { error?: string };
        if (response.ok) {
          remote = responseBody;
        } else if (pdfBase64) {
          throw new Error(responseBody.error || "Не удалось распознать PDF");
        }
      } catch (error) {
        if (pdfBase64 || imageBase64) throw error;
        // Для текстового описания и Office-файлов остаётся локальный резерв.
      }
      const recognized = mergeRecognition(local, remote);
      // Для XLSX точные серийные даты и суммы читаются локально из ячеек.
      // Текстовый ИИ может принять 18.08 за номер месяца и превратить её в 01.08,
      // поэтому не разрешаем ему заменять детерминированно прочитанный график.
      if (spreadsheetRecognition?.schedule?.length) {
        recognized.schedule = spreadsheetRecognition.schedule;
        recognized.dueDate = spreadsheetRecognition.dueDate || recognized.dueDate;
      }
      const rate = await loadRate(recognized.currency).catch(() => 1);
      setData(recognized);
      const exactSchedule = recognizedSchedule(recognized.schedule, rate);
      setSchedule(exactSchedule.length ? exactSchedule : monthlySchedule(recognized, rate));
      const company = companies.find((item) => recognized.companyHint && companyMatchesHint(item.name, recognized.companyHint));
      const account = accounts.find((item) => recognized.accountHint && item.name.toLowerCase().includes(recognized.accountHint.toLowerCase()));
      if (company) setSelectedCompany(company.id);
      if (account) setSelectedAccount(account.id);
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
    try {
      const response = await fetch("/api/opiu/loan-recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          corrections: correctionText,
          existingRecognition: {
            ...data,
            schedule: schedule.map(({ date, principal, interest, penalty }) => ({
              date,
              principal: principal / exchangeRate,
              interest: interest / exchangeRate,
              penalty: penalty / exchangeRate,
            })),
          },
        }),
      });
      const corrected = await response.json() as Partial<RecognizedLoan> & { error?: string };
      if (!response.ok) throw new Error(corrected.error || "Не удалось применить корректировки");
      const recognized = mergeRecognition(data, corrected);
      const rate = await loadRate(recognized.currency).catch(() => exchangeRate);
      setData(recognized);
      const correctedSchedule = recognizedSchedule(corrected.schedule, rate);
      if (correctedSchedule.length) setSchedule(correctedSchedule);
      const company = companies.find((item) => recognized.companyHint && companyMatchesHint(item.name, recognized.companyHint));
      const account = accounts.find((item) => recognized.accountHint && item.name.toLowerCase().includes(recognized.accountHint.toLowerCase()));
      if (company) setSelectedCompany(company.id);
      if (account) setSelectedAccount(account.id);
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
      const rate = await loadRate(currency);
      setSchedule(monthlySchedule({ ...data, currency }, rate));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось пересчитать график");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanSchedule = [...schedule.reduce((byDate, row) => {
      if (!row.date || Number(row.principal) + Number(row.interest) + Number(row.penalty) <= 0) return byDate;
      const current = byDate.get(row.date);
      if (!current) byDate.set(row.date, { ...row });
      else byDate.set(row.date, {
        ...current,
        principal: current.principal + Number(row.principal || 0),
        interest: current.interest + Number(row.interest || 0),
        penalty: current.penalty + Number(row.penalty || 0),
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
          principalAmount: data.principalAmount * exchangeRate,
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
        originalPrincipal: data.principalAmount,
        exchangeRate,
        annualRate: data.annualRate,
        originationFee: data.originationFee,
        feeAmortizationMonths: data.feeAmortizationMonths,
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
        <label className="block text-sm font-semibold text-slate-800">Корректировки после распознавания<textarea value={correctionText} onChange={(event) => setCorrectionText(event.target.value)} rows={3} className={`${fieldClass} resize-y py-3`} placeholder="Напишите обычным текстом, что исправить или дополнить" /></label>
        <div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-slate-500">Например: изменить кредитора, комиссию, дату или конкретную строку графика.</p><button type="button" disabled={busy || !correctionText.trim()} onClick={() => void applyCorrections()} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Применить</button></div>
      </section>
      <section className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">Номер договора<input value={data.contractNumber} onChange={(e) => updateData({ contractNumber: e.target.value })} className={fieldClass} placeholder="Например, 2026020800236" /></label>
        <label className="text-sm font-medium text-slate-700 md:col-span-2">Кредитор / займодавец<input required value={data.creditorName} onChange={(e) => updateData({ creditorName: e.target.value })} className={fieldClass} placeholder="ФИО или название организации" /></label>
        <label className="text-sm font-medium text-slate-700">Компания<select required value={selectedCompany} onChange={(e) => setSelectedCompany(e.target.value)} className={fieldClass}><option value="">Проверьте и выберите</option>{companies.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-sm font-medium text-slate-700">Счёт оплаты<select required value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)} className={fieldClass}><option value="">Проверьте и выберите</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-sm font-medium text-slate-700">Сумма в валюте договора<input required type="number" min="0" step="0.01" value={data.principalAmount || ""} onChange={(e) => updateData({ principalAmount: Number(e.target.value) })} className={fieldClass} /></label>
        <label className="text-sm font-medium text-slate-700">Валюта<select value={data.currency} onChange={(e) => { const currency = e.target.value as LoanCurrency; updateData({ currency }); void recalculate(currency); }} className={fieldClass}><option value="RUB">Рубли</option><option value="USD">Доллары США</option><option value="EUR">Евро</option><option value="CNY">Юани</option></select></label>
        <label className="text-sm font-medium text-slate-700">Ставка, % годовых<input required type="number" min="0" step="0.001" value={data.annualRate} onChange={(e) => updateData({ annualRate: Number(e.target.value) })} className={fieldClass} /></label>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm"><p className="text-xs text-slate-500">Курс для планового графика</p><p className="mt-1 font-bold">{exchangeRate.toLocaleString("ru-RU")} ₽ за {data.currency === "RUB" ? "1 ₽" : `1 ${data.currency}`}</p><button type="button" disabled={busy} onClick={() => void recalculate()} className="mt-2 text-xs font-bold text-violet-700">Обновить курс и график</button>{rateDate && <p className="mt-1 text-xs text-slate-400">Банк России, {rateDate}</p>}</div>
        <label className="text-sm font-medium text-slate-700">Дата получения<input required type="date" value={data.startDate} onChange={(e) => updateData({ startDate: e.target.value })} className={fieldClass} /></label>
        <label className="text-sm font-medium text-slate-700">Дата возврата тела<input required type="date" value={data.dueDate} onChange={(e) => updateData({ dueDate: e.target.value })} className={fieldClass} /></label>
        <label className="text-sm font-medium text-slate-700">Комиссия за выдачу, ₽<input type="number" min="0" step="0.01" value={data.originationFee || ""} onChange={(e) => updateData({ originationFee: Number(e.target.value) })} className={fieldClass} /><span className="mt-1 block text-xs text-slate-500">Попадает в ОПиУ частями, но не создаёт платёж в календаре.</span></label>
        <label className="text-sm font-medium text-slate-700">Распределить комиссию, месяцев<input type="number" min="1" max="120" value={data.feeAmortizationMonths} onChange={(e) => updateData({ feeAmortizationMonths: Number(e.target.value) })} className={fieldClass} /></label>
      </section>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold">График платежей в рублях</h3><p className="text-xs text-slate-500">Проценты для валютного займа рассчитаны по выбранному курсу. Перед оплатой их можно обновить.</p></div><button type="button" onClick={() => setSchedule((rows) => [...rows, emptySchedule()])} className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-bold"><Plus className="h-4 w-4" />Добавить платёж</button></div>
        {schedule.map((row, index) => <div key={row.id} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1.1fr_1fr_1fr_1fr_1fr_44px]">
          <label className="text-xs font-medium">Дата<input type="date" value={row.date} onChange={(e) => updateSchedule(row.id, { date: e.target.value })} className={fieldClass} /></label>
          <label className="text-xs font-medium">Тело, ₽<input type="number" min="0" step="0.01" value={row.principal || ""} onChange={(e) => updateSchedule(row.id, { principal: Number(e.target.value) })} className={fieldClass} /></label>
          <label className="text-xs font-medium">Проценты, ₽<input type="number" min="0" step="0.01" value={row.interest || ""} onChange={(e) => updateSchedule(row.id, { interest: Number(e.target.value) })} className={fieldClass} /></label>
          <label className="text-xs font-medium">Пени / штрафы, ₽<input type="number" min="0" step="0.01" value={row.penalty || ""} onChange={(e) => updateSchedule(row.id, { penalty: Number(e.target.value) })} className={fieldClass} /></label>
          <label className="text-xs font-medium">Состояние<select value={row.status} onChange={(e) => updateSchedule(row.id, { status: e.target.value as PaymentStatus })} className={fieldClass}><option value="planned">Запланировано</option><option value="done">Оплачено</option><option value="cancelled">Отменено</option></select></label>
          <button type="button" aria-label={`Удалить платёж ${index + 1}`} onClick={() => setSchedule((rows) => rows.filter((item) => item.id !== row.id))} className="mt-5 flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
        </div>)}
        <div className="grid gap-2 rounded-xl bg-slate-900 p-4 text-white sm:grid-cols-4"><div><p className="text-xs text-slate-400">Тело</p><b>{totals.principal.toLocaleString("ru-RU")} ₽</b></div><div><p className="text-xs text-slate-400">Проценты</p><b>{totals.interest.toLocaleString("ru-RU")} ₽</b></div><div><p className="text-xs text-slate-400">Пени / штрафы</p><b>{totals.penalty.toLocaleString("ru-RU")} ₽</b></div><div><p className="text-xs text-slate-400">Всего выплат</p><b>{(totals.principal + totals.interest + totals.penalty).toLocaleString("ru-RU")} ₽</b></div></div>
      </section>
      {file && <p className="flex items-center gap-2 text-sm text-slate-600"><FileText className="h-4 w-4" />Документ обработан: {file.name}</p>}
      {message && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{message}</p>}
      <div className="flex flex-wrap justify-between gap-3 border-t pt-4"><button type="button" disabled={busy} onClick={() => setStage("source")} className="min-h-11 rounded-xl px-4 font-semibold text-slate-600 disabled:opacity-50">{editing ? "Заменить документ / описание" : "Назад к документу"}</button><div className="flex gap-2"><button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-xl px-4 font-semibold text-slate-600 disabled:opacity-50">Отмена</button><button type="submit" disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-5 font-bold text-white disabled:opacity-60">{busy && <LoaderCircle className="h-4 w-4 animate-spin" />}{busy ? "Сохраняю…" : editing ? "Сохранить изменения" : "Подтвердить и создать"}</button></div></div>
    </form>
  );
}
