
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import type { BankStatement } from "./bankStatementGrid";

// Распознавание PDF-выписки ИИ. Перенесено из роута без изменения логики:
// провайдеры запускаются одновременно, выбирается результат с наименьшим
// числом расхождений по контрольным суммам, при равенстве — с большим числом строк.

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
- Списание всегда отрицательное, поступление всегда положительное.
- Не дублируй одну операцию из-за повторяющихся заголовков или итоговых строк.
- Для карточных операций контрагент — название магазина/получателя из описания, purpose — полное описание банка.
- Для переводов без имени контрагента оставь counterparty пустым, но сохрани полное назначение.
- accountNumber — счёт владельца выписки, а не счёт контрагента.
- declaredDebit и declaredCredit — положительные контрольные итоги расходов и поступлений. Если итогов нет, рассчитай их по операциям.
- id сделай устойчивым: дата|время или номер документа|сумма|последние цифры карты/счёта.
- ИП Филиппов и ИП Коровкин в панели считаются одним юридическим лицом, но owner верни как написано в документе.
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

export function normalizeStatement(raw: RawStatement, documentHash: string): BankStatement {
  const fingerprintOccurrences = new Map<string, number>();
  const rows = (raw.rows ?? []).flatMap((row) => {
    const date = normalizeDate(row.date);
    const amount = Number(row.amount);
    if (!date || !Number.isFinite(amount) || amount === 0) return [];
    const counterparty = String(row.counterparty ?? "").replace(/\s+/g, " ").trim();
    const purpose = String(row.purpose ?? "").replace(/\s+/g, " ").trim();
    const documentNumber = String(row.documentNumber ?? "").trim();
    const counterpartyInn = String(row.counterpartyInn ?? "").replace(/\D/g, "");
    const counterpartyAccount = String(row.counterpartyAccount ?? "").replace(/\s+/g, "").trim();
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([date, amount.toFixed(2), documentNumber.toLowerCase(), counterpartyAccount, counterpartyInn, counterparty.toLowerCase(), purpose.toLowerCase()]))
      .digest("hex")
      .slice(0, 32);
    const occurrence = (fingerprintOccurrences.get(fingerprint) ?? 0) + 1;
    fingerprintOccurrences.set(fingerprint, occurrence);
    return [{ id: `${documentHash}:${fingerprint}:${occurrence}`, date, amount, counterparty, counterpartyInn, counterpartyAccount, purpose, documentNumber }];
  });
  const debit = rows.reduce((sum, row) => sum + Math.max(0, -row.amount), 0);
  const credit = rows.reduce((sum, row) => sum + Math.max(0, row.amount), 0);
  const dates = rows.map((row) => row.date).sort();
  const openingBalance = Number(raw.openingBalance) || 0;
  const closingBalance = Number(raw.closingBalance) || 0;
  const rawDebit = Number(raw.declaredDebit);
  const rawCredit = Number(raw.declaredCredit);
  const hasDeclaredTotals = Number.isFinite(rawDebit) && rawDebit >= 0 && Number.isFinite(rawCredit) && rawCredit >= 0;
  const hasBothBalances = raw.openingBalance != null && raw.closingBalance != null
    && Number.isFinite(Number(raw.openingBalance)) && Number.isFinite(Number(raw.closingBalance));
  const declaredBalancesReconcile = hasDeclaredTotals && hasBothBalances
    && Math.abs(openingBalance + rawCredit - rawDebit - closingBalance) <= 0.02;
  // PDF сначала попадает в отдельную очередь проверки. В карточках показываем
  // точную сумму извлечённых строк, а не потенциально ошибочно распознанную шапку.
  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings.map(String).filter((warning) => !/сумм.*не совп|контрольн.*сумм|начальн.*конечн.*остат/i.test(warning))
    : [];
  const headerTotalsUnavailable = (hasDeclaredTotals && (Math.abs(rawDebit - debit) > 0.01 || Math.abs(rawCredit - credit) > 0.01))
    || (hasBothBalances && !declaredBalancesReconcile);
  const notes = headerTotalsUnavailable
    ? [`Итоги рассчитаны по распознанным операциям (${rows.length}). Контрольные значения шапки PDF будут подтверждены на этапе проверки.`]
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
    declaredDebit: debit,
    declaredCredit: credit,
    rows,
    warnings,
    notes,
  };
}

