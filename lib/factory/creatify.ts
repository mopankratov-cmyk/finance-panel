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

// ОСНОВНОЙ: link_to_videos — товар в кадре. Возвращает токен + debug (сырые ответы для отладки).
// Фото товара передаём НАПРЯМУЮ (link_with_params) — WB не скрейпится, поэтому даём image_urls.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function creatifyLinkVideo(opts: { url?: string; images?: string[]; title?: string; description?: string; script?: string; avatar?: string; length?: number }): Promise<{ token?: string; error?: string; debug?: any }> {
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
  const body: Record<string, unknown> = { link: linkId, aspect_ratio: "9x16", video_length: opts?.length || 15, target_platform: "Tiktok", language: "russian" };
  if (opts?.script) body.override_script = opts.script.slice(0, 1500);
  if (opts?.avatar) body.override_avatar = opts.avatar;
  const created = await jpost(h, "/link_to_videos/", body);
  debug.create = { status: created.status, body: created.json || created.text };
  const vidId = (created.json?.id as string) || "";
  if (!vidId) return { error: `link_to_videos ${created.status}: ${created.text}`, debug };
  // 3) render (если create не зарендерил сам). Пробуем /{id}/render/.
  const st = (created.json?.status as string) || "";
  if (st !== "rendering" && st !== "done" && st !== "in_queue" && st !== "running") {
    const rend = await jpost(h, `/link_to_videos/${vidId}/render/`, {});
    debug.render = { status: rend.status, body: rend.json || rend.text };
  }
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
    const j = (await r.json()) as { status?: string; output?: string; video_output?: string; failed_reason?: string };
    const url = j.video_output || j.output;
    if (j.status === "done" && url) return { status: "done", videoUrl: url };
    if (j.status === "failed" || j.status === "error") return { status: "error", error: (j.failed_reason || "creatify failed").slice(0, 120) };
    return { status: "in_progress", raw: j.status };
  } catch (e) { return { status: "error", error: String(e).slice(0, 100) }; }
}
