// V3 нод-движок: единый диспетчер «нода → инструмент → сабмит/опрос».
// Одна точка маппинга params(jsonb из инспектора) → тело конкретного API. Переиспользуется
// и в node-preview (одна нода), и в graph-run (весь граф). Токен несёт движок: base64url("engine::inner").
import { falVideoSubmit, falVideoStatus, FAL_VIDEO_MODELS, type FalVideoModel, type FalVideoOpts } from "./falVideo";
import { creatifyLinkVideo, creatifyStatus } from "./creatify";

export type NodeEngine = "fal" | "creatify" | "disk" | "asset" | "none";

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
  const imageUrl = node.image_url || params.image_url || node.asset_url || "";

  // disk_real / готовый ассет — «превью» = сам клип, без генерации ($0)
  if (tool === "disk_real" || tool === "disk") {
    const url = node.asset_url || params.url || node.image_url;
    if (url) return { engine: "disk", url, done: true, cost_hint: "free" };
    return { engine: "disk", error: "disk_real: нет url клипа (params.url / asset_url)" };
  }
  if (node.asset_url && !tool) return { engine: "asset", url: node.asset_url, done: true, cost_hint: "free" };

  // fal видео-семейства (seedance/kling/pika)
  if (FAL_TOOLS[tool]) {
    if (!imageUrl) return { engine: "fal", error: `${tool}: нужно image_url (фото товара/стартовый кадр)` };
    const model = FAL_TOOLS[tool];
    const opts = falOptsFromParams(params);
    const inner = await falVideoSubmit(model, imageUrl, String(node.prompt || params.prompt || ""), opts);
    if (!inner) return { engine: "fal", error: "fal не принял сабмит (FAL_KEY / баланс / 422 модель)" };
    return { engine: "fal", token: packToken("fal", inner), cost_hint: model.includes("fast") ? "low" : "med" };
  }

  // creatify UGC-актёр
  if (tool === "creatify") {
    // субтитры приходят плоскими точечными ключами из инспектора (caption_setting.font_family) → собираем вложенный объект
    const caption_setting: Record<string, unknown> = {};
    if (params["caption_setting.font_family"]) caption_setting.font_family = params["caption_setting.font_family"];
    if (params["caption_setting.text_color"]) caption_setting.text_color = params["caption_setting.text_color"];
    const r = await creatifyLinkVideo({
      url: params.url || undefined,
      images: imageUrl ? [imageUrl] : (Array.isArray(params.images) ? params.images : undefined),
      title: params.title || undefined,
      description: params.description || undefined,
      script: node.prompt || params.override_script || params.script || undefined,
      avatar: params.override_avatar || params.avatar || undefined,
      visual_style: params.visual_style || undefined,
      length: Number(params.video_length || params.length || node.duration_sec || 15) || 15,
      model_version: params.model_version || undefined,
      no_cta: typeof params.no_cta === "boolean" ? params.no_cta : undefined,
      script_style: params.script_style || undefined,
      caption_setting: Object.keys(caption_setting).length ? caption_setting : undefined,
    });
    if (r.error || !r.token) return { engine: "creatify", error: r.error || "creatify без токена" };
    return { engine: "creatify", token: packToken("creatify", r.token), cost_hint: "med" };
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
