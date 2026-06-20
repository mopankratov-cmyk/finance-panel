// Creatify API — AI UGC-актёр. Два режима:
//  • link_to_videos (ОСНОВНОЙ): URL карточки WB → UGC-ролик с ПОКАЗОМ товара (актёр + b-roll). 2 шага: создать → render.
//  • lipsyncs (запас): актёр просто говорит наш текст (без товара в кадре).
// Токен кодирует режим: base64url("lv|"+id) или ("ls|"+id) — чтобы статус опрашивал правильный эндпоинт.
// Ключи в env: CREATIFY_API_ID + CREATIFY_API_KEY. Инертно без ключей.
const BASE = "https://api.creatify.ai/api";
const DEFAULT_MODEL = "aurora_v1_fast";

function headers(): Record<string, string> | null {
  const id = process.env.CREATIFY_API_ID;
  const key = process.env.CREATIFY_API_KEY;
  if (!id || !key) return null;
  return { "X-API-ID": id, "X-API-KEY": key, "Content-Type": "application/json" };
}
export function creatifyReady(): boolean {
  return !!(process.env.CREATIFY_API_ID && process.env.CREATIFY_API_KEY);
}

async function jpost(h: Record<string, string>, path: string, body: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null; text: string }> {
  try {
    const r = await fetch(`${BASE}${path}`, { method: "POST", headers: h, cache: "no-store", body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const text = await r.text();
    let json: Record<string, unknown> | null = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { ok: r.ok, status: r.status, json, text: text.slice(0, 300) };
  } catch (e) { return { ok: false, status: 0, json: null, text: String(e).slice(0, 200) }; }
}

export async function creatifyListCreators(): Promise<{ id: string; name?: string }[]> {
  const h = headers();
  if (!h) return [];
  try {
    const r = await fetch(`${BASE}/personas/`, { headers: h, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    const j = await r.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr: any[] = Array.isArray(j) ? j : j.results || j.data || [];
    return arr.map((p) => ({ id: p.id, name: p.name || p.creator_name || p.persona_name })).filter((p) => p.id);
  } catch { return []; }
}

// ── Галерея аватаров Creatify (GET /personas/) — для пикера в кокпите ──
// Полные метаданные: id, имя, пол/возраст/стиль, сцена-фон, превью-картинка + видео (9:16 для вертикали).
export interface CreatifyAvatar {
  id: string;
  name: string;
  gender: string; // m | f | nb
  age: string;    // child | teen | adult | senior
  style: string;  // selfie | presenter | other
  location: string;
  scene: string;  // video_scene — описание фона
  thumb: string;  // превью-картинка (приоритет 9:16)
  video: string;  // превью-видео (приоритет 9:16)
  industries: string;
}
export interface AvatarFilters { gender?: string; age?: string; style?: string; location?: string; search?: string; limit?: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toStr(v: any): string { return Array.isArray(v) ? v.filter(Boolean).join(", ") : (v == null ? "" : String(v)); }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normAvatar(p: any): CreatifyAvatar | null {
  if (!p?.id) return null;
  return {
    id: String(p.id),
    name: p.creator_name || p.name || p.persona_name || "Аватар",
    gender: p.gender || "",
    age: p.age_range || p.age || "",
    style: p.style || "",
    location: p.location || "",
    scene: p.video_scene || "",
    thumb: p.preview_image_9_16 || p.preview_image_1_1 || p.preview_image_16_9 || "",
    video: p.portrait_preview_video || p.preview_video_9_16 || p.squared_preview_video || p.preview_video_1_1 || p.landscape_preview_video || p.preview_video_16_9 || "",
    // live API отдаёт suitable_industries МАССИВОМ (не строкой как в доках) → приводим к строке, иначе UI-фильтр .toLowerCase() падает
    industries: toStr(p.suitable_industries) || toStr(p.keywords),
  };
}

// Возвращает аватаров + диагностику (status/error), чтобы первый live-вызов сразу показал, работает ли API на тарифе.
export async function creatifyListAvatars(f: AvatarFilters = {}): Promise<{ avatars: CreatifyAvatar[]; error?: string; status?: number }> {
  const h = headers();
  if (!h) return { avatars: [], error: "CREATIFY ключ не настроен" };
  const cap = Math.min(Math.max(f.limit || 120, 12), 400);
  const qp = new URLSearchParams();
  if (f.gender) qp.set("gender", f.gender);
  if (f.age) qp.set("age_range", f.age);
  if (f.style) qp.set("style", f.style);
  if (f.location) qp.set("location", f.location);
  if (f.search) qp.set("keyword", f.search);
  const out: CreatifyAvatar[] = [];
  let url: string | null = `${BASE}/personas/?${qp.toString()}`;
  let lastStatus = 0;
  try {
    for (let page = 0; page < 5 && url && out.length < cap; page++) {
      const r: Response = await fetch(url, { headers: h, cache: "no-store", signal: AbortSignal.timeout(15000) });
      lastStatus = r.status;
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        return { avatars: out, error: `personas ${r.status}: ${t.slice(0, 160)}`, status: r.status };
      }
      const j = await r.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr: any[] = Array.isArray(j) ? j : j.results || j.data || [];
      for (const p of arr) { const a = normAvatar(p); if (a) out.push(a); }
      url = (!Array.isArray(j) && typeof j.next === "string" && j.next) ? j.next : null;
    }
    return { avatars: out.slice(0, cap), status: lastStatus };
  } catch (e) {
    return { avatars: out, error: String(e).slice(0, 160), status: lastStatus };
  }
}

// Композиции сцены (= visual_style в link_to_videos) — то, что в UI Creatify «Bottom left / Circle overlay / Side by side / Top and bottom».
export const CREATIFY_SCENES: { id: string; label: string; hint: string }[] = [
  { id: "AvatarBubbleTemplate", label: "Кружок-оверлей", hint: "Аватар в кружке поверх товара (дефолт)" },
  { id: "SideBySideTemplate", label: "Бок о бок", hint: "Аватар и товар рядом — половина/половина" },
  { id: "TopBottomTemplate", label: "Сверху и снизу", hint: "Аватар сверху, товар снизу (или наоборот)" },
  { id: "DynamicProductTemplate", label: "Динамика товара", hint: "Акцент на товаре, аватар комментирует" },
  { id: "MotionCardsTemplate", label: "Карточки в движении", hint: "Текст-карточки + аватар" },
  { id: "VlogTemplate", label: "Влог", hint: "Полноэкранный аватар, как влог" },
  { id: "VanillaTemplate", label: "Чистый", hint: "Без оформления — только аватар + субтитры" },
];

// ОСНОВНОЙ: link_to_videos — товар в кадре. Возвращает токен + debug (сырые ответы для отладки).
// Фото товара передаём НАПРЯМУЮ (link_with_params) — WB не скрейпится, поэтому даём image_urls.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function creatifyLinkVideo(opts: { url?: string; images?: string[]; title?: string; description?: string; script?: string; avatar?: string; visual_style?: string; length?: number }): Promise<{ token?: string; error?: string; debug?: any }> {
  const h = headers();
  if (!h) return { error: "CREATIFY ключ не настроен" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const debug: any = {};
  // 1) link: если есть фото — отдаём напрямую (link_with_params), иначе пробуем скрейп URL
  let linkId = "";
  if (opts.images && opts.images.length) {
    const lp = await jpost(h, "/links/link_with_params/", { title: opts.title || "Товар", description: opts.description || opts.title || "", image_urls: opts.images.slice(0, 8), video_urls: [] });
    debug.link_params = { status: lp.status, body: lp.json || lp.text };
    linkId = (lp.json?.id as string) || "";
  }
  if (!linkId && opts.url) {
    const link = await jpost(h, "/links/", { url: opts.url });
    debug.link = { status: link.status, body: link.json || link.text };
    linkId = (link.json?.id as string) || "";
  }
  if (!linkId) return { error: `link не создан: ${JSON.stringify(debug).slice(0, 220)}`, debug };
  // 2) создать видео из link
  // язык — КОД "ru" (не слово "russian"!), иначе CTA/плашки уходят в английский.
  // no_cta — убираем англоязычную плашку-концовку ("Blast Away with Wildberries / BUY NOW"); CTA уже в субтитрах по-русски.
  const body: Record<string, unknown> = { link: linkId, aspect_ratio: "9x16", video_length: opts.length || 15, target_platform: "Tiktok", language: "ru", no_cta: true };
  if (opts.script) body.override_script = opts.script.slice(0, 1500);
  if (opts.avatar) body.override_avatar = opts.avatar;
  if (opts.visual_style) body.visual_style = opts.visual_style; // композиция сцены (AvatarBubble/SideBySide/TopBottom…)
  const created = await jpost(h, "/link_to_videos/", body);
  debug.create = { status: created.status, body: created.json || created.text };
  const vidId = (created.json?.id as string) || "";
  if (!vidId) return { error: `link_to_videos ${created.status}: ${created.text}`, debug };
  // 3) генерим ПРЕВЬЮ (обязательно перед render — render без превью даёт 400). Async, рендер запустим в опросе.
  const prev = await jpost(h, `/link_to_videos/${vidId}/generate_preview/`, {});
  debug.preview = { status: prev.status, body: prev.json || prev.text };
  return { token: Buffer.from("lv|" + vidId).toString("base64url"), debug };
}

// ЗАПАС: lipsyncs — актёр говорит text (без товара).
export async function creatifyLipsync(text: string, opts?: { creator?: string; model?: string }): Promise<{ token?: string; error?: string }> {
  const h = headers();
  if (!h) return { error: "CREATIFY ключ не настроен" };
  let creator = (opts?.creator || "").trim();
  if (!creator) { const list = await creatifyListCreators(); creator = list[0]?.id || "18fccce8-86e7-5f31-abc8-18915cb872be"; }
  const r = await jpost(h, "/lipsyncs/", { text: text.slice(0, 1500), creator, aspect_ratio: "9:16", model_version: opts?.model || DEFAULT_MODEL });
  const id = (r.json?.id as string) || "";
  if (!id) return { error: `lipsyncs ${r.status}: ${r.text}` };
  return { token: Buffer.from("ls|" + id).toString("base64url") };
}

export interface CreatifyStatus { status: "in_progress" | "done" | "error"; videoUrl?: string; error?: string; raw?: string }

export async function creatifyStatus(token: string): Promise<CreatifyStatus> {
  const h = headers();
  if (!h) return { status: "error", error: "CREATIFY ключ не настроен" };
  let decoded: string;
  try { decoded = Buffer.from(token, "base64url").toString(); } catch { return { status: "error", error: "плохой токен" }; }
  const isLink = decoded.startsWith("lv|");
  const id = decoded.replace(/^(lv|ls)\|/, "");
  const path = isLink ? `/link_to_videos/${id}/` : `/lipsyncs/${id}/`;
  try {
    const r = await fetch(`${BASE}${path}`, { headers: h, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { status: "error", error: `creatify ${r.status}` };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = (await r.json()) as any;
    const url = j.video_output || j.output;
    if (j.status === "done" && url) return { status: "done", videoUrl: url };
    if (j.status === "failed" || j.status === "error") return { status: "error", error: (j.failed_reason || "creatify failed").toString().slice(0, 120) };
    // link_to_videos: как только превью готово — запускаем render (стейт-машина в опросе)
    if (isLink) {
      const hasPreview = !!j.preview || (Array.isArray(j.previews) && j.previews.length > 0);
      const notRendering = j.status === "pending" || j.status === "draft" || !j.status;
      if (hasPreview && notRendering) {
        await jpost(h, `/link_to_videos/${id}/render/`, {}); // запустить рендер (идемпотентно — статус сменится)
        return { status: "in_progress", raw: "render" };
      }
    }
    return { status: "in_progress", raw: j.status };
  } catch (e) { return { status: "error", error: String(e).slice(0, 100) }; }
}
