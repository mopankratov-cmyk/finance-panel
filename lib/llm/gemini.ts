// Google Gemini через REST (без SDK). Нужен GEMINI_API_KEY. Модель — GEMINI_MODEL (по умолч. gemini-2.5-pro).
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-pro";
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export function hasGemini(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

// Один вызов: system + user → текст. Возвращает null при отсутствии ключа/ошибке (вызывающий падает на Claude).
export async function geminiText(system: string, user: string, maxTokens = 3000): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`${BASE}/${MODEL}:generateContent?key=${key}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.9 },
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const txt = j.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ?? "";
    return txt.trim() || null;
  } catch { return null; }
}
