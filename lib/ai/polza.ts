// Единая точка вызова «Пользы» (polza.ai) для финансового распознавания.
// Польза — российский агрегатор моделей с OpenAI-совместимым API и оплатой в
// рублях; слаги моделей — как в каталоге GET polza.ai/api/v1/models. Раньше
// запрос к ней был скопирован в трёх финансовых файлах — здесь он один, и здесь
// же логируется стоимость звонка (usage.cost_rub), которую Польза возвращает.

export const POLZA_CHAT_URL = "https://polza.ai/api/v1/chat/completions";

/** Ключ Пользы: POLZA_API_KEY, иначе POLZA_AI_API_KEY (как у старого сборщика находок); пусто — не настроен. */
export function polzaKey(): string {
  return process.env.POLZA_API_KEY?.trim() || process.env.POLZA_AI_API_KEY?.trim() || "";
}

export function polzaConfigured(): boolean {
  return Boolean(polzaKey());
}

/** Содержимое пользовательского сообщения: строка или массив частей OpenAI-формата (text/file/image_url). */
export type PolzaUserContent = string | Array<Record<string, unknown>>;

/**
 * Один вызов чата Пользы со строгим JSON-ответом. Возвращает сырой текст ответа
 * модели (каждый вызывающий парсит под свой контракт). Бросает ошибку с текстом
 * от Пользы при не-2xx или пустом ответе.
 */
export async function polzaChat(opts: {
  model: string;
  system: string;
  content: PolzaUserContent;
  maxTokens: number;
  timeoutMs: number;
  /** Префикс строки лога стоимости, например «Распознавание кредита». */
  label?: string;
}): Promise<string> {
  const key = polzaKey();
  if (!key) throw new Error("POLZA_API_KEY не настроен");
  const response = await fetch(POLZA_CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      temperature: 0,
      max_tokens: opts.maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.content },
      ],
    }),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  const payload = (await response.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: string } }>; usage?: { cost_rub?: number }; error?: { message?: string } }
    | null;
  if (!response.ok) throw new Error(payload?.error?.message || `Polza вернула ошибку ${response.status}`);
  const text = payload?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Polza не вернула результат распознавания");
  if (typeof payload?.usage?.cost_rub === "number") {
    console.info(`${opts.label || "Polza"} (${opts.model}): ${payload.usage.cost_rub.toFixed(2)} ₽`);
  }
  return text;
}
