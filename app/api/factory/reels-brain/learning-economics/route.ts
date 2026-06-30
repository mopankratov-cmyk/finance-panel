import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { automationRunHistory } from "@/lib/factory/reelsBrainPlaybook";
import { discoverySources } from "@/lib/factory/reelsBrainDiscovery";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

type PatternBrain = {
  total_videos?: number;
  analyzed_videos?: number;
  meta_brain?: {
    patterns?: unknown[];
    generator_ready_patterns?: unknown[];
    quality_summary?: {
      generator_ready?: number;
      needs_cleanup?: number;
      noise?: number;
      avg_relevance_score?: number;
    };
  };
  cross_platform_patterns?: unknown[];
  platform_brains?: Record<string, {
    total_videos?: number;
    analyzed_videos?: number;
    patterns?: unknown[];
    generator_ready_patterns?: unknown[];
  }>;
};

type InsightPattern = {
  pattern_id?: string;
  hook_type?: string;
  hook_label?: string;
  structure_type?: string;
  structure_label?: string;
  retention_mechanism?: string;
  retention_label?: string;
  viral_logic_label?: string;
  frequency?: number;
  strength_score?: number;
  avg_views?: number;
  quality_label?: string;
  quality_score?: number;
  relevance_score?: number;
  hooks?: string[];
  examples?: { url?: string | null; hook?: string | null; score?: number; views?: number }[];
};

type ReferenceCreativeBrief = {
  hook: string;
  retention_mechanic: string;
  second_by_second: string[];
  visual_recipe: string[];
  product_fit: string[];
  copy_as_mechanic: string[];
  do_not_copy: string[];
};

type InsightExample = {
  reference_id?: string;
  url?: string | null;
  hook?: string | null;
  score?: number;
  views?: number;
  why_selected?: string;
  confidence?: "high" | "medium" | "low";
  safety_flags?: string[];
  creative_brief?: ReferenceCreativeBrief;
};

type GeneratorPayload = {
  source: "reels_brain_pattern";
  hook: string;
  retention: string;
  structure: string;
  second_by_second: string[];
  visual_recipe: string[];
  product_fit: string[];
  copy_as_mechanic: string[];
  do_not_copy: string[];
};

function splitList(value: unknown): string[] {
  return Array.from(new Set(String(value || "")
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean)))
    .slice(0, 20);
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function estimatedUsdFromCostUnits(costUnits: number): number {
  const usdPerUnit = Number(process.env.REELS_BRAIN_COST_UNIT_USD || 0.035);
  const safeUsdPerUnit = Number.isFinite(usdPerUnit) && usdPerUnit > 0 ? usdPerUnit : 0.035;
  return Math.round(costUnits * safeUsdPerUnit * 10000) / 10000;
}

function unitCost(row: { mode?: string; found?: number; analyzed?: number; retries?: number; errors?: number; cost_units?: number }) {
  if (num(row.cost_units) > 0) return num(row.cost_units);
  if (row.mode === "analyze") return Math.max(1, num(row.analyzed));
  return Math.max(1, num(row.found) + num(row.retries) * 5 + num(row.errors) * 10);
}

function spendUsd(row: {
  mode?: string;
  found?: number;
  analyzed?: number;
  retries?: number;
  errors?: number;
  actual_spend_usd?: number | null;
  estimated_spend_usd?: number;
  cost_units?: number;
}) {
  const actual = num(row.actual_spend_usd);
  if (actual > 0) return { value: actual, source: "actual" as const };
  const estimated = num(row.estimated_spend_usd);
  if (estimated > 0) return { value: estimated, source: "estimated" as const };
  return { value: estimatedUsdFromCostUnits(unitCost(row)), source: "estimated" as const };
}

function trendLabel(current: number | null, previous: number | null) {
  if (current == null || previous == null || previous <= 0) return "not_enough_data" as const;
  const delta = (current - previous) / previous;
  if (delta <= -0.08) return "cheaper" as const;
  if (delta >= 0.08) return "more_expensive" as const;
  return "flat" as const;
}

function dayKey(value: string, offsetDays = 0) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function perUnit(total: number, count: number) {
  return count > 0 ? Math.round((total / count) * 10000) / 10000 : null;
}

function patternBrain(playbook: unknown): PatternBrain {
  const pb = playbook && typeof playbook === "object" ? playbook as Record<string, unknown> : {};
  return pb.reels_brain_patterns && typeof pb.reels_brain_patterns === "object"
    ? pb.reels_brain_patterns as PatternBrain
    : {};
}

function patternList(brain: PatternBrain): InsightPattern[] {
  const meta = brain.meta_brain || {};
  const ready = Array.isArray(meta.generator_ready_patterns) ? meta.generator_ready_patterns : [];
  const all = Array.isArray(meta.patterns) ? meta.patterns : [];
  return (ready.length ? ready : all).filter((row) => row && typeof row === "object") as InsightPattern[];
}

function insightScore(pattern: InsightPattern, nicheCount: number, platformCount: number) {
  return Math.round(Math.min(100,
    num(pattern.strength_score)
    + Math.min(20, Math.log(num(pattern.frequency) + 1) * 6)
    + Math.min(12, nicheCount * 4)
    + Math.min(12, platformCount * 4)
    + (pattern.quality_label === "generator_ready" ? 10 : 0)
    + Math.min(10, num(pattern.relevance_score) / 10)
  ));
}

function statusFromScore(score: number) {
  if (score >= 90) return "op_hook" as const;
  if (score >= 75) return "strong" as const;
  if (score >= 60) return "stable" as const;
  return "watch" as const;
}

