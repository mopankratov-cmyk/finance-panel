import { createClaudeClient } from "@/lib/agent/client";
import { CONTENT_STANDARD, DEAI_FILTERS, QA_THRESHOLD } from "@/lib/factory/standard";
import { extractJson } from "@/lib/factory/extractJson";
import { tastePatternHints } from "@/lib/factory/tastePatterns";
import { buildPlatformBrainHint, normalizeTargetPlatform } from "@/lib/factory/reelsBrainPlaybook";
import type { ReelsPlatform } from "./reelsBrain";
import { evaluateHookPolicy, type HookPolicyResult } from "./hookPolicy";
import { validateBlueprint, type BlueprintValidation } from "./blueprint/schema";

export type ScenarioQualityInput = {
  article?: string;
  product_name?: string;
  niche?: string;
  target_platform?: unknown;
  platform?: unknown;
  playbook?: unknown;
  scenario?: unknown;
  hooks?: unknown;
  visual_beats?: unknown;
  threshold?: unknown;
  scenarios?: unknown;
  brand?: string;
  format?: string;
  blueprint?: unknown;
  hook_source?: unknown;
};

export type ScenarioQualityCandidate = {
  id: string;
  label: string;
  hook: string;
  scenario: string;
  visual_beats: string;
  source_index: number;
};

export type ScenarioQualityAxes = {
  hook: number;
  retention: number;
  clarity: number;
  emotion: number;
  specificity: number;
  novelty: number;
  publishability: number;
};

export type ScenarioQualityRanked = {
  id: string;
  label: string;
  hook: string;
  scenario: string;
  visual_beats: string;
  score: number;
  threshold: number;
  should_render: boolean;
  axes: ScenarioQualityAxes;
  issues: string[];
  rewrite_hints: string[];
};

export type ScenarioQualityResult = {
  ok: boolean;
  threshold: number;
  article: string;
  product_name: string;
  niche: string;
  target_platform: ReelsPlatform;
  winner: ScenarioQualityRanked | null;
  ranked: ScenarioQualityRanked[];
  issues: string[];
  rewrite_hints: string[];
  score: number;
  should_render: boolean;
  source: "claude" | "fallback";
  blueprint_validation?: BlueprintValidation;
  hook_policy?: HookPolicyResult;
  error?: string;
};

export type ScenarioQualityNormalizedInput = {
  article: string;
  product_name: string;
  niche: string;
  threshold: number;
  target_platform: ReelsPlatform;
  playbook: unknown;
  candidates: ScenarioQualityCandidate[];
};

const GENERIC_OPENERS = [
  "привет",
  "сегодня расскажу",
  "хочу показать",
  "давайте разберемся",
  "в современном мире",
  "это не просто",
  "идеальное решение",
  "купите",
  "успей",
  "представляем",
];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : String(v ?? "").trim();
}

function toArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean);
  const s = str(v);
  return s ? [s] : [];
}

function normalizeVisualBeats(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean).join(" | ");
  return str(v);
}

function makeCandidate(id: string, item: unknown, fallbackScenario: string, fallbackVisualBeats: string, sourceIndex: number): ScenarioQualityCandidate {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const rec = item as Record<string, unknown>;
    return {
      id,
      label: str(rec.label || rec.name || rec.title || rec.id || `candidate-${sourceIndex + 1}`) || `candidate-${sourceIndex + 1}`,
      hook: str(rec.hook || rec.hook_text || rec.title || ""),
      scenario: str(rec.scenario || rec.text || rec.script || rec.copy || fallbackScenario),
      visual_beats: normalizeVisualBeats(rec.visual_beats || rec.beats || rec.shots || fallbackVisualBeats),
      source_index: sourceIndex,
    };
  }
  return {
    id,
    label: `candidate-${sourceIndex + 1}`,
    hook: "",
    scenario: str(item || fallbackScenario),
    visual_beats: fallbackVisualBeats,
    source_index: sourceIndex,
  };
}

