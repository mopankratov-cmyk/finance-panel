// Remotion render-движок — клиент к render-микросервису (render-service/server.mjs на Yandex VM).
// Контракт submit→poll ЗЕРКАЛЬНЫЙ к shotstack.ts: ложится в тот же graph-run runner без переписывания.
// Премиум-слой (ReelV5: кинетик-капшены, обводка, грейд, бренд-эндкард) Shotstack не умеет — это путь под него.
//
// ENV:
//   REMOTION_RENDER_URL    — база сервиса, напр. https://render.example.ru (или http://<ip>:8080)
//   REMOTION_RENDER_TOKEN  — общий секрет (тот же на VM); Bearer
//   FACTORY_RENDER_ENGINE  — "remotion" включает этот движок в graphRun; иначе/пусто → Shotstack (дефолт, без изменений)

const URL = (): string | null => {
  const u = (process.env.REMOTION_RENDER_URL || "").trim();
  return u ? u.replace(/\/+$/, "") : null;
};
const TOKEN = (): string => process.env.REMOTION_RENDER_TOKEN || "";
const HEADERS = (): Record<string, string> => {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const t = TOKEN();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
};

// движок выбран И сервис настроен
export function remotionEngineSelected(): boolean {
  return (process.env.FACTORY_RENDER_ENGINE || "").toLowerCase() === "remotion";
}
export function remotionReady(): boolean {
  return !!URL();
}

// submit: POST /render { composition, inputProps, durationInFrames? } → job id
export async function remotionSubmit(
  composition: string,
  inputProps: Record<string, unknown>,
  durationInFrames?: number,
  opts?: { still?: boolean },
): Promise<string | null> {
  const base = URL();
  if (!base) return null;
  try {
    const body: Record<string, unknown> = { composition, inputProps };
    if (typeof durationInFrames === "number" && durationInFrames > 0) body.durationInFrames = durationInFrames;
    if (opts?.still) body.still = true; // СТАТИКА: renderStill → PNG (1 кадр), не видео

    const r = await fetch(`${base}/render`, { method: "POST", headers: HEADERS(), cache: "no-store", body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => ({}))) as { id?: string };
    return j.id || null;
  } catch { return null; }
}

// retryable=true → сбой транспорта/опроса (сеть, таймаут, non-2xx, пропавшая in-memory джоба), НЕ настоящий отказ рендера.
// render-poll не должен хоронить из-за такого уже оплаченный/готовый рендер — он продолжает опрос до таймаута.
export interface RemotionStatus { status: "in_progress" | "done" | "error"; videoUrl?: string; error?: string; progress?: number; retryable?: boolean }

// status: GET /status/{id} → { status, videoUrl?, error?, progress? }
export async function remotionStatus(id: string): Promise<RemotionStatus> {
  const base = URL();
  if (!base) return { status: "error", error: "REMOTION_RENDER_URL не настроен" };
  try {
    const r = await fetch(`${base}/status/${id}`, { headers: HEADERS(), cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { status: "error", error: `remotion ${r.status}`, retryable: true }; // 404 (джоба пропала после рестарта VM) и др. — транспорт, не отказ рендера
    const j = (await r.json().catch(() => ({}))) as { status?: string; videoUrl?: string; error?: string; progress?: number };
    if (j.status === "done" && j.videoUrl) return { status: "done", videoUrl: j.videoUrl, progress: j.progress };
    if (j.status === "error") return { status: "error", error: (j.error || "remotion failed").slice(0, 200) }; // явный отказ рендера — НЕ retryable
    return { status: "in_progress", progress: j.progress };
  } catch (e) { return { status: "error", error: String(e).slice(0, 120), retryable: true }; } // сеть/таймаут — транзиент
}
