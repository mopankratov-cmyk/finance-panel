
import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_MODEL } from "@/lib/ai/models";
import { COMPANY_ALIAS_PROMPT_NOTE } from "@/lib/finance/companyAliases";

// ИИ-распознавание условий кредита по тексту, PDF или картинке. Перенесено из
// роута /api/opiu/loan-recognize без изменения промпта и логики резерва.

export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
export type AiRecognitionBody = {
  text?: string;
  pdfBase64?: string;
  imageBase64?: string;
  imageMediaType?: ImageMediaType;
  fileName?: string;
  existingRecognition?: unknown;
  corrections?: string;
};

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_LENGTH = 200_000;

export class LoanRecognitionValidationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const system = `Ты финансовый ассистент. Извлеки условия кредита или займа.
Верни ТОЛЬКО JSON без markdown:
{"contractNumber":"","creditorName":"","companyHint":"","accountHint":"","principalAmount":0,"currency":"RUB","annualRate":0,"monthlyRate":0,"originationFee":0,"feeAmortizationMonths":36,"startDate":"YYYY-MM-DD","dueDate":"YYYY-MM-DD","interestFrequency":"weekly|monthly|semi_monthly|quarterly|at_maturity|unknown","paymentDays":[16,30],"disbursements":[{"date":"YYYY-MM-DD","amount":0}],"confidence":0,"warnings":[],"schedule":[{"date":"YYYY-MM-DD","principal":0,"interest":0,"penalty":0,"fine":0}]}
Не выдумывай отсутствующие данные. ${COMPANY_ALIAS_PROMPT_NOTE}. Ставку возвращай в процентах годовых.
Если договор говорит, что проценты выплачиваются ежемесячно, верни interestFrequency=monthly. Не создавай расчётный график с разными суммами процентов, если готового графика нет в самом документе.
Если ставка указана «в месяц» и есть две даты оплаты процентов, верни interestFrequency=semi_monthly, monthlyRate без пересчёта, annualRate=monthlyRate×12, paymentDays и все отдельные выдачи займа в disbursements. Месячную ставку нельзя начислять полностью на каждую из двух дат.
Если ставка переменная, в annualRate укажи начальную годовую ставку и опиши периоды изменения в warnings.
Если в документе есть график платежей, перенеси ВСЕ строки графика без пересчёта: дату, основной долг, проценты и штраф/пеню. Не заменяй недельный график месячным.
Если пользователь просит перенести платёж, измени дату именно указанной строки, сохрани её тело, проценты, пени и штрафы; остальные строки не меняй. Если на новой дате уже есть платёж, верни обе обязанности отдельными строками — не теряй ни одну сумму.
Фраза «не платили» не означает удаление платежей: такие строки остаются в графике неоплаченными. Не удаляй просроченные обязательства.
creditorName — займодавец/кредитор, а companyHint — заёмщик. accountHint — расчётный счёт заёмщика.
contractNumber — номер договора без слова «№», но со всеми цифрами, дефисами и дополнительными частями номера.
originationFee — сумма комиссии за выдачу в валюте договора. Если комиссия указана в процентах, рассчитай сумму от principalAmount. Если комиссия равна нулю, не добавляй предупреждение про feeAmortizationMonths.`;

function jsonFrom(value: string) {
  const match = value.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("ИИ не вернул структурированные данные");
  return JSON.parse(match[0]) as unknown;
}

function promptFor(body: AiRecognitionBody) {
  if (body.corrections?.trim() && body.existingRecognition) {
    return `Текущие распознанные данные:\n${JSON.stringify(body.existingRecognition)}\n\nКорректировки пользователя:\n${body.corrections.trim()}\n\nВерни полный исправленный JSON. Сохрани все данные и строки графика, которых корректировка не касается.`;
  }
  return `${body.fileName ? `Файл: ${body.fileName}\n` : ""}${body.text?.trim() || "Изучи приложенный договор или изображение графика платежей и извлеки все доступные условия."}`;
}

function decodeBase64(value: string, maxBytes: number, label: string): Buffer {
  const rawBase64 = value.replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
  if (!rawBase64 || rawBase64.length > Math.ceil(maxBytes * 4 / 3) + 8) throw new LoanRecognitionValidationError(`${label} превышает допустимый размер`, 413);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(rawBase64) || rawBase64.length % 4 === 1) throw new LoanRecognitionValidationError(`${label} содержит некорректные base64-данные`, 400);
  const decoded = Buffer.from(rawBase64, "base64");
  if (!decoded.length || decoded.length > maxBytes) throw new LoanRecognitionValidationError(`${label} превышает допустимый размер`, 413);
  return decoded;
}

/** Некоторые банки присылают договор как подписанный PKCS#7-контейнер с PDF внутри. */
export function extractPdfFromContainer(source: Buffer): Buffer {
  const pdfStart = source.indexOf(Buffer.from("%PDF-"));
  const pdfEnd = source.lastIndexOf(Buffer.from("%%EOF"));
  if (pdfStart < 0 || pdfEnd < pdfStart) {
    throw new LoanRecognitionValidationError("В выбранном файле не найден PDF-документ. Возможно, это файл электронной подписи без вложенного договора.", 415);
  }
  return source.subarray(pdfStart, pdfEnd + Buffer.byteLength("%%EOF"));
}

