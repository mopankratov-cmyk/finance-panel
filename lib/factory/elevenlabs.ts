// V22 · TTS-адаптер для русской озвучки. Приоритет:
//   1) Yandex SpeechKit, если настроен;
//   2) ElevenLabs, если есть ключ и он доступен;
//   3) мягкий отказ, чтобы завод продолжал без голосовой дорожки.
//
// Оба провайдера хостят результат в Supabase Storage и возвращают публичный URL для сборки.
// SpeechKit хорош как основной RU-fallback: ключ можно держать на сервисном аккаунте, а запрос
// поддерживает mp3 и до 5000 символов на синтез. ElevenLabs оставляем как premium-резерв.
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const YANDEX_API = "https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize";
const API = "https://api.elevenlabs.io/v1";
const BUCKET = "factory-media"; // тот же публичный бакет, что и под слайды/видео
const MODEL = "eleven_multilingual_v2"; // поддерживает русский
const KEY = () => (process.env.ELEVENLABS_API_KEY || "").trim();
const YANDEX_KEY = () => (process.env.YANDEX_SPEECHKIT_API_KEY || process.env.YANDEX_API_KEY || "").trim();
const YANDEX_IAM = () => (process.env.YANDEX_SPEECHKIT_IAM_TOKEN || process.env.YANDEX_IAM_TOKEN || "").trim();
const YANDEX_FOLDER = () => (process.env.YANDEX_SPEECHKIT_FOLDER_ID || process.env.YANDEX_FOLDER_ID || "").trim();

// детерминированный хэш для имени кеш-файла (зависит от текста+голоса+настроек, иначе коллизия по длине → подмена озвучки)
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

export function elevenReady(): boolean { return !!KEY(); }
export function yandexReady(): boolean { return !!YANDEX_KEY() || !!YANDEX_IAM(); }
export function speechReady(): boolean { return yandexReady() || elevenReady(); }

export interface ElevenVoice { id: string; name: string; preview?: string; labels?: string; meta?: string }

const YANDEX_RU_VOICES: ElevenVoice[] = [
  { id: "marina", name: "Marina", labels: "ru-RU · F · neutral" },
  { id: "alena", name: "Alena", labels: "ru-RU · F · good" },
  { id: "dasha", name: "Dasha", labels: "ru-RU · F · friendly" },
  { id: "julia", name: "Julia", labels: "ru-RU · F · strict" },
  { id: "lera", name: "Lera", labels: "ru-RU · F · neutral" },
  { id: "omazh", name: "Omazh", labels: "ru-RU · F · evil" },
  { id: "filipp", name: "Filipp", labels: "ru-RU · M" },
  { id: "ermil", name: "Ermil", labels: "ru-RU · M · neutral/good" },
  { id: "zahar", name: "Zahar", labels: "ru-RU · M · good" },
  { id: "alexander", name: "Alexander", labels: "ru-RU · M · neutral" },
  { id: "kirill", name: "Kirill", labels: "ru-RU · M · good/strict" },
  { id: "anton", name: "Anton", labels: "ru-RU · M · good" },
  { id: "masha", name: "Masha", labels: "ru-RU · F · good/friendly" },
  { id: "madi_ru", name: "Madi RU", labels: "ru-RU · M" },
  { id: "saule_ru", name: "Saule RU", labels: "ru-RU · F · neutral/strict" },
];

// Живой список голосов (для пикера). Без ключа / гео-блок → []. Все голоса работают с multilingual → RU ок.
export async function elevenListVoices(): Promise<ElevenVoice[]> {
  if (yandexReady()) return YANDEX_RU_VOICES;
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
let _yandexDefaultVoice: string | null = null;
let _ttsQueue: Promise<void> = Promise.resolve(); // ElevenLabs часто ограничивает concurrent TTS на аккаунт

async function withTtsSlot<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _ttsQueue;
  let release!: () => void;
  _ttsQueue = new Promise<void>((resolve) => { release = resolve; });
  await prev.catch(() => undefined);
  try { return await fn(); }
  finally {
    await new Promise((resolve) => setTimeout(resolve, 750));
    release();
  }
}