export function normalizeScenarioQualityInput(body: ScenarioQualityInput): ScenarioQualityNormalizedInput {
  const article = str(body.article);
  const product_name = str(body.product_name);
  const niche = str(body.niche || "default") || "default";
  const threshold = clamp(Number(body.threshold ?? QA_THRESHOLD) || QA_THRESHOLD, 1, 10);
  const fallbackScenario = str(body.scenario);
  const fallbackVisualBeats = normalizeVisualBeats(body.visual_beats);
  const hookList = toArray(body.hooks);
  const scenarioList = Array.isArray(body.scenarios) ? body.scenarios : [];

  let candidates: ScenarioQualityCandidate[] = [];
  if (scenarioList.length) {
    candidates = scenarioList.map((item, i) =>
      makeCandidate(`scenario-${i + 1}`, item, fallbackScenario, fallbackVisualBeats, i)
    );
  } else if (hookList.length > 1) {
    candidates = hookList.map((hook, i) =>
      makeCandidate(`hook-${i + 1}`, { hook, scenario: fallbackScenario, visual_beats: fallbackVisualBeats, label: hook.slice(0, 48) }, fallbackScenario, fallbackVisualBeats, i)
    );
  } else {
    const base = makeCandidate("scenario-1", body.scenario ?? fallbackScenario, fallbackScenario, fallbackVisualBeats, 0);
    if (hookList.length === 1) base.hook = hookList[0];
    if (!base.hook && hookList.length > 1) base.hook = hookList[0];
    candidates = [base];
  }

  if (body.scenario && !candidates[0]?.scenario) candidates[0].scenario = fallbackScenario;
  if (hookList.length && candidates.length === 1 && !candidates[0].hook) candidates[0].hook = hookList[0];

  return {
    article,
    product_name,
    niche,
    threshold,
    target_platform: normalizeTargetPlatform(body.target_platform || body.platform),
    playbook: body.playbook ?? null,
    candidates: candidates.map((c, i) => ({ ...c, id: c.id || `candidate-${i + 1}` })),
  };
}

function platformQualityGuidance(platform: ReelsPlatform): string {
  if (platform === "tiktok") {
    return "TikTok: суди строже за pattern-break в первой фразе, скорость входа, разговорность и отсутствие polished-ad ощущения. Слабый conversational hook или медленный старт снижай сильнее.";
  }
  if (platform === "instagram") {
    return "Instagram Reels: суди строже за visual polish, commercial safety, clean packaging кадра и понятность пользы без хаоса. Слишком raw/грязный TikTok-tone снижает publishability.";
  }
  if (platform === "youtube") {
    return "YouTube Shorts: суди строже за ясность value promise, объяснимость хука, серийность/обещание payoff и способность удержать не только эмоцией, но и смыслом.";
  }
  return "";
}

function weightAxes(axes: ScenarioQualityAxes): number {
  return axes.hook * 0.22 + axes.retention * 0.16 + axes.clarity * 0.14 + axes.emotion * 0.14 + axes.specificity * 0.14 + axes.novelty * 0.10 + axes.publishability * 0.10;
}

function toScore10(axes: ScenarioQualityAxes): number {
  return clamp(Math.round(weightAxes(axes) * 2), 1, 10);
}

function hardIssues(text: string, visualBeats: string): string[] {
  const lower = `${text} ${visualBeats}`.toLowerCase();
  const issues: string[] = [];
  if (GENERIC_OPENERS.some((p) => lower.includes(p))) issues.push("слишком общий старт");
  if (lower.length < 90) issues.push("слишком мало содержания для удержания");
  if (!/[0-9]/.test(lower)) issues.push("нет чисел или измеримой конкретики");
  if (!/[?]/.test(lower) && !/\bпочему\b|\bкак\b|\bзачем\b/.test(lower)) issues.push("нет открытого вопроса или интриги");
  if (!visualBeats.trim()) issues.push("нет visual beats");
  if (/привет|сегодня расскажу|хочу показать|представляем|идеальное решение|купите|успей/i.test(lower)) issues.push("запах рекламной простыни");
  return issues;
}