function confidenceLevel(input: { frequency?: number; niches?: number; platforms?: number; score?: number; examples?: number }) {
  const points =
    Math.min(30, Math.log(num(input.frequency) + 1) * 8)
    + Math.min(25, num(input.score) / 4)
    + Math.min(20, num(input.niches) * 7)
    + Math.min(15, num(input.platforms) * 5)
    + Math.min(10, num(input.examples) * 3);
  if (points >= 72) return "high" as const;
  if (points >= 48) return "medium" as const;
  return "low" as const;
}

function hookSegment(row: { op_score: number; frequency: number; confidence?: "high" | "medium" | "low" }) {
  if (row.op_score >= 85 && row.confidence !== "low") return "op_hooks" as const;
  if (row.frequency >= 100) return "frequent_hooks" as const;
  return "experimental_hooks" as const;
}

function templateForPattern(pattern: InsightPattern) {
  const hookType = pattern.hook_type || "unknown";
  const structure = pattern.structure_label || pattern.structure_type || "демо";
  const retention = pattern.retention_label || pattern.retention_mechanism || "интерес";
  const templates: Record<string, string[]> = {
    curiosity_question: [
      "А ты знал, что [товар/прием] может решить [боль] вот так?",
      "Почему все делают [действие] неправильно, если есть [решение]?",
      "Что будет, если попробовать [товар] в ситуации [контекст]?",
    ],
    warning_pattern_break: [
      "Не покупай [товар], пока не увидишь этот тест.",
      "Ты тоже делаешь [действие] неправильно? Вот почему результат хуже.",
      "Главная ошибка при выборе [товара], из-за которой все разочаровываются.",
    ],
    list_promise: [
      "Три причины, почему [товар] стоит попробовать для [ситуация].",
      "Топ-3 способа использовать [товар], о которых мало кто знает.",
      "Что проверить перед покупкой [товара]: короткий список.",
    ],
    before_after: [
      "Было [проблема], стало [результат]: показываю без фильтров.",
      "До/после с [товаром]: смотри на результат в конце.",
      "Проверяю, правда ли [товар] дает заметную разницу.",
    ],
    demo_review: [
      "Проверяю [товар] на камеру: выдержит ли реальный тест?",
      "Распаковка и честный тест [товара] за 15 секунд.",
      "Показываю, как [товар] работает в обычной жизни.",
    ],
    curiosity_gap: [
      "Я не ожидал, что [товар] сработает именно так.",
      "Сначала кажется странным, но результат в конце объясняет все.",
      "Досмотри до момента, где [товар] показывает главный эффект.",
    ],
    direct_claim: [
      "[Товар] решает [боль] быстрее, чем кажется.",
      "Вот почему [товар] забирают для [ситуация].",
      "Если нужен [результат], начни с этого простого решения.",
    ],
    unknown: [
      `Хук через ${structure}: показать проблему, доказательство и результат.`,
      `Сценарий с удержанием "${retention}": открыть вопрос и закрыть его в конце.`,
      "Покажи [проблему] в первом кадре, затем докажи [решение] через демонстрацию.",
    ],
  };
  return templates[hookType] || templates.unknown;
}

function recipeTitle(pattern: InsightPattern) {
  const hook = pattern.hook_label || "хук";
  const structure = pattern.structure_label || "формат";
  const retention = pattern.retention_label || "удержание";
  return `${hook}: ${structure} -> ${retention}`;
}

function secondsForPattern(pattern: InsightPattern) {
  const hook = pattern.hook_label || "хук";
  const structure = pattern.structure_label || "демо";
  const retention = pattern.retention_label || "удержание";
  if (pattern.structure_type === "before_after") {
    return [
      "0-2с: показать проблему/исходное состояние крупно, без долгого вступления.",
      `2-5с: дать ${hook} и обещать видимый результат.`,
      "5-10с: показать процесс применения/переход без лишних деталей.",
      "10-14с: раскрыть after-кадр и доказательство результата.",
      "14-18с: короткий вывод + мягкий CTA сохранить/сравнить.",
    ];
  }
  if (pattern.structure_type === "unboxing") {
    return [
      "0-2с: быстрый первый кадр с упаковкой/товаром и причиной смотреть дальше.",
      "2-5с: распаковка в 2-3 быстрых склейки, без пауз.",
      "5-9с: показать ключевую деталь товара крупно.",
      "9-14с: мини-тест в реальной ситуации.",
      "14-18с: финальный кадр с результатом и понятным выводом.",
    ];
  }
  if (pattern.structure_type === "life_hack") {
    return [
      "0-2с: назвать боль или ошибку, которую зритель узнает.",
      "2-5с: показать неожиданный способ решения.",
      "5-10с: пошагово доказать механику на камеру.",
      "10-15с: показать результат до/после или close-up.",
      "15-20с: закрепить вывод и дать сценарий применения.",
    ];
  }
  return [
    `0-2с: открыть ролик через ${hook}.`,
    `2-5с: быстро объяснить контекст, не раскрывая весь payoff.`,
    `5-10с: показать ${structure} как доказательство, а не рассказ.`,
    `10-15с: удерживать через "${retention}" и закрыть главный вопрос.`,
    "15-20с: финальный результат + короткий CTA без копирования оригинала.",
  ];
}

