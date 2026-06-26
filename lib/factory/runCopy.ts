import type { ContentMode } from "./rubric";

export function normalizeContentMode(value: unknown): ContentMode {
  return value === "sell" ? "sell" : "audience";
}

export function defaultFactoryCaption(mode: unknown, article: string): string {
  const nextMode = normalizeContentMode(mode);
  if (nextMode === "sell") return article ? `Ищи на WB: ${article}` : "Ищи товар на WB";
  return "Сохрани, чтобы не потерять";
}

export function defaultFactoryCtaButton(mode: unknown, article: string): string | null {
  const nextMode = normalizeContentMode(mode);
  if (nextMode !== "sell") return null;
  return article ? "ищи на WB" : "подробнее";
}

const PLACEHOLDER_COPY = [
  /^control clip$/i,
  /^placeholder$/i,
  /^todo$/i,
  /^tbd$/i,
  /^sample$/i,
  /^test clip$/i,
  /^demo clip$/i,
];

export function isPlaceholderNarrative(value: unknown): boolean {
  const text = String(value || "").trim();
  if (!text) return true;
  return PLACEHOLDER_COPY.some((pattern) => pattern.test(text));
}

export function nodeLooksPlaceholder(node: Record<string, any>): boolean {
  const params = (node?.params && typeof node.params === "object") ? node.params as Record<string, unknown> : {};
  const agent = (node?.agent_suggestion && typeof node.agent_suggestion === "object") ? node.agent_suggestion as Record<string, unknown> : {};
  const copy = [
    node?.prompt,
    node?.onscreen_text,
    params["onscreen_text"],
    params["visual_desc"],
    agent["onscreen_text"],
    agent["visual_desc"],
    agent["voiceover"],
  ].map((value) => String(value || "").trim()).filter(Boolean);
  if (!copy.length) return false;
  return copy.every((value) => isPlaceholderNarrative(value));
}
