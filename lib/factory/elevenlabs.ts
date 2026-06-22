// V22 · ElevenLabs RU-озвучка: премиум живой русский голос (eleven_multilingual_v2). Адаптер генерит
// аудио по тексту → хостит mp3 в Supabase Storage → отдаёт публичный URL для сборки (Shotstack-дорожка
// закадра поверх реальной съёмки/b-roll). Ключ ELEVENLABS_API_KEY вводит владелец в Vercel — мы его не трогаем.
// ⚠️ ElevenLabs гео-режет РФ; вызов с Vercel МОЖЕТ быть зарезан если их облако флагует IP. Всё soft-degrade:
// нет ключа / заблокировано / ошибка → { error }, завод откатывается на Creatify-голос.
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const API = "https://api.elevenlabs.io/v1";
const BUCKET = "factory-media"; // тот же публичный бакет, что и под слайды/видео
const MODEL = "eleven_multilingual_v2"; // поддерживает русский
const KEY = () => (process.env.ELEVENLABS_API_KEY || "").trim();

// детерминированный хэш для имени кеш-файла (зависит от текста+голоса+настроек, иначе коллизия по длине → подмена озвучки)
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

export function elevenReady(): boolean { return !!KEY(); }

export interface ElevenVoice { id: string; name: string; preview?: string; labels?: string; meta?: string }

// Живой список голосов (для пикера). Без ключа / гео-блок → []. Все голоса работают с multilingual → RU ок.
export async function elevenListVoices(): Promise<ElevenVoice[]> {
  if (!elevenReady()) return [];
  try {
    const r = await fetch(`${API}/voices`, { headers: { "xi-api-key": KEY() }, cache: "no-store", signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const j = (await r.json()) as { voices?: Record<string, unknown>[] };
    return (j.voices || []).map((v) => {
      const labels = (v.labels || {}) as Record<string, string>;
      const lab = [labels.gender, labels.accent, labels.age, labels.use_case].filter(Boolean).join(" · ");
      return { id: String(v.voice_id || ""), name: String(v.name || "voice"), preview: (v.preview_url as string) || undefined, labels: lab || undefined, meta: String(v.category || "") };
    }).filter((v) => v.id);
  } catch { return []; }
}

let _elevenDefaultVoice: string | null = null; // memoize дефолтного голоса — не дёргаем /voices на каждую озвучку

// TTS → mp3 в Storage → публичный URL. text — русский сценарий. voiceId — из пикера/бренд-кита.
// voice_settings: stability/similarity_boost/style 0..1, use_speaker_boost. Возвращает { url } или { error }.
export async function elevenTTS(text: string, voiceId: string, opts?: { stability?: number; similarity_boost?: number; style?: number; model?: string }): Promise<{ url?: string; error?: string }> {
  if (!elevenReady()) return { error: "ELEVENLABS_API_KEY не задан (добавь в Vercel)" };
  const t = String(text || "").trim().slice(0, 2500);
  if (!t) return { error: "пустой текст озвучки" };
  // voice_id может не прийти (автозаполнение не знает live-id, бренд-кит не задан) → берём первый доступный голос аккаунта
  let vid = voiceId;
  if (!vid) vid = (process.env.ELEVENLABS_DEFAULT_VOICE_ID || "").trim();
  // детерминированный дефолт: сортируем по id, чтобы голос был стабильным (а не «первый как вернул API»)
  if (!vid) { if (_elevenDefaultVoice === null) { const voices = await elevenListVoices(); _elevenDefaultVoice = ([...voices].sort((a, b) => a.id.localeCompare(b.id))[0]?.id) || ""; } vid = _elevenDefaultVoice; }
  if (!vid) return { error: "ElevenLabs не дал голосов (гео-блок/неверный ключ?) — задай voice_id в бренд-ките или инспекторе" };
  const db = getSupabaseAdmin();
  if (!db) return { error: "Supabase не настроен (негде хостить аудио)" };

  let buf: Buffer;
  try {
    const vs: Record<string, unknown> = { use_speaker_boost: true };
    if (typeof opts?.stability === "number") vs.stability = Math.max(0, Math.min(1, opts.stability));
    if (typeof opts?.similarity_boost === "number") vs.similarity_boost = Math.max(0, Math.min(1, opts.similarity_boost));
    if (typeof opts?.style === "number") vs.style = Math.max(0, Math.min(1, opts.style));
    const r = await fetch(`${API}/text-to-speech/${encodeURIComponent(vid)}`, {
      method: "POST",
      headers: { "xi-api-key": KEY(), "Content-Type": "application/json", "Accept": "audio/mpeg" },
      body: JSON.stringify({ text: t, model_id: opts?.model || MODEL, voice_settings: vs }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      // 401/403 = ключ/гео-блок; surface честно, чтобы откатиться на Creatify-голос
      return { error: `ElevenLabs ${r.status}: ${detail.slice(0, 140) || (r.status === 401 || r.status === 403 ? "ключ/гео-блок" : "ошибка TTS")}` };
    }
    buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return { error: "ElevenLabs вернул пустое аудио" };
  } catch (e) {
    return { error: "ElevenLabs недоступен: " + String((e as Error)?.message || e).slice(0, 120) };
  }

  try {
    try { await db.storage.createBucket(BUCKET, { public: true }); } catch { /* есть */ }
    const cacheKey = fnv1a([vid, opts?.model || MODEL, opts?.stability, opts?.similarity_boost, opts?.style, t].join("|"));
    const path = `voiceover/${vid.slice(0, 12)}-${cacheKey}.mp3`; // ключ зависит от текста+голоса+настроек — без коллизий по длине
    const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: "audio/mpeg", upsert: true });
    if (error) return { error: "не залилось в Storage: " + error.message.slice(0, 100) };
    const url = db.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl;
    return url ? { url } : { error: "нет publicUrl для аудио" };
  } catch (e) {
    return { error: "Storage сбой: " + String((e as Error)?.message || e).slice(0, 100) };
  }
}
