export type UgcDelivery = "confessional" | "demo" | "whisper" | "matter_of_fact" | "excited";

export interface UgcSpokenLine {
  t: number;
  text: string;
  emotion: string;
  delivery: UgcDelivery;
  pause_after_ms: number;
}

export interface UgcScript {
  hook: { text: string; locked: true };
  product: string;
  duration_sec: number;
  spoken_lines: UgcSpokenLine[];
  onscreen: Array<{ t: number; text: string }>;
  cta: string;
  render_allowed: boolean;
  render_blockers: string[];
  notes: string[];
}

export interface UgcScriptValidation {
  valid: boolean;
  script: UgcScript;
  errors: string[];
  warnings: string[];
}

const DELIVERIES = new Set<UgcDelivery>(["confessional", "demo", "whisper", "matter_of_fact", "excited"]);

function clean(value: unknown, max = 1000): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanComparable(value: unknown): string {
  return clean(value, 400).toLowerCase().replace(/[ё]/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function delivery(value: unknown): UgcDelivery {
  const d = clean(value, 40) as UgcDelivery;
  return DELIVERIES.has(d) ? d : "matter_of_fact";
}

function blockersForRender(input: {
  personaId?: string | null;
  consentStatus?: string | null;
  extra?: string[];
}): string[] {
  const blockers: string[] = [];
  if (!input.personaId) blockers.push("persona_id missing");
  if (input.consentStatus !== "granted") blockers.push(`persona consent ${input.consentStatus || "unknown"}`);
  return [...blockers, ...(input.extra || [])].filter(Boolean);
}

export function buildFallbackUgcScript(input: {
  hook: string;
  product?: string;
  personaId?: string | null;
  consentStatus?: string | null;
  reason?: string;
}): UgcScript {
  const hook = clean(input.hook, 180) || "Я сначала не поняла, зачем это нужно";
  const product = clean(input.product, 160) || "товар";
  const blockers = blockersForRender({ personaId: input.personaId, consentStatus: input.consentStatus });
  return {
    hook: { text: hook, locked: true },
    product,
    duration_sec: 18,
    spoken_lines: [
      { t: 0, text: hook, emotion: "curious", delivery: "confessional", pause_after_ms: 250 },
      { t: 3, text: `Показываю ${product} вживую: сначала деталь, потом как это выглядит в обычном использовании.`, emotion: "practical", delivery: "demo", pause_after_ms: 180 },
      { t: 10, text: "Если ищешь похожее, сверяй артикул и реальные кадры, а не только красивую карточку.", emotion: "honest", delivery: "matter_of_fact", pause_after_ms: 0 },
    ],
    onscreen: [
      { t: 0, text: hook.slice(0, 60) },
      { t: 6, text: "смотрим на реальный кадр" },
      { t: 14, text: "артикул в описании" },
    ],
    cta: "Ищи артикул на WB и смотри реальные кадры перед заказом",
    render_allowed: blockers.length === 0,
    render_blockers: blockers,
    notes: [`fallback: ${clean(input.reason, 160) || "strict UGC script fallback"}`],
  };
}

export function normalizeUgcScript(input: unknown, opts: {
  expectedHook: string;
  product?: string;
  personaId?: string | null;
  consentStatus?: string | null;
  extraRenderBlockers?: string[];
}): UgcScriptValidation {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const expectedHook = clean(opts.expectedHook, 180);
  const rawHook = raw.hook && typeof raw.hook === "object" ? raw.hook as Record<string, unknown> : {};
  const hookText = clean(rawHook.text || raw.hook_text || expectedHook, 180);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!hookText) errors.push("hook.text is required");
  if (rawHook.locked !== true) errors.push("hook.locked must be true");
  if (expectedHook && cleanComparable(hookText) !== cleanComparable(expectedHook)) {
    errors.push("hook text must stay locked");
  }

  const linesRaw = Array.isArray(raw.spoken_lines) ? raw.spoken_lines : [];
  if (!linesRaw.length) errors.push("spoken_lines[] is required");
  const spokenLines = linesRaw.slice(0, 8).map((line, idx) => {
    const item = line && typeof line === "object" ? line as Record<string, unknown> : {};
    const text = clean(item.text, 260);
    if (!text) errors.push(`spoken_lines[${idx}].text is required`);
    return {
      t: Math.max(0, Math.min(60, num(item.t, idx * 3))),
      text,
      emotion: clean(item.emotion, 60) || "honest",
      delivery: delivery(item.delivery),
      pause_after_ms: Math.max(0, Math.min(1200, Math.round(num(item.pause_after_ms, 180)))),
    };
  }).filter((line) => line.text);
  if (spokenLines.length < 2) errors.push("spoken_lines must contain at least 2 valid lines");
  if (spokenLines[0] && expectedHook && cleanComparable(spokenLines[0].text) !== cleanComparable(expectedHook)) {
    errors.push("first spoken line must equal locked hook");
  }

  const duration = Math.max(6, Math.min(60, Math.round(num(raw.duration_sec, 18))));
  const onscreenRaw = Array.isArray(raw.onscreen) ? raw.onscreen : [];
  const onscreen = onscreenRaw.slice(0, 8).map((line, idx) => {
    const item = line && typeof line === "object" ? line as Record<string, unknown> : {};
    return { t: Math.max(0, Math.min(duration, num(item.t, idx * 4))), text: clean(item.text, 90) };
  }).filter((line) => line.text);
  if (!onscreen.length) warnings.push("onscreen captions missing");

  const blockers = blockersForRender({ personaId: opts.personaId, consentStatus: opts.consentStatus, extra: opts.extraRenderBlockers });
  const script: UgcScript = {
    hook: { text: hookText || expectedHook, locked: true },
    product: clean(raw.product, 160) || clean(opts.product, 160) || "товар",
    duration_sec: duration,
    spoken_lines: spokenLines,
    onscreen,
    cta: clean(raw.cta, 180) || "Ищи артикул на WB",
    render_allowed: blockers.length === 0 && errors.length === 0,
    render_blockers: [...blockers, ...errors],
    notes: Array.isArray(raw.notes) ? raw.notes.slice(0, 5).map((n) => clean(n, 180)).filter(Boolean) : [],
  };
  return { valid: errors.length === 0, script, errors, warnings };
}