function fallbackAxes(text: string, visualBeats: string, platform: ReelsPlatform): ScenarioQualityAxes {
  const lower = `${text} ${visualBeats}`.toLowerCase();
  const generic = GENERIC_OPENERS.filter((p) => lower.includes(p)).length;
  const digits = (lower.match(/[0-9]/g) || []).length;
  const question = /[?]/.test(lower) || /\bпочему\b|\bкак\b|\bзачем\b/.test(lower);
  const concrete = /\b(рука|дома|ванна|шкаф|ремень|молния|кожа|тепло|ветер|пятно|сумка|деталь|упаковка|пляж|улица|ребёнок|ребенок)\b/.test(lower);
  const emotion = /\b(бесит|надоело|стыдно|страшно|удобно|спасает|обидно|радуюсь|радостно|наконец)\b/.test(lower);
  const novelty = /\b(неожидан|вдруг|никто|новый|другое|иначе|сразу)\b/.test(lower);
  let publishability = /привет|сегодня расскажу|представляем|успей|купите/i.test(lower) ? 1 : 4;
  if (platform === "instagram" && /жесть|шок|жми|срочно|успей/i.test(lower)) publishability = Math.max(1, publishability - 1);
  if (platform === "youtube" && !question && lower.length < 120) publishability = Math.max(1, publishability - 1);
  return {
    hook: clamp(5 - generic + (platform === "tiktok" && question ? 1 : 0) - (platform === "instagram" && generic > 0 ? 1 : 0), 1, 5),
    retention: clamp(3 + (question ? 1 : 0) + (concrete ? 1 : 0) - (generic > 0 ? 1 : 0) + (platform === "youtube" && text.length > 140 ? 1 : 0), 1, 5),
    clarity: clamp(3 + (text.length > 120 ? 1 : 0) + (concrete ? 1 : 0), 1, 5),
    emotion: clamp(2 + (emotion ? 2 : 0) + (platform === "tiktok" && novelty ? 1 : 0), 1, 5),
    specificity: clamp(2 + Math.min(2, digits) + (concrete ? 1 : 0), 1, 5),
    novelty: clamp(2 + (novelty ? 2 : 0) - (generic > 0 ? 1 : 0) + (platform === "tiktok" ? 1 : 0), 1, 5),
    publishability: publishability,
  };
}

function fallbackRank(candidate: ScenarioQualityCandidate, threshold: number, platform: ReelsPlatform): ScenarioQualityRanked {
  const text = `${candidate.hook} ${candidate.scenario}`.trim();
  const axes = fallbackAxes(text, candidate.visual_beats, platform);
  const score = toScore10(axes);
  const issues = hardIssues(text, candidate.visual_beats);
  const rewrite_hints = [
    ...candidate.hook ? ["сделай хук острее и короче"] : ["добавь явный хук в первую фразу"],
    ...issues.includes("слишком общий старт") ? ["замени общий старт на конкретную боль"] : [],
    ...issues.includes("нет чисел или измеримой конкретики") ? ["добавь число, размер, цену или измеримую деталь"] : [],
    ...candidate.visual_beats ? ["перенеси пользу в видимый кадр"] : ["опиши 2-3 visual beats"],
  ];
  const should_render = score >= threshold && axes.publishability >= 3 && !issues.includes("запах рекламной простыни");
  return {
    id: candidate.id,
    label: candidate.label,
    hook: candidate.hook,
    scenario: candidate.scenario,
    visual_beats: candidate.visual_beats,
    score,
    threshold,
    should_render,
    axes,
    issues,
    rewrite_hints,
  };
}

function aggregateHints(ranked: ScenarioQualityRanked[], threshold: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of ranked) {
    for (const hint of item.rewrite_hints) {
      const key = hint.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(hint);
      if (out.length >= 6) return out;
    }
    if (item.score >= threshold) break;
  }
  return out;
}