const IMAGE_SIGNATURES: Record<ImageMediaType, (value: Buffer) => boolean> = {
  "image/jpeg": (value) => value.length >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff,
  "image/png": (value) => value.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/gif": (value) => ["GIF87a", "GIF89a"].includes(value.subarray(0, 6).toString("ascii")),
  "image/webp": (value) => value.subarray(0, 4).toString("ascii") === "RIFF" && value.subarray(8, 12).toString("ascii") === "WEBP",
};

export function isImageMediaType(value: string): value is ImageMediaType {
  return value in IMAGE_SIGNATURES;
}

export function validateImage(image: Buffer, mediaType: ImageMediaType) {
  if (image.length > MAX_IMAGE_BYTES) throw new LoanRecognitionValidationError("Изображение превышает допустимый размер", 413);
  if (!IMAGE_SIGNATURES[mediaType](image)) throw new LoanRecognitionValidationError("Содержимое изображения не соответствует указанному формату", 415);
}

export function validateAiBody(body: AiRecognitionBody): AiRecognitionBody {
  if (typeof body.text === "string" && body.text.length > MAX_TEXT_LENGTH) throw new LoanRecognitionValidationError("Текст договора слишком большой", 413);
  if (typeof body.corrections === "string" && body.corrections.length > 20_000) throw new LoanRecognitionValidationError("Текст корректировки слишком большой", 413);
  if (typeof body.fileName === "string" && body.fileName.length > 255) throw new LoanRecognitionValidationError("Слишком длинное имя файла", 400);
  let result = body;
  if (body.pdfBase64) result = { ...result, pdfBase64: extractPdfFromContainer(decodeBase64(body.pdfBase64, MAX_PDF_BYTES, "PDF")).toString("base64") };
  if (body.imageBase64) {
    if (!body.imageMediaType || !isImageMediaType(body.imageMediaType)) throw new LoanRecognitionValidationError("Неподдерживаемый тип изображения", 415);
    const image = decodeBase64(body.imageBase64, MAX_IMAGE_BYTES, "Изображение");
    validateImage(image, body.imageMediaType);
    result = { ...result, imageBase64: image.toString("base64") };
  }
  return result;
}

async function recognizeWithAnthropic(body: AiRecognitionBody) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY не настроен");
  const client = new Anthropic({ apiKey, timeout: 55_000, maxRetries: 0 });
  const content: Anthropic.MessageCreateParams["messages"][number]["content"] = [];
  if (body.pdfBase64) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: body.pdfBase64 } });
  if (body.imageBase64 && body.imageMediaType) content.push({ type: "image", source: { type: "base64", media_type: body.imageMediaType, data: body.imageBase64 } });
  content.push({ type: "text", text: promptFor(body) });
  const response = await client.messages.create({ model: ANTHROPIC_MODEL, max_tokens: 6500, temperature: 0, system, messages: [{ role: "user", content }] });
  return jsonFrom(response.content.filter((item) => item.type === "text").map((item) => item.text).join("\n"));
}

async function recognizeWithPolza(body: AiRecognitionBody) {
  const apiKey = process.env.POLZA_API_KEY || process.env.POLZA_AI_API_KEY;
  if (!apiKey) throw new Error("POLZA_API_KEY не настроен");
  const content: Array<Record<string, unknown>> = [{ type: "text", text: promptFor(body) }];
  if (body.pdfBase64) content.push({ type: "file", file: { filename: body.fileName || "loan-document.pdf", file_data: `data:application/pdf;base64,${body.pdfBase64}` } });
  if (body.imageBase64 && body.imageMediaType) content.push({ type: "image_url", image_url: { url: `data:${body.imageMediaType};base64,${body.imageBase64}` } });
  const response = await fetch("https://polza.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.POLZA_MODEL || "openai/gpt-4o", temperature: 0, max_tokens: 6500, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content }] }),
    signal: AbortSignal.timeout(55_000),
  });
  const payload = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message || `Polza вернула ошибку ${response.status}`);
  const text = payload?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Polza не вернула результат распознавания");
  return jsonFrom(text);
}

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.POLZA_API_KEY || process.env.POLZA_AI_API_KEY);
}

export class LoanAiUnavailableError extends Error {}

/** Основной провайдер, затем резерв. Бросает LoanAiUnavailableError, если оба недоступны или не настроены. */
export async function recognizeLoanWithAi(input: AiRecognitionBody): Promise<unknown> {
  const body = validateAiBody(input);
  const hasPolzaKey = Boolean(process.env.POLZA_API_KEY || process.env.POLZA_AI_API_KEY);
  if (!process.env.ANTHROPIC_API_KEY && !hasPolzaKey) throw new LoanAiUnavailableError("ИИ-распознавание не подключено: настройте ANTHROPIC_API_KEY или резервный POLZA_API_KEY");
  let primaryError = "";
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await recognizeWithAnthropic(body);
    } catch (error) {
      primaryError = error instanceof Error ? error.message : "ошибка основного ИИ-сервиса";
    }
  }
  if (hasPolzaKey) {
    try {
      return await recognizeWithPolza(body);
    } catch (error) {
      const fallbackError = error instanceof Error ? error.message : "ошибка резервного ИИ-сервиса";
      console.error("Loan recognition providers failed", { primaryError, fallbackError });
      throw new LoanAiUnavailableError("Не удалось распознать документ ни основным, ни резервным ИИ-сервисом. Проверьте баланс и ключи сервисов.");
    }
  }
  console.error("Primary loan recognition failed and Polza is not configured", { primaryError });
  throw new LoanAiUnavailableError("Основной ИИ-сервис недоступен, а резервный POLZA_API_KEY пока не настроен");
}
