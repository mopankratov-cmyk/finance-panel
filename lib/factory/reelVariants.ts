// «1 генерация → N монтажей»: чистые трансформы вариантов поверх УЖЕ сгенерённых нод рецепта.
// Переиспользуют клипы (node.url), НЕ генерят заново — дорогой слой (fal/creatify/eleven) амортизируется
// по R рендерам. Рендер-пропсы собирает graphRun.buildReelProps; здесь только варьируем вход под него.
// Без рантайм-импортов graphRun (type-only) → юнит-тестируемо (reelVariants.test.mts).
import type { RunNode } from "./graphRun";

// Оси дифференциации (анти-дубль): хук + первый кадр решают охват; косметика (accent) — добор.
export interface ReelVariant {
  hook?: string;            // новый хук-текст (ось №1) — влияет на captions + ctaTitle
  overlayOrder?: number[];  // новый порядок визуальных клипов (индексы по selectVisualNodes) — «другой первый кадр»
  audioSrc?: string;        // другой музыкальный трек (другой audio-fingerprint)
  accent?: string;          // акцент-цвет темы
  ctaTitle?: string;
  ctaButton?: string;
}

const roleOf = (n: RunNode): string =>
  String(((n.params || {}) as Record<string, unknown>)["role"] || n.slot || "").toLowerCase();

// визуальные ноды для монтажа — та же логика, что graphRun assemble (готовый клип, не капшен/закадр/skip)
export function selectVisualNodes(nodes: RunNode[]): RunNode[] {
  return (nodes || []).filter((n) =>
    n.status === "done" && !!n.url && n.node_type !== "captions" &&
    String(n.tool || "").toLowerCase() !== "elevenlabs" &&
    String(((n.params || {}) as Record<string, unknown>)["role"] || "").toLowerCase() !== "skip");
}

// копия нод с подменой хук-текста — НЕ мутируем оригинал (N вариантов из одного пула).
// params копируем ГЛУБОКО (structuredClone): вложенные объекты (caption_setting и пр.) — отдельные у каждого
// варианта, иначе правка вложенного поля одним вариантом протекла бы в остальные (общий пул baseNodes).
export function cloneNodesWithHook(nodes: RunNode[], hook?: string): RunNode[] {
  const out = (nodes || []).map((n) => ({ ...n, params: structuredClone((n.params || {}) as Record<string, unknown>) }));
  if (hook) {
    const h = out.find((n) => roleOf(n) === "hook") || out[0];
    if (h) h.onscreen_text = hook;
  }
  return out;
}

// клэмп/санитайз пользовательского варианта ДО рендера (длины, типы, http-only аудио, целые индексы).
// Вход приходит от оператора (single-owner за proxy.ts-гейтом), но клэмпим, чтобы мусор не попал в пропсы рендера.
const clampStr = (s: unknown, max: number): string | undefined => {
  if (typeof s !== "string") return undefined;
  const t = s.trim();
  return t ? t.slice(0, max) : undefined;
};
export function sanitizeVariant(v: ReelVariant | undefined): ReelVariant {
  const out: ReelVariant = {};
  const hook = clampStr(v?.hook, 200); if (hook) out.hook = hook;
  const accent = clampStr(v?.accent, 16); if (accent) out.accent = accent;
  const ctaTitle = clampStr(v?.ctaTitle, 60); if (ctaTitle) out.ctaTitle = ctaTitle;
  const ctaButton = clampStr(v?.ctaButton, 40); if (ctaButton) out.ctaButton = ctaButton;
  const audioSrc = clampStr(v?.audioSrc, 500); if (audioSrc && /^https?:\/\//.test(audioSrc)) out.audioSrc = audioSrc; // только http(s) — без staticFile-путей
  if (Array.isArray(v?.overlayOrder)) {
    const ord = v!.overlayOrder!.filter((i) => Number.isInteger(i) && i >= 0).slice(0, 32);
    if (ord.length) out.overlayOrder = ord;
  }
  return out;
}

// переупорядочить визуальные клипы (другой первый кадр — главная ось анти-дубля). order = индексы в visual.
// невошедшие индексы уходят в хвост (ничего не теряем), дубликаты/выход за границы игнорируются.
export function reorderVisual(visual: RunNode[], order?: number[]): RunNode[] {
  if (!order || !order.length) return visual.slice();
  const seen = new Set<number>();
  const out: RunNode[] = [];
  for (const i of order) {
    if (Number.isInteger(i) && i >= 0 && i < visual.length && !seen.has(i)) { out.push(visual[i]); seen.add(i); }
  }
  visual.forEach((v, i) => { if (!seen.has(i)) out.push(v); });
  return out;
}

// патч пропсов ReelV5 поверх результата buildReelProps (оси, которых нет в базовом билдере)
export function patchVariantProps(props: Record<string, unknown>, variant: ReelVariant): Record<string, unknown> {
  const p = { ...props };
  if (variant.accent) p.accent = variant.accent;
  if (variant.audioSrc) p.audioSrc = variant.audioSrc;
  if (variant.ctaTitle) p.ctaTitle = variant.ctaTitle;
  if (variant.ctaButton) p.ctaButton = variant.ctaButton;
  return p;
}
