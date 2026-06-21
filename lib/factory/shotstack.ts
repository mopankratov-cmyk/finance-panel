// Shotstack — managed render-API для модульной сборки видео (Factory v2). Async submit→poll, ложится
// на нашу self-chaining очередь (контракт как falVideo). Ключ SHOTSTACK_API_KEY (+SHOTSTACK_ENV=v1|stage).
// ⚠️ НЕ ВАЛИДИРОВАНО LIVE: JSON-схема Shotstack собрана по докам/ресёрчу — нужен 1 смоук-тест на ПРОДЕ
// (sandbox=stage ставит watermark). Кириллица: Noto Sans из jsDelivr/Google Fonts CDN — дефолт, без загрузки.
// Вся схема Edit изолирована в buildEdit() — миграция на ffmpeg/другой движок трогает ТОЛЬКО этот файл.

// Noto Sans с Кириллицей (Google Fonts → jsDelivr CDN, стабильный TTF, загрузка не нужна)
const CYRILLIC_FONT_URL = "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosans/NotoSans-Regular.ttf";
const CYRILLIC_FONT_FAMILY = "Noto Sans";

const KEY = (): string | null => process.env.SHOTSTACK_API_KEY || null;
const ENV = (): string => (process.env.SHOTSTACK_ENV === "stage" ? "stage" : "v1"); // дефолт prod (stage=watermark)
const BASE = (): string => `https://api.shotstack.io/edit/${ENV()}`; // /edit/ — текущий формат API (видно в dashboard)

export function shotstackReady(): boolean {
  return !!process.env.SHOTSTACK_API_KEY;
}

// блок сборки: видео/изображение с АБСОЛЮТНЫМ start/length (раскладка по секундам/бит-сетке)
export interface AssemblyClip {
  url: string;
  type: "video" | "image";
  start: number;
  length: number;
  transition?: string; // fade | slideLeft | ... (Shotstack transition in)
  trim?: number;       // отрезать начало исходника, с (disk_real trim_start)
  volume?: number;     // громкость видео-клипа 0-1
  fit?: string;        // per-clip вписывание (перебивает глобальный)
}

function aspectSize(a: string): { width: number; height: number } {
  if (a === "1:1") return { width: 1080, height: 1080 };
  if (a === "16:9") return { width: 1920, height: 1080 };
  return { width: 1080, height: 1920 }; // 9:16 дефолт
}

// Собрать Shotstack Edit timeline из блоков [HOOK]+[SCENE]+[PAYOFF] + хук-текст + субтитры + трендовый звук.
// Порядок треков: текст СВЕРХУ (track[0] = передний план у Shotstack), визуал — база, аудио — отдельно.
export function buildEdit(opts: {
  clips: AssemblyClip[];
  hookText?: string;
  caption?: string;
  audioUrl?: string;
  fontUrl?: string;          // Cyrillic-TTF (Supabase Storage URL) — ОБЯЗАТЕЛЬНО для RU
  fontFamily?: string;       // должен совпадать с family внутри TTF
  aspect?: "9:16" | "1:1" | "16:9";
  // настройки ноды shotstack (инспектор) — раньше игнорились, теперь применяются
  fontSize?: number;         // кегль субтитров (дефолт 28)
  fontColor?: string;        // цвет субтитров (#RRGGBB)
  effect?: string;           // Ken Burns на видео-клипах (zoomIn/slideLeft…)
  filter?: string;           // фильтр (boost/contrast/muted…)
  audioVolume?: number;      // громкость трека 0-1 (дефолт 1)
  // вывод / композиция (нода shotstack) — раньше захардкожены
  outputFormat?: string;     // mp4|gif|webm|mp3 (дефолт mp4)
  fps?: number;              // 12|15|24|25|30
  quality?: string;          // low|medium|high
  fit?: string;              // cover|contain|crop|none (дефолт cover)
  background?: string;       // фон таймлайна (#RRGGBB, дефолт #000000)
}): Record<string, unknown> {
  const resolvedFontUrl = opts.fontUrl || process.env.SHOTSTACK_FONT_URL || CYRILLIC_FONT_URL;
  const family = opts.fontFamily || process.env.SHOTSTACK_FONT_FAMILY || CYRILLIC_FONT_FAMILY;
  const totalLen = opts.clips.reduce((m, c) => Math.max(m, c.start + c.length), 0) || 5;
  const capSize = typeof opts.fontSize === "number" ? opts.fontSize : 28;
  const capColor = opts.fontColor || "#ffffff";
  const ef = opts.effect && opts.effect !== "none" ? opts.effect : undefined;
  const fl = opts.filter && opts.filter !== "none" ? opts.filter : undefined;
  const fit = opts.fit && opts.fit !== "none" ? opts.fit : "cover";

  const visualClips = opts.clips.map((c) => ({
    // trim — отрезаем начало исходника (disk_real); volume — для видео-клипа со звуком
    asset: { type: c.type, src: c.url, ...(typeof c.trim === "number" && c.trim > 0 ? { trim: c.trim } : {}), ...(typeof c.volume === "number" ? { volume: c.volume } : {}) },
    start: c.start,
    length: c.length,
    fit: c.fit && c.fit !== "none" ? c.fit : fit,
    ...(c.transition ? { transition: { in: c.transition } } : {}),
    ...(ef ? { effect: ef } : {}),
    ...(fl ? { filter: fl } : {}),
  }));
  const tracks: Record<string, unknown>[] = [{ clips: visualClips }];

  // субтитры/подпись внизу — весь ролик (кладём раньше визуала → выше по z)
  if (opts.caption) {
    tracks.unshift({ clips: [{ asset: { type: "text", text: opts.caption, font: { family, size: capSize, color: capColor }, alignment: { horizontal: "center", vertical: "bottom" } }, start: 0, length: totalLen }] });
  }
  // хук-текст сверху — первые ~3с (крупнее субтитров)
  if (opts.hookText) {
    tracks.unshift({ clips: [{ asset: { type: "text", text: opts.hookText, font: { family, size: Math.max(capSize, 48), color: capColor }, alignment: { horizontal: "center", vertical: "top" }, background: { color: "#000000", opacity: 0.45 } }, start: 0, length: Math.min(3, totalLen) }] });
  }
  // трендовый звук — отдельный аудио-трек (порядок для аудио не влияет на z)
  if (opts.audioUrl) tracks.push({ clips: [{ asset: { type: "audio", src: opts.audioUrl, volume: typeof opts.audioVolume === "number" ? opts.audioVolume : 1 }, start: 0, length: totalLen }] });

  const timeline: Record<string, unknown> = { background: opts.background || "#000000", tracks };
  timeline.fonts = [{ src: resolvedFontUrl }];
  const ALLOWED_FORMATS = new Set(["mp4", "gif", "jpg", "png", "bmp", "mp3"]); // защита: чужой format → 422; падаем на mp4
  const output: Record<string, unknown> = { format: ALLOWED_FORMATS.has(String(opts.outputFormat)) ? opts.outputFormat! : "mp4", size: aspectSize(opts.aspect || "9:16") };
  if (typeof opts.fps === "number") output.fps = opts.fps;
  if (opts.quality) output.quality = opts.quality;
  return { timeline, output };
}

