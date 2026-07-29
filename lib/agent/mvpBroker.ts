import { createHash } from "node:crypto";

export const MVP_AGENT_PROFILE = "dev-director";
export const MVP_AGENT_ENV_PREFIX = "PANKSTER_DEV_DIRECTOR_MODEL_";
export const MVP_AGENT_FEATURE_FLAG = "PANKSTER_AGENT_MVP_ENABLED";

export type AgentMode = "analyze" | "chat";

export interface MvpAgentContext {
  generatedAt: string;
  totals?: unknown;
  skus?: unknown;
}

export interface MvpAgentConfig {
  enabled: true;
  profile: typeof MVP_AGENT_PROFILE;
  baseUrl: string;
  apiKey: string;
  model: string;
  allowlist: string[];
  timeoutMs: number;
}

export interface MvpAgentConfigDenied {
  enabled: false;
  reason: string;
}

export type MvpAgentConfigResult = MvpAgentConfig | MvpAgentConfigDenied;

export interface MvpAgentCompletion {
  text: string;
  audit: {
    profile: typeof MVP_AGENT_PROFILE;
    model: string;
    requestId: string;
    provider: "openai-compatible";
  };
}

type EnvSource = Record<string, string | undefined>;

const DEFAULT_TIMEOUT_MS = 55_000;
const MAX_TIMEOUT_MS = 55_000;
const SECRET_VALUE_PATTERNS = [
  /sk-proj-[A-Za-z0-9_-]{20,}/,
  /BEGIN [A-Z ]*PRIVATE KEY/,
  /\bBearer\s+[A-Za-z0-9._-]{12,}/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
];

export function isMvpAgentEnabled(env: EnvSource = process.env): boolean {
  return ["1", "true", "yes", "on"].includes(String(env[MVP_AGENT_FEATURE_FLAG] ?? "").toLowerCase());
}

export function resolveMvpAgentConfig(env: EnvSource = process.env): MvpAgentConfigResult {
  if (!isMvpAgentEnabled(env)) {
    return { enabled: false, reason: "MVP_AGENT_DISABLED" };
  }

  const profile = env.PANKSTER_AGENT_MVP_PROFILE ?? MVP_AGENT_PROFILE;
  if (profile !== MVP_AGENT_PROFILE) {
    return { enabled: false, reason: "MVP_AGENT_PROFILE_NOT_ALLOWLISTED" };
  }

  const baseUrl = normalizeBaseUrl(env[`${MVP_AGENT_ENV_PREFIX}BASE_URL`]);
  if (!baseUrl) {
    return { enabled: false, reason: "MVP_AGENT_MODEL_BASE_URL_MISSING" };
  }

  const apiKey = env[`${MVP_AGENT_ENV_PREFIX}API_KEY`];
  if (!apiKey) {
    return { enabled: false, reason: "MVP_AGENT_MODEL_API_KEY_MISSING" };
  }

  const allowlist = parseAllowlist(env[`${MVP_AGENT_ENV_PREFIX}ALLOWLIST`]);
  if (!allowlist.length) {
    return { enabled: false, reason: "MVP_AGENT_MODEL_ALLOWLIST_MISSING" };
  }

  const model = env[`${MVP_AGENT_ENV_PREFIX}DEFAULT`] ?? allowlist[0];
  if (!allowlist.includes(model)) {
    return { enabled: false, reason: "MVP_AGENT_MODEL_NOT_ALLOWLISTED" };
  }

  return {
    enabled: true,
    profile: MVP_AGENT_PROFILE,
    baseUrl,
    apiKey,
    model,
    allowlist,
    timeoutMs: clampTimeout(Number(env[`${MVP_AGENT_ENV_PREFIX}TIMEOUT_MS`])),
  };
}

export function mvpAgentSafeError(reason: string): string {
  switch (reason) {
    case "MVP_AGENT_DISABLED":
      return "MVP агент выключен";
    case "MVP_AGENT_PROFILE_NOT_ALLOWLISTED":
      return "MVP агент разрешён только для профиля dev-director";
    case "MVP_AGENT_MODEL_BASE_URL_MISSING":
      return "MVP агент: не настроен profile-scoped model base URL";
    case "MVP_AGENT_MODEL_API_KEY_MISSING":
      return "MVP агент: не настроен profile-scoped model API key";
    case "MVP_AGENT_MODEL_ALLOWLIST_MISSING":
      return "MVP агент: не настроен allowlist моделей профиля";
    case "MVP_AGENT_MODEL_NOT_ALLOWLISTED":
      return "MVP агент: выбранная модель не входит в allowlist профиля";
    default:
      return "MVP агент: конфигурация отклонена fail-closed";
  }
}

