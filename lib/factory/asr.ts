// R5 · ASR: расшифровка голоса (fal-whisper) — для голос-ревью оператора в Telegram
// и (позже) word-timestamps капшенов VO. Переиспользует FAL_KEY (новый ключ не нужен).
// Sync-эндпоинт fal.run (голосовые короткие <60с укладываются в maxDuration). Мягкая деградация.

const WHISPER = "https://fal.run/fal-ai/whisper";

export async function transcribeFal(audioUrl: string, language = "ru"): Promise<{ text: string | null; error?: string }> {
  const k = process.env.FAL_KEY || null;
  if (!k) return { text: null, error: "FAL_KEY не настроен" };
  if (!audioUrl) return { text: null, error: "нет audio_url" };
  try {
    const r = await fetch(WHISPER, {
      method: "POST",
      headers: { Authorization: `Key ${k}`, "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ audio_url: audioUrl, task: "transcribe", language }),
      signal: AbortSignal.timeout(50000),
    });
    if (!r.ok) return { text: null, error: `whisper ${r.status}` };
    const j = (await r.json().catch(() => ({}))) as { text?: string };
    return { text: (j.text || "").trim() || null };
  } catch (e) {
    return { text: null, error: String((e as Error)?.message || e).slice(0, 120) };
  }
}