async function yandexTTS(text: string, voiceId: string, opts?: { speed?: number; emotion?: string; format?: "mp3" | "oggopus" | "lpcm" }): Promise<{ url?: string; error?: string }> {
  if (!yandexReady()) return { error: "YANDEX_SPEECHKIT_API_KEY не задан (или IAM token)" };
  const t = String(text || "").trim().slice(0, 5000);
  if (!t) return { error: "пустой текст озвучки" };
  const db = getSupabaseAdmin();
  if (!db) return { error: "Supabase не настроен (негде хостить аудио)" };

  const vid = String(voiceId || process.env.YANDEX_SPEECHKIT_VOICE || process.env.YANDEX_VOICE || _yandexDefaultVoice || "marina").trim();
  if (!_yandexDefaultVoice) _yandexDefaultVoice = vid || "marina";

  try {
    const body = new URLSearchParams();
    body.set("text", t);
    body.set("lang", "ru-RU");
    body.set("voice", vid || "marina");
    body.set("format", opts?.format || "mp3");
    if (typeof opts?.speed === "number" && Number.isFinite(opts.speed)) body.set("speed", String(Math.max(0.1, Math.min(3, opts.speed))));
    if (opts?.emotion) body.set("emotion", opts.emotion);

    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    const apiKey = YANDEX_KEY();
    const iam = YANDEX_IAM();
    if (apiKey) headers.Authorization = `Api-Key ${apiKey}`;
    else if (iam) headers.Authorization = `Bearer ${iam}`;
    else return { error: "SpeechKit auth не настроен" };
    if (iam && YANDEX_FOLDER()) body.set("folderId", YANDEX_FOLDER());

    const r = await withTtsSlot(() => fetch(YANDEX_API, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(45000),
    }));
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return { error: `Yandex SpeechKit ${r.status}: ${detail.slice(0, 160) || "ошибка TTS"}` };
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return { error: "Yandex SpeechKit вернул пустое аудио" };

    try { await db.storage.createBucket(BUCKET, { public: true }); } catch { /* есть */ }
    const cacheKey = fnv1a([`yandex`, vid, opts?.format || "mp3", opts?.speed, opts?.emotion, t].join("|"));
    const path = `voiceover/yandex-${vid.slice(0, 12)}-${cacheKey}.mp3`;
    const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: "audio/mpeg", upsert: true, cacheControl: "31536000" });
    if (error) return { error: "не залилось в Storage: " + error.message.slice(0, 100) };
    const url = db.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl;
    return url ? { url } : { error: "нет publicUrl для аудио" };
  } catch (e) {
    return { error: "Yandex SpeechKit недоступен: " + String((e as Error)?.message || e).slice(0, 120) };
  }
}

// TTS → mp3 в Storage → публичный URL. text — русский сценарий. voiceId — из пикера/бренд-кита.
// voice_settings: stability/similarity_boost/style 0..1, use_speaker_boost. Возвращает { url } или { error }.
export async function elevenTTS(text: string, voiceId: string, opts?: { stability?: number; similarity_boost?: number; style?: number; model?: string }): Promise<{ url?: string; error?: string }> {
  if (yandexReady()) {
    return yandexTTS(text, voiceId, {
      format: "mp3",
      speed: typeof opts?.stability === "number" ? Math.max(0.1, Math.min(3, 1 + (opts.stability - 0.5) * 0.4)) : undefined,
      emotion: "friendly",
    });
  }
  if (!elevenReady()) return { error: "ни Yandex SpeechKit, ни ELEVENLABS_API_KEY не настроены" };
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
    // Пресет естественного UGC-голоса (исследование ElevenLabs): stability 0.5 / similarity 0.75 / style 0 —
    // меньше артефактов и латентности, чем дефолт. Любой параметр переопределяется через opts.
    const vs: Record<string, unknown> = {
      stability: typeof opts?.stability === "number" ? Math.max(0, Math.min(1, opts.stability)) : 0.5,
      similarity_boost: typeof opts?.similarity_boost === "number" ? Math.max(0, Math.min(1, opts.similarity_boost)) : 0.75,
      style: typeof opts?.style === "number" ? Math.max(0, Math.min(1, opts.style)) : 0,
      use_speaker_boost: true,
    };
    const r = await withTtsSlot(() => fetch(`${API}/text-to-speech/${encodeURIComponent(vid)}`, {
      method: "POST",
      headers: { "xi-api-key": KEY(), "Content-Type": "application/json", "Accept": "audio/mpeg" },
      // apply_text_normalization:"auto" — числа/цены/проценты/даты озвучиваются словами (иначе «2990₽» искажается)
      body: JSON.stringify({ text: t, model_id: opts?.model || MODEL, voice_settings: vs, apply_text_normalization: "auto" }),
      signal: AbortSignal.timeout(45000),
    }));
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
    const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: "audio/mpeg", upsert: true, cacheControl: "31536000" });
    if (error) return { error: "не залилось в Storage: " + error.message.slice(0, 100) };
    const url = db.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl;
    return url ? { url } : { error: "нет publicUrl для аудио" };
  } catch (e) {
    return { error: "Storage сбой: " + String((e as Error)?.message || e).slice(0, 100) };
  }
}