export function buildMvpAgentPrompt(params: {
  mode: AgentMode;
  context: MvpAgentContext;
  question: string;
}): { system: string; user: string } {
  const contextJson = JSON.stringify(params.context);
  const system = [
    "Ты — MVP-агент dev-director для анализа маркетплейс-бизнеса.",
    "Работай только с данными из переданного JSON.",
    "Не проси и не раскрывай ключи, токены, env, auth files или системные секреты.",
    "Отвечай по-русски, кратко и прикладно.",
  ].join(" ");

  if (params.mode === "analyze") {
    return {
      system,
      user: [
        "Верни только JSON без markdown.",
        'Формат: {"insights":[{"severity":"info|warning|critical","module":"ads|supplies|finance|analytics","title":"...","body":"..."}]}',
        "Не выдумывай данные, которых нет.",
        `Данные:\n${contextJson}`,
      ].join("\n\n"),
    };
  }

  return {
    system,
    user: [
      `Данные по бизнесу JSON:\n${contextJson}`,
      `Вопрос: ${params.question || "Дай краткий разбор ситуации."}`,
    ].join("\n\n"),
  };
}

export async function callMvpAgent(params: {
  config: MvpAgentConfig;
  mode: AgentMode;
  context: MvpAgentContext;
  question: string;
  fetchImpl?: typeof fetch;
}): Promise<MvpAgentCompletion> {
  if (containsSecretShape(params.question)) {
    throw new MvpAgentProviderError("MVP_AGENT_PROMPT_SECRET_SHAPE_DETECTED");
  }
  const prompt = buildMvpAgentPrompt({ mode: params.mode, context: params.context, question: params.question });
  const fetchImpl = params.fetchImpl ?? fetch;
  const requestId = createRequestId({
    profile: params.config.profile,
    model: params.config.model,
    mode: params.mode,
    question: params.question,
    contextGeneratedAt: params.context.generatedAt,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.config.timeoutMs);
  try {
    const response = await fetchImpl(`${params.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.config.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        temperature: 0.2,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new MvpAgentProviderError("MVP_AGENT_PROVIDER_HTTP_ERROR", response.status);
    }

    const payload = await response.json().catch(() => null);
    const text = extractOpenAiCompatibleText(payload);
    if (!text) {
      throw new MvpAgentProviderError("MVP_AGENT_PROVIDER_EMPTY_RESPONSE");
    }

    return {
      text,
      audit: {
        profile: params.config.profile,
        model: params.config.model,
        requestId,
        provider: "openai-compatible",
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export class MvpAgentProviderError extends Error {
  readonly code: string;
  readonly upstreamStatus?: number;

  constructor(code: string, upstreamStatus?: number) {
    super(code);
    this.code = code;
    this.upstreamStatus = upstreamStatus;
  }
}

export function mvpAgentRouteError(error: unknown): { status: number; message: string } {
  if (error instanceof MvpAgentProviderError) {
    return {
      status: 502,
      message: error.code === "MVP_AGENT_PROMPT_SECRET_SHAPE_DETECTED"
        ? "MVP агент: вопрос похож на секрет, запрос к модели заблокирован"
        : error.upstreamStatus
        ? `MVP агент: provider вернул HTTP ${error.upstreamStatus}`
        : "MVP агент: provider вернул пустой или некорректный ответ",
    };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { status: 504, message: "MVP агент: provider timeout" };
  }
  return { status: 500, message: "MVP агент: внутренняя ошибка" };
}

function parseAllowlist(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return trimmed.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function clampTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Math.round(value)));
}

function extractOpenAiCompatibleText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return "";
  const first = choices[0];
  if (!first || typeof first !== "object") return "";
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

function createRequestId(input: Record<string, string>): string {
  const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24);
  return `mvp_${digest}`;
}

function containsSecretShape(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}
