import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { selectCreativeBriefBrainWithTrust } from "@/lib/factory/reelsBrainCreativeBrief";
import type { ReelsBrainMetricRow } from "@/lib/factory/reelsBrainOperatingSystem";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

type Example = {
  id?: string | number;
  url?: string | null;
  hook?: string | null;
  score?: number;
  views?: number;
};

type Pattern = {
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
  examples?: Example[];
};

type CrossPlatformPattern = Pattern & {
  platforms?: string[];
  platform_count?: number;
  total_frequency?: number;
  avg_strength_score?: number;
};

type AntiPattern = {
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

type TrustDecision = ReturnType<typeof selectCreativeBriefBrainWithTrust>;

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function topExamples(pattern: Pattern, limit = 3) {
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

function score(pattern: Pattern) {
  return Math.round(Math.min(100,
    num(pattern.strength_score)
    + Math.min(20, Math.log(num(pattern.frequency) + 1) * 6)
    + (pattern.quality_label === "generator_ready" ? 12 : 0)
    + Math.min(12, num(pattern.relevance_score) / 8)
    + Math.min(10, num(pattern.quality_score) / 10)
  ));
}

function confidenceGate(pattern: Pattern) {
  const value = score(pattern);
  if (value >= 88) return "high_confidence";
  if (value >= 72) return "medium_confidence";
  return "experimental";
}

function productFit(productType: string, niche: string, pattern: Pattern) {
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

function platformRecipe(platform: string, pattern: Pattern) {
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

function secondBySecond(platform: string, pattern: Pattern) {
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

function visualRecipe(platform: string, pattern: Pattern) {
  const fit = platformRecipe(platform, pattern);
  return [
    `Платформа: ${platform || "mixed"}. Первый кадр: ${fit.firstFrame}.`,
    "Вертикальный 9:16, товар или результат занимают главный фокус.",
    ...fit.editing,
    "Текст только там, где он усиливает promise, proof или payoff.",
  ];
}

function antiCopyWarnings(pattern: Pattern) {
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

function copyMechanics(pattern: Pattern) {
  return [
    `Тип хука: ${text(pattern.hook_label || pattern.hook_type || "сильный хук")}.`,
    `Структура раскрытия: ${text(pattern.structure_label || pattern.structure_type || "демонстрация")}.`,
    `Механика удержания: ${text(pattern.retention_label || pattern.retention_mechanism || "ожидание доказательства")}.`,
    "Порядок доказательства и темп перехода к payoff.",
  ];
}

function rationale(pattern: Pattern, crossPattern: CrossPlatformPattern | null) {
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

function antiPatternWarnings(antiPatterns: AntiPattern[]) {
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

function buildBrief(
  pattern: Pattern,
  niche: string,
  productType: string,
  platform: string,
  crossPattern: CrossPlatformPattern | null,
  antiPatterns: AntiPattern[],
  trustDecision: TrustDecision,
) {
  const productFitNotes = productFit(productType, niche, pattern);
  const examples = topExamples(pattern, 3);
  return {
    source: "reels_brain_best_pattern",
    niche,
    platform: platform || "mixed",
    product_type: productType || "любой товар с визуальным proof",
    pattern_id: pattern.pattern_id || `${pattern.hook_type || "hook"}:${pattern.structure_type || "format"}:${pattern.retention_mechanism || "retention"}`,
    op_score: score(pattern),
    confidence_gate: trustDecision.recommended_mode === "research_only"
      ? "experimental"
      : trustDecision.recommended_mode === "control_only" && confidenceGate(pattern) === "high_confidence"
        ? "medium_confidence"
        : confidenceGate(pattern),
    trust_mode: trustDecision.recommended_mode,
    creative_brief: {
      hook: text(pattern.hook_label || pattern.hook_type || "сильный хук"),
      retention_mechanic: text(pattern.retention_label || pattern.retention_mechanism || "ожидание доказательства"),
      structure: text(pattern.structure_label || pattern.structure_type || "демонстрация"),
      emotion: text(pattern.emotion_label || pattern.emotion || "интерес"),
      viral_logic: text(pattern.viral_logic_label || pattern.viral_logic || ""),
      second_by_second: secondBySecond(platform, pattern),
      visual_recipe: visualRecipe(platform, pattern),
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
      rationale: rationale(pattern, crossPattern),
      anti_pattern_warnings: antiPatternWarnings(antiPatterns),
      trust_decision: {
        selected_scope: trustDecision.selected_scope,
        allow_primary_use: trustDecision.allow_primary_use,
        recommended_mode: trustDecision.recommended_mode,
        score: trustDecision.trust.score,
        status: trustDecision.trust.status,
        confidence: trustDecision.trust.confidence,
        reasons: trustDecision.reasons,
        why_ready: trustDecision.trust.why_ready,
        why_not_yet: trustDecision.trust.why_not_yet,
      },
      cross_platform_support: crossPattern
        ? {
            platforms: Array.isArray(crossPattern.platforms) ? crossPattern.platforms : [],
            platform_count: num(crossPattern.platform_count),
            total_frequency: num(crossPattern.total_frequency),
            avg_strength_score: num(crossPattern.avg_strength_score),
          }
        : null,
    },
    hypotheses: [
      `Если адаптировать этот хук под ${productType || "товар"}, ролик должен быстрее захватывать внимание в первые 2 секунды.`,
      `Если сохранить механику "${text(pattern.retention_label || pattern.retention_mechanism || "удержание")}", досмотр должен быть выше, чем у обычного прямого обзора.`,
      platform
        ? `На платформе ${platform} этот паттерн стоит тестировать в первую очередь как control-вариант.`
        : "Этот паттерн стоит использовать как control-вариант для следующего креативного теста.",
    ],
  };
}

function bestPatternFromList(patterns: Pattern[]) {
  return [...patterns].sort((a, b) => score(b) - score(a))[0] || null;
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const niche = text(req.nextUrl.searchParams.get("niche")) || "ru_toys";
    const productType = text(req.nextUrl.searchParams.get("product_type"));
    const platform = text(req.nextUrl.searchParams.get("platform")).toLowerCase();

    const { data, error } = await db
      .from("niche_playbooks")
      .select("playbook")
      .eq("niche", niche)
      .limit(1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { data: feedbackRows } = await db
      .from("post_metrics")
      .select("recipe_id,platform,views,watch_rate,hook_rate,hold_rate,completion_rate,ctr_card,saves,marketplace_orders,revenue,posted_at,pulled_at")
      .limit(300);

    const playbook = ((data as { playbook?: Record<string, unknown> }[] | null)?.[0]?.playbook || {}) as Record<string, unknown>;
    const root = (playbook.reels_brain_patterns || {}) as Record<string, unknown>;
    const platformBrains = (root.platform_brains || {}) as Record<string, { generator_ready_patterns?: Pattern[]; patterns?: Pattern[]; anti_patterns?: AntiPattern[] }>;
    const crossPlatformPatterns = Array.isArray(root.cross_platform_patterns) ? root.cross_platform_patterns as CrossPlatformPattern[] : [];
    const meta = (root.meta_brain || {}) as { generator_ready_patterns?: Pattern[]; patterns?: Pattern[]; anti_patterns?: AntiPattern[] };
    const trustDecision = selectCreativeBriefBrainWithTrust({ playbook, platform, feedbackRows: ((feedbackRows || []) as ReelsBrainMetricRow[]) });

    const usePlatform = trustDecision.selected_scope === "platform" && platform && platformBrains[platform];
    const platformPatterns = usePlatform
      ? (platformBrains[platform].generator_ready_patterns?.length
        ? platformBrains[platform].generator_ready_patterns
        : platformBrains[platform].patterns) || []
      : [];
    const fallbackPatterns = meta.generator_ready_patterns?.length ? meta.generator_ready_patterns : meta.patterns || [];
    const patterns = platformPatterns.length ? platformPatterns : fallbackPatterns;
    const antiPatterns = usePlatform && platformBrains[platform]?.anti_patterns?.length
      ? platformBrains[platform].anti_patterns || []
      : meta.anti_patterns || [];
    const best = bestPatternFromList(patterns);

    if (!best) {
      return NextResponse.json({ ok: false, error: "Нет готовых паттернов для этой ниши" }, { status: 404 });
    }

    const crossPattern = crossPlatformPatterns.find((item) => text(item.pattern_id) === text(best.pattern_id)) || null;

    return NextResponse.json({
      ok: true,
      selected_pattern: {
        pattern_id: best.pattern_id || null,
        hook_type: best.hook_type || null,
        structure_type: best.structure_type || null,
        retention_mechanism: best.retention_mechanism || null,
        quality_label: best.quality_label || null,
        trust_scope: trustDecision.selected_scope,
      },
      ...buildBrief(best, niche, productType, platform, crossPattern, antiPatterns, trustDecision),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "creative-brief reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