async function withAnthropic(pdf: Buffer, fileName: string, model: string): Promise<RawStatement> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY не настроен");
  const client = new Anthropic({ apiKey: key, timeout: 90_000, maxRetries: 0 });
  const response = await client.messages.create({
    model,
    max_tokens: 32_000,
    temperature: 0,
    system,
    tools: [{
      name: "save_bank_statement",
      description: "Сохранить полностью распознанную банковскую выписку",
      input_schema: {
        type: "object",
        properties: {
          bank: { type: "string" }, owner: { type: "string" }, ownerInn: { type: "string" },
          accountNumber: { type: "string" }, dateFrom: { type: "string" }, dateTo: { type: "string" },
          openingBalance: { type: "number" }, closingBalance: { type: "number" },
          declaredDebit: { type: "number" }, declaredCredit: { type: "number" },
          warnings: { type: "array", items: { type: "string" } },
          rows: { type: "array", items: { type: "object", properties: {
            id: { type: "string" }, date: { type: "string" }, amount: { type: "number" },
            counterparty: { type: "string" }, counterpartyInn: { type: "string" },
            counterpartyAccount: { type: "string" }, purpose: { type: "string" }, documentNumber: { type: "string" },
          }, required: ["date", "amount"] } },
        },
        required: ["rows"],
      },
    }],
    tool_choice: { type: "tool", name: "save_bank_statement" },
    messages: [{ role: "user", content: [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
      { type: "text", text: `Файл: ${fileName}. Распознай выписку полностью.` },
    ] }],
  });
  const tool = response.content.find((item) => item.type === "tool_use" && item.name === "save_bank_statement");
  if (!tool || tool.type !== "tool_use") {
    if (response.stop_reason === "max_tokens") throw new Error("Anthropic обрезал слишком длинную выписку");
    throw new Error("Anthropic не вернул структурированную банковскую выписку");
  }
  return tool.input as RawStatement;
}

async function withPolza(pdf: Buffer, fileName: string): Promise<RawStatement> {
  const key = process.env.POLZA_API_KEY || process.env.POLZA_AI_API_KEY;
  if (!key) throw new Error("POLZA_API_KEY не настроен");
  const response = await fetch("https://polza.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.POLZA_MODEL || "openai/gpt-4o",
      temperature: 0,
      max_tokens: 16_000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: [
          { type: "text", text: `Файл: ${fileName}. Распознай выписку полностью.` },
          { type: "file", file: { filename: fileName, file_data: `data:application/pdf;base64,${pdf.toString("base64")}` } },
        ] },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const payload = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message || `Polza вернула ошибку ${response.status}`);
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Polza не вернула результат распознавания");
  return extractJson(content);
}

export class PdfRecognitionError extends Error {
  constructor(message: string, readonly timedOut: boolean) {
    super(message);
  }
}

export async function recognizeBankStatementPdf(pdf: Buffer, fileName: string): Promise<BankStatement> {
  const documentHash = createHash("sha256").update(pdf).digest("hex");
  const providers: Array<{ name: string; promise: Promise<RawStatement> }> = [];
  if (process.env.ANTHROPIC_API_KEY) {
    const fastModel = process.env.BANK_STATEMENT_ANTHROPIC_MODEL || "claude-haiku-4-5";
    const accurateModel = process.env.BANK_STATEMENT_ACCURATE_MODEL || "claude-sonnet-4-6";
    providers.push({ name: fastModel, promise: withAnthropic(pdf, fileName, fastModel) });
    if (accurateModel !== fastModel) providers.push({ name: accurateModel, promise: withAnthropic(pdf, fileName, accurateModel) });
  }
  if (process.env.POLZA_API_KEY || process.env.POLZA_AI_API_KEY) providers.push({ name: "polza", promise: withPolza(pdf, fileName) });
  if (!providers.length) throw new PdfRecognitionError("Распознавание PDF не подключено: отсутствуют ключи Anthropic и Polza", false);
  const settled = await Promise.allSettled(providers.map((provider) => provider.promise));
  const successful = settled.flatMap((result, index) => result.status === "fulfilled"
    ? [{ name: providers[index].name, statement: normalizeStatement(result.value, documentHash) }]
    : []);
  if (!successful.length) {
    const reasons = settled.flatMap((result) => result.status === "rejected" ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : []);
    console.error(`Bank statement recognition failed (${providers.length}): ${reasons.join(" | ")}`);
    const timedOut = reasons.some((reason) => /timed out|timeout|aborted/i.test(reason));
    throw new PdfRecognitionError(timedOut
      ? "ИИ-сервисы не успели обработать PDF. Повторите загрузку; если банк даёт XLSX, используйте его — он разбирается детерминированно и точнее."
      : "Не удалось распознать PDF ни основным, ни резервным ИИ-сервисом", timedOut);
  }
  const mismatch = (candidate: BankStatement) => candidate.warnings.filter((warning) => /контрольн.*сумм/i.test(warning)).length;
  successful.sort((left, right) => mismatch(left.statement) - mismatch(right.statement) || right.statement.rows.length - left.statement.rows.length);
  const selected = successful[0];
  console.info(`Bank statement provider selected: ${selected.name}; rows=${selected.statement.rows.length}; controlWarnings=${mismatch(selected.statement)}`);
  return selected.statement;
}