function visualRecipeForPattern(pattern: InsightPattern) {
  const structureType = pattern.structure_type || "demo";
  const base = [
    "Вертикальный 9:16, первый кадр должен читаться без звука.",
    "Крупные планы товара/результата, минимум пустого фона.",
    "Субтитр или экранный текст только для смысла хука, не как декор.",
  ];
  if (structureType === "before_after") {
    return [...base, "Split/transition before-after: одинаковый ракурс, чтобы разница была честной.", "Финальный кадр держать на 1-2 секунды дольше остальных."];
  }
  if (structureType === "unboxing") {
    return [...base, "Быстрые jump-cuts рук, упаковки, фактуры и ключевой детали.", "Один кадр с товаром в использовании, не только на столе."];
  }
  if (structureType === "pov") {
    return [...base, "Камера от лица пользователя или бытовая сцена, где проблема узнается сразу.", "Добавить реакцию/микро-драму, но не копировать персонажа оригинала."];
  }
  return [...base, "Демонстрация должна доказывать тезис хука в кадре.", "Избегать длинного говорящего вступления."];
}

function productFitForPattern(pattern: InsightPattern, niche: string) {
  const byNiche: Record<string, string[]> = {
    ru_toys: ["игрушки с демонстрируемым эффектом", "товары, где важна реакция ребенка/родителя", "подарочные товары с быстрым wow-моментом"],
    ru_cosmetics: ["косметика с видимым before/after", "уходовые товары с proof-кадром", "макияж/аксессуары, где важна трансформация"],
    ru_clothing: ["одежда с проблемой посадки/размера", "образы до/после", "вещи, где важны фактура, цвет и посадка на теле"],
  };
  const fit = byNiche[niche] || ["товары с визуально доказуемым результатом", "темы, где можно быстро показать проблему и решение"];
  if (pattern.hook_type === "warning_pattern_break") return [...fit, "товары, где покупатель боится ошибиться"];
  if (pattern.hook_type === "list_promise") return [...fit, "товары, где есть 3-5 понятных преимуществ"];
  return fit;
}

function creativeBriefForPattern(pattern: InsightPattern, niche: string, example?: { hook?: string | null }): ReferenceCreativeBrief {
  const template = templateForPattern(pattern)[0] || "Покажи проблему, механику и результат без копирования оригинала.";
  const exampleHook = String(example?.hook || "").trim();
  const safeExample = exampleHook && !/#[\p{L}\p{N}_]+|https?:\/\//iu.test(exampleHook) && exampleHook.length < 140 ? exampleHook : "";
  return {
    hook: safeExample || template,
    retention_mechanic: pattern.retention_label || pattern.retention_mechanism || "открытая петля / ожидание доказательства",
    second_by_second: secondsForPattern(pattern),
    visual_recipe: visualRecipeForPattern(pattern),
    product_fit: productFitForPattern(pattern, niche),
    copy_as_mechanic: [
      "Темп раскрытия: быстрый хук -> доказательство -> payoff.",
      `Механику удержания: ${pattern.retention_label || "ожидание результата"}.`,
      `Структуру: ${pattern.structure_label || "демонстрация"} как скелет, адаптируя под наш товар.`,
    ],
    do_not_copy: [
      "Не копировать чужой монтаж покадрово.",
      "Не копировать текст, озвучку, музыку, персонажей, визуальные образы и брендовые элементы.",
      "Не использовать чужое видео как ассет; только как референс механики.",
      "Не повторять claim, если его нельзя доказать нашим товаром.",
    ],
  };
}

function generatorPayload(pattern: InsightPattern, niche: string): GeneratorPayload {
  const brief = creativeBriefForPattern(pattern, niche);
  return {
    source: "reels_brain_pattern",
    hook: brief.hook,
    retention: brief.retention_mechanic,
    structure: pattern.structure_label || pattern.structure_type || "демонстрация",
    second_by_second: brief.second_by_second,
    visual_recipe: brief.visual_recipe,
    product_fit: brief.product_fit,
    copy_as_mechanic: brief.copy_as_mechanic,
    do_not_copy: brief.do_not_copy,
  };
}

