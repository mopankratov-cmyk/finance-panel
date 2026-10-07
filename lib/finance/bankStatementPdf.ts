
import { createHash } from "node:crypto";
import type { BankStatement } from "./bankStatementGrid";
import { POLZA_FINANCE_MODEL, POLZA_FINANCE_FALLBACK_MODEL } from "@/lib/ai/models";
import { polzaChat, polzaConfigured } from "@/lib/ai/polza";
import { COMPANY_ALIAS_PROMPT_NOTE } from "@/lib/finance/companyAliases";
import { extractPdfText } from "@/lib/loans/pdfText";
import { parseStatementNumber } from "./bankStatementGrid";

// Распознавание PDF-выписки ИИ — через «Пользу» (решение владельца 07.10.2026):
// главная и резервная модели «Пользы» запускаются одновременно, выбирается
// результат с наименьшим числом расхождений по контрольным суммам, при равенстве —
// с большим числом строк. Детерминированный разбор Сбера идёт до ИИ.

type RawRow = {
  id?: string;
  date?: string;
  amount?: number;
  counterparty?: string;
  counterpartyInn?: string;
  counterpartyAccount?: string;
  purpose?: string;
  documentNumber?: string;
};

type RawStatement = {
  bank?: string;
  owner?: string;
  ownerInn?: string;
  accountNumber?: string;
  dateFrom?: string;
  dateTo?: string;
  openingBalance?: number;
  closingBalance?: number;
  declaredDebit?: number;
  declaredCredit?: number;
  rows?: RawRow[];
  warnings?: string[];
};

const system = `Ты распознаёшь российские банковские выписки и справки о движении средств.
Верни ТОЛЬКО JSON без markdown:
{"bank":"","owner":"","ownerInn":"","accountNumber":"","dateFrom":"YYYY-MM-DD","dateTo":"YYYY-MM-DD","openingBalance":0,"closingBalance":0,"declaredDebit":0,"declaredCredit":0,"warnings":[],"rows":[{"id":"","date":"YYYY-MM-DD","amount":0,"counterparty":"","counterpartyInn":"","counterpartyAccount":"","purpose":"","documentNumber":""}]}

Правила:
- Перенеси ВСЕ операции со всех страниц в исходном порядке.
- Списание всегда отрицательное, поступление всегда положительное. В таблицах ВБ Банка колонка «По дебету» означает списание (минус), а «По кредиту» — поступление (плюс).
- bank — банк из шапки выписки, обслуживающий счёт владельца. Банк контрагента внутри строки не является банком выписки.
- Не дублируй одну операцию из-за повторяющихся заголовков или итоговых строк.
- Для карточных операций контрагент — название магазина/получателя из описания, purpose — полное описание банка.
- Для переводов без имени контрагента оставь counterparty пустым, но сохрани полное назначение.
- Если в строке указан банк получателя (например, «Т-Банк»), обязательно сохрани его название в purpose, даже когда имени получателя нет.
- accountNumber — счёт владельца выписки, а не счёт контрагента.
- declaredDebit и declaredCredit — положительные контрольные итоги расходов и поступлений. Если итогов нет, рассчитай их по операциям.
- id сделай устойчивым: дата|время или номер документа|сумма|последние цифры карты/счёта.
- ${COMPANY_ALIAS_PROMPT_NOTE}, но owner верни как написано в документе.
- Ничего не выдумывай; неизвестные реквизиты оставляй пустыми.`;

function extractJson(value: string): RawStatement {
  const match = value.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("ИИ не вернул структурированные данные выписки");
  return JSON.parse(match[0]) as RawStatement;
}

export function cleanPdf(source: Buffer): Buffer {
  const start = source.indexOf(Buffer.from("%PDF-"));
  const end = source.lastIndexOf(Buffer.from("%%EOF"));
  if (start < 0 || end < start) throw new Error("Выбранный файл не содержит корректный PDF-документ");
  return source.subarray(start, end + Buffer.byteLength("%%EOF"));
}

