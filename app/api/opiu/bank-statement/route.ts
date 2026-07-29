import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";

export const maxDuration = 120;

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

function cleanPdf(source: Buffer): Buffer {
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

function normalizeStatement(raw: RawStatement, documentHash: string) {
  const seenIds = new Set<string>();
  const fingerprintOccurrences = new Map<string, number>();
  let duplicateIds = 0;
  const rows = (raw.rows ?? []).flatMap((row) => {
    const date = normalizeDate(row.date);
    const amount = Number(row.amount);
    if (!date || !Number.isFinite(amount) || amount === 0) return [];
    const counterparty = String(row.counterparty ?? "").replace(/\s+/g, " ").trim();
    const purpose = String(row.purpose ?? "").replace(/\s+/g, " ").trim();
    const documentNumber = String(row.documentNumber ?? "").trim();
    const counterpartyInn = String(row.counterpartyInn ?? "").replace(/\D/g, "");
    const counterpartyAccount = String(row.counterpartyAccount ?? "").replace(/\s+/g, "").trim();
    const modelId = String(row.id ?? "").trim();
    if (modelId && seenIds.has(modelId)) duplicateIds += 1;
    if (modelId) seenIds.add(modelId);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([
        date,
        amount.toFixed(2),
        documentNumber.toLowerCase(),
        counterpartyAccount,
        counterpartyInn,
        counterparty.toLowerCase(),
        purpose.toLowerCase(),
      ]))
      .digest("hex")
      .slice(0, 32);
    const occurrence = (fingerprintOccurrences.get(fingerprint) ?? 0) + 1;
    fingerprintOccurrences.set(fingerprint, occurrence);
    return [{
      id: `${documentHash}:${fingerprint}:${occurrence}`,
      date,
      amount,
      counterparty,
      counterpartyInn,
      counterpartyAccount,
      purpose,
      documentNumber,
    }];
  });
  const debit = rows.reduce((sum, row) => sum + Math.max(0, -row.amount), 0);
  const credit = rows.reduce((sum, row) => sum + Math.max(0, row.amount), 0);
  const dates = rows.map((row) => row.date).sort();
  const declaredDebit = Number(raw.declaredDebit) || debit;
  const declaredCredit = Number(raw.declaredCredit) || credit;
  const warnings = Array.isArray(raw.warnings) ? raw.warnings.map(String) : [];
  if (duplicateIds > 0) warnings.push(`ИИ вернул одинаковые ID у ${duplicateIds} операций — строки сохранены и требуют проверки`);
  if (Math.abs(declaredDebit - debit) > 0.01) warnings.push("Сумма расходов не совпала с контрольной суммой банка");
  if (Math.abs(declaredCredit - credit) > 0.01) warnings.push("Сумма поступлений не совпала с контрольной суммой банка");
  return {
    documentHash,
    bank: String(raw.bank ?? "Банковская выписка").trim(),
    owner: String(raw.owner ?? "").trim(),
    ownerInn: String(raw.ownerInn ?? "").replace(/\D/g, ""),
    accountNumber: String(raw.accountNumber ?? "").replace(/\D/g, ""),
    dateFrom: normalizeDate(raw.dateFrom) || dates[0] || "",
    dateTo: normalizeDate(raw.dateTo) || dates.at(-1) || "",
    openingBalance: Number(raw.openingBalance) || 0,
    closingBalance: Number(raw.closingBalance) || 0,
    declaredDebit,
    declaredCredit,
    rows,
    warnings,
  };
}

async function withAnthropic(pdf: Buffer, fileName: string) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY не настроен");
  const client = new Anthropic({ apiKey: key, timeout: 90_000, maxRetries: 0 });
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16_000,
    temperature: 0,
    system,
    messages: [{ role: "user", content: [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
      { type: "text", text: `Файл: ${fileName}. Распознай выписку полностью.` },
    ] }],
  });
  return extractJson(response.content.filter((item) => item.type === "text").map((item) => item.text).join("\n"));
}

async function withPolza(pdf: Buffer, fileName: string) {
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

export async function POST(request: Request) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Добавьте PDF-выписку" }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "PDF больше 20 МБ" }, { status: 413 });
    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json({ error: "Поддерживается только PDF-выписка" }, { status: 415 });
    }
    const pdf = cleanPdf(Buffer.from(await file.arrayBuffer()));
    const documentHash = createHash("sha256").update(pdf).digest("hex");
    let primaryError = "";
    if (process.env.ANTHROPIC_API_KEY) {
      try { return NextResponse.json(normalizeStatement(await withAnthropic(pdf, file.name), documentHash)); }
      catch (error) { primaryError = error instanceof Error ? error.message : "Ошибка Anthropic"; }
    }
    if (process.env.POLZA_API_KEY || process.env.POLZA_AI_API_KEY) {
      try { return NextResponse.json(normalizeStatement(await withPolza(pdf, file.name), documentHash)); }
      catch (error) {
        const fallbackError = error instanceof Error ? error.message : "Ошибка Polza";
        console.error("Bank statement recognition failed", { primaryError, fallbackError });
        return NextResponse.json({ error: `Не удалось распознать PDF. Anthropic: ${primaryError || "не настроен"}. Polza: ${fallbackError}.` }, { status: 502 });
      }
    }
    return NextResponse.json({ error: `Распознавание PDF не подключено. ${primaryError}`.trim() }, { status: 503 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось прочитать PDF-выписку" }, { status: 500 });
  }
}
