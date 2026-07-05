export type ReelsBrainDecisionPackExample = {
  id?: string | number;
  url?: string | null;
  hook?: string | null;
  score?: number;
  views?: number;
};

export type ReelsBrainDecisionPackPattern = {
  pattern_id?: string;
  hook_type?: string;
  hook_label?: string;
  structure_type?: string;
  structure_label?: string;
  retention_mechanism?: string;
  retention_label?: string;
  emotion?: string;
  emotion_label?: string;
  viral_logic?: string;
  viral_logic_label?: string;
  frequency?: number;
  strength_score?: number;
  quality_label?: string;
  quality_score?: number;
  relevance_score?: number;
  quality_reasons?: string[];
  avg_views?: number;
  hooks?: string[];
  sounds?: string[];
  examples?: ReelsBrainDecisionPackExample[];
};

export type ReelsBrainDecisionPackCrossPlatformPattern = ReelsBrainDecisionPackPattern & {
  platforms?: string[];
  platform_count?: number;
  total_frequency?: number;
  avg_strength_score?: number;
};

export type ReelsBrainDecisionPackAntiPattern = {
  anti_pattern_id?: string;
  label?: string;
  trigger_reason?: string;
  severity?: string;
  affected_patterns?: number;
  total_frequency?: number;
  avg_quality_score?: number;
  avg_relevance_score?: number;
  action?: string;
};

export type ReelsBrainDecisionTrust = {
  selected_scope: "platform" | "meta";
  selected_platform: string;
  allow_primary_use: boolean;
  recommended_mode: "primary" | "control_only" | "research_only";
  reasons: string[];
  trust: {
    score: number;
    status: "ready" | "warming" | "weak";
    confidence: "high" | "medium" | "low";
    why_ready: string[];
    why_not_yet: string[];
  };
};

