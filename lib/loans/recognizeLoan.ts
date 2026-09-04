
import { extractOfficeText } from "@/components/loans/officeText";
import { mergeRecognition, recognizeLoanSpreadsheet, recognizeLoanText, type LoanCurrency, type RecognizedLoan } from "@/components/loans/loanRecognition";
import { applyLoanScheduleCorrections } from "@/components/loans/loanScheduleCorrections";
import { roundLoanMoney } from "@/lib/opiu/loanCurrency";
import { xlsxGrid } from "@/lib/finance/xlsxGrid";
import { isImageMediaType, type AiRecognitionBody } from "./aiRecognition";
import { monthlySchedule, normalizeScheduleMoney, recognizedSchedule, scheduleRow, type LoanScheduleDraft } from "./schedule";
import { sameCompanyAlias } from "@/lib/finance/companyAliases";

// Распознавание договора целиком на сервере: текст описания + файл (PDF,
// картинка, DOCX, XLSX) → условия, график, курс, предложенные компания и
// счёт. Порядок и приоритеты слияния — те же, что раньше были в браузере
// (LoanForm.analyze): локальные регулярки и табличные графики важнее ИИ.
// Разница одна: результат не зависит от того, кто и откуда загрузил документ.

export interface LoanUpload {
  name: string;
  bytes: Buffer;
  mimeType: string;
}

export interface LoanRecognitionDeps {
  /** ИИ-распознаватель; undefined — ИИ недоступен, работают только регулярки. */
  ai?: (body: AiRecognitionBody) => Promise<Partial<RecognizedLoan>>;
  rate: (currency: LoanCurrency) => Promise<{ rate: number; date: string }>;
  companies: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string }>;
}

export interface LoanRecognitionOutcome {
  recognized: RecognizedLoan;
  schedule: LoanScheduleDraft[];
  actions: string[];
  exchangeRate: number;
  rateDate: string;
  suggestedCompanyId: string | null;
  suggestedAccountId: string | null;
}

function imageMediaType(file: LoanUpload) {
  const type = file.mimeType.toLowerCase();
  if (isImageMediaType(type)) return type;
  if (/\.jpe?g$/i.test(file.name)) return "image/jpeg" as const;
  if (/\.png$/i.test(file.name)) return "image/png" as const;
  if (/\.gif$/i.test(file.name)) return "image/gif" as const;
  if (/\.webp$/i.test(file.name)) return "image/webp" as const;
  return "";
}

function companyMatchesHint(companyName: string, hint: string) {
  const company = companyName.toLowerCase();
  const recognized = hint.toLowerCase();
  if (sameCompanyAlias(recognized, company)) return true;
  return company.includes(recognized) || recognized.includes(company);
}

async function safeRate(deps: LoanRecognitionDeps, currency: LoanCurrency, fallback: number) {
  if (currency === "RUB") return { rate: 1, date: "" };
  try {
    return await deps.rate(currency);
  } catch {
    return { rate: fallback, date: "" };
  }
}

