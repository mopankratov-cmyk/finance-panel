// Второй LLM-провайдер (OpenAI-совместимый): OpenRouter ИЛИ DeepSeek (доступен из РФ) и др.
// Конфиг через env: LLM2_API_KEY + LLM2_BASE_URL + LLM2_MODEL.
// Пресеты: DeepSeek → base https://api.deepseek.com/v1, model deepseek-chat (DEEPSEEK_API_KEY).
//          OpenRouter → base https://openrouter.ai/api/v1, model google/gemini-2.5-pro (OPENROUTER_API_KEY).
function cfg() {
  if (process.env.DEEPSEEK_API_KEY) return { key: process.env.DEEPSEEK_API_KEY, base: "https://api.deepseek.com/v1", model: process.env.LLM2_MODEL || "deepseek-chat" };
  if (process.env.OPENROUTER_API_KEY) return { key: process.env.OPENROUTER_API_KEY, base: "https://openrouter.ai/api/v1", model: process.env.LLM2_MODEL || "google/gemini-2.5-pro" };
  if (process.env.LLM2_API_KEY) return { key: process.env.LLM2_API_KEY, base: process.env.LLM2_BASE_URL || "https://openrouter.ai/api/v1", model: process.env.LLM2_MODEL || "google/gemini-2.5-pro" };
  return null;
}

export function hasOpenRouter(): boolean { return !!cfg(); }
export function openRouterModel(): string { return cfg()?.model || ""; }

export async function openRouterText(system: string, user: string, maxTokens = 3000): Promise<string | null> {
  const c = cfg();
  if (!c) return null;
  const key = c.key;
  try {
    const r = await fetch(`${c.base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Content Factory" },
      cache: "no-store",
      body: JSON.stringify({
        model: c.model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: maxTokens, temperature: 0.9,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content?.trim() || null;
  } catch { return null; }
}