type LegacyDecisionQualityGate = {
  status: "needs_validation" | "not_ready";
  source: "legacy_decision_pack";
  allowed_generation_modes: Array<"control_ready" | "brief_only" | "research_only">;
  blocked_reasons: string[];
  exact_segment_ready: false;
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function topExamples(pattern: ReelsBrainDecisionPackPattern, limit = 3) {
  return (Array.isArray(pattern.examples) ? pattern.examples : [])
    .slice(0, limit)
    .map((example) => ({
      id: example.id ?? null,
      url: example.url || null,
      hook: example.hook || null,
      score: num(example.score),
      views: num(example.views),
    }));
}

export function scoreDecisionPattern(pattern: ReelsBrainDecisionPackPattern) {
  return Math.round(Math.min(100,
    num(pattern.strength_score)
    + Math.min(20, Math.log(num(pattern.frequency) + 1) * 6)
    + (pattern.quality_label === "generator_ready" ? 12 : 0)
    + Math.min(12, num(pattern.relevance_score) / 8)
    + Math.min(10, num(pattern.quality_score) / 10)
  ));
}

function confidenceGate(pattern: ReelsBrainDecisionPackPattern) {
  const value = scoreDecisionPattern(pattern);
  if (value >= 88) return "high_confidence";
  if (value >= 72) return "medium_confidence";
  return "experimental";
}

function productFit(productType: string, niche: string, pattern: ReelsBrainDecisionPackPattern) {
  const product = productType || "товар с понятным визуальным proof";
  const structure = text(pattern.structure_type);
  if (structure.includes("before_after")) {
    return [
      `${product}: когда можно показать заметный контраст до/после.`,
      "Товары с сильным визуальным результатом, трансформацией или сравнением.",
    ];
  }
  if (structure.includes("review") || structure.includes("demo") || structure.includes("unboxing")) {
    return [
      `${product}: когда можно быстро показать hands-on использование.`,
      "Подходит для маркетплейс-товаров, где решение видно в кадре, а не объясняется словами.",
    ];
  }
  if (structure.includes("life_hack")) {
    return [
      `${product}: когда товар решает маленькую, но понятную бытовую проблему.`,
      "Лучше всего для утилитарных товаров с wow-эффектом в моменте.",
    ];
  }
  return [
    `${product}: базовый UGC / proof-сценарий для ниши ${niche}.`,
    "Подходит, если товар можно продать через боль, демонстрацию или быстрый результат.",
  ];
}

function platformRecipe(platform: string, pattern: ReelsBrainDecisionPackPattern) {
  const structure = text(pattern.structure_type);
  const retention = text(pattern.retention_mechanism);
  if (platform === "tiktok") {
    return {
      pace: "быстрый, с плотными склейками и моментальным входом в действие",
      firstFrame: "крупный первый кадр, смысл считывается за 0.5-1.0с",
      editing: [
        "Склейки каждые 0.4-0.9с, если товар динамичный.",
        "Текст короткий, скорее как punchline, чем как субтитры-полотна.",
        retention.includes("surprise") ? "Добавлять смену плана или reveal перед payoff." : "Рано показать proof, не держать пустое вступление.",
      ],
    };
  }
  if (platform === "instagram") {
    return {
      pace: "чуть чище и визуально аккуратнее, чем TikTok, но без медленного старта",
      firstFrame: "сильный visual proof или эстетичный trigger-кадр",
      editing: [
        "Первый кадр должен быть достаточно сильным даже без звука.",
        "Держать чистую композицию, товар и результат в центре внимания.",
        structure.includes("review") ? "Сочетать UGC-подачу и аккуратную демонстрацию деталей." : "Работать через визуальную трансформацию и эмоциональный payoff.",
      ],
    };
  }
  return {
    pace: "чуть спокойнее, с понятной структурой и более явным payoff",
    firstFrame: "сразу показать premise ролика, без лишнего разгона",
    editing: [
      "Хук должен сработать и как Shorts-first, и как search-friendly promise.",
      "Давать чуть больше контекста в середине ролика, чем в TikTok.",
      "Финал должен закрывать вопрос зрителя, а не просто делать CTA.",
    ],
  };
}

function secondBySecond(platform: string, pattern: ReelsBrainDecisionPackPattern) {
  const structure = text(pattern.structure_label || pattern.structure_type || "демонстрация");
  const hook = text(pattern.hook_label || pattern.hook_type || "сильный хук");
  const retention = text(pattern.retention_label || pattern.retention_mechanism || "ожидание доказательства");
  const platformFit = platformRecipe(platform, pattern);
  return [
    `0-2с: хук "${hook}" в первом кадре. Без вступления, сразу проблема, обещание или необычный proof.`,
    `2-5с: раскрыть premise через формат "${structure}". Темп: ${platformFit.pace}.`,
    `5-9с: удерживать через механику "${retention}" и усилить интерес вторым доказательством.`,
    "9-14с: payoff, контраст, результат или наиболее убедительный кадр использования.",
    "14-18с: короткий вывод, кому это подходит, и мягкий CTA без перегруза.",
  ];
}

function visualRecipe(platform: string, pattern: ReelsBrainDecisionPackPattern) {
  const fit = platformRecipe(platform, pattern);
  return [
    `Платформа: ${platform || "mixed"}. Первый кадр: ${fit.firstFrame}.`,
    "Вертикальный 9:16, товар или результат занимают главный фокус.",
    ...fit.editing,
    "Текст только там, где он усиливает promise, proof или payoff.",
  ];
}

function antiCopyWarnings(pattern: ReelsBrainDecisionPackPattern) {
  const warnings = [
    "Не копировать чужую дословную озвучку, текст на экране и монтаж покадрово.",
    "Не копировать музыку, персонажей и фирменные визуальные детали референса.",
    "Не повторять недоказуемые claims, даже если они были у залетевшего оригинала.",
  ];
  const reasons = Array.isArray(pattern.quality_reasons) ? pattern.quality_reasons : [];
  if (reasons.includes("mixed_or_non_ru_examples")) {
    warnings.push("Проверить локализацию: механику можно брать, но язык и культурный контекст надо адаптировать.");
  }
  return warnings;
}

function copyMechanics(pattern: ReelsBrainDecisionPackPattern) {
  return [
    `Тип хука: ${text(pattern.hook_label || pattern.hook_type || "сильный хук")}.`,
    `Структура раскрытия: ${text(pattern.structure_label || pattern.structure_type || "демонстрация")}.`,
    `Механика удержания: ${text(pattern.retention_label || pattern.retention_mechanism || "ожидание доказательства")}.`,
    "Порядок доказательства и темп перехода к payoff.",
  ];
}

function rationale(pattern: ReelsBrainDecisionPackPattern, crossPattern: ReelsBrainDecisionPackCrossPlatformPattern | null) {
  const parts = [
    `Частота в памяти: ${num(pattern.frequency)}.`,
    `Средний вес паттерна: ${num(pattern.strength_score)}.`,
    `Средние просмотры по примерам: ${num(pattern.avg_views)}.`,
    `Relevance score: ${num(pattern.relevance_score)}.`,
  ];
  if (crossPattern?.platform_count) {
    parts.push(`Паттерн повторяется на ${num(crossPattern.platform_count)} платформах.`);
  }
  return parts.join(" ");
}

function antiPatternWarnings(antiPatterns: ReelsBrainDecisionPackAntiPattern[]) {
  return antiPatterns.slice(0, 3).map((item) => ({
    anti_pattern_id: item.anti_pattern_id || null,
    label: item.label || null,
    severity: item.severity || "low",
    trigger_reason: item.trigger_reason || null,
    action: item.action || null,
    affected_patterns: num(item.affected_patterns),
    total_frequency: num(item.total_frequency),
  }));
}

function legacyGuard(input: {
  trustDecision: ReelsBrainDecisionTrust;
  platform: string;
  niche: string;
}): LegacyDecisionQualityGate {
  const recommendedMode = input.trustDecision.recommended_mode;
  return {
    status: recommendedMode === "research_only" ? "not_ready" : "needs_validation",
    source: "legacy_decision_pack",
    allowed_generation_modes: recommendedMode === "research_only"
      ? ["research_only", "brief_only"]
      : ["control_ready", "brief_only"],
    blocked_reasons: [
      `Legacy decision-pack не доказывает exact segment ${input.niche} × ${input.platform || "mixed"} и не должен идти в primary lane.`,
      ...(recommendedMode === "research_only"
        ? ["Даже trust-layer пока не разрешает blind запуск; сначала нужен research/control цикл."]
        : ["Нужен control-ready тест и exact-segment proof перед production rollout."]),
    ],
    exact_segment_ready: false,
  };
}

export function buildDecisionBrief(
  pattern: ReelsBrainDecisionPackPattern,
  input: {
    niche: string;
    productType: string;
    platform: string;
    crossPattern: ReelsBrainDecisionPackCrossPlatformPattern | null;
    antiPatterns: ReelsBrainDecisionPackAntiPattern[];
    trustDecision: ReelsBrainDecisionTrust;
    source?: string;
    rank?: number;
  },
) {
  const productFitNotes = productFit(input.productType, input.niche, pattern);
  const examples = topExamples(pattern, 3);
  const opScore = scoreDecisionPattern(pattern);
  const gate = input.trustDecision.recommended_mode === "research_only"
    ? "experimental"
    : input.trustDecision.recommended_mode === "control_only" && confidenceGate(pattern) === "high_confidence"
      ? "medium_confidence"
      : confidenceGate(pattern);
  return {
    source: input.source || "reels_brain_pattern",
    rank: Math.max(1, num(input.rank) || 1),
    niche: input.niche,
    platform: input.platform || "mixed",
    product_type: input.productType || "любой товар с визуальным proof",
    pattern_id: pattern.pattern_id || `${pattern.hook_type || "hook"}:${pattern.structure_type || "format"}:${pattern.retention_mechanism || "retention"}`,
    pattern_title: `${text(pattern.hook_label || pattern.hook_type || "сильный хук")} + ${text(pattern.structure_label || pattern.structure_type || "демонстрация")}`,
    hook_type: text(pattern.hook_type),
    hook_label: text(pattern.hook_label),
    structure_type: text(pattern.structure_type),
    structure_label: text(pattern.structure_label),
    retention_mechanism: text(pattern.retention_mechanism),
    retention_label: text(pattern.retention_label),
    quality_label: text(pattern.quality_label),
    op_score: opScore,
    confidence_gate: gate,
    trust_mode: input.trustDecision.recommended_mode,
    creative_brief: {
      hook: text(pattern.hook_label || pattern.hook_type || "сильный хук"),
      retention_mechanic: text(pattern.retention_label || pattern.retention_mechanism || "ожидание доказательства"),
      structure: text(pattern.structure_label || pattern.structure_type || "демонстрация"),
      emotion: text(pattern.emotion_label || pattern.emotion || "интерес"),
      viral_logic: text(pattern.viral_logic_label || pattern.viral_logic || ""),
      second_by_second: secondBySecond(input.platform, pattern),
      visual_recipe: visualRecipe(input.platform, pattern),
      product_fit: productFitNotes,
      copy_as_mechanic: copyMechanics(pattern),
      do_not_copy: antiCopyWarnings(pattern),
    },
    evidence: {
      frequency: num(pattern.frequency),
      strength_score: num(pattern.strength_score),
      quality_score: num(pattern.quality_score),
      relevance_score: num(pattern.relevance_score),
      avg_views: num(pattern.avg_views),
      examples,
      top_hooks_seen: Array.isArray(pattern.hooks) ? pattern.hooks.slice(0, 5) : [],
      top_sounds_seen: Array.isArray(pattern.sounds) ? pattern.sounds.slice(0, 4) : [],
      quality_reasons: Array.isArray(pattern.quality_reasons) ? pattern.quality_reasons : [],
      rationale: rationale(pattern, input.crossPattern),
      anti_pattern_warnings: antiPatternWarnings(input.antiPatterns),
      trust_decision: {
        selected_scope: input.trustDecision.selected_scope,
        allow_primary_use: input.trustDecision.allow_primary_use,
        recommended_mode: input.trustDecision.recommended_mode,
        score: input.trustDecision.trust.score,
        status: input.trustDecision.trust.status,
        confidence: input.trustDecision.trust.confidence,
        reasons: input.trustDecision.reasons,
        why_ready: input.trustDecision.trust.why_ready,
        why_not_yet: input.trustDecision.trust.why_not_yet,
      },
      cross_platform_support: input.crossPattern
        ? {
            platforms: Array.isArray(input.crossPattern.platforms) ? input.crossPattern.platforms : [],
            platform_count: num(input.crossPattern.platform_count),
            total_frequency: num(input.crossPattern.total_frequency),
            avg_strength_score: num(input.crossPattern.avg_strength_score),
          }
        : null,
    },
    hypotheses: [
      `Если адаптировать этот хук под ${input.productType || "товар"}, ролик должен быстрее захватывать внимание в первые 2 секунды.`,
      `Если сохранить механику "${text(pattern.retention_label || pattern.retention_mechanism || "удержание")}", досмотр должен быть выше, чем у обычного прямого обзора.`,
      input.platform
        ? `На платформе ${input.platform} этот паттерн стоит тестировать как ${input.rank === 1 ? "primary" : "control"}-вариант.`
        : "Этот паттерн стоит использовать как control-вариант для следующего креативного теста.",
    ],
    quality_gate: legacyGuard({
      trustDecision: input.trustDecision,
      platform: input.platform || "mixed",
      niche: input.niche,
    }),
  };
}

export function buildReelsBrainDecisionPack(input: {
  patterns: ReelsBrainDecisionPackPattern[];
  crossPlatformPatterns?: ReelsBrainDecisionPackCrossPlatformPattern[];
  antiPatterns?: ReelsBrainDecisionPackAntiPattern[];
  trustDecision: ReelsBrainDecisionTrust;
  niche: string;
  productType?: string;
  platform?: string;
  limit?: number;
}) {
  const ranked = [...(input.patterns || [])]
    .sort((a, b) => scoreDecisionPattern(b) - scoreDecisionPattern(a))
    .slice(0, Math.max(1, input.limit || 3));
  const antiPatterns = input.antiPatterns || [];
  const crossPatterns = input.crossPlatformPatterns || [];
  const options = ranked.map((pattern, index) => {
    const crossPattern = crossPatterns.find((item) => text(item.pattern_id) === text(pattern.pattern_id)) || null;
    return buildDecisionBrief(pattern, {
      niche: input.niche,
      productType: input.productType || "",
      platform: input.platform || "",
      crossPattern,
      antiPatterns,
      trustDecision: input.trustDecision,
      source: index === 0 ? "reels_brain_best_pattern" : "reels_brain_alternative_pattern",
      rank: index + 1,
    });
  });

  const primary = options[0] || null;
  return {
    primary,
    alternatives: options.slice(1),
    decision_pack: {
      options_total: options.length,
      trust_scope: input.trustDecision.selected_scope,
      recommended_mode: input.trustDecision.recommended_mode,
      allow_primary_use: input.trustDecision.allow_primary_use,
      quality_gate: legacyGuard({
        trustDecision: input.trustDecision,
        platform: input.platform || "mixed",
        niche: input.niche,
      }),
      rollout_order: options.map((item) => ({
        rank: item.rank,
        pattern_id: item.pattern_id,
        op_score: item.op_score,
        confidence_gate: item.confidence_gate,
      })),
      strategy_note: input.trustDecision.allow_primary_use
        ? "Есть primary-вариант, который можно брать как основу, а остальные держать как controlled alternatives."
        : "Primary-вариант пока не для слепого запуска: использовать весь набор как research/control ladder.",
    },
  };
}