export async function recognizeLoanDocument(
  input: { description: string; file?: LoanUpload },
  deps: LoanRecognitionDeps,
): Promise<LoanRecognitionOutcome> {
  const file = input.file;
  if (!file && !input.description.trim()) throw new Error("Добавьте договор или опишите займ текстом.");
  let extractedText = input.description.trim();
  let pdfBase64 = "";
  let imageBase64 = "";
  let imageType: AiRecognitionBody["imageMediaType"] | "" = "";
  let spreadsheetRecognition: Partial<RecognizedLoan> | undefined;
  if (file) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".pdf") || file.mimeType === "application/pdf") pdfBase64 = file.bytes.toString("base64");
    else if ((imageType = imageMediaType(file))) imageBase64 = file.bytes.toString("base64");
    else {
      const officeFile = new File([new Uint8Array(file.bytes)], file.name);
      extractedText = `${extractedText}\n${await extractOfficeText(officeFile)}`.trim();
      if (lower.endsWith(".xlsx")) spreadsheetRecognition = recognizeLoanSpreadsheet(xlsxGrid(file.bytes));
    }
  }
  const local = mergeRecognition(recognizeLoanText(extractedText || file?.name || ""), spreadsheetRecognition);
  let remote: Partial<RecognizedLoan> | undefined;
  if (deps.ai) {
    try {
      remote = await deps.ai({ text: extractedText, pdfBase64, imageBase64, imageMediaType: imageType || undefined, fileName: file?.name });
    } catch (error) {
      // Для PDF и картинок локального резерва нет — без ИИ читать нечем.
      if (pdfBase64 || imageBase64) throw error;
    }
  } else if (pdfBase64 || imageBase64) {
    throw new Error("Для PDF и изображений нужно ИИ-распознавание, а оно не подключено");
  }
  const recognized = mergeRecognition(local, remote);
  if (local.interestFrequency === "semi_monthly") {
    recognized.principalAmount = local.principalAmount;
    recognized.currency = local.currency;
    recognized.annualRate = local.annualRate;
    recognized.interestFrequency = local.interestFrequency;
    recognized.monthlyRate = local.monthlyRate;
    recognized.disbursements = local.disbursements;
    recognized.paymentDays = local.paymentDays;
  }
  // Если в DOCX/Excel нет самого графика, не принимаем сгенерированные ИИ
  // строки как договорные. Для ежемесячной выплаты строим их по условиям.
  const officeDocument = Boolean(file && !pdfBase64 && !imageBase64);
  if (officeDocument && !local.schedule?.length && !spreadsheetRecognition?.schedule?.length) recognized.schedule = undefined;
  // Табличный график из Word/текста читается по колонкам договора — точнее свободного ответа ИИ.
  if (local.schedule?.length) {
    recognized.schedule = local.schedule;
    recognized.dueDate = local.dueDate || recognized.dueDate;
  }
  // Для XLSX серийные даты и суммы прочитаны из ячеек — ИИ их не подменяет.
  if (spreadsheetRecognition?.schedule?.length) {
    recognized.schedule = spreadsheetRecognition.schedule;
    recognized.dueDate = spreadsheetRecognition.dueDate || recognized.dueDate;
  }
  const { rate, date: rateDate } = await safeRate(deps, recognized.currency, 1);
  const exactSchedule = recognizedSchedule(recognized.schedule, rate);
  const baseSchedule = exactSchedule.length ? exactSchedule : monthlySchedule(recognized, rate);
  const localCorrection = applyLoanScheduleCorrections(baseSchedule, input.description, scheduleRow);
  const correctedDueDate = localCorrection.schedule.at(-1)?.date ?? recognized.dueDate;
  const company = deps.companies.find((item) => recognized.companyHint && companyMatchesHint(item.name, recognized.companyHint));
  const account = deps.accounts.find((item) => recognized.accountHint && item.name.toLowerCase().includes(recognized.accountHint.toLowerCase()));
  return {
    recognized: {
      ...recognized,
      principalAmount: roundLoanMoney(recognized.principalAmount),
      originationFee: roundLoanMoney(recognized.originationFee),
      disbursements: recognized.disbursements?.map((item) => ({ ...item, amount: roundLoanMoney(item.amount) })),
      dueDate: correctedDueDate,
    },
    schedule: localCorrection.schedule.map(normalizeScheduleMoney),
    actions: localCorrection.actions,
    exchangeRate: rate,
    rateDate,
    suggestedCompanyId: company?.id ?? null,
    suggestedAccountId: account?.id ?? null,
  };
}

export interface LoanCorrectionsInput {
  existing: RecognizedLoan;
  schedule: LoanScheduleDraft[];
  corrections: string;
  exchangeRate: number;
}

export interface LoanCorrectionsOutcome {
  recognized: RecognizedLoan;
  schedule: LoanScheduleDraft[];
  notice: string;
  exchangeRate: number;
  rateDate: string;
}

export async function applyLoanCorrections(input: LoanCorrectionsInput, deps: LoanRecognitionDeps): Promise<LoanCorrectionsOutcome> {
  const corrections = input.corrections.trim();
  if (!corrections) throw new Error("Опишите, что изменить в договоре или графике.");
  const exchangeRate = input.exchangeRate || 1;
  const localCorrection = applyLoanScheduleCorrections(input.schedule, corrections, scheduleRow);
  let corrected: Partial<RecognizedLoan> = {};
  if (deps.ai) {
    try {
      corrected = await deps.ai({
        corrections,
        existingRecognition: {
          ...input.existing,
          schedule: localCorrection.schedule.map(({ date, principal, interest, penalty, fine }) => ({
            date, principal: principal / exchangeRate, interest: interest / exchangeRate, penalty: penalty / exchangeRate, fine: fine / exchangeRate,
          })),
        },
      });
    } catch (error) {
      if (!localCorrection.actions.length) throw error;
    }
  } else if (!localCorrection.actions.length) {
    throw new Error("Не удалось понять корректировку без ИИ. Используйте формы «перенести … на …», «с … по … не платили» или «заменить график: дата; тело; проценты».");
  }
  const recognized = mergeRecognition(input.existing, corrected);
  const { rate, date: rateDate } = await safeRate(deps, recognized.currency, exchangeRate);
  const correctedSchedule = recognizedSchedule(corrected.schedule, rate);
  let finalSchedule = input.schedule;
  let notice = "";
  if (localCorrection.actions.length) {
    finalSchedule = localCorrection.schedule;
    notice = localCorrection.actions.join(". ");
  } else if (correctedSchedule.length) {
    const previousByDate = new Map(input.schedule.map((row) => [row.date, row]));
    finalSchedule = correctedSchedule.map((row) => {
      const previous = previousByDate.get(row.date);
      return previous ? { ...row, id: previous.id, status: previous.status } : row;
    });
    notice = "Изменения применены. Проверьте обновлённый график перед сохранением.";
  }
  return {
    recognized: {
      ...recognized,
      principalAmount: roundLoanMoney(recognized.principalAmount),
      originationFee: roundLoanMoney(recognized.originationFee),
      dueDate: finalSchedule.at(-1)?.date ?? recognized.dueDate,
    },
    schedule: finalSchedule.map(normalizeScheduleMoney),
    notice,
    exchangeRate: rate,
    rateDate,
  };
}
