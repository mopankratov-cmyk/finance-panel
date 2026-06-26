import { normalizeContentMode } from "./runCopy";

type FallbackNode = Record<string, any>;

function pickTool(node: FallbackNode, available: string[]): string {
  const current = String(node.tool || "").trim();
  if (current && available.includes(current)) return current;
  const nodeType = String(node.node_type || "").toLowerCase();
  if (["captions", "caption"].includes(nodeType) && available.includes("shotstack")) return "shotstack";
  if (["voiceover", "narration"].includes(nodeType) && available.includes("elevenlabs")) return "elevenlabs";
  if (["music", "sound"].includes(nodeType) && available.includes("sound")) return "sound";
  if (available.includes("disk_real")) return "disk_real";
  return available[0] || current || "disk_real";
}

function fallbackOnscreen(role: string, mode: "audience" | "sell", article: string): string {
  if (role === "hook") return article ? `Что видно в ${article} сразу` : "Что видно сразу";
  if (role === "cta") return mode === "sell" ? (article ? `Арт. ${article}` : "Подробнее") : "Сохрани";
  if (role === "problem") return "Где это обычно подводит";
  if (role === "solution") return "Как это работает вживую";
  if (role === "proof") return "Как это выглядит вживую";
  return "Реальный кадр товара";
}

function fallbackVisual(role: string, article: string, niche: string): string {
  if (role === "hook") return article ? `Первый живой кадр товара ${article} крупно, без витрины` : "Первый живой кадр товара крупно, без витрины";
  if (role === "problem") return "Покажи реальную ситуацию, где проблема видна без объяснений";
  if (role === "solution") return "Покажи товар в использовании и один понятный выигрышный момент";
  if (role === "proof") return `Реальный ${niche || "товар"} в использовании: руки, ткань, фактура, движение`;
  if (role === "cta") return "Финальный чистый кадр товара без агрессивной продажи";
  return "Реальный кадр товара в использовании";
}

function fallbackPrompt(role: string, article: string, niche: string, visual: string, onscreen: string): string {
  const product = article || "товар";
  return [
    `Черновик сцены ${role || "scene"} под ${product}.`,
    `Кадр: ${visual}.`,
    `Текст на экране: ${onscreen}.`,
    `Без рекламного тона, без AI-сюрреализма, ниша ${niche || "default"}.`,
  ].join(" ").slice(0, 1500);
}

export function buildAutofillFallbackAssignment(node: FallbackNode, input: { available: string[]; article: string; niche: string; mode: unknown }) {
  const role = String((node.params && node.params.role) || node.slot || node.node_type || "scene").toLowerCase();
  const mode = normalizeContentMode(input.mode);
  const tool = pickTool(node, input.available);
  const onscreen = fallbackOnscreen(role, mode, input.article);
  const visual = fallbackVisual(role, input.article, input.niche);
  const params: Record<string, unknown> = {
    ...(node.params && typeof node.params === "object" ? node.params : {}),
    role,
    onscreen_text: onscreen,
    visual_desc: visual,
  };
  if (typeof node.duration_sec === "number") params.duration_sec = node.duration_sec;
  return {
    ordinal: Number(node.ordinal) || 0,
    tool,
    prompt: fallbackPrompt(role, input.article, input.niche, visual, onscreen),
    params,
    reason: "fallback_autofill",
  };
}
