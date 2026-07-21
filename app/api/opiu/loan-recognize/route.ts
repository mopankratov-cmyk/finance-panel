import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const maxDuration = 60;

const system = `Ты финансовый ассистент. Извлеки условия кредита или займа.
Верни ТОЛЬКО JSON без markdown:
{"creditorName":"","companyHint":"","accountHint":"","principalAmount":0,"currency":"RUB","annualRate":0,"originationFee":0,"feeAmortizationMonths":36,"startDate":"YYYY-MM-DD","dueDate":"YYYY-MM-DD","interestFrequency":"monthly|quarterly|at_maturity|unknown","confidence":0,"warnings":[]}
Не выдумывай отсутствующие данные. ИП Филиппов и ИП Коровкин — одно юридическое лицо. Ставку возвращай в процентах годовых.`;

function jsonFrom(value: string) {
  const match = value.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("ИИ не вернул структурированные данные");
  return JSON.parse(match[0]) as unknown;
}

export async function POST(request: Request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ИИ-распознавание пока не подключено" }, { status: 503 });
    }
    const body = await request.json() as { text?: string; pdfBase64?: string; fileName?: string };
    if (!body.text?.trim() && !body.pdfBase64) {
      return NextResponse.json({ error: "Добавьте текст или документ" }, { status: 400 });
    }
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const content: Anthropic.MessageCreateParams["messages"][number]["content"] = [];
    if (body.pdfBase64) {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: body.pdfBase64 },
      });
    }
    content.push({
      type: "text",
      text: `${body.fileName ? `Файл: ${body.fileName}\n` : ""}${body.text?.trim() || "Изучи приложенный договор и извлеки его условия."}`,
    });
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      temperature: 0,
      system,
      messages: [{ role: "user", content }],
    });
    const text = response.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
    return NextResponse.json(jsonFrom(text));
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "";
    const billingError = /credit balance is too low|plans & billing|purchase credits/i.test(rawMessage);
    return NextResponse.json({
      error: billingError
        ? "Автоматическое распознавание временно недоступно: закончился оплаченный баланс ИИ-сервиса. Пополните баланс ANTHROPIC_API_KEY и повторите загрузку."
        : rawMessage || "Не удалось распознать договор",
    }, { status: billingError ? 503 : 500 });
  }
}
