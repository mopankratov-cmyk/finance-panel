// R5 · ASR: расшифровка голоса (fal-whisper) — для голос-ревью оператора в Telegram
// и (позже) word-timestamps капшенов VO. Переиспользует FAL_KEY (новый ключ не нужен).
// Sync-эндпоинт fal.run (голосовые короткие <60с укладываются в maxDuration). Мягкая деградация.

const WHISPER = "https://fal.run/fal-ai/whisper";
const WHISPER_TIMEOUT_MS = Number(process.env.REELS_BRAIN_FAL_WHISPER_TIMEOUT_MS || 180000);

export async function transcribeFal(audioUrl: string, language = "ru"): Promise<{ text: string | null; error?: string }> {
  const k = process.env.FAL_KEY || null;
  if (!k) return { text: null, error: "FAL_KEY не настроен" };
  if (!audioUrl) return { text: null, error: "нет audio_url" };
  const attempts = [WHISPER_TIMEOUT_MS, Math.max(WHISPER_TIMEOUT_MS, 300000)];
  let lastError = "whisper_failed";
  for (let index = 0; index < attempts.length; index += 1) {
    try {
      const r = await fetch(WHISPER, {
        method: "POST",
        headers: { Authorization: `Key ${k}`, "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ audio_url: audioUrl, task: "transcribe", language }),
        signal: AbortSignal.timeout(attempts[index]),
      });
      if (!r.ok) {
        lastError = `whisper ${r.status}`;
        if (r.status >= 500 && index + 1 < attempts.length) continue;
        return { text: null, error: lastError };
      }
      const j = (await r.json().catch(() => ({}))) as { text?: string };
      return { text: (j.text || "").trim() || null };
    } catch (e) {
      lastError = String((e as Error)?.message || e).slice(0, 120) || "whisper_failed";
      if (/aborted|timeout/i.test(lastError) && index + 1 < attempts.length) continue;
      return { text: null, error: lastError };
    }
  }
  return { text: null, error: lastError };
}