// Бит-синк ДЕМОУТНУТ до фикс-сетки: Virlo не отдаёт скачиваемый mp3/bpm → захардкоженный каденс
// (~120 BPM = 0.5с). Настоящий onset-детект — позже, после того как появится реальный mp3-URL.
export function fixedBeatGrid(bpm = 120, totalSec = 20): number[] {
  const step = 60 / (bpm || 120);
  const out: number[] = [];
  for (let t = 0; t < totalSec; t += step) out.push(Math.round(t * 100) / 100);
  return out;
}

// Разложить блоки по бит-сетке: каждому клипу start = ближайший бит, length = до следующего нужного бита.
export function quantizeToBeats(clips: AssemblyClip[], grid: number[]): AssemblyClip[] {
  if (!grid.length) return clips;
  const nearest = (t: number) => grid.reduce((p, g) => (Math.abs(g - t) < Math.abs(p - t) ? g : p), grid[0]);
  return clips.map((c) => { const s = nearest(c.start); return { ...c, start: s, length: Math.max(0.5, nearest(s + c.length) - s || c.length) }; });
}

// submit: POST /render → render id (контракт как falVideoSubmit).
export async function shotstackSubmit(editJson: Record<string, unknown>): Promise<string | null> {
  const k = KEY();
  if (!k) return null;
  try {
    const r = await fetch(`${BASE()}/render`, { method: "POST", headers: { "x-api-key": k, "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify(editJson), signal: AbortSignal.timeout(25000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { response?: { id?: string } };
    return j.response?.id || null;
  } catch { return null; }
}

export interface ShotstackStatus { status: "in_progress" | "done" | "error"; videoUrl?: string; error?: string }

// status: GET /render/{id} → queued|fetching|rendering|saving|done|failed (+ url).
export async function shotstackStatus(id: string): Promise<ShotstackStatus> {
  const k = KEY();
  if (!k) return { status: "error", error: "SHOTSTACK_API_KEY не настроен" };
  try {
    const r = await fetch(`${BASE()}/render/${id}`, { headers: { "x-api-key": k }, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { status: "error", error: `shotstack ${r.status}` };
    const j = (await r.json()) as { response?: { status?: string; url?: string; error?: string } };
    const st = j.response?.status;
    if (st === "done" && j.response?.url) return { status: "done", videoUrl: j.response.url };
    if (st === "failed") return { status: "error", error: (j.response?.error || "shotstack failed").slice(0, 120) };
    return { status: "in_progress" };
  } catch (e) { return { status: "error", error: String(e).slice(0, 100) }; }
}
