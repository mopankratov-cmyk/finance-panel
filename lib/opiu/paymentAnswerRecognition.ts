import { POLZA_FINANCE_MODEL, POLZA_FINANCE_FALLBACK_MODEL } from "@/lib/ai/models";
import { polzaChat, polzaConfigured } from "@/lib/ai/polza";
import { COMPANY_ALIAS_PROMPT_NOTE } from "@/lib/finance/companyAliases";

export interface PaymentAnswerContext {
  answer: string;
  amount: number;
  purpose: string;
  counterparty: string;
  currentCompanyId: string | null;
  companies: Array<{ id: string; name: string }>;
  categories: string[];
}

export interface PaymentAnswerRecognition {
  category: string | null;
  companyId: string | null;
  confidence: number;
  clarification: string | null;
  explanation: string;
}

function jsonFrom(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("ИИ не вернул JSON");
  return JSON.parse(match[0]) as Partial<PaymentAnswerRecognition>;
}

const system = `Ты классифицируешь ответ руководителя о банковском платеже. Не выдумывай.
Верни только JSON: {"category":string|null,"companyId":string|null,"confidence":0..1,"clarification":string|null,"explanation":string}.
category выбирай только из переданного списка. companyId — только из переданного списка компаний.
Если неясна статья или компания, confidence должен быть ниже 0.85 и clarification должен содержать один короткий конкретный вопрос.
${COMPANY_ALIAS_PROMPT_NOTE}. «Сервис», программа, подписка, ЭЦП и ИИ обычно относятся к ПО, но при неоднозначности уточни назначение.`;

/** Классификация ответа о платеже — через «Пользу»: главная модель, при сбое — резервная. */
export async function recognizePaymentAnswer(context: PaymentAnswerContext): Promise<PaymentAnswerRecognition> {
  if (!polzaConfigured()) throw new Error("POLZA_API_KEY не настроен");
  const ask = (model: string) => polzaChat({ model, system, content: JSON.stringify(context), maxTokens: 700, timeoutMs: 30_000, label: "Классификация платежа" });
  let text: string;
  try {
    text = await ask(POLZA_FINANCE_MODEL);
  } catch (primary) {
    if (!POLZA_FINANCE_FALLBACK_MODEL || POLZA_FINANCE_FALLBACK_MODEL === POLZA_FINANCE_MODEL) throw primary;
    text = await ask(POLZA_FINANCE_FALLBACK_MODEL);
  }
  const parsed = jsonFrom(text);
  const allowedCategory = context.categories.includes(String(parsed.category ?? "")) ? String(parsed.category) : null;
  const allowedCompany = context.companies.some((company) => company.id === parsed.companyId) ? String(parsed.companyId) : context.currentCompanyId;
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
  return {
    category: allowedCategory,
    companyId: allowedCompany,
    confidence,
    clarification: parsed.clarification ? String(parsed.clarification).slice(0, 500) : null,
    explanation: String(parsed.explanation ?? "").slice(0, 500),
  };
}