async function judgeWithClaude(input: { article: string; product_name: string; niche: string; threshold: number; target_platform: ReelsPlatform; playbook?: unknown; candidates: ScenarioQualityCandidate[] }): Promise<ScenarioQualityResult> {
  const client = await createClaudeClient();
  if (!client) throw new Error("ANTHROPIC_API_KEY не настроен");

  const hints = tastePatternHints({ niche: input.niche, goal: "sell", limit: 3 });
  const brainHint = buildPlatformBrainHint(input.playbook, input.target_platform);
  const system = [
    "Ты строгий сценарный ОТК контент-завода. Твоя цель — не пропустить в дорогой render слабый текст.",
    `ЦЕЛЕВАЯ ПЛАТФОРМА: ${input.target_platform}. ${platformQualityGuidance(input.target_platform)}`,
    CONTENT_STANDARD,
    DEAI_FILTERS,
    "Оценивай по осям: hook, retention, clarity, emotion, specificity, novelty, publishability. Каждая ось 1-5.",
    "Hook = первая фраза/первый кадр. Clarity = легко ли понять сцену без пояснений. Emotion = есть ли человеческое напряжение. Specificity = есть ли детали, цифры, бытовая конкретика. Novelty = есть ли свежий заход. Publishability = не пахнет ли рекламной простынёй.",
    "Если текст слабый, should_render обязано быть false.",
    hints.length ? `Паттерны-подсказки по структуре, не копируй дословно: ${hints.join(" || ")}` : "",
    brainHint || "",
    "Верни СТРОГО JSON: {\"ranked\":[{\"id\":\"...\",\"label\":\"...\",\"score\":1-10,\"should_render\":true|false,\"axes\":{\"hook\":1-5,\"retention\":1-5,\"clarity\":1-5,\"emotion\":1-5,\"specificity\":1-5,\"novelty\":1-5,\"publishability\":1-5},\"issues\":[\"...\"],\"rewrite_hints\":[\"...\"]}]}. Только JSON.",
  ].filter(Boolean).join("\n");

  const user = JSON.stringify({
    article: input.article,
    product_name: input.product_name,
    niche: input.niche,
    target_platform: input.target_platform,
    threshold: input.threshold,
    candidates: input.candidates.map((c) => ({
      id: c.id,
      label: c.label,
      hook: c.hook,
      scenario: c.scenario,
      visual_beats: c.visual_beats,
    })),
  }, null, 2);

  const res = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2800,
    temperature: 0.15,
    system,
    messages: [{ role: "user", content: user }],
  });


  const text = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
  const parsed = extractJson(text);
  if (!parsed || !Array.isArray(parsed.ranked)) throw new Error("невалидный JSON quality-gate");

  const ranked = input.candidates.map((candidate, index) => {
    const raw = parsed.ranked[index] || parsed.ranked.find((r: Record<string, unknown>) => str(r.id) === candidate.id || str(r.label) === candidate.label) || {};
    const axesRaw = (raw.axes && typeof raw.axes === "object") ? raw.axes as Record<string, unknown> : {};
    const axes: ScenarioQualityAxes = {
      hook: clamp(Number(axesRaw.hook ?? 3) || 3, 1, 5),
      retention: clamp(Number(axesRaw.retention ?? 3) || 3, 1, 5),
      clarity: clamp(Number(axesRaw.clarity ?? 3) || 3, 1, 5),
      emotion: clamp(Number(axesRaw.emotion ?? 3) || 3, 1, 5),
      specificity: clamp(Number(axesRaw.specificity ?? 3) || 3, 1, 5),
      novelty: clamp(Number(axesRaw.novelty ?? 3) || 3, 1, 5),
      publishability: clamp(Number(axesRaw.publishability ?? 3) || 3, 1, 5),
    };
    const score = clamp(Number(raw.score ?? toScore10(axes)) || toScore10(axes), 1, 10);
    const issues = Array.isArray(raw.issues) ? raw.issues.map((x: unknown) => str(x)).filter(Boolean) : [];
    const rewrite_hints = Array.isArray(raw.rewrite_hints) ? raw.rewrite_hints.map((x: unknown) => str(x)).filter(Boolean) : [];
    const should_render = raw.should_render == null ? (score >= input.threshold && axes.publishability >= 3 && axes.hook >= 3) : Boolean(raw.should_render);
    return {
      id: candidate.id,
      label: candidate.label,
      hook: candidate.hook,
      scenario: candidate.scenario,
      visual_beats: candidate.visual_beats,
      score,
      threshold: input.threshold,
      should_render,
      axes,
      issues,
      rewrite_hints,
    };
  }).sort((a, b) => b.score - a.score);

  const winner = ranked[0] || null;
  return {
    ok: true,
    threshold: input.threshold,
    article: input.article,
    product_name: input.product_name,
    niche: input.niche,
    target_platform: input.target_platform,
    winner,
    ranked,
    issues: winner?.issues || [],
    rewrite_hints: aggregateHints(ranked, input.threshold),
    score: winner?.score || 0,
    should_render: winner?.should_render || false,
    source: "claude",
  };
}

