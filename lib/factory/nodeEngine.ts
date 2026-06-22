// V3 нод-движок: единый диспетчер «нода → инструмент → сабмит/опрос».
// Одна точка маппинга params(jsonb из инспектора) → тело конкретного API. Переиспользуется
// и в node-preview (одна нода), и в graph-run (весь граф). Токен несёт движок: base64url("engine::inner").
import { falVideoSubmit, falVideoStatus, FAL_VIDEO_MODELS, type FalVideoModel, type FalVideoOpts } from "./falVideo";
import { creatifyLinkVideo, creatifyStatus } from "./creatify";
import { elevenTTS } from "./elevenlabs";
import { isPlaceholderSource } from "./toolSchemas";
import { rehostImageForFal } from "./rehostImage";

export type NodeEngine = "fal" | "creatify" | "disk" | "asset" | "voice" | "none";

// нормализованная нода (из node_recipe_nodes ИЛИ из инспектора)
export interface EngineNode {
  tool?: string | null;          // seedance|kling|creatify|disk_real|...
  node_type?: string | null;
  prompt?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: Record<string, any> | null;  // ВСЕ api-настройки (имена api_param из toolSchemas)
  image_url?: string | null;     // вход для i2v / товар
  asset_url?: string | null;     // готовый ассет (disk_real / уже сгенерённое)
  duration_sec?: number | null;
}

export interface SubmitResult { engine: NodeEngine; token?: string; url?: string; done?: boolean; error?: string; cost_hint?: string }
export interface PollResult { status: "in_progress" | "done" | "error"; url?: string; error?: string }

// fal-семейства по tool
const FAL_TOOLS: Record<string, FalVideoModel> = {
  seedance: "seedance", seedance_fast: "seedance_fast", seedance_pro: "seedance",
  kling: "kling", kling_pro: "kling_pro", pika: "pika",
};

function packToken(engine: NodeEngine, inner: string): string {
  return Buffer.from(`${engine}::${inner}`).toString("base64url");
}
function unpackToken(token: string): { engine: NodeEngine; inner: string } | null {
  try {
    const s = Buffer.from(token, "base64url").toString();
    const i = s.indexOf("::");
    if (i < 0) return null;
    return { engine: s.slice(0, i) as NodeEngine, inner: s.slice(i + 2) };
  } catch { return null; }
}

// params(api_param имена) → FalVideoOpts. Терпит и aspect_ratio, и aspect.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function falOptsFromParams(p: Record<string, any> | null | undefined): FalVideoOpts {
  const o: FalVideoOpts = {};
  if (!p) return o;
  if (p.duration != null) o.duration = p.duration;
  if (p.aspect_ratio || p.aspect) o.aspect = p.aspect_ratio || p.aspect;
  if (p.resolution) o.resolution = p.resolution;
  if (p.negative_prompt || p.negative) o.negative = p.negative_prompt || p.negative;
  if (p.end_image_url || p.tail_image_url) o.end_image_url = p.end_image_url || p.tail_image_url;
  if (typeof p.camera_fixed === "boolean") o.camera_fixed = p.camera_fixed;
  if (typeof p.seed === "number") o.seed = p.seed;
  if (typeof p.cfg_scale === "number") o.cfg_scale = p.cfg_scale;
  if (typeof p.num_frames === "number") o.num_frames = p.num_frames;
  if (typeof p.enable_safety_checker === "boolean") o.enable_safety_checker = p.enable_safety_checker;
  // выбор эндпоинта: явный endpoint > kling mode=pro > model-ключ. Иначе движок берёт дефолт семейства.
  if (p.endpoint) o.endpoint = p.endpoint;
  else if (p.mode === "pro") o.endpoint = FAL_VIDEO_MODELS.kling_pro;          // kling Режим=pro → kling_pro эндпоинт
  else if (p.model && FAL_VIDEO_MODELS[p.model as FalVideoModel]) o.endpoint = FAL_VIDEO_MODELS[p.model as FalVideoModel];
  return o;
}

