import type { ReelsPatternMemoryBundle, ReelsPatternMemoryItem } from "./reelsBrainPatterns";

export type ReelsCreativeBrief = {
  id: string;
  niche: string;
  title: string;
  hook: string;
  retention_mechanic: string;
  structure: string;
  second_by_second: string[];
  visual_recipe: string[];
  product_fit: string[];
  copy_as_mechanic: string[];
  do_not_copy: string[];
  confidence: "high" | "medium" | "low";
  op_score: number;
  source_pattern_id: string;
  source_examples: { id?: string | number; url?: string | null; hook?: string | null; score?: number; views?: number }[];
  generator_payload: {
    source: "reels_brain_pattern";
    niche: string;
    hook: string;
    retention: string;
    structure: string;
    second_by_second: string[];
    visual_recipe: string[];
    product_fit: string[];
    copy_as_mechanic: string[];
    do_not_copy: string[];
  };
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function reelsPatternBrain(playbook: unknown): ReelsPatternMemoryBundle | null {
  const brain = rec(playbook).reels_brain_patterns;
  return brain && typeof brain === "object" ? brain as ReelsPatternMemoryBundle : null;
}

function patternList(brain: ReelsPatternMemoryBundle | null): ReelsPatternMemoryItem[] {
  const meta = brain?.meta_brain;
  if (!meta) return [];
  const ready = Array.isArray(meta.generator_ready_patterns) ? meta.generator_ready_patterns : [];
  const all = Array.isArray(meta.patterns) ? meta.patterns : [];
  return (ready.length ? ready : all).filter(Boolean);
}

function confidence(pattern: ReelsPatternMemoryItem): "high" | "medium" | "low" {
  const score = num(pattern.strength_score) * 0.45
    + num(pattern.quality_score) * 0.35
    + Math.min(20, Math.log(num(pattern.frequency) + 1) * 8);
  if (score >= 72) return "high";
  if (score >= 52) return "medium";
  return "low";
}

function opScore(pattern: ReelsPatternMemoryItem): number {
  return Math.round(Math.min(100,
    num(pattern.strength_score) * 0.45
    + num(pattern.quality_score) * 0.25
    + num(pattern.relevance_score) * 0.15
    + Math.min(15, Math.log(num(pattern.frequency) + 1) * 7)
  ));
}

function seconds(pattern: ReelsPatternMemoryItem): string[] {
  const hook = pattern.hook_label || pattern.hook_type || "хук";
  const structure = pattern.structure_label || pattern.structure_type || "демонстрация";
  const retention = pattern.retention_label || pattern.retention_mechanism || "удержание";
  if (pattern.structure_type === "before_after") {
    return [
      "0-2с: показать проблему или исходное состояние крупным первым кадром.",
      `2-5с: дать хук "${hook}" и обещание результата.`,
      "5-10с: показать процесс применения без лишних объяснений.",
      "10-14с: раскрыть after-кадр и proof результата.",
      "14-18с: короткий вывод и мягкий CTA сохранить/сравнить.",
    ];
  }
  if (pattern.structure_type === "unboxing") {
    return [
      "0-2с: показать упаковку/товар и причину досмотреть.",
      "2-5с: быстрая распаковка в 2-3 склейки.",
      "5-9с: крупно показать главную деталь или эффект.",
      "9-14с: мини-тест товара в реальной ситуации.",
      "14-18с: финальный результат и короткий вывод.",
    ];
  }
  return [
    `0-2с: открыть ролик через "${hook}".`,
    "2-5с: быстро обозначить контекст и оставить открытый вопрос.",
    `5-10с: показать "${structure}" как доказательство, а не рассказ.`,
    `10-15с: удерживать через "${retention}" и закрыть главный вопрос.`,
    "15-20с: финальный результат и CTA без копирования оригинала.",
  ];
}

function visualRecipe(pattern: ReelsPatternMemoryItem): string[] {
  const base = [
    "Вертикальный 9:16, первый кадр должен читаться без звука.",
    "Крупные планы товара, результата или действия, минимум пустого фона.",
    "Экранный текст только для смысла хука, не как декор.",
  ];
  if (pattern.structure_type === "before_after") {
    return [...base, "Before/after показывать в похожем ракурсе, чтобы proof был честным.", "Финальный результат удержать на 1-2 секунды."];
  }
  if (pattern.structure_type === "pov") {
    return [...base, "Сцена должна быть бытовой и узнаваемой для зрителя.", "Не копировать персонажа/сцену оригинала, только механику POV."];
  }
  return [...base, "Демонстрация должна визуально доказывать тезис хука.", "Избегать длинного говорящего вступления."];
}

function productFit(niche: string, pattern: ReelsPatternMemoryItem): string[] {
  const normalized = niche.toLowerCase();
  const base = normalized.includes("toy") || normalized.includes("игруш")
    ? ["игрушки с быстрым wow-эффектом", "подарочные товары", "товары, где важна реакция ребенка/родителя"]
    : normalized.includes("cosmetic") || normalized.includes("beauty") || normalized.includes("космет")
      ? ["косметика с видимым before/after", "уходовые товары с proof-кадром", "макияж и аксессуары для трансформации"]
      : normalized.includes("cloth") || normalized.includes("одеж")
        ? ["одежда с доказуемой посадкой", "образы до/после", "товары, где важны фактура и цвет"]
        : ["товары с визуально доказуемым результатом", "темы, где можно быстро показать проблему и решение"];
  if (pattern.hook_type === "warning_pattern_break") return [...base, "товары, где покупатель боится ошибиться"];
  if (pattern.hook_type === "list_promise") return [...base, "товары с 3-5 понятными преимуществами"];
  return base;
}

function safeHook(pattern: ReelsPatternMemoryItem): string {
  const hasRawTagOrUrl = (value: string) => /#[\p{L}\p{N}_]+|https?:\/\//iu.test(value);
  const example = (pattern.examples || [])
    .map((row) => String(row.hook || "").trim())
    .find((hook) => hook && hook.length <= 140 && !hasRawTagOrUrl(hook));
  if (example) return example;
  const hook = (pattern.hooks || []).map((row) => String(row || "").trim()).find((row) => row && row.length <= 140 && !hasRawTagOrUrl(row));
  if (hook) return hook;
  return `${pattern.hook_label || "Хук"}: показать проблему, доказательство и результат.`;
}

export function buildCreativeBriefsFromPlaybooks(rows: { niche?: string; playbook?: unknown }[], limit = 10): ReelsCreativeBrief[] {
  const briefs: ReelsCreativeBrief[] = [];
  for (const row of rows) {
    const niche = row.niche || "default";
    for (const pattern of patternList(reelsPatternBrain(row.playbook))) {
      const brief = {
        id: `${niche}:${pattern.pattern_id}`,
        niche,
        title: `${pattern.hook_label || pattern.hook_type}: ${pattern.structure_label || pattern.structure_type}`,
        hook: safeHook(pattern),
        retention_mechanic: pattern.retention_label || pattern.retention_mechanism || "открытая петля",
        structure: pattern.structure_label || pattern.structure_type || "демонстрация",
        second_by_second: seconds(pattern),
        visual_recipe: visualRecipe(pattern),
        product_fit: productFit(niche, pattern),
        copy_as_mechanic: [
          "Темп: быстрый хук -> proof -> payoff.",
          `Механика удержания: ${pattern.retention_label || pattern.retention_mechanism || "ожидание результата"}.`,
          `Структура: ${pattern.structure_label || pattern.structure_type || "демонстрация"} как скелет, адаптируя под наш товар.`,
        ],
        do_not_copy: [
          "Не копировать чужой монтаж покадрово.",
          "Не копировать текст, озвучку, музыку, лица, персонажей и брендовые элементы.",
          "Не использовать чужое видео как ассет.",
          "Не повторять claim, если его нельзя доказать нашим товаром.",
        ],
        confidence: confidence(pattern),
        op_score: opScore(pattern),
        source_pattern_id: pattern.pattern_id,
        source_examples: (pattern.examples || []).slice(0, 3),
      } satisfies Omit<ReelsCreativeBrief, "generator_payload">;
      briefs.push({
        ...brief,
        generator_payload: {
          source: "reels_brain_pattern",
          niche,
          hook: brief.hook,
          retention: brief.retention_mechanic,
          structure: brief.structure,
          second_by_second: brief.second_by_second,
          visual_recipe: brief.visual_recipe,
          product_fit: brief.product_fit,
          copy_as_mechanic: brief.copy_as_mechanic,
          do_not_copy: brief.do_not_copy,
        },
      });
    }
  }
  return briefs
    .sort((a, b) => b.op_score - a.op_score || a.niche.localeCompare(b.niche))
    .slice(0, Math.max(1, Math.min(50, limit)));
}
