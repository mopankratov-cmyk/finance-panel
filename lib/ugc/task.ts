import { SignJWT, jwtVerify } from "jose";
import { UGC_AVATARS, type UgcAvatarId, type UgcKind } from "./validation";

const HF_BASE = "https://platform.higgsfield.ai";
const SOUL_SUBMIT = `${HF_BASE}/v1/text2image/soul`;
const VIDEO_SUBMIT = `${HF_BASE}/v1/image2video/dop`;

export interface UgcTaskClaims {
  provider: "higgsfield";
  jobId: string;
  kind: UgcKind;
  cabinetId: string;
  nmId: number;
  article: string;
  avatarId: UgcAvatarId;
}

export interface UgcProviderStatus {
  status: "queued" | "generating" | "done" | "error";
  resultUrl?: string;
  error?: string;
  ageSec?: number | null;
}

function secret() {
  return new TextEncoder().encode(process.env.SIGN_SECRET || process.env.AUTH_SECRET || "dev-insecure-secret-change-me-finance-panel");
}

export async function signUgcTask(task: UgcTaskClaims) {
  return new SignJWT({ ...task, scope: "ugc-task" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("48h")
    .sign(secret());
}

export async function verifyUgcTask(token: string): Promise<UgcTaskClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.scope !== "ugc-task" || payload.provider !== "higgsfield") return null;
    const kind = payload.kind;
    const nmId = Number(payload.nmId);
    if ((kind !== "image" && kind !== "video") || !Number.isSafeInteger(nmId) || nmId <= 0) return null;
    const jobId = String(payload.jobId ?? "");
    const cabinetId = String(payload.cabinetId ?? "");
    const article = String(payload.article ?? "");
    const avatarId = String(payload.avatarId ?? "");
    if (!jobId || !cabinetId || !article || !UGC_AVATARS.some((avatar) => avatar.id === avatarId)) return null;
    return {
      provider: "higgsfield",
      jobId,
      kind,
      cabinetId,
      nmId,
      article,
      avatarId: avatarId as UgcAvatarId,
    };
  } catch { return null; }
}

export async function submitUgcTask(input: { kind: UgcKind; imageUrl: string; imagePrompt: string; videoMotion: string }) {
  const credentials = process.env.HF_CREDENTIALS;
  if (!credentials) throw new Error("HF_CREDENTIALS не настроен");
  const prompt = (input.kind === "image" ? input.imagePrompt : input.videoMotion).trim();
  if (!prompt) throw new Error(input.kind === "image" ? "Сначала подготовьте промпт изображения" : "Сначала подготовьте сценарий движения");
  const url = input.kind === "image" ? SOUL_SUBMIT : VIDEO_SUBMIT;
  const params = input.kind === "image"
    ? { prompt, width_and_height: "1536x2048", quality: "1080p", batch_size: 1, image_reference: { type: "image_url", image_url: input.imageUrl } }
    : { prompt, input_images: [{ type: "image_url", image_url: input.imageUrl }], quality: "720p" };
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Key ${credentials}`, "Content-Type": "application/json" },
    body: JSON.stringify({ params }),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Higgsfield ${response.status}: ${(await response.text()).slice(0, 160)}`);
  const body = await response.json() as { id?: string };
  if (!body.id) throw new Error("Higgsfield не вернул id задачи");
  return body.id;
}

export async function pollUgcTask(task: UgcTaskClaims): Promise<UgcProviderStatus> {
  const credentials = process.env.HF_CREDENTIALS;
  if (!credentials) return { status: "error", error: "HF_CREDENTIALS не настроен" };
  try {
    const response = await fetch(`${HF_BASE}/v1/job-sets/${encodeURIComponent(task.jobId)}`, {
      headers: { Authorization: `Key ${credentials}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      return { status: retryable ? "generating" : "error", error: `Higgsfield ${response.status}${retryable ? ": повторим автоматически" : ""}` };
    }
    const body = await response.json() as { jobs?: { status?: string; created_at?: string; results?: { raw?: { url?: string }; min?: { url?: string } } | null }[] };
    const job = body.jobs?.[0];
    if (!job) return { status: "queued" };
    const ageSec = job.created_at ? Math.max(0, Math.round((Date.now() - new Date(job.created_at).getTime()) / 1_000)) : null;
    if (job.status === "completed") {
      const resultUrl = job.results?.raw?.url ?? job.results?.min?.url;
      return resultUrl ? { status: "done", resultUrl, ageSec } : { status: "error", error: "Провайдер не вернул файл результата", ageSec };
    }
    if (job.status === "failed" || job.status === "nsfw") return { status: "error", error: job.status === "nsfw" ? "Результат отклонён модерацией" : "Генерация не удалась", ageSec };
    return { status: "generating", ageSec };
  } catch (error) {
    return { status: "generating", error: `${error instanceof Error ? error.message : "Провайдер генерации недоступен"}. Повторим автоматически` };
  }
}