// Сабмит одной ноды на её движок. Возвращает токен (для опроса) ЛИБО сразу url/done (disk_real/asset).
export async function submitNode(node: EngineNode): Promise<SubmitResult> {
  const tool = String(node.tool || "").toLowerCase();
  const params = node.params || {};
  // isPlaceholderSource: «picker»/«file»/пустое — это echo имени ui-контрола из автофилла, не источник.
  // Без этого seedance слал бы image_url="picker" в fal (→ 422), а disk_real помечался done с заглушкой (→ Remotion 404).
  const pick = (...cands: unknown[]) => { for (const c of cands) if (!isPlaceholderSource(c)) return String(c); return ""; };
  const imageUrl = pick(node.image_url, params.image_url, node.asset_url);

  // disk_real / готовый ассет — «превью» = сам клип, без генерации ($0)
  if (tool === "disk_real" || tool === "disk") {
    const url = pick(node.asset_url, params.url, node.image_url);
    if (url) return { engine: "disk", url, done: true, cost_hint: "free" };
    return { engine: "disk", error: "disk_real: нет url клипа (params.url / asset_url)" };
  }
  if (node.asset_url && !tool) return { engine: "asset", url: node.asset_url, done: true, cost_hint: "free" };

  // fal видео-семейства (seedance/kling/pika)
  if (FAL_TOOLS[tool]) {
    if (!imageUrl) return { engine: "fal", error: `${tool}: нужно image_url (фото товара/стартовый кадр)` };
    const model = FAL_TOOLS[tool];
    const opts = falOptsFromParams(params);
    // WB-CDN флэйкит на серверной загрузке fal ("file_download") → рехостим фото товара в наш бакет (надёжно).
    // Best-effort: при любом сбое вернётся исходный url. end_image_url (before/after) — тоже.
    const srcImg = await rehostImageForFal(imageUrl);
    if (opts.end_image_url) opts.end_image_url = await rehostImageForFal(opts.end_image_url);
    const inner = await falVideoSubmit(model, srcImg, String(node.prompt || params.prompt || ""), opts);
    if (!inner) return { engine: "fal", error: "fal не принял сабмит (FAL_KEY / баланс / 422 модель)" };
    return { engine: "fal", token: packToken("fal", inner), cost_hint: model.includes("fast") ? "low" : "med" };
  }

  // creatify UGC-актёр
  if (tool === "creatify") {
    // субтитры приходят ПЛОСКИМИ точечными ключами (caption_setting.font_size, caption_setting.offset.x) →
    // собираем ВЛОЖЕННЫЙ объект (offset.x → offset:{x}). ВАЖНО: при любой правке субтитров шлём
    // override_visual_style:true, иначе шаблон Creatify игнорит наши caption_setting.
    const caption_setting: Record<string, unknown> = {};
    const setNested = (obj: Record<string, unknown>, path: string, val: unknown) => {
      const parts = path.split(".");
      let o = obj;
      for (let i = 0; i < parts.length - 1; i++) { if (typeof o[parts[i]] !== "object" || o[parts[i]] === null) o[parts[i]] = {}; o = o[parts[i]] as Record<string, unknown>; }
      o[parts[parts.length - 1]] = val;
    };
    for (const k of Object.keys(params)) {
      if (k.startsWith("caption_setting.") && params[k] !== "" && params[k] != null) setNested(caption_setting, k.slice("caption_setting.".length), params[k]);
    }
    if (Object.keys(caption_setting).length) caption_setting.override_visual_style = true;
    const r = await creatifyLinkVideo({
      url: pick(params.url) || undefined,
      images: imageUrl ? [imageUrl] : (Array.isArray(params.images) ? params.images : undefined),
      title: params.title || undefined,
      description: params.description || undefined,
      script: node.prompt || params.override_script || params.script || undefined,
      avatar: params.override_avatar || params.avatar || undefined,
      override_voice: params.override_voice || undefined,
      background_music_url: params.background_music_url || undefined,
      background_music_volume: typeof params.background_music_volume === "number" ? params.background_music_volume : undefined,
      no_background_music: typeof params.no_background_music === "boolean" ? params.no_background_music : undefined,
      visual_style: params.visual_style || undefined,
      length: Number(params.video_length || params.length || node.duration_sec || 15) || 15,
      model_version: params.model_version || undefined,
      no_cta: typeof params.no_cta === "boolean" ? params.no_cta : undefined,
      script_style: params.script_style || undefined,
      no_caption: typeof params.no_caption === "boolean" ? params.no_caption : undefined,
      caption_setting: Object.keys(caption_setting).length ? caption_setting : undefined,
      aspect_ratio: params.aspect_ratio || undefined,
      target_platform: params.target_platform || undefined,
      voiceover_volume: typeof params.voiceover_volume === "number" ? params.voiceover_volume : undefined,
      no_emotion: typeof params.no_emotion === "boolean" ? params.no_emotion : undefined,
      no_stock_broll: typeof params.no_stock_broll === "boolean" ? params.no_stock_broll : undefined,
    });
    if (r.error || !r.token) return { engine: "creatify", error: r.error || "creatify без токена" };
    return { engine: "creatify", token: packToken("creatify", r.token), cost_hint: "med" };
  }

  // V22 · ElevenLabs RU-озвучка → mp3 в Storage → url (закадр-дорожка для сборки). Синхронно (TTS ~5-10с).
  if (tool === "elevenlabs") {
    const voiceId = String(params.voice_id || ""); // пуст (autofill не знает live-id) → elevenTTS возьмёт дефолтный голос аккаунта
    const text = String(params.script || node.prompt || params.onscreen_text || "").trim();
    if (!text) return { engine: "voice", error: "elevenlabs: пустой текст озвучки (script/prompt)" };
    const r = await elevenTTS(text, voiceId, {
      stability: typeof params.stability === "number" ? params.stability : undefined,
      similarity_boost: typeof params.similarity_boost === "number" ? params.similarity_boost : undefined,
      style: typeof params.style === "number" ? params.style : undefined,
    });
    if (r.error || !r.url) return { engine: "voice", error: r.error || "elevenlabs без url" };
    return { engine: "voice", url: r.url, done: true, cost_hint: "low" };
  }

  // shotstack/sound/captions — это СБОРКА/аудио, отдельного превью ноды нет (рендерится в graph-run)
  if (tool === "shotstack" || tool === "sound" || tool === "music") {
    return { engine: "none", error: `${tool}: нода сборки/звука — превью только в составе графа (graph-run)` };
  }
  // higgsfield/gemini/sharp (картинка) — адаптеры ещё не подключены (ключи владельца)
  if (tool === "higgsfield" || tool === "gemini" || tool === "sharp") {
    return { engine: "none", error: `${tool}: image-движок ещё не подключён для превью` };
  }
  return { engine: "none", error: tool ? `неизвестный инструмент: ${tool}` : "у ноды не задан инструмент" };
}

