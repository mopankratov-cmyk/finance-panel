import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { automationRunHistory } from "@/lib/factory/reelsBrainPlaybook";

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
    examples: { url?: string | null; hook?: string | null; score?: number; views?: number }[];
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
    niches: string[];
    examples: { url?: string | null; hook?: string | null; score?: number; views?: number }[];
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
      for (const example of pattern.examples || []) {
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
        niches: [niche],
        examples: (pattern.examples || []).slice(0, 3),
      });
    }
  }

  const top_hooks = Array.from(hookMap.values()).map((row) => {
    const avg_score = row.count ? Math.round(row.avg_score_sum / row.count) : 0;
    const quality_score = row.count ? Math.round(row.quality_score_sum / row.count) : 0;
    const relevance_score = row.count ? Math.round(row.relevance_score_sum / row.count) : 0;
    const op_score = insightScore({ strength_score: avg_score, frequency: row.frequency, quality_score, relevance_score, quality_label: quality_score >= 70 ? "generator_ready" : "needs_cleanup" }, row.niches.size, row.platforms.size);
    return {
      hook_type: row.hook_type,
      hook_label: row.hook_label,
      frequency: row.frequency,
      avg_score,
      quality_score,
      relevance_score,
      op_score,
      status: statusFromScore(op_score),
      niches: Array.from(row.niches).sort(),
      platforms: Array.from(row.platforms).sort(),
      templates: Array.from(row.templates).slice(0, 3),
      examples: row.examples.sort((a, b) => num(b.score) - num(a.score) || num(b.views) - num(a.views)).slice(0, 3),
    };
  }).sort((a, b) => b.op_score - a.op_score || b.frequency - a.frequency).slice(0, 8);

  return {
    summary: [
      top_hooks[0] ? `Самый сильный вход: ${top_hooks[0].hook_label} (${top_hooks[0].op_score}/100).` : "Паттерны хуков пока не найдены.",
      `Generator-ready паттерны уже можно отдавать в контент-завод как рецепты, но примеры исходников лучше держать рядом.`,
      `Технические логи спрятаны ниже: витрина показывает только выводы, уверенность и применение.`,
    ],
    top_hooks,
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