function normalizeDate(value: unknown): string {
  const text = String(value ?? "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  return ru ? `${ru[3]}-${ru[2].padStart(2, "0")}-${ru[1].padStart(2, "0")}` : "";
}

const sberOperationStart = /\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}\s+/;
const cleanSberText = (value: string) => value
  .replace(/T-B\)5k/gi,"T-Bank")
  .replace(/zo5 B\)5k\s*\(\s*zo5\s*\)/gi,"Ozon Bank (Ozon)")
  .replace(/Alf\)-B\)5k/gi,"Alfa-Bank")
  .replace(/\s+/g," ").trim();

/** Детерминированный разбор текстовых PDF Сбербанка с карточными операциями. */
export function recognizeSberStatementText(text: string, documentHash: string): BankStatement | null {
  if(!/Выписка по плат[её]жному сч[её]ту/i.test(text)||!/СберБанк Онлайн/i.test(text))return null;
  const period=text.match(/За период\s+(\d{2}\.\d{2}\.\d{4})\s+[—–-]\s+(\d{2}\.\d{2}\.\d{4})/i);
  const owner=text.match(/Владелец сч[её]та\s+(.+?)\s+Номер сч[её]та/i)?.[1]?.trim()??"";
  const accountNumber=text.match(/Номер сч[её]та\s+([\d ]{15,30})\s+Карты/i)?.[1]?.replace(/\D/g,"")??"";
  const opening=text.match(/Остаток на\s+\d{2}\.\d{2}\.\d{4}\s+([\d ]+,\d{2})/i)?.[1];
  const declaredCredit=text.match(/Пополнение\s+([\d ]+,\d{2})/i)?.[1];
  const declaredDebit=text.match(/Списание\s+([\d ]+,\d{2})/i)?.[1];
  const closing=text.match(/Остаток на\s+\d{2}\.\d{2}\.\d{4}\s+([\d ]+,\d{2})\s+Расшифровка/i)?.[1];
  const operationText=text.slice(text.indexOf("Расшифровка операций")+"Расшифровка операций".length);
  const pattern=/(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})\s+(.+?)\s+(\+?\d[\d ]*,\d{2})\s+(\d[\d ]*,\d{2})\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{6})\s+([\s\S]*?)(?=\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}\s+|Продолжение на следующей странице|Дата формирования документа|$)/g;
  const rows: RawRow[]=[];
  for(const match of operationText.matchAll(pattern)) {
    const signedAmount=match[4].trim();
    const amount=parseStatementNumber(signedAmount);
    if(!amount)continue;
    const category=cleanSberText(match[3]);
    const description=cleanSberText(match[8]
      .replace(/Выписка по плат[её]жному сч[её]ту\s+Страница\s+\d+\s+из\s+\d+[\s\S]*?ОСТАТОК СРЕДСТВ\s+В валюте сч[её]та/gi," ")
    );
    const transferParty=description.match(/Перевод (?:для|от)\s+(.+?)\.\s+Операция/i)?.[1]?.trim();
    const merchant=description.match(/^(.+?)\.\s+Операция/i)?.[1]?.trim();
    rows.push({
      date:match[1],
      amount:signedAmount.startsWith("+")?amount:-amount,
      counterparty:transferParty??merchant??"",
      purpose:`${category}. ${description}`.trim(),
      documentNumber:match[7],
    });
  }
  if(!rows.length||!sberOperationStart.test(operationText))return null;
  return normalizeStatement({
    bank:"Сбербанк",owner,accountNumber,dateFrom:period?.[1],dateTo:period?.[2],
    openingBalance:opening==null?undefined:parseStatementNumber(opening),
    closingBalance:closing==null?undefined:parseStatementNumber(closing),
    declaredDebit:declaredDebit==null?undefined:parseStatementNumber(declaredDebit),
    declaredCredit:declaredCredit==null?undefined:parseStatementNumber(declaredCredit),
    rows,
  },documentHash);
}