// Опрос статуса по токену (движок зашит в токен).
export async function pollNode(token: string): Promise<PollResult> {
  const u = unpackToken(token);
  if (!u) return { status: "error", error: "плохой токен" };
  if (u.engine === "fal") {
    const s = await falVideoStatus(u.inner);
    return { status: s.status === "done" ? "done" : s.status === "error" ? "error" : "in_progress", url: s.videoUrl, error: s.error };
  }
  if (u.engine === "creatify") {
    const s = await creatifyStatus(u.inner);
    return { status: s.status === "done" ? "done" : s.status === "error" ? "error" : "in_progress", url: s.videoUrl, error: s.error };
  }
  return { status: "error", error: `опрос движка ${u.engine} не поддержан` };
}

// Детерминированный хэш ноды для кэша превью (одни и те же tool+prompt+params+вход → тот же клип, $0).
export function nodeHash(node: EngineNode): string {
  const basis = JSON.stringify({
    t: String(node.tool || "").toLowerCase(),
    p: String(node.prompt || node.params?.prompt || "").trim(),
    img: node.image_url || node.params?.image_url || node.asset_url || "",
    par: stableParams(node.params),
  });
  // FNV-1a 32-бит (без крипто-зависимостей, достаточно для кэш-ключа)
  let h = 0x811c9dc5;
  for (let i = 0; i < basis.length; i++) { h ^= basis.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stableParams(p: Record<string, any> | null | undefined): string {
  if (!p) return "";
  const keys = Object.keys(p).filter((k) => k !== "prompt").sort();
  return keys.map((k) => `${k}=${JSON.stringify(p[k])}`).join("&");
}
