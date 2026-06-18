// ElevenLabs TTS — живой русский voiceover для немых роликов (карусель/Kling/Pika/Seedance).
// ИНФРАСТРУКТУРА: инертно без ELEVENLABS_API_KEY. Озвучку накладываем на видео серверным FAL ffmpeg-муксом (см. falVideo),
// НЕ браузером. Текст берём из scenario.shots[].voiceover. Русский → eleven_multilingual_v2.
const BASE = "https://api.elevenlabs.io/v1";
// дефолтный голос (Rachel) — переопределяется opts.voiceId; список голосов: GET /voices
const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";
const DEFAULT_MODEL = "eleven_multilingual_v2";

function key(): string | null { return process.env.ELEVENLABS_API_KEY || null; }
export function ttsReady(): boolean { return !!key(); }

// список голосов (для выбора рус-диктора). Free read.
export async function ttsVoices(): Promise<{ id: string; name?: string }[]> {
  const k = key();
  if (!k) return [];
  try {
    const r = await fetch(`${BASE}/voices`, { headers: { "xi-api-key": k }, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    const j = (await r.json()) as { voices?: Array<{ voice_id: string; name?: string }> };
    return (j.voices || []).map((v) => ({ id: v.voice_id, name: v.name }));
  } catch { return []; }
}

// Сгенерить mp3 из текста. Возвращает байты (Buffer) или ошибку. Загрузку в Storage + мукс делает вызывающий.
export async function ttsGenerate(text: string, opts?: { voiceId?: string; model?: string; stability?: number }): Promise<{ audio?: Buffer; contentType?: string; error?: string }> {
  const k = key();
  if (!k) return { error: "ELEVENLABS_API_KEY не настроен" };
  const clean = (text || "").toString().trim().slice(0, 2500);
  if (!clean) return { error: "пустой текст" };
  const voice = opts?.voiceId || DEFAULT_VOICE;
  try {
    const r = await fetch(`${BASE}/text-to-speech/${voice}`, {
      method: "POST",
      headers: { "xi-api-key": k, "Content-Type": "application/json", Accept: "audio/mpeg" },
      cache: "no-store",
      body: JSON.stringify({
        text: clean,
        model_id: opts?.model || DEFAULT_MODEL,
        voice_settings: { stability: opts?.stability ?? 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) { const t = await r.text().catch(() => ""); return { error: `ElevenLabs ${r.status}: ${t.slice(0, 150)}` }; }
    const buf = Buffer.from(await r.arrayBuffer());
    return { audio: buf, contentType: "audio/mpeg" };
  } catch (e) { return { error: String(e).slice(0, 140) }; }
}
