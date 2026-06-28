import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";
import { extractJson } from "./extractJson";
import { extractFrames } from "./serverMedia";
import { nicheFromArticle, rubricPrompt, scoreRubric, type AxisScores, type ContentMode, type RubricNiche } from "./rubric";

export interface ArtifactCheckResult {
  ok: boolean;
  severity: "clean" | "minor" | "broken";
  defects: string[];
  note?: string;
  error?: string;
}

export interface VideoCriticResult {
  score: number | null;
  weighted?: number;
  verdict?: string;
  axes?: AxisScores;
  floor_fail?: string[];
  mode: ContentMode;
  niche: RubricNiche;
  basis: "model" | "text" | "fallback";
  basis_reason: string;
  issues: string[];
  fixes: string[];
  regen_hint: string;
}

const AXIS_SCHEMA = { type: "integer", minimum: 1, maximum: 5 } as const;
const CRITIQUE_TOOL = {
  name: "submit_critique",
  description: "Verdict per rubric: axes 1-5, issues/fixes, regen hint.",
  input_schema: {
    type: "object" as const,
    properties: {
      axes: {
        type: "object",
        properties: { hook: AXIS_SCHEMA, retention: AXIS_SCHEMA, native: AXIS_SCHEMA, brand: AXIS_SCHEMA, cta: AXIS_SCHEMA },
        required: ["hook", "retention", "native", "brand", "cta"],
      },
      issues: { type: "array", items: { type: "string" } },
      fixes: { type: "array", items: { type: "string" } },
      regen_hint: { type: "string" },
    },
    required: ["axes", "issues", "fixes"],
  },
};

function axisOr3(v: unknown): number {
  return v != null ? Number(v) : 3;
}

function scenarioDigest(sc: unknown): string {
  if (!sc) return "";
  if (typeof sc === "string") return sc.slice(0, 1500);
  if (typeof sc !== "object") return "";
  const obj = sc as Record<string, unknown>;
  if (Array.isArray(obj.nodes)) {
    return obj.nodes.slice(0, 8).map((node, i) => {
      const n = node as Record<string, unknown>;
      const p = n.params && typeof n.params === "object" ? n.params as Record<string, unknown> : {};
      return `${i}: ${String(n.prompt || "")} ${String(p.onscreen_text || "")}`;
    }).join("\n").slice(0, 1500);
  }
  return JSON.stringify(obj).slice(0, 1500);
}

function parseLoose(txt: string): Record<string, unknown> | null {
  return extractJson(txt) as Record<string, unknown> | null;
}

function fallbackCritique(input: {
  frames: string[];
  hook: string;
  scenarioText: string;
  mode: ContentMode;
  niche: RubricNiche;
  article: string;
  name: string;
  reason: string;
}): VideoCriticResult {
  const hookText = String(input.hook || "").trim();
  const hasArticle = !!String(input.article || input.name || "").trim();
  const strongHook = /[?!]/.test(hookText) || /\b(как|почему|что|не|смотри|ошибка|риск|правда|секрет)\b/i.test(hookText) || hookText.length > 28;
  const frameCount = input.frames.length;
  const axes: AxisScores = {
    hook: strongHook ? 4 : hookText ? 3 : 2,
    retention: frameCount >= 4 ? 4 : frameCount >= 2 ? 3 : 2,
    native: frameCount >= 2 ? 3 : 2,
    brand: hasArticle ? 4 : 3,
    cta: input.mode === "sell" ? (/(wb|артикул|куп|закаж|ссылка)/i.test(`${hookText} ${input.scenarioText}`) ? 4 : 3) : 3,
  };
  const r = scoreRubric(axes, input.mode, input.niche);
  return {
    score: r.score,
    weighted: r.weighted,
    verdict: r.verdict,
    axes,
    floor_fail: r.floorFail,
    mode: input.mode,
    niche: input.niche,
    basis: "fallback",
    basis_reason: input.reason,
    issues: [`video-critic fallback: ${input.reason}`, frameCount < 2 ? "мало кадров для точного ОТК" : "оценка без внешней модели"],
    fixes: ["усилить первый кадр, читаемость товара и CTA"],
    regen_hint: "",
  };
}

export async function runArtifactCheck(frames: string[]): Promise<ArtifactCheckResult> {
  const sample = Array.isArray(frames) ? frames.slice(0, 6) : [];
  if (!sample.length) return { ok: true, severity: "clean", defects: [], note: "нет кадров - гейт пропущен" };
  const client = await createClaudeClient();
  if (!client) return { ok: true, severity: "clean", defects: [], note: "ANTHROPIC_API_KEY нет - гейт мягко пропущен" };
  const sys = "Ты ОТК-контролёр сломанных AI-артефактов в кадрах видео. Ищи только технический брак: искажённый текст/лого, плавящиеся края, морфинг объекта, кривые руки, восковую кожу, нереалистичный товар. Верни строго JSON {\"ok\":true|false,\"severity\":\"clean|minor|broken\",\"defects\":[\"...\"]}.";
  const content: any[] = [{ type: "text", text: `Проверь ${sample.length} кадр(ов) по порядку.` }];
  for (const frame of sample) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: frame } });
  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 500, system: sys, messages: [{ role: "user", content }] });
    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    const parsed = parseLoose(txt) || {};
    const severity = parsed.severity === "broken" || parsed.severity === "minor" || parsed.severity === "clean" ? parsed.severity : (parsed.ok === false ? "broken" : "clean");
    const defects = Array.isArray(parsed.defects) ? parsed.defects.map((d) => String(d).slice(0, 120)).slice(0, 5) : [];
    return { ok: severity !== "broken", severity, defects };
  } catch (e) {
    return { ok: true, severity: "clean", defects: [], error: String((e as Error)?.message || e).slice(0, 140) };
  }
}