// Предупреждения о несведении чисел. По ним отбирается лучшая из моделей
// «Пользы», поэтому запись и отбор используют ОДНУ константу — иначе текст и
// фильтр разъезжаются (была мёртвая regex-проверка `/контрольн.*сумм/i`, которая
// не матчила ни одно реальное предупреждение, и отбор по сверке не работал).
export const CONTROL_SUM_MISMATCH = "Суммы распознанных операций не совпали с контрольными итогами банка";
export const HEADER_BALANCE_MISMATCH = "Начальный остаток, обороты и конечный остаток в распознанной шапке не сходятся";

export function normalizeStatement(raw: RawStatement, documentHash: string): BankStatement {
  const parsedRows = (raw.rows ?? []).flatMap((row) => {
    const date = normalizeDate(row.date);
    const amount = Number(row.amount);
    if (!date || !Number.isFinite(amount) || amount === 0) return [];
    const counterparty = String(row.counterparty ?? "").replace(/\s+/g, " ").trim();
    const purpose = String(row.purpose ?? "").replace(/\s+/g, " ").trim();
    const documentNumber = String(row.documentNumber ?? "").trim();
    const counterpartyInn = String(row.counterpartyInn ?? "").replace(/\D/g, "");
    const counterpartyAccount = String(row.counterpartyAccount ?? "").replace(/\s+/g, "").trim();
    return [{ date, amount, counterparty, counterpartyInn, counterpartyAccount, purpose, documentNumber }];
  });
  const openingBalance = Number(raw.openingBalance) || 0;
  const closingBalance = Number(raw.closingBalance) || 0;
  const rawDebit = Number(raw.declaredDebit);
  const rawCredit = Number(raw.declaredCredit);
  const hasDeclaredTotals = Number.isFinite(rawDebit) && rawDebit >= 0 && Number.isFinite(rawCredit) && rawCredit >= 0;
  const hasBothBalances = raw.openingBalance != null && raw.closingBalance != null
    && Number.isFinite(Number(raw.openingBalance)) && Number.isFinite(Number(raw.closingBalance));
  const declaredBalancesReconcile = hasDeclaredTotals && hasBothBalances
    && Math.abs(openingBalance + rawCredit - rawDebit - closingBalance) <= 0.02;
  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings.map(String).filter((warning) => !/сумм.*не совп|контрольн.*сумм|начальн.*конечн.*остат/i.test(warning))
    : [];
  const extractedDebit = parsedRows.reduce((sum, row) => sum + Math.max(0, -row.amount), 0);
  const extractedCredit = parsedRows.reduce((sum, row) => sum + Math.max(0, row.amount), 0);
  const totalsMatch = (debit: number, credit: number) => hasDeclaredTotals
    && Math.abs(rawDebit - debit) <= 0.02 && Math.abs(rawCredit - credit) <= 0.02;
  const globallyReversed = !totalsMatch(extractedDebit, extractedCredit)
    && totalsMatch(extractedCredit, extractedDebit);
  if (globallyReversed) {
    for (const row of parsedRows) row.amount = -row.amount;
    warnings.push("Направления операций исправлены по контрольным итогам банка: дебет — списание, кредит — поступление");
  }
  const debit = parsedRows.reduce((sum, row) => sum + Math.max(0, -row.amount), 0);
  const credit = parsedRows.reduce((sum, row) => sum + Math.max(0, row.amount), 0);
  const controlMismatch = hasDeclaredTotals && !totalsMatch(debit, credit);
  if (controlMismatch) warnings.push(CONTROL_SUM_MISMATCH);
  if (hasBothBalances && hasDeclaredTotals && !declaredBalancesReconcile) warnings.push(HEADER_BALANCE_MISMATCH);
  const fingerprintOccurrences = new Map<string, number>();
  const rows = parsedRows.map((row) => {
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([row.date, row.amount.toFixed(2), row.documentNumber.toLowerCase(), row.counterpartyAccount, row.counterpartyInn, row.counterparty.toLowerCase(), row.purpose.toLowerCase()]))
      .digest("hex").slice(0, 32);
    const occurrence = (fingerprintOccurrences.get(fingerprint) ?? 0) + 1;
    fingerprintOccurrences.set(fingerprint, occurrence);
    return { ...row, id: `${documentHash}:${fingerprint}:${occurrence}` };
  });
  const dates = rows.map((row) => row.date).sort();
  const notes = controlMismatch
    ? [`Проверьте направления и полноту ${rows.length} распознанных операций перед добавлением.`]
    : [];
  return {
    documentHash,
    bank: String(raw.bank ?? "Банковская выписка").trim(),
    owner: String(raw.owner ?? "").trim(),
    ownerInn: String(raw.ownerInn ?? "").replace(/\D/g, ""),
    accountNumber: String(raw.accountNumber ?? "").replace(/\D/g, ""),
    dateFrom: normalizeDate(raw.dateFrom) || dates[0] || "",
    dateTo: normalizeDate(raw.dateTo) || dates.at(-1) || "",
    openingBalance,
    closingBalance,
    declaredDebit: hasDeclaredTotals && !controlMismatch ? rawDebit : debit,
    declaredCredit: hasDeclaredTotals && !controlMismatch ? rawCredit : credit,
    rows,
    warnings,
    notes,
  };
}

