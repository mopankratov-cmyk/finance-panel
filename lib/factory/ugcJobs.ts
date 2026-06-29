type DbClient = {
  from: (table: string) => any;
};

type UgcJobStatus = "queued" | "submitted" | "rendering" | "qa" | "done" | "failed" | "dlq" | "cancelled";
type DlqCategory = "consent" | "policy" | "lipsync" | "face_drift" | "provider" | "timeout" | "budget" | "artifact" | "unknown";

type UgcJobInput = {
  recipeId?: number | null;
  nodeId?: number | null;
  provider?: string | null;
  token?: string | null;
  providerJobId?: string | null;
  idempotencyKey?: string | null;
  status?: UgcJobStatus | string | null;
  dlqCategory?: DlqCategory | string | null;
  inputPayload?: Record<string, unknown> | null;
  qaResult?: Record<string, unknown> | null;
  outputUrl?: string | null;
  error?: string | null;
};

export type UgcJobRecordResult = {
  id: string | null;
  warning: string | null;
};

export type PersonaConsentGate = {
  allowed: boolean;
  personaId: string | null;
  consentStatus: string | null;
  warning: string | null;
  error: string | null;
};

const STATUSES = new Set<UgcJobStatus>(["queued", "submitted", "rendering", "qa", "done", "failed", "dlq", "cancelled"]);
const DLQ = new Set<DlqCategory>(["consent", "policy", "lipsync", "face_drift", "provider", "timeout", "budget", "artifact", "unknown"]);

function cleanText(value: unknown, max = 500): string | null {
  const text = String(value || "").trim();
  return text ? text.slice(0, max) : null;
}

function safeError(error: unknown): string {
  const message = String((error as { message?: unknown } | null)?.message || error || "unknown");
  return message.slice(0, 180);
}

function normalizeStatus(value: unknown): UgcJobStatus {
  const raw = String(value || "submitted").trim().toLowerCase() as UgcJobStatus;
  return STATUSES.has(raw) ? raw : "submitted";
}

function normalizeDlq(value: unknown): DlqCategory | null {
  const raw = String(value || "").trim().toLowerCase() as DlqCategory;
  return DLQ.has(raw) ? raw : null;
}

function decodeBase64Url(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString();
  } catch {
    return null;
  }
}

export function extractCreatifyProviderJobId(tokenOrTaskId: unknown): string | null {
  let token = String(tokenOrTaskId || "").trim();
  if (!token) return null;
  if (token.startsWith("cf.")) token = token.slice(3);

  const outer = decodeBase64Url(token);
  if (outer?.startsWith("creatify::")) token = outer.slice("creatify::".length);

  const inner = decodeBase64Url(token);
  if (inner?.startsWith("lv|") || inner?.startsWith("ls|")) return inner.slice(3) || null;
  return cleanText(token, 240);
}

export function isCreatifyPackedToken(token: unknown): boolean {
  const raw = String(token || "").trim();
  const outer = decodeBase64Url(raw);
  return !!outer?.startsWith("creatify::");
}

export async function checkPersonaConsent(db: DbClient | null | undefined, providerPersonaId: unknown, options: { requireGranted?: boolean } = {}): Promise<PersonaConsentGate> {
  const persona = cleanText(providerPersonaId, 240);
  if (!persona && options.requireGranted) return { allowed: false, personaId: null, consentStatus: null, warning: null, error: "persona consent missing" };
  if (!db && options.requireGranted) return { allowed: false, personaId: null, consentStatus: null, warning: null, error: "persona consent db unavailable" };
  if (!db || !persona) return { allowed: true, personaId: null, consentStatus: null, warning: null, error: null };

  try {
    const found = await db.from("factory_personas")
      .select("id,consent_status")
      .eq("provider", "creatify")
      .eq("provider_persona_id", persona)
      .limit(1);
    if (found?.error) {
      if (options.requireGranted) return { allowed: false, personaId: null, consentStatus: null, warning: null, error: `persona consent lookup: ${safeError(found.error)}` };
      return { allowed: true, personaId: null, consentStatus: null, warning: `persona consent lookup: ${safeError(found.error)}`, error: null };
    }

    const row = (found.data as { id?: string; consent_status?: string }[] | null)?.[0] || null;
    if (!row) {
      if (options.requireGranted) return { allowed: false, personaId: null, consentStatus: null, warning: null, error: "persona consent not found" };
      return { allowed: true, personaId: null, consentStatus: null, warning: null, error: null };
    }

    const status = String(row.consent_status || "unknown");
    if (status === "revoked") {
      return { allowed: false, personaId: row.id || null, consentStatus: status, warning: null, error: "persona consent revoked" };
    }
    if (options.requireGranted && status !== "granted") {
      return { allowed: false, personaId: row.id || null, consentStatus: status, warning: null, error: `persona consent ${status}` };
    }
    if (status === "unknown") {
      return { allowed: true, personaId: row.id || null, consentStatus: status, warning: "persona consent unknown; render allowed fail-open", error: null };
    }
    return { allowed: true, personaId: row.id || null, consentStatus: status, warning: null, error: null };
  } catch (error) {
    if (options.requireGranted) return { allowed: false, personaId: null, consentStatus: null, warning: null, error: `persona consent exception: ${safeError(error)}` };
    return { allowed: true, personaId: null, consentStatus: null, warning: `persona consent exception: ${safeError(error)}`, error: null };
  }
}

export async function recordUgcJob(db: DbClient | null | undefined, input: UgcJobInput): Promise<UgcJobRecordResult> {
  if (!db) return { id: null, warning: "ugc job skipped: db missing" };

  const provider = cleanText(input.provider, 40) || "creatify";
  const providerJobId = cleanText(input.providerJobId, 240) || extractCreatifyProviderJobId(input.token);
  const idempotencyKey = cleanText(input.idempotencyKey, 500) || `${provider}:${providerJobId || cleanText(input.token, 240) || Date.now()}`;
  const status = normalizeStatus(input.status);
  const dlqCategory = normalizeDlq(input.dlqCategory);
  const now = new Date().toISOString();

  const row: Record<string, unknown> = {
    provider,
    provider_job_id: providerJobId,
    idempotency_key: idempotencyKey,
    status,
    dlq_category: dlqCategory,
    input_payload: input.inputPayload || {},
    qa_result: input.qaResult || null,
    output_url: cleanText(input.outputUrl, 1200),
    error: cleanText(input.error, 500),
    updated_at: now,
  };

  const recipeId = Math.floor(Number(input.recipeId) || 0);
  const nodeId = Math.floor(Number(input.nodeId) || 0);
  if (recipeId) row.recipe_id = recipeId;
  if (nodeId) row.node_id = nodeId;

  try {
    const upserted = await db.from("factory_ugc_jobs")
      .upsert(row, { onConflict: "idempotency_key" })
      .select("id")
      .limit(1);
    if (upserted?.error) return { id: null, warning: `factory_ugc_jobs upsert: ${safeError(upserted.error)}` };
    return { id: (upserted.data as { id?: string }[] | null)?.[0]?.id || null, warning: null };
  } catch (error) {
    return { id: null, warning: `factory_ugc_jobs exception: ${safeError(error)}` };
  }
}
