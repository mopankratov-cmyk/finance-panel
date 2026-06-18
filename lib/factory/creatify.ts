// Creatify API — AI UGC-актёры (полноростовые «креаторы» с товаром, говорят наш сценарий).
// Тир выше HeyGen, но всё ещё AI → гнать через ОТК. Флоу: создать link из URL товара → link_to_video → опрос.
// Ключи в env: CREATIFY_API_ID + CREATIFY_API_KEY (берутся в аккаунте Creatify, тариф с API). Инертно без ключей.
const BASE = "https://api.creatify.ai/api";

function headers(): Record<string, string> | null {
  const id = process.env.CREATIFY_API_ID;
  const key = process.env.CREATIFY_API_KEY;
  if (!id || !key) return null;
  return { "X-API-ID": id, "X-API-KEY": key, "Content-Type": "application/json" };
}

export function creatifyReady(): boolean {
  return !!(process.env.CREATIFY_API_ID && process.env.CREATIFY_API_KEY);
}

// шаг 1: «ссылка» из URL товара — Creatify крошит страницу (картинки/описание) и отдаёт id
async function createLink(h: Record<string, string>, url: string): Promise<string | null> {
  try {
    const r = await fetch(`${BASE}/links/`, { method: "POST", headers: h, cache: "no-store", body: JSON.stringify({ url }), signal: AbortSignal.timeout(25000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { id?: string };
    return j.id || null;
  } catch { return null; }
}

// шаг 2: UGC-видео из товара (+ наш сценарий override_script). Возвращает токен (base64url от video id).
export async function creatifyCreate(productUrl: string, opts: { script?: string; length?: number; language?: string; name?: string }): Promise<{ token?: string; error?: string }> {
  const h = headers();
  if (!h) return { error: "CREATIFY ключ не настроен (CREATIFY_API_ID/CREATIFY_API_KEY)" };
  const linkId = await createLink(h, productUrl);
  if (!linkId) return { error: "Creatify не принял URL товара (эндпоинт links)" };
  try {
    const body: Record<string, unknown> = {
      link: linkId,
      aspect_ratio: "9x16",
      video_length: opts.length || 15,
      target_platform: "Tiktok",
      language: opts.language || "russian",
    };
    if (opts.script) body.override_script = opts.script;
    if (opts.name) body.name = opts.name.slice(0, 80);
    const r = await fetch(`${BASE}/link_to_videos/`, { method: "POST", headers: h, cache: "no-store", body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
    if (!r.ok) return { error: `Creatify ${r.status}` };
    const j = (await r.json()) as { id?: string };
    return j.id ? { token: Buffer.from(String(j.id)).toString("base64url") } : { error: "Creatify без id" };
  } catch (e) { return { error: String(e).slice(0, 120) }; }
}

export interface CreatifyStatus { status: "in_progress" | "done" | "error"; videoUrl?: string; error?: string }

export async function creatifyStatus(token: string): Promise<CreatifyStatus> {
  const h = headers();
  if (!h) return { status: "error", error: "CREATIFY ключ не настроен" };
  let id: string;
  try { id = Buffer.from(token, "base64url").toString(); } catch { return { status: "error", error: "плохой токен" }; }
  try {
    const r = await fetch(`${BASE}/link_to_videos/${id}/`, { headers: h, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { status: "error", error: `creatify ${r.status}` };
    const j = (await r.json()) as { status?: string; video_output?: string; failed_reason?: string };
    if (j.status === "done" && j.video_output) return { status: "done", videoUrl: j.video_output };
    if (j.status === "error" || j.status === "failed") return { status: "error", error: (j.failed_reason || "creatify failed").slice(0, 100) };
    return { status: "in_progress" };
  } catch (e) { return { status: "error", error: String(e).slice(0, 100) }; }
}
