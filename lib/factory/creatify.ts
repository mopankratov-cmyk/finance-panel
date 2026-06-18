// Creatify API — AI UGC-актёр (Aurora): говорит наш сценарий. Тир выше HeyGen, но всё ещё AI → гнать через ОТК.
// Флоу lipsyncs (подтверждён контрактом): POST /lipsyncs/ {text, creator, aspect_ratio:"9:16", model_version} авто-рендерит
// → опрос GET /lipsyncs/{id}/ (status: pending|in_queue|running|failed|done, готовый url в поле output).
// Ключи в env: CREATIFY_API_ID + CREATIFY_API_KEY. Инертно без ключей.
const BASE = "https://api.creatify.ai/api";
const DEFAULT_CREATOR = "18fccce8-86e7-5f31-abc8-18915cb872be"; // из примера; переопределяется / можно листать /personas/
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

// список актёров (для выбора creator). Free — берём первый валидный, если creator не задан.
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

// создать UGC-видео (актёр говорит text). Возвращает токен (base64url от lipsync id) или ошибку.
export async function creatifyCreate(text: string, opts?: { creator?: string; aspect?: string; model?: string }): Promise<{ token?: string; error?: string }> {
  const h = headers();
  if (!h) return { error: "CREATIFY ключ не настроен (CREATIFY_API_ID/CREATIFY_API_KEY)" };
  let creator = (opts?.creator || "").trim();
  if (!creator) {
    const list = await creatifyListCreators();
    creator = list[0]?.id || DEFAULT_CREATOR; // реальный из аккаунта, иначе дефолт из примера
  }
  try {
    const body = {
      text: text.slice(0, 1500),
      creator,
      aspect_ratio: opts?.aspect || "9:16",
      model_version: opts?.model || DEFAULT_MODEL,
    };
    const r = await fetch(`${BASE}/lipsyncs/`, { method: "POST", headers: h, cache: "no-store", body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
    if (!r.ok) { const t = await r.text().catch(() => ""); return { error: `Creatify ${r.status}: ${t.slice(0, 160)}` }; }
    const j = (await r.json()) as { id?: string };
    return j.id ? { token: Buffer.from(String(j.id)).toString("base64url") } : { error: "Creatify без id" };
  } catch (e) { return { error: String(e).slice(0, 140) }; }
}

export interface CreatifyStatus { status: "in_progress" | "done" | "error"; videoUrl?: string; error?: string; raw?: string }

export async function creatifyStatus(token: string): Promise<CreatifyStatus> {
  const h = headers();
  if (!h) return { status: "error", error: "CREATIFY ключ не настроен" };
  let id: string;
  try { id = Buffer.from(token, "base64url").toString(); } catch { return { status: "error", error: "плохой токен" }; }
  try {
    const r = await fetch(`${BASE}/lipsyncs/${id}/`, { headers: h, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { status: "error", error: `creatify ${r.status}` };
    const j = (await r.json()) as { status?: string; output?: string; video_output?: string; failed_reason?: string };
    const url = j.output || j.video_output;
    if (j.status === "done" && url) return { status: "done", videoUrl: url };
    if (j.status === "failed" || j.status === "error") return { status: "error", error: (j.failed_reason || "creatify failed").slice(0, 120) };
    return { status: "in_progress", raw: j.status };
  } catch (e) { return { status: "error", error: String(e).slice(0, 100) }; }
}