export async function analyzeScenarioQuality(body: ScenarioQualityInput): Promise<ScenarioQualityResult> {
  const normalized = normalizeScenarioQualityInput(body);
  const fallbackRanked = normalized.candidates.map((candidate) => fallbackRank(candidate, normalized.threshold, normalized.target_platform)).sort((a, b) => b.score - a.score);
  const blueprintValidation = body.blueprint == null ? undefined : validateBlueprint(body.blueprint);
  const candidateHook = normalized.candidates[0]?.hook || ((body.blueprint && typeof body.blueprint === "object") ? String(((body.blueprint as Record<string, unknown>).hook as Record<string, unknown> | undefined)?.text || "") : "");
  const hookPolicy = candidateHook
    ? evaluateHookPolicy({ text: candidateHook, source: body.hook_source || ((body.blueprint && typeof body.blueprint === "object") ? ((body.blueprint as Record<string, unknown>).hook as Record<string, unknown> | undefined)?.source : undefined), locked: body.blueprint && typeof body.blueprint === "object" ? ((body.blueprint as Record<string, unknown>).hook as Record<string, unknown> | undefined)?.locked : true })
    : undefined;
  if ((blueprintValidation && !blueprintValidation.ok) || hookPolicy?.action === "reject") {
    const issues = [
      ...(blueprintValidation && !blueprintValidation.ok ? blueprintValidation.errors.map((e) => `blueprint:${e}`) : []),
      ...(hookPolicy?.action === "reject" ? hookPolicy.issues.map((e) => `hook_policy:${e}`) : []),
    ];
    const winner = fallbackRanked[0] ? { ...fallbackRanked[0], should_render: false, issues: [...fallbackRanked[0].issues, ...issues], rewrite_hints: [...fallbackRanked[0].rewrite_hints, "исправь Blueprint/hook до платного рендера"] } : null;
    return {
      ok: false,
      threshold: normalized.threshold,
      article: normalized.article,
      product_name: normalized.product_name,
      niche: normalized.niche,
      target_platform: normalized.target_platform,
      winner,
      ranked: winner ? [winner, ...fallbackRanked.slice(1)] : fallbackRanked,
      issues,
      rewrite_hints: ["исправь Blueprint/hook до paid render"],
      score: winner?.score || 0,
      should_render: false,
      source: "fallback",
      blueprint_validation: blueprintValidation,
      hook_policy: hookPolicy,
      error: "pre_render_gate_reject",
    };
  }

  try {
    const judged = await judgeWithClaude({
      article: normalized.article,
      product_name: normalized.product_name,
      niche: normalized.niche,
      threshold: normalized.threshold,
      target_platform: normalized.target_platform,
      playbook: normalized.playbook,
      candidates: normalized.candidates,
    });
    if (!judged.ranked.length) {
      return {
        ok: true,
        threshold: normalized.threshold,
        article: normalized.article,
        product_name: normalized.product_name,
        niche: normalized.niche,
        target_platform: normalized.target_platform,
        winner: fallbackRanked[0] || null,
        ranked: fallbackRanked,
        issues: fallbackRanked[0]?.issues || [],
        rewrite_hints: aggregateHints(fallbackRanked, normalized.threshold),
        score: fallbackRanked[0]?.score || 0,
        should_render: fallbackRanked[0]?.should_render || false,
        source: "fallback",
        error: "пустой ответ модели",
      };
    }
    return { ...judged, blueprint_validation: blueprintValidation, hook_policy: hookPolicy };
  } catch (error) {
    return {
      ok: false,
      threshold: normalized.threshold,
      article: normalized.article,
      product_name: normalized.product_name,
      niche: normalized.niche,
      target_platform: normalized.target_platform,
      winner: fallbackRanked[0] || null,
      ranked: fallbackRanked,
      issues: fallbackRanked[0]?.issues || [],
      rewrite_hints: aggregateHints(fallbackRanked, normalized.threshold),
      score: fallbackRanked[0]?.score || 0,
      should_render: fallbackRanked[0]?.should_render || false,
      source: "fallback",
      blueprint_validation: blueprintValidation,
      hook_policy: hookPolicy,
      error: String(error).slice(0, 200),
    };
  }
}