export async function runVideoCritic(input: {
  frames: string[];
  context?: string;
  kind?: "avatar" | "product";
  mode?: ContentMode;
  hook?: string;
  article?: string;
  product_name?: string;
  niche?: RubricNiche;
  scenario?: unknown;
}): Promise<VideoCriticResult> {
  const frames = Array.isArray(input.frames) ? input.frames.slice(0, 6) : [];
  const mode: ContentMode = input.mode === "sell" ? "sell" : "audience";
  const article = String(input.article || "").slice(0, 40);
  const name = String(input.product_name || "").slice(0, 120);
  const niche: RubricNiche = input.niche || nicheFromArticle(article, name);
  const hook = String(input.hook || "").slice(0, 300);
  const scenarioText = scenarioDigest(input.scenario);
  const client = await createClaudeClient();
  if (!client) return fallbackCritique({ frames, hook, scenarioText, mode, niche, article, name, reason: "upstream_unavailable" });
  if (!frames.length && !hook && !scenarioText) {
    return { ...fallbackCritique({ frames, hook, scenarioText, mode, niche, article, name, reason: "no_frames_no_storyboard" }), score: null };
  }

  const basis: "model" | "text" = frames.length ? "model" : "text";
  const sys = basis === "text"
    ? `Ты отсеиваешь слабый хук/структуру короткого видео ДО рендера. По тексту честно оцени hook/retention/cta, native и brand ставь 3. Ниша: ${niche}. ${rubricPrompt(mode)} Верни JSON через tool.`
    : `Ты строгий ОТК коротких вертикальных видео. Оцени, обойдёт ли ролик конкурентов в ленте. Суди по кадрам в порядке таймлайна + хук/сценарий. Анти-слоп: искажённый товар/текст/лого валит native. Ниша: ${niche}. ${rubricPrompt(mode)} Верни JSON через tool.`;
  const content: any[] = [];
  frames.forEach((frame, i) => {
    content.push({ type: "text", text: i === 0 ? "Кадр 1 (старт/хук)" : `Кадр ${i + 1}` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: frame } });
  });
  content.push({ type: "text", text: `Хук: ${hook || "-"}\nСценарий:\n${scenarioText || "-"}\nКонтекст: ${String(input.context || "-").slice(0, 400)}` });

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1536,
      temperature: 0.2,
      system: sys,
      tools: [CRITIQUE_TOOL as any],
      tool_choice: { type: "tool", name: "submit_critique" },
      messages: [{ role: "user", content }],
    });
    const blocks = res.content as any[];
    const toolUse = blocks.find((b) => b.type === "tool_use" && b.name === "submit_critique");
    const parsed = toolUse?.input || parseLoose(blocks.filter((b) => b.type === "text").map((b) => b.text).join(" "));
    if (!parsed) return fallbackCritique({ frames, hook, scenarioText, mode, niche, article, name, reason: "model_empty_response" });
    const raw = parsed.axes && typeof parsed.axes === "object" ? parsed.axes as Record<string, unknown> : {};
    const axes: AxisScores = basis === "text"
      ? { hook: axisOr3(raw.hook), retention: axisOr3(raw.retention), native: 3, brand: 3, cta: axisOr3(raw.cta) }
      : { hook: axisOr3(raw.hook), retention: axisOr3(raw.retention), native: axisOr3(raw.native), brand: raw.brand != null ? Number(raw.brand) : (mode === "sell" ? 4 : 3), cta: axisOr3(raw.cta) };
    const r = scoreRubric(axes, mode, niche, basis === "text" ? "text" : "frames");
    return {
      score: r.score,
      weighted: r.weighted,
      verdict: r.verdict,
      axes,
      floor_fail: r.floorFail,
      mode,
      niche,
      basis,
      basis_reason: toolUse ? "tool_use" : "text_parse",
      issues: Array.isArray(parsed.issues) ? parsed.issues.map((x: unknown) => String(x).slice(0, 160)).slice(0, 8) : [],
      fixes: Array.isArray(parsed.fixes) ? parsed.fixes.map((x: unknown) => String(x).slice(0, 160)).slice(0, 8) : [],
      regen_hint: String(parsed.regen_hint || "").slice(0, 200),
    };
  } catch (e) {
    return fallbackCritique({ frames, hook, scenarioText, mode, niche, article, name, reason: String(e).slice(0, 160) });
  }
}

export async function runClipQa(clipUrl: string): Promise<ArtifactCheckResult & { score: number | null }> {
  const frames = await extractFrames(clipUrl);
  const artifact = await runArtifactCheck(frames);
  return { ...artifact, score: null };
}