function safetyFlags(pattern: InsightPattern, example?: { hook?: string | null }) {
  const flags: string[] = [];
  const hook = String(example?.hook || "").trim();
  if (/#[\p{L}\p{N}_]+/u.test(hook)) flags.push("raw_hashtags");
  if (/https?:\/\//i.test(hook)) flags.push("raw_url_in_hook");
  if (pattern.quality_label !== "generator_ready") flags.push("not_generator_ready");
  if (num(pattern.relevance_score) < 55) flags.push("low_relevance");
  return flags;
}

function enrichExamples(pattern: InsightPattern, niche: string): InsightExample[] {
  return ((pattern.examples || []) as InsightExample[])
    .slice(0, 3)
    .map((example, index) => ({
      ...example,
      reference_id: `${pattern.pattern_id || pattern.hook_type || "pattern"}:${index}`,
      why_selected: `Высокий score/просмотры для паттерна "${pattern.hook_label || pattern.hook_type || "hook"}"; используем как референс механики, не как ассет.`,
      confidence: confidenceLevel({
        frequency: pattern.frequency,
        score: pattern.strength_score,
        niches: 1,
        platforms: 1,
        examples: pattern.examples?.length || 0,
      }),
      safety_flags: safetyFlags(pattern, example),
      creative_brief: creativeBriefForPattern(pattern, niche, example),
    }));
}

function buildSourceMap(rows: { niche?: string; playbook?: unknown }[]) {
  const map = new Map<string, {
    provider: string;
    runs: number;
    found: number;
    inserted: number;
    analyzed: number;
    relevant: number;
    errors: number;
    estimated_spend_usd: number;
    actual_spend_usd: number;
    estimated_runs: number;
    actual_runs: number;
    niches: Set<string>;
  }>();
  for (const row of rows) {
    for (const run of automationRunHistory(row.playbook)) {
      const provider = run.best_provider || "unknown";
      const current = map.get(provider) || {
        provider,
        runs: 0,
        found: 0,
        inserted: 0,
        analyzed: 0,
        relevant: 0,
        errors: 0,
        estimated_spend_usd: 0,
        actual_spend_usd: 0,
        estimated_runs: 0,
        actual_runs: 0,
        niches: new Set<string>(),
      };
      const spend = spendUsd(run);
      current.runs += 1;
      current.found += num(run.found);
      current.inserted += num(run.inserted);
      current.analyzed += num(run.analyzed);
      current.relevant += num(run.relevant);
      current.errors += num(run.errors);
      current.estimated_spend_usd += spend.value;
      if (spend.source === "actual") {
        current.actual_spend_usd += spend.value;
        current.actual_runs += 1;
      } else {
        current.estimated_runs += 1;
      }
      if (row.niche) current.niches.add(row.niche);
      map.set(provider, current);
    }
  }
  return Array.from(map.values()).map((row) => ({
    provider: row.provider,
    runs: row.runs,
    found: row.found,
    inserted: row.inserted,
    analyzed: row.analyzed,
    relevant: row.relevant,
    errors: row.errors,
    estimated_spend_usd: Math.round(row.estimated_spend_usd * 10000) / 10000,
    actual_spend_usd: Math.round(row.actual_spend_usd * 10000) / 10000,
    spend_source: row.actual_runs > 0 && row.estimated_runs > 0 ? "mixed" : row.actual_runs > 0 ? "actual" : "estimated",
    cost_per_inserted: perUnit(row.estimated_spend_usd, row.inserted),
    cost_per_analyzed: perUnit(row.estimated_spend_usd, row.analyzed),
    cost_per_useful: perUnit(row.estimated_spend_usd, row.relevant || row.analyzed || row.inserted),
    waste_score: Math.round(Math.min(100,
      (row.found > 0 && row.inserted === 0 ? 45 : 0)
      + (row.errors / Math.max(1, row.runs)) * 35
      + (row.relevant > 0 ? 0 : 20)
    )),
    niches: Array.from(row.niches).sort(),
  })).sort((a, b) => (a.cost_per_analyzed ?? 999) - (b.cost_per_analyzed ?? 999) || b.analyzed - a.analyzed).slice(0, 8);
}

function sourceRecommendation(source: ReturnType<typeof discoverySources>[number]) {
  if (source.status !== "active") return "skip" as const;
  if (source.runs < 2) return "explore_more" as const;
  if (source.yield_score >= 65 && source.cost_per_relevant <= 2.5) return "scale" as const;
  if (source.yield_score >= 45) return "keep_testing" as const;
  return "avoid" as const;
}

function sourceLane(source: ReturnType<typeof discoverySources>[number]) {
  const recommendation = sourceRecommendation(source);
  if (recommendation === "scale") return "exploit" as const;
  if (recommendation === "explore_more") return "explore" as const;
  if (recommendation === "keep_testing") return "refresh" as const;
  return "hold" as const;
}

function buildSourceRankings(rows: { niche?: string; playbook?: unknown }[]) {
  const sources = rows.flatMap((row) => discoverySources(row.playbook, { includePaused: true }).map((source) => {
    const recommendation = sourceRecommendation(source);
    const lane = sourceLane(source);
    const estimatedCostPerRelevantUsd = estimatedUsdFromCostUnits(source.cost_per_relevant);
    const wasteScore = Math.round(Math.min(100,
      (source.status !== "active" ? 25 : 0)
      + (source.found > 0 && source.relevant === 0 ? 35 : 0)
      + Math.max(0, 45 - source.yield_score)
      + Math.max(0, source.cost_per_relevant - 3) * 8
    ));
    return {
      id: source.id,
      niche: source.niche || row.niche || "default",
      platform: source.platform,
      type: source.type,
      value: source.value,
      status: source.status,
      yield_score: source.yield_score,
      relevance_rate: source.relevance_rate,
      breakout_rate: source.breakout_rate,
      cost_per_relevant_units: source.cost_per_relevant,
      estimated_cost_per_relevant_usd: estimatedCostPerRelevantUsd,
      runs: source.runs,
      found: source.found,
      relevant: source.relevant,
      breakout: source.breakout,
      inserted: source.inserted,
      waste_score: wasteScore,
      lane,
      recommendation,
      reason: source.reason || (
        recommendation === "scale"
          ? "Высокий yield и нормальная цена за полезный референс."
          : recommendation === "explore_more"
            ? "Источник перспективный, но пока мало прогонов для уверенности."
            : recommendation === "avoid"
              ? "Источник дорогой или дает мало релевантных видео."
              : "Источник стоит перепроверять малыми лимитами."
      ),
    };
  }));

  return sources
    .sort((a, b) =>
      b.yield_score - a.yield_score
      || a.cost_per_relevant_units - b.cost_per_relevant_units
      || b.relevant - a.relevant
    )
    .slice(0, 24);
}

function buildRecommendedSpendPlan(sourceRankings: ReturnType<typeof buildSourceRankings>, sourceMap: ReturnType<typeof buildSourceMap>) {
  const scalable = sourceRankings.filter((source) => source.recommendation === "scale").slice(0, 5);
  const explore = sourceRankings.filter((source) => source.recommendation === "explore_more").slice(0, 5);
  const refresh = sourceRankings.filter((source) => source.recommendation === "keep_testing").slice(0, 5);
  const avoid = sourceRankings.filter((source) => source.recommendation === "avoid").slice(0, 5);
  const bestProvider = sourceMap
    .filter((source) => source.analyzed > 0 || source.inserted > 0)
    .sort((a, b) => (a.cost_per_useful ?? 999) - (b.cost_per_useful ?? 999) || b.analyzed - a.analyzed)[0] || null;

  return {
    split: {
      exploit_pct: scalable.length ? 70 : 45,
      explore_pct: explore.length ? 20 : 40,
      refresh_pct: 10,
    },
    next_actions: [
      scalable[0] ? `Увеличить лимит на ${scalable[0].platform}/${scalable[0].type}: ${scalable[0].value}.` : "Нет доказанного источника для масштабирования: сначала explore малыми лимитами.",
      explore[0] ? `Добрать статистику по новому источнику: ${explore[0].value}.` : "Новых перспективных источников мало: replay старого корпуса может подсказать новые account/sound.",
      avoid[0] ? `Не тратить бюджет на слабый источник: ${avoid[0].value}.` : "Явных источников для стоп-листа пока нет.",
    ],
    scale_sources: scalable,
    explore_sources: explore,
    refresh_sources: refresh,
    avoid_sources: avoid,
    best_provider: bestProvider,
  };
}

function buildEconomicsSummary(input: {
  sourceRankings: ReturnType<typeof buildSourceRankings>;
  sourceMap: ReturnType<typeof buildSourceMap>;
}) {
  const strongSources = input.sourceRankings.filter((source) => source.recommendation === "scale");
  const avoidSources = input.sourceRankings.filter((source) => source.recommendation === "avoid");
  const bestSource = strongSources[0] || input.sourceRankings[0] || null;
  const cheapestProvider = input.sourceMap
    .filter((source) => source.cost_per_useful != null)
    .sort((a, b) => (a.cost_per_useful ?? 999) - (b.cost_per_useful ?? 999))[0] || null;
  const billingSources = new Set(input.sourceMap.map((source) => source.spend_source));

  return {
    source_memory_count: input.sourceRankings.length,
    scalable_sources: strongSources.length,
    avoid_sources: avoidSources.length,
    best_source: bestSource ? {
      label: `${bestSource.platform}/${bestSource.type}: ${bestSource.value}`,
      yield_score: bestSource.yield_score,
      estimated_cost_per_relevant_usd: bestSource.estimated_cost_per_relevant_usd,
    } : null,
    cheapest_provider: cheapestProvider ? {
      provider: cheapestProvider.provider,
      cost_per_useful: cheapestProvider.cost_per_useful,
      spend_source: cheapestProvider.spend_source,
    } : null,
    billing_truth: billingSources.has("actual") || billingSources.has("mixed")
      ? "mixed_or_actual"
      : "estimated_only",
    note: billingSources.has("actual") || billingSources.has("mixed")
      ? "В экономике есть реальные billing-значения, но часть строк может быть оценочной."
      : "Экономика пока оценочная: для честной цены за видео нужен billing API провайдера.",
  };
}

function buildInsights(rows: { niche?: string; playbook?: unknown }[]) {
  const hookMap = new Map<string, {
    hook_type: string;
    hook_label: string;
    frequency: number;
    avg_score_sum: number;
    quality_score_sum: number;
    relevance_score_sum: number;
    count: number;
    niches: Set<string>;
    platforms: Set<string>;
    examples: InsightExample[];
    templates: Set<string>;
  }>();
  const formatMap = new Map<string, { label: string; frequency: number; score_sum: number; count: number; niches: Set<string> }>();
  const retentionMap = new Map<string, { label: string; frequency: number; score_sum: number; count: number; hooks: Set<string> }>();
  const recipes: Array<{
    id: string;
    title: string;
    hook: string;
    format: string;
    retention: string;
    op_score: number;
    confidence: "high" | "medium" | "low";
    niches: string[];
    creative_brief: ReferenceCreativeBrief;
    generator_payload: GeneratorPayload;
    examples: InsightExample[];
  }> = [];

  for (const row of rows) {
    const niche = row.niche || "default";
    const brain = patternBrain(row.playbook);
    for (const pattern of patternList(brain)) {
      const hookKey = pattern.hook_type || "unknown";
      const hook = hookMap.get(hookKey) || {
        hook_type: hookKey,
        hook_label: pattern.hook_label || hookKey,
        frequency: 0,
        avg_score_sum: 0,
        quality_score_sum: 0,
        relevance_score_sum: 0,
        count: 0,
        niches: new Set<string>(),
        platforms: new Set<string>(),
        examples: [],
        templates: new Set<string>(),
      };
      hook.frequency += num(pattern.frequency);
      hook.avg_score_sum += num(pattern.strength_score);
      hook.quality_score_sum += num(pattern.quality_score);
      hook.relevance_score_sum += num(pattern.relevance_score);
      hook.count += 1;
      hook.niches.add(niche);
      for (const [platform, platformBrain] of Object.entries(brain.platform_brains || {})) {
        const platformPatterns = Array.isArray(platformBrain?.generator_ready_patterns) ? platformBrain.generator_ready_patterns : [];
        if (platformPatterns.some((item) => (item as InsightPattern).hook_type === hookKey)) hook.platforms.add(platform);
      }
      for (const example of enrichExamples(pattern, niche)) {
        if (hook.examples.length < 5) hook.examples.push(example);
      }
      for (const template of templateForPattern(pattern)) hook.templates.add(template);
      hookMap.set(hookKey, hook);

      const formatKey = pattern.structure_type || "unknown_structure";
      const format = formatMap.get(formatKey) || { label: pattern.structure_label || formatKey, frequency: 0, score_sum: 0, count: 0, niches: new Set<string>() };
      format.frequency += num(pattern.frequency);
      format.score_sum += num(pattern.strength_score);
      format.count += 1;
      format.niches.add(niche);
      formatMap.set(formatKey, format);

      const retentionKey = pattern.retention_mechanism || "unknown";
      const retention = retentionMap.get(retentionKey) || { label: pattern.retention_label || retentionKey, frequency: 0, score_sum: 0, count: 0, hooks: new Set<string>() };
      retention.frequency += num(pattern.frequency);
      retention.score_sum += num(pattern.strength_score);
      retention.count += 1;
      retention.hooks.add(pattern.hook_label || hookKey);
      retentionMap.set(retentionKey, retention);

      recipes.push({
        id: pattern.pattern_id || `${hookKey}:${formatKey}:${retentionKey}`,
        title: recipeTitle(pattern),
        hook: pattern.hook_label || hookKey,
        format: pattern.structure_label || formatKey,
        retention: pattern.retention_label || retentionKey,
        op_score: insightScore(pattern, 1, 1),
        confidence: confidenceLevel({ frequency: pattern.frequency, score: pattern.strength_score, niches: 1, platforms: 1, examples: pattern.examples?.length || 0 }),
        niches: [niche],
        creative_brief: creativeBriefForPattern(pattern, niche),
        generator_payload: generatorPayload(pattern, niche),
        examples: enrichExamples(pattern, niche),
      });
    }
  }

  const top_hooks = Array.from(hookMap.values()).map((row) => {
    const avg_score = row.count ? Math.round(row.avg_score_sum / row.count) : 0;
    const quality_score = row.count ? Math.round(row.quality_score_sum / row.count) : 0;
    const relevance_score = row.count ? Math.round(row.relevance_score_sum / row.count) : 0;
    const op_score = insightScore({ strength_score: avg_score, frequency: row.frequency, quality_score, relevance_score, quality_label: quality_score >= 70 ? "generator_ready" : "needs_cleanup" }, row.niches.size, row.platforms.size);
    const confidence = confidenceLevel({ frequency: row.frequency, score: op_score, niches: row.niches.size, platforms: row.platforms.size, examples: row.examples.length });
    return {
      hook_type: row.hook_type,
      hook_label: row.hook_label,
      frequency: row.frequency,
      avg_score,
      quality_score,
      relevance_score,
      op_score,
      confidence,
      status: statusFromScore(op_score),
      segment: hookSegment({ op_score, frequency: row.frequency, confidence }),
      evidence: {
        based_on_videos: row.frequency,
        niche_count: row.niches.size,
        platform_count: row.platforms.size,
        reference_count: row.examples.length,
      },
      niches: Array.from(row.niches).sort(),
      platforms: Array.from(row.platforms).sort(),
      templates: Array.from(row.templates).slice(0, 3),
      examples: row.examples.sort((a, b) => num(b.score) - num(a.score) || num(b.views) - num(a.views)).slice(0, 3),
    };
  }).sort((a, b) => b.op_score - a.op_score || b.frequency - a.frequency).slice(0, 8);
  const hook_groups = {
    op_hooks: top_hooks.filter((row) => row.segment === "op_hooks").slice(0, 4),
    frequent_hooks: top_hooks.filter((row) => row.segment === "frequent_hooks").slice(0, 4),
    experimental_hooks: top_hooks.filter((row) => row.segment === "experimental_hooks").slice(0, 4),
  };

  const source_map = buildSourceMap(rows);
  const source_rankings = buildSourceRankings(rows);
  const recommended_spend_plan = buildRecommendedSpendPlan(source_rankings, source_map);
  const economics_summary = buildEconomicsSummary({ sourceRankings: source_rankings, sourceMap: source_map });

  return {
    summary: [
      top_hooks[0] ? `Самый сильный вход: ${top_hooks[0].hook_label} (${top_hooks[0].op_score}/100).` : "Паттерны хуков пока не найдены.",
      `Generator-ready паттерны уже можно отдавать в контент-завод как рецепты, но примеры исходников лучше держать рядом.`,
      `Технические логи спрятаны ниже: витрина показывает только выводы, уверенность и применение.`,
    ],
    top_hooks,
    hook_groups,
    winning_formats: Array.from(formatMap.values()).map((row) => ({
      label: row.label,
      frequency: row.frequency,
      avg_score: row.count ? Math.round(row.score_sum / row.count) : 0,
      niches: Array.from(row.niches).sort(),
    })).sort((a, b) => b.avg_score - a.avg_score || b.frequency - a.frequency).slice(0, 6),
    retention_mechanics: Array.from(retentionMap.values()).map((row) => ({
      label: row.label,
      frequency: row.frequency,
      avg_score: row.count ? Math.round(row.score_sum / row.count) : 0,
      hooks: Array.from(row.hooks).slice(0, 4),
    })).sort((a, b) => b.avg_score - a.avg_score || b.frequency - a.frequency).slice(0, 6),
    recipes: recipes.sort((a, b) => b.op_score - a.op_score).slice(0, 6),
    source_references: top_hooks.flatMap((hook) => hook.examples.map((example) => ({
      hook_type: hook.hook_type,
      hook_label: hook.hook_label,
      op_score: hook.op_score,
      confidence: hook.confidence,
      ...example,
    }))).slice(0, 8),
    source_map,
    source_rankings,
    recommended_spend_plan,
    economics_summary,
    legal_guard: {
      principle: "Копируем только механику: темп, структуру, удержание и тип доказательства. Не копируем сам контент.",
      allowed: ["структура по секундам", "ритм раскрытия", "тип хука", "механика удержания", "тип proof-кадра"],
      forbidden: ["чужой монтаж покадрово", "текст/озвучка", "музыка", "персонажи", "визуальная айдентика", "недоказуемые claims"],
    },
    capability_status: [
      { key: "source_references", label: "Source references", status: "live" },
      { key: "confidence", label: "Confidence / доказательность", status: "live" },
      { key: "hook_segments", label: "OP / Frequent / Experimental", status: "live" },
      { key: "generator_payload", label: "Use in generator payload", status: "payload_ready" },
      { key: "filters", label: "Фильтры витрины", status: "ui_ready" },
      { key: "actual_billing", label: "Реальный Apify billing", status: "needs_provider_api" },
      { key: "product_fit", label: "Product fit", status: "rule_based" },
      { key: "source_map", label: "Source map discovery", status: "estimated" },
      { key: "noise_cleanup", label: "Noise cleanup", status: "rule_based" },
      { key: "weekly_report", label: "Weekly intelligence report", status: "planned" },
      { key: "feedback_loop", label: "Feedback loop публикаций", status: "planned" },
      { key: "generator_integration", label: "Generator integration", status: "payload_ready" },
      { key: "discovery_autopilot", label: "Discovery autopilot", status: "planned" },
      { key: "video_structure_extraction", label: "Actual video structure extraction", status: "pattern_based" },
      { key: "legal_guard_v2", label: "Legal / safety guard v2", status: "rule_based" },
    ],
  };
}

function understandingScore(brain: PatternBrain) {
  const total = num(brain.total_videos);
  const analyzed = num(brain.analyzed_videos);
  const meta = brain.meta_brain || {};
  const patterns = Array.isArray(meta.patterns) ? meta.patterns.length : 0;
  const ready = Array.isArray(meta.generator_ready_patterns) ? meta.generator_ready_patterns.length : num(meta.quality_summary?.generator_ready);
  const cross = Array.isArray(brain.cross_platform_patterns) ? brain.cross_platform_patterns.length : 0;
  const relevance = Math.max(0, Math.min(100, num(meta.quality_summary?.avg_relevance_score)));
  const analyzedRatio = total ? analyzed / total : 0;
  const score = Math.round(
    Math.min(40, analyzedRatio * 40)
    + Math.min(25, ready * 2)
    + Math.min(20, patterns)
    + Math.min(10, cross * 1.5)
    + Math.min(5, relevance / 20)
  );
  return Math.max(0, Math.min(100, score));
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) {
      return NextResponse.json({ ok: true, niches: [], runs: [], warning: "Supabase не настроен" }, { headers: { "Cache-Control": "no-store" } });
    }

    const niches = splitList(req.nextUrl.searchParams.get("niches") || "ru_toys,ru_clothing,ru_cosmetics");
    const limit = Math.max(4, Math.min(80, Number(req.nextUrl.searchParams.get("limit") || 50)));
    const { data, error } = await db
      .from("niche_playbooks")
      .select("niche,playbook,updated_at")
      .in("niche", niches);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = ((data || []) as { niche?: string; playbook?: unknown; updated_at?: string }[]);
    const runMap = new Map<string, ReturnType<typeof automationRunHistory>[number] & { niches: Set<string> }>();
    const nicheSummaries = rows.map((row) => {
      const brain = patternBrain(row.playbook);
      for (const run of automationRunHistory(row.playbook)) {
        const key = [
          run.created_at,
          run.mode,
          run.strategy || "",
          run.found,
          run.inserted,
          run.analyzed,
          run.errors,
        ].join("|");
        const current = runMap.get(key) || { ...run, niches: new Set<string>() };
        if (row.niche) current.niches.add(row.niche);
        runMap.set(key, current);
      }
      const meta = brain.meta_brain || {};
      return {
        niche: row.niche || "",
        updated_at: row.updated_at || null,
        total_videos: num(brain.total_videos),
        analyzed_videos: num(brain.analyzed_videos),
        patterns: Array.isArray(meta.patterns) ? meta.patterns.length : 0,
        generator_ready_patterns: Array.isArray(meta.generator_ready_patterns) ? meta.generator_ready_patterns.length : num(meta.quality_summary?.generator_ready),
        cross_platform_patterns: Array.isArray(brain.cross_platform_patterns) ? brain.cross_platform_patterns.length : 0,
        avg_relevance_score: num(meta.quality_summary?.avg_relevance_score),
        understanding_score: understandingScore(brain),
        platform_brains: Object.fromEntries(Object.entries(brain.platform_brains || {}).map(([platform, platformBrain]) => [
          platform,
          {
            total_videos: num(platformBrain?.total_videos),
            analyzed_videos: num(platformBrain?.analyzed_videos),
            patterns: Array.isArray(platformBrain?.patterns) ? platformBrain.patterns.length : 0,
            generator_ready_patterns: Array.isArray(platformBrain?.generator_ready_patterns) ? platformBrain.generator_ready_patterns.length : 0,
          },
        ])),
      };
    }).sort((a, b) => b.understanding_score - a.understanding_score || a.niche.localeCompare(b.niche));

    const runs = Array.from(runMap.values())
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .slice(-limit)
      .map((run) => {
        const costUnits = unitCost(run);
        return {
          id: run.id,
          mode: run.mode,
          strategy: run.strategy || null,
          created_at: run.created_at,
          niches: Array.from(run.niches).sort(),
          ok: run.ok,
          found: run.found,
          inserted: run.inserted,
          analyzed: run.analyzed,
          relevant: run.relevant,
          retries: run.retries,
          errors: run.errors,
          best_provider: run.best_provider || null,
          cost_units: costUnits,
          spend_usd: spendUsd(run).value,
          spend_source: spendUsd(run).source,
          inserted_per_100_cost_units: Math.round((run.inserted / costUnits) * 1000) / 10,
          analyzed_per_100_cost_units: Math.round((run.analyzed / costUnits) * 1000) / 10,
          cost_units_per_inserted: run.inserted > 0 ? Math.round((costUnits / run.inserted) * 10) / 10 : null,
          cost_units_per_analyzed: run.analyzed > 0 ? Math.round((costUnits / run.analyzed) * 10) / 10 : null,
          usd_per_inserted: run.inserted > 0 ? perUnit(spendUsd(run).value, run.inserted) : null,
          usd_per_analyzed: run.analyzed > 0 ? perUnit(spendUsd(run).value, run.analyzed) : null,
          usd_per_relevant: run.relevant > 0 ? perUnit(spendUsd(run).value, run.relevant) : null,
        };
      });

    let cumulativeInserted = 0;
    let cumulativeAnalyzed = 0;
    let cumulativeCost = 0;
    const timeline = runs.map((run) => {
      cumulativeInserted += run.inserted;
      cumulativeAnalyzed += run.analyzed;
      cumulativeCost += run.cost_units;
      return {
        ...run,
        cumulative_inserted: cumulativeInserted,
        cumulative_analyzed: cumulativeAnalyzed,
        cumulative_cost_units: cumulativeCost,
      };
    });

    const intakeRuns = timeline.filter((row) => row.inserted > 0);
    const todayKey = dayKey(new Date().toISOString());
    const yesterdayKey = dayKey(new Date().toISOString(), -1);
    const dailyRows = Array.from(timeline.reduce((map, row) => {
      const key = dayKey(row.created_at);
      if (!key) return map;
      const current = map.get(key) || {
        date: key,
        runs: 0,
        found: 0,
        inserted: 0,
        analyzed: 0,
        relevant: 0,
        retries: 0,
        errors: 0,
        cost_units: 0,
        spend_usd: 0,
        spend_source: "estimated" as "estimated" | "actual" | "mixed",
      };
      current.runs += 1;
      current.found += row.found;
      current.inserted += row.inserted;
      current.analyzed += row.analyzed;
      current.relevant += row.relevant;
      current.retries += row.retries;
      current.errors += row.errors;
      current.cost_units += row.cost_units;
      current.spend_usd += row.spend_usd;
      if (current.spend_source !== row.spend_source) current.spend_source = current.runs > 1 ? "mixed" : row.spend_source;
      map.set(key, current);
      return map;
    }, new Map<string, {
      date: string;
      runs: number;
      found: number;
      inserted: number;
      analyzed: number;
      relevant: number;
      retries: number;
      errors: number;
      cost_units: number;
      spend_usd: number;
      spend_source: "estimated" | "actual" | "mixed";
    }>()).values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        ...row,
        spend_usd: Math.round(row.spend_usd * 10000) / 10000,
        usd_per_found: perUnit(row.spend_usd, row.found),
        usd_per_inserted: perUnit(row.spend_usd, row.inserted),
        usd_per_analyzed: perUnit(row.spend_usd, row.analyzed),
        usd_per_relevant: perUnit(row.spend_usd, row.relevant),
        cost_units_per_inserted: perUnit(row.cost_units, row.inserted),
      }));
    const today = dailyRows.find((row) => row.date === todayKey) || null;
    const yesterday = dailyRows.find((row) => row.date === yesterdayKey) || null;
    const todayUseful = today?.usd_per_relevant ?? today?.usd_per_analyzed ?? today?.usd_per_inserted ?? null;
    const yesterdayUseful = yesterday?.usd_per_relevant ?? yesterday?.usd_per_analyzed ?? yesterday?.usd_per_inserted ?? null;
    const recentIntake = intakeRuns.slice(-5);
    const previousIntake = intakeRuns.slice(-10, -5);
    const avgRecentCost = recentIntake.length
      ? recentIntake.reduce((sum, row) => sum + (row.cost_units_per_inserted || 0), 0) / recentIntake.length
      : null;
    const avgPreviousCost = previousIntake.length
      ? previousIntake.reduce((sum, row) => sum + (row.cost_units_per_inserted || 0), 0) / previousIntake.length
      : null;
    const totals = {
      total_videos: nicheSummaries.reduce((sum, row) => sum + row.total_videos, 0),
      analyzed_videos: nicheSummaries.reduce((sum, row) => sum + row.analyzed_videos, 0),
      patterns: nicheSummaries.reduce((sum, row) => sum + row.patterns, 0),
      generator_ready_patterns: nicheSummaries.reduce((sum, row) => sum + row.generator_ready_patterns, 0),
      cross_platform_patterns: nicheSummaries.reduce((sum, row) => sum + row.cross_platform_patterns, 0),
      avg_understanding_score: nicheSummaries.length
        ? Math.round(nicheSummaries.reduce((sum, row) => sum + row.understanding_score, 0) / nicheSummaries.length)
        : 0,
      cost_units_per_inserted_recent: avgRecentCost == null ? null : Math.round(avgRecentCost * 10) / 10,
      cost_units_per_inserted_previous: avgPreviousCost == null ? null : Math.round(avgPreviousCost * 10) / 10,
      cost_trend: trendLabel(avgRecentCost, avgPreviousCost),
      today_usd_per_useful_video: todayUseful,
      yesterday_usd_per_useful_video: yesterdayUseful,
      day_cost_trend: trendLabel(todayUseful, yesterdayUseful),
    };

    return NextResponse.json({
      ok: true,
      niches: nicheSummaries,
      totals,
      insights: buildInsights(rows),
      timeline,
      daily_costs: {
        today,
        yesterday,
        rows: dailyRows.slice(-14),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "learning-economics reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