async function withPolza(pdf: Buffer, fileName: string, model: string): Promise<RawStatement> {
  const content = await polzaChat({
    model,
    system,
    content: [
      { type: "text", text: `Файл: ${fileName}. Распознай выписку полностью.` },
      { type: "file", file: { filename: fileName, file_data: `data:application/pdf;base64,${pdf.toString("base64")}` } },
    ],
    maxTokens: 16_000,
    timeoutMs: 90_000,
    label: "Распознавание выписки",
  });
  return extractJson(content);
}

export class PdfRecognitionError extends Error {
  constructor(message: string, readonly timedOut: boolean) {
    super(message);
  }
}

export async function recognizeBankStatementPdf(pdf: Buffer, fileName: string): Promise<BankStatement> {
  const documentHash = createHash("sha256").update(pdf).digest("hex");
  const local=recognizeSberStatementText(extractPdfText(pdf),documentHash);
  if(local)return local;
  if (!polzaConfigured()) throw new PdfRecognitionError("Распознавание PDF не подключено: отсутствует ключ POLZA_API_KEY", false);
  // Главная и резервная модели «Пользы» одновременно; выбираем результат с
  // наименьшим числом несведений (контрольная сумма и шапка), при равенстве —
  // больше строк, затем предпочитаем главную модель.
  const models = Array.from(new Set([POLZA_FINANCE_MODEL, POLZA_FINANCE_FALLBACK_MODEL].filter(Boolean)));
  const providers = models.map((model) => ({ name: model, promise: withPolza(pdf, fileName, model) }));
  const settled = await Promise.allSettled(providers.map((provider) => provider.promise));
  const successful = settled.flatMap((result, index) => result.status === "fulfilled"
    ? [{ name: providers[index].name, statement: normalizeStatement(result.value, documentHash) }]
    : []);
  if (!successful.length) {
    const reasons = settled.flatMap((result) => result.status === "rejected" ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : []);
    console.error(`Bank statement recognition via Polza failed (${providers.length}): ${reasons.join(" | ")}`);
    const timedOut = reasons.some((reason) => /timed out|timeout|aborted/i.test(reason));
    throw new PdfRecognitionError(timedOut
      ? "«Польза» не успела обработать PDF. Повторите загрузку; если банк даёт XLSX, используйте его — он разбирается детерминированно и точнее."
      : "Не удалось распознать PDF моделями «Пользы»", timedOut);
  }
  const reconIssues = (candidate: BankStatement) => candidate.warnings.filter((w) => w === CONTROL_SUM_MISMATCH || w === HEADER_BALANCE_MISMATCH).length;
  successful.sort((left, right) => reconIssues(left.statement) - reconIssues(right.statement)
    || right.statement.rows.length - left.statement.rows.length
    || (left.name === POLZA_FINANCE_MODEL ? -1 : right.name === POLZA_FINANCE_MODEL ? 1 : 0));
  const selected = successful[0];
  console.info(`Bank statement model selected: ${selected.name}; rows=${selected.statement.rows.length}; reconIssues=${reconIssues(selected.statement)}`);
  return selected.statement;
}
