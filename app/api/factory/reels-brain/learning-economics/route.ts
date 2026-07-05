import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { automationRunHistory } from "@/lib/factory/reelsBrainPlaybook";
import { buildReelsBrainOperatingSystem, type ReelsBrainMetricRow } from "@/lib/factory/reelsBrainOperatingSystem";
import { buildPatternOutcomeLayer } from "@/lib/factory/reelsBrainPatternOutcome";
import { buildGroupedReelsBrainHypothesisBanks, buildReelsBrainHypothesisBank } from "@/lib/factory/reelsBrainHypothesisBank";
import { buildGroupedReelsBrainActionPacks, buildReelsBrainActionPack } from "@/lib/factory/reelsBrainActionPack";
import { buildGroupedReelsBrainBriefPacks, buildReelsBrainBriefPack } from "@/lib/factory/reelsBrainBriefPack";
import { applySegmentTrustToGroups, buildReelsBrainSegmentTrust } from "@/lib/factory/reelsBrainSegmentTrust";
import { buildReelsBrainOpportunities } from "@/lib/factory/reelsBrainOpportunities";
import { buildReelsBrainPatternAtlas } from "@/lib/factory/reelsBrainPatternAtlas";
import { buildReelsBrainSegmentPlaybook } from "@/lib/factory/reelsBrainSegmentPlaybook";
import { buildReelsBrainEvidenceLedger } from "@/lib/factory/reelsBrainEvidenceLedger";
import { buildReelsBrainSegmentDecisionDeck } from "@/lib/factory/reelsBrainSegmentDecisionDeck";
import { buildReelsBrainSegmentPriorityQueue } from "@/lib/factory/reelsBrainSegmentPriorityQueue";
import { buildReelsBrainSegmentGenerationPacks } from "@/lib/factory/reelsBrainSegmentGenerationPacks";
import { buildReelsBrainSegmentCreativeExports } from "@/lib/factory/reelsBrainSegmentCreativeExports";
import { buildReelsBrainSegmentReadinessAudit } from "@/lib/factory/reelsBrainSegmentReadinessAudit";
import { buildReelsBrainSegmentSolutions } from "@/lib/factory/reelsBrainSegmentSolutions";
import { buildReelsBrainSegmentSolutionMatrix } from "@/lib/factory/reelsBrainSegmentSolutionMatrix";
import { buildReelsBrainGenerationPolicy } from "@/lib/factory/reelsBrainGenerationPolicy";
import { buildReelsBrainSegmentStabilityAudit } from "@/lib/factory/reelsBrainSegmentStabilityAudit";
import { buildReelsBrainPortfolioReadiness } from "@/lib/factory/reelsBrainPortfolioReadiness";
import { REELS_BRAIN_CORPUS_TARGET_TOTAL } from "@/lib/factory/reelsBrainCorpusTargets";
import { buildReelsBrainSegmentGapPlanner } from "@/lib/factory/reelsBrainSegmentGapPlanner";
import { loadReelsBrainFeedbackRows } from "@/lib/factory/reelsBrainFeedbackRows";
import { buildReelsBrainOutcomeAntiPatternMemory } from "@/lib/factory/reelsBrainOutcomeAntiPatternMemory";
import { buildReelsBrainPatternOutcomeMemory } from "@/lib/factory/reelsBrainPatternOutcomeMemory";
import { buildReelsBrainMeasurementPlan } from "@/lib/factory/reelsBrainMeasurementPlan";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

function takeRecordList<T>(value: T[] | undefined, limit: number): T[] {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

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
  audio_strategy: string[];
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
  audio_strategy: string[];
  product_fit: string[];
  copy_as_mechanic: string[];
  do_not_copy: string[];
};

type CorpusAuditRow = {
  url?: string | null;
  platform?: string | null;
  niche?: string | null;
  caption?: string | null;
  hook_text?: string | null;
  analyzed?: boolean | null;
  source_orbit_id?: string | null;
  virality_score?: number | null;
  views?: number | null;
  analyzed_full?: unknown;
};

type AudioVisualReadiness = {
  sampled_rows: number;
  with_media_locators: number;
  with_media_locator_rate: number;
  with_audio_features: number;
  with_audio_features_rate: number;
  with_transcript: number;
  with_transcript_rate: number;
  audio_failed: number;
  audio_failed_rate: number;
  ready_for_worker: number;
  ready_for_worker_rate: number;
  by_platform: Record<string, {
    total: number;
    with_media_locators: number;
    with_audio_features: number;
    ready_for_worker: number;
  }>;
  status: "spec_ready" | "media_seeded" | "worker_ready";
  next_step: string;
};

type SegmentAudioVisualReadinessRow = {
  niche: string;
  platform: string;
  total: number;
  total_backlog: number;
  dominant_gap: {
    key: "media" | "audio" | "transcript" | "analyze";
    count: number;
    label: string;
  };
  direct_rate: number;
  audio_rate: number;
  transcript_ready_rate: number;
  analyzed_rate: number;
};

type TaxonomyBrain = {
  classified_videos: number;
  classified_rate: number;
  confident_videos: number;
  confident_rate: number;
  resolved_videos: number;
  resolved_rate: number;
  unresolved_any_videos: number;
  unresolved_any_rate: number;
  unresolved_hook_videos: number;
  unresolved_hook_rate: number;
  unresolved_structure_videos: number;
  unresolved_structure_rate: number;
  custom_hook_labels: string[];
  custom_structure_labels: string[];
  promoted_today: number;
  promoted_yesterday: number;
  estimated_total_spend_usd: number;
  estimated_today_spend_usd: number;
  estimated_yesterday_spend_usd: number;
  estimated_usd_per_classified_video: number;
  trend: "cheaper" | "more_expensive" | "flat" | "not_enough_data";
  top_new_labels: Array<{ kind: "hook" | "structure"; label: string; niche: string; count: number }>;
  pattern_lift: {
    generator_ready_patterns: number;
    high_confidence_patterns: number;
    patterns_with_taxonomy_backing: number;
    patterns_without_taxonomy_backing: number;
    taxonomy_backed_rate: number;
    next_step: string;
  };
  by_niche: Record<string, {
    analyzed_videos: number;
    classified_videos: number;
    confident_videos: number;
    resolved_videos: number;
    unresolved_any_videos: number;
    unresolved_hook_videos: number;
    unresolved_structure_videos: number;
    gray_zone_rate: number;
    custom_hook_labels: number;
    custom_structure_labels: number;
  }>;
  status: "planned" | "bootstrapping" | "learning" | "strong";
  next_step: string;
};

async function loadFeedbackRows(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>): Promise<{ rows: ReelsBrainMetricRow[]; warning: string | null }> {
  return loadReelsBrainFeedbackRows(db as any, 300) as Promise<{ rows: ReelsBrainMetricRow[]; warning: string | null }>;
}

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

function firstPositive(...values: unknown[]): number {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
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

function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readSeed(row: CorpusAuditRow) {
  const analyzedFull = asRecord(row.analyzed_full);
  const reelsSeed = asRecord(analyzedFull?.reels_seed);
  const pipeline = asRecord(reelsSeed?.pipeline);
  const mediaLocators = Array.isArray(reelsSeed?.media_locator_candidates)
    ? reelsSeed.media_locator_candidates.filter((item) => typeof item === "string" && item.trim())
    : [];
  const transcript = typeof reelsSeed?.transcript === "string" ? reelsSeed.transcript.trim() : "";
  const audioFeatures = asRecord(reelsSeed?.audio_features);
  return {
    mediaLocators,
    transcript,
    audioFeatures,
    mediaStatus: String(pipeline?.media_status || "").trim(),
    audioStatus: String(pipeline?.audio_status || "").trim(),
    transcriptStatus: String(pipeline?.transcript_status || "").trim(),
  };
}

function audioFeatureNum(features: Record<string, unknown> | null | undefined, key: string) {
  if (!features) return null;
  return num(features[key]);
}

function firstLongSilence(features: Record<string, unknown> | null | undefined) {
  const segments = Array.isArray(features?.silence_segments) ? features?.silence_segments as Record<string, unknown>[] : [];
  return segments.find((segment) => num(segment?.duration_sec) >= 0.8) || null;
}

function classifyAudioMechanics(row: CorpusAuditRow) {
  const seed = readSeed(row);
  const features = seed.audioFeatures;
  const firstSound = audioFeatureNum(features, "first_sound_sec");
  const meanVolume = audioFeatureNum(features, "mean_volume_db");
  const wordsPerSecond = audioFeatureNum(features, "words_per_second");
  const hasTranscript = seed.transcript.length > 20;
  const mechanics: string[] = [];

  if (firstSound != null && firstSound <= 0.35) mechanics.push("instant_sound_hook");
  if (hasTranscript && firstSound != null && firstSound <= 0.65) mechanics.push("voice_starts_immediately");
  if (hasTranscript && wordsPerSecond != null && wordsPerSecond >= 3.4) mechanics.push("fast_ugc_speech");
  if (hasTranscript && wordsPerSecond != null && wordsPerSecond >= 2 && wordsPerSecond < 3.4) mechanics.push("calm_proof_voice");
  if (meanVolume != null && meanVolume >= -18 && meanVolume <= -10) mechanics.push("balanced_mobile_mix");
  if (!firstLongSilence(features) && firstSound != null && firstSound <= 0.5) mechanics.push("no_dead_intro");
  if (hasTranscript && firstSound != null && firstSound > 0.8) mechanics.push("late_voice_entry");
  if (hasTranscript && wordsPerSecond != null && wordsPerSecond < 1.8) mechanics.push("slow_flat_speech");
  if (firstLongSilence(features)) mechanics.push("pause_before_payoff");
  if (meanVolume != null && meanVolume < -20) mechanics.push("weak_voice_mix");
  if (String(features?.pacing_tier || "") === "fast") mechanics.push("fast_pacing_tier");
  if (String(features?.beat_density_hint || "") === "high") mechanics.push("dense_cut_rhythm");
  if (audioFeatureNum(features, "dead_air_ratio_pct") != null && (audioFeatureNum(features, "dead_air_ratio_pct") || 0) <= 12) mechanics.push("low_dead_air");

  return mechanics;
}

function labelAudioMechanic(key: string) {
  const labels: Record<string, string> = {
    instant_sound_hook: "Звук цепляет сразу",
    voice_starts_immediately: "Голос начинается сразу",
    fast_ugc_speech: "Быстрая UGC-речь",
    calm_proof_voice: "Спокойный proof-voice",
    balanced_mobile_mix: "Нормальный мобильный микс",
    no_dead_intro: "Нет мёртвого вступления",
    late_voice_entry: "Поздний вход голоса",
    slow_flat_speech: "Вялая медленная речь",
    pause_before_payoff: "Пауза перед payoff",
    weak_voice_mix: "Слабый голос в миксе",
    fast_pacing_tier: "Быстрый pacing layer",
    dense_cut_rhythm: "Плотный ритм смен",
    low_dead_air: "Мало пустого воздуха",
  };
  return labels[key] || key;
}

function audioMechanicDirection(key: string) {
  if (["late_voice_entry", "slow_flat_speech", "weak_voice_mix"].includes(key)) return "negative";
  return "positive";
}

function buildAudioBrain(rows: CorpusAuditRow[]) {
  const audioRows = rows.filter((row) => Object.keys(readSeed(row).audioFeatures || {}).length > 0);
  const transcriptRows = audioRows.filter((row) => readSeed(row).transcript.length > 20);
  const total = rows.length;
  const mechanicMap = new Map<string, {
    key: string;
    label: string;
      count: number;
      views: number;
      virality: number;
      niches: Set<string>;
      platforms: Set<string>;
      direction: "positive" | "negative";
    }>();

  for (const row of audioRows) {
    const mechanics = classifyAudioMechanics(row);
    for (const key of mechanics) {
      const bucket = mechanicMap.get(key) || {
        key,
        label: labelAudioMechanic(key),
        count: 0,
        views: 0,
        virality: 0,
        niches: new Set<string>(),
        platforms: new Set<string>(),
        direction: audioMechanicDirection(key),
      };
      bucket.count += 1;
      bucket.views += num(row.views);
      bucket.virality += num(row.virality_score);
      if (row.niche) bucket.niches.add(String(row.niche));
      if (row.platform) bucket.platforms.add(String(row.platform));
      mechanicMap.set(key, bucket);
    }
  }

  const scoredMechanics = Array.from(mechanicMap.values()).map((row) => {
    const avgViews = row.count ? Math.round(row.views / row.count) : 0;
    const avgVirality = row.count ? Math.round((row.virality / row.count) * 10) / 10 : 0;
    const score = Math.round(Math.min(100,
      Math.log(row.count + 1) * 18
      + Math.min(35, avgVirality * 3)
      + Math.min(18, row.platforms.size * 6)
      + Math.min(12, row.niches.size * 4)
      + (row.direction === "negative" ? -18 : 0),
    ));
    const decision = score >= 78 ? "scale" : score >= 58 ? "test" : "watch";
    return {
      key: row.key,
      label: row.label,
      direction: row.direction,
      count: row.count,
      avg_views: avgViews,
      avg_virality: avgVirality,
      score,
      decision,
      decision_label: decision === "scale" ? "Scale" : decision === "test" ? "Test" : "Watch",
      why_it_wins: [
        row.count >= 5 ? `повторяется ${row.count} раз в audio-ready корпусе` : "",
        row.platforms.size >= 2 ? `встречается на ${row.platforms.size} платформах, значит это не локальная аномалия` : "",
        avgVirality >= 12 ? `держится на роликах с хорошей virality ${avgVirality}` : "",
      ].filter(Boolean),
      next_action: decision === "scale"
        ? "Добавлять эту аудио-механику в creative brief по умолчанию."
        : decision === "test"
          ? "Проверить в A/B как обязательное правило для первых секунд."
          : "Собрать больше audio-ready референсов перед масштабированием.",
    };
  }).sort((a, b) => b.score - a.score || b.count - a.count);

  const top_mechanics = scoredMechanics.filter((item) => item.direction === "positive").slice(0, 6);
  const anti_patterns = [
    ...scoredMechanics.filter((item) => item.direction === "negative").map((item) => ({
      key: item.key,
      label: item.label,
      count: item.count,
      reason: item.key === "late_voice_entry"
        ? "Голос слишком поздно включается, и первые секунды теряют хук."
        : item.key === "slow_flat_speech"
          ? "Речь тянется, не держит мобильный темп и снижает ощущение живости."
          : "Смысловой голос слишком слаб в миксе и не тянет доказательство.",
      action: item.key === "late_voice_entry"
        ? "Поднимать voice/sound event в первые 0.3-0.8 секунды."
        : item.key === "slow_flat_speech"
          ? "Ускорять смысловую плотность речи и резать лишние связки."
          : "Делать голос выше и чище в мобильном миксе.",
    })),
    {
      key: "transcript_gap",
      label: "Есть media, но нет расшифровки",
      count: rows.filter((row) => {
        const seed = readSeed(row);
        return seed.mediaLocators.length > 0 && seed.transcript.length <= 20;
      }).length,
      reason: "Без transcript мозг хуже понимает voice logic и speech pacing.",
      action: "Продолжать transcript backfill на RU-корпусе.",
    },
  ].filter((item) => item.count > 0).sort((a, b) => b.count - a.count).slice(0, 4);

  const withAudio = audioRows.length;
  const withTranscript = transcriptRows.length;
  return {
    status: withAudio >= 100 ? "learning" : withAudio > 0 ? "seeded" : "planned",
    with_audio: withAudio,
    with_audio_rate: pct(withAudio, total),
    with_transcript: withTranscript,
    with_transcript_rate: pct(withTranscript, total),
    top_mechanics,
    anti_patterns,
    feature_depth: {
      pause_map_ready: audioRows.filter((row) => audioFeatureNum(readSeed(row).audioFeatures, "pause_count") != null).length,
      pacing_ready: audioRows.filter((row) => String(readSeed(row).audioFeatures?.pacing_tier || "") !== "").length,
      beat_hint_ready: audioRows.filter((row) => String(readSeed(row).audioFeatures?.beat_density_hint || "") !== "").length,
    },
    next_step: withAudio >= 100
      ? "Связывать audio mechanics с hook + structure и усиливать generator payload."
      : withAudio > 0
        ? "Добрать ещё audio-ready видео, чтобы механики стали статистически устойчивыми."
        : "Сначала прогнать audio backfill и transcript слой.",
  };
}

function buildOutcomeMemoryBrain(
  feedbackLoop: ReturnType<typeof buildReelsBrainOperatingSystem>["feedback_loop"],
  patternDetails: Array<Record<string, unknown>>,
) {
  const highConfidencePatterns = patternDetails.filter((row) => String(row.quality_gate || "") === "high_confidence").length;
  const mediumPatterns = patternDetails.filter((row) => String(row.quality_gate || "") === "medium_confidence").length;
  const pattern_memory = buildReelsBrainPatternOutcomeMemory({
    patterns: patternDetails,
    limit: 6,
  });
  return {
    status: feedbackLoop.outcome_schema?.schema_ready
      ? pattern_memory.rows_live > 0
        ? "learning_live"
        : "schema_ready"
      : "planned",
    rows_live: feedbackLoop.total_posts || 0,
    schema: feedbackLoop.outcome_schema || null,
    mapping_ready: {
      recipe_id: true,
      platform: true,
      segment: Boolean(feedbackLoop.segment_outcome_memory?.ready),
      top_funnel: true,
      retention: true,
      commerce: true,
      pattern_signature: true,
    },
    attach_targets: {
      high_confidence_patterns: highConfidencePatterns,
      medium_confidence_patterns: mediumPatterns,
      winner_memory_write: highConfidencePatterns + mediumPatterns > 0 ? "ready" : "waiting_patterns",
    },
    segment_memory: feedbackLoop.segment_outcome_memory || null,
    pattern_memory,
    next_step: feedbackLoop.total_posts
      ? pattern_memory.next_step
      : "Схема готова: как только пойдут публикации, писать outcomes через post-metrics и reels-brain/feedback.",
  };
}

function readTaxonomy(row: CorpusAuditRow) {
  const analyzedFull = asRecord(row.analyzed_full);
  const hookTypeV2 = String(analyzedFull?.hook_type_v2 || "").trim();
  const structureV2 = String(analyzedFull?.structure_v2 || "").trim();
  const confidence = num(analyzedFull?.taxonomy_confidence);
  const updatedAt = String(analyzedFull?.taxonomy_updated_at || "");
  return {
    hookTypeV2,
    structureV2,
    confidence,
    updatedAt,
    classified: Boolean(hookTypeV2 || structureV2),
  };
}

function buildAudioVisualReadiness(rows: CorpusAuditRow[]): AudioVisualReadiness {
  const byPlatform = new Map<string, { total: number; with_media_locators: number; with_audio_features: number; ready_for_worker: number }>();
  let withMediaLocators = 0;
  let withAudioFeatures = 0;
  let withTranscript = 0;
  let audioFailed = 0;
  let readyForWorker = 0;

  for (const row of rows) {
    const platform = String(row.platform || "unknown");
    const bucket = byPlatform.get(platform) || { total: 0, with_media_locators: 0, with_audio_features: 0, ready_for_worker: 0 };
    bucket.total += 1;
    const seed = readSeed(row);
    const hasMediaLocators = seed.mediaLocators.length > 0;
    const hasTranscript = seed.transcript.length > 20;
    const hasAudioFeatures = Object.keys(seed.audioFeatures || {}).length > 0;
    if (hasMediaLocators) {
      withMediaLocators += 1;
      bucket.with_media_locators += 1;
    }
    if (hasAudioFeatures) {
      withAudioFeatures += 1;
      bucket.with_audio_features += 1;
    }
    if (hasTranscript) withTranscript += 1;
    if (seed.audioStatus === "audio_failed") audioFailed += 1;
    if (hasMediaLocators && hasAudioFeatures && row.analyzed) {
      readyForWorker += 1;
      bucket.ready_for_worker += 1;
    }
    byPlatform.set(platform, bucket);
  }

  const sampledRows = rows.length;
  const readyRate = pct(readyForWorker, sampledRows);
  return {
    sampled_rows: sampledRows,
    with_media_locators: withMediaLocators,
    with_media_locator_rate: pct(withMediaLocators, sampledRows),
    with_audio_features: withAudioFeatures,
    with_audio_features_rate: pct(withAudioFeatures, sampledRows),
    with_transcript: withTranscript,
    with_transcript_rate: pct(withTranscript, sampledRows),
    audio_failed: audioFailed,
    audio_failed_rate: pct(audioFailed, sampledRows),
    ready_for_worker: readyForWorker,
    ready_for_worker_rate: readyRate,
    by_platform: Object.fromEntries(Array.from(byPlatform.entries()).map(([platform, bucket]) => [platform, bucket])),
    status: readyForWorker >= 100 ? "worker_ready" : withMediaLocators > 0 ? "media_seeded" : "spec_ready",
    next_step: readyForWorker >= 100
      ? `Оффлайн-воркер можно грузить глубже: уже готово ${readyForWorker} видео с media locators и базовым seed.`
      : withAudioFeatures > 0
        ? `Audio extraction уже пошёл. Добрать ещё ${Math.max(0, 100 - readyForWorker)}+ разобранных видео с audio features и transcript-ready слоем.`
      : withMediaLocators > 0
        ? `Media locators уже пишутся. Добрать и разметить ещё ${Math.max(0, 100 - readyForWorker)}+ видео, затем включить audio/deep extraction.`
        : "Сначала накопить media locators в ingest metadata, затем запускать audio/deep extraction.",
  };
}

function buildSegmentAudioVisualReadiness(rows: CorpusAuditRow[]): SegmentAudioVisualReadinessRow[] {
  const buckets = new Map<string, {
    niche: string;
    platform: string;
    total: number;
    with_direct_media: number;
    audio_extracted: number;
    transcript_ready: number;
    analyzed: number;
    media_backlog: number;
    audio_backlog: number;
    transcript_backlog: number;
    analyze_backlog: number;
  }>();

  for (const row of rows) {
    const niche = String(row.niche || "unknown").trim() || "unknown";
    const platform = String(row.platform || "unknown").trim() || "unknown";
    const key = `${niche}__${platform}`;
    const current = buckets.get(key) || {
      niche,
      platform,
      total: 0,
      with_direct_media: 0,
      audio_extracted: 0,
      transcript_ready: 0,
      analyzed: 0,
      media_backlog: 0,
      audio_backlog: 0,
      transcript_backlog: 0,
      analyze_backlog: 0,
    };
    const seed = readSeed(row);
    const mediaReady = seed.mediaLocators.length > 0 || seed.mediaStatus === "media_downloaded";
    current.total += 1;
    if (mediaReady) current.with_direct_media += 1;
    if (seed.audioStatus === "audio_extracted") current.audio_extracted += 1;
    if (seed.transcript.length > 20 || seed.transcriptStatus === "transcript_ready") current.transcript_ready += 1;
    if (row.analyzed) current.analyzed += 1;
    if (!mediaReady) current.media_backlog += 1;
    if (mediaReady && seed.audioStatus !== "audio_extracted") current.audio_backlog += 1;
    if (seed.audioStatus === "audio_extracted" && seed.transcriptStatus !== "transcript_ready") current.transcript_backlog += 1;
    if (!row.analyzed) current.analyze_backlog += 1;
    buckets.set(key, current);
  }

  return Array.from(buckets.values())
    .map((row) => {
      const dominant_gap = [
        { key: "media" as const, count: row.media_backlog, label: "media" },
        { key: "audio" as const, count: row.audio_backlog, label: "audio" },
        { key: "transcript" as const, count: row.transcript_backlog, label: "transcript" },
        { key: "analyze" as const, count: row.analyze_backlog, label: "analyze" },
      ].sort((a, b) => b.count - a.count)[0];
      return {
        niche: row.niche,
        platform: row.platform,
        total: row.total,
        total_backlog: row.media_backlog + row.audio_backlog + row.transcript_backlog + row.analyze_backlog,
        dominant_gap,
        direct_rate: pct(row.with_direct_media, row.total),
        audio_rate: pct(row.audio_extracted, row.total),
        transcript_ready_rate: pct(row.transcript_ready, row.total),
        analyzed_rate: pct(row.analyzed, row.total),
      };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) =>
      b.total_backlog - a.total_backlog
      || a.direct_rate - b.direct_rate
      || a.audio_rate - b.audio_rate
      || a.transcript_ready_rate - b.transcript_ready_rate
      || a.niche.localeCompare(b.niche)
      || a.platform.localeCompare(b.platform),
    );
}

function buildTaxonomyBrain(input: {
  corpusSample: CorpusAuditRow[];
  recentSample: CorpusAuditRow[];
  playbooks: { niche?: string; playbook?: unknown }[];
}): TaxonomyBrain {
  const estimatedUsdPerVideoRaw = Number(process.env.REELS_BRAIN_TAXONOMY_USD_PER_VIDEO || 0.0008);
  const estimatedUsdPerVideo = Number.isFinite(estimatedUsdPerVideoRaw) && estimatedUsdPerVideoRaw > 0 ? estimatedUsdPerVideoRaw : 0.0008;
  let classifiedVideos = 0;
  let confidentVideos = 0;
  let analyzedVideos = 0;
  let resolvedVideos = 0;
  let unresolvedAnyVideos = 0;
  let unresolvedHookVideos = 0;
  let unresolvedStructureVideos = 0;
  let promotedToday = 0;
  let promotedYesterday = 0;
  let todayClassified = 0;
  let yesterdayClassified = 0;
  const byNiche = new Map<string, {
    analyzed_videos: number;
    classified_videos: number;
    confident_videos: number;
    resolved_videos: number;
    unresolved_any_videos: number;
    unresolved_hook_videos: number;
    unresolved_structure_videos: number;
    custom_hook_labels: number;
    custom_structure_labels: number;
  }>();
  const labelRows: Array<{ kind: "hook" | "structure"; label: string; niche: string; count: number }> = [];
  const todayKey = dayKey(new Date().toISOString());
  const yesterdayKey = dayKey(new Date().toISOString(), -1);

  for (const row of input.corpusSample) {
    const niche = String(row.niche || "").trim() || "unknown";
    const currentNiche = byNiche.get(niche) || {
      analyzed_videos: 0,
      classified_videos: 0,
      confident_videos: 0,
      resolved_videos: 0,
      unresolved_any_videos: 0,
      unresolved_hook_videos: 0,
      unresolved_structure_videos: 0,
      custom_hook_labels: 0,
      custom_structure_labels: 0,
    };
    if (row.analyzed) analyzedVideos += 1;
    if (row.analyzed) currentNiche.analyzed_videos += 1;
    const taxonomy = readTaxonomy(row);
    const unresolvedHook = !taxonomy.hookTypeV2 || taxonomy.hookTypeV2 === "direct_claim" || taxonomy.hookTypeV2 === "unknown";
    const unresolvedStructure = !taxonomy.structureV2 || taxonomy.structureV2 === "unknown_structure";
    const unresolvedAny = unresolvedHook || unresolvedStructure;
    if (unresolvedAny) {
      unresolvedAnyVideos += 1;
      currentNiche.unresolved_any_videos += 1;
    }
    if (unresolvedHook) {
      unresolvedHookVideos += 1;
      currentNiche.unresolved_hook_videos += 1;
    }
    if (unresolvedStructure) {
      unresolvedStructureVideos += 1;
      currentNiche.unresolved_structure_videos += 1;
    }
    if (taxonomy.classified) {
      classifiedVideos += 1;
      currentNiche.classified_videos += 1;
      if (!unresolvedAny) {
        resolvedVideos += 1;
        currentNiche.resolved_videos += 1;
      }
      if (taxonomy.confidence >= 0.75) {
        confidentVideos += 1;
        currentNiche.confident_videos += 1;
      }
    }
    byNiche.set(niche, currentNiche);
  }

  for (const row of input.recentSample) {
    const taxonomy = readTaxonomy(row);
    if (!taxonomy.classified || !taxonomy.updatedAt) continue;
    const key = dayKey(taxonomy.updatedAt);
    if (key === todayKey) todayClassified += 1;
    if (key === yesterdayKey) yesterdayClassified += 1;
  }

  for (const row of input.playbooks) {
    const niche = String(row.niche || "").trim();
    if (!niche) continue;
    const playbook = asRecord(row.playbook) || {};
    const taxonomy = asRecord(playbook.reels_brain_taxonomy) || {};
    const hookLabels = Array.isArray(taxonomy.custom_hook_labels) ? taxonomy.custom_hook_labels.map((item) => String(item || "").trim()).filter(Boolean) : [];
    const structureLabels = Array.isArray(taxonomy.custom_structure_labels) ? taxonomy.custom_structure_labels.map((item) => String(item || "").trim()).filter(Boolean) : [];
    const hookCounts = asRecord(asRecord(taxonomy.other_label_counts)?.hooks) || {};
    const structureCounts = asRecord(asRecord(taxonomy.other_label_counts)?.structures) || {};
    const taxonomyUpdatedAt = String(taxonomy.taxonomy_updated_at || "");
    if (dayKey(taxonomyUpdatedAt) === todayKey) promotedToday += hookLabels.length + structureLabels.length;
    if (dayKey(taxonomyUpdatedAt) === yesterdayKey) promotedYesterday += hookLabels.length + structureLabels.length;
    const existing = byNiche.get(niche) || {
      analyzed_videos: 0,
      classified_videos: 0,
      confident_videos: 0,
      resolved_videos: 0,
      unresolved_any_videos: 0,
      unresolved_hook_videos: 0,
      unresolved_structure_videos: 0,
      custom_hook_labels: 0,
      custom_structure_labels: 0,
    };
    byNiche.set(niche, {
      ...existing,
      custom_hook_labels: hookLabels.length,
      custom_structure_labels: structureLabels.length,
    });
    for (const label of hookLabels) {
      labelRows.push({ kind: "hook", label, niche, count: num(hookCounts[label]) });
    }
    for (const label of structureLabels) {
      labelRows.push({ kind: "structure", label, niche, count: num(structureCounts[label]) });
    }
  }

  const totalPromoted = labelRows.length;
  const estimatedTodaySpend = Math.round(todayClassified * estimatedUsdPerVideo * 10000) / 10000;
  const estimatedYesterdaySpend = Math.round(yesterdayClassified * estimatedUsdPerVideo * 10000) / 10000;
  const estimatedTotalSpend = Math.round(classifiedVideos * estimatedUsdPerVideo * 10000) / 10000;

  return {
    classified_videos: classifiedVideos,
    classified_rate: pct(classifiedVideos, analyzedVideos),
    confident_videos: confidentVideos,
    confident_rate: pct(confidentVideos, classifiedVideos),
    resolved_videos: resolvedVideos,
    resolved_rate: pct(resolvedVideos, analyzedVideos),
    unresolved_any_videos: unresolvedAnyVideos,
    unresolved_any_rate: pct(unresolvedAnyVideos, analyzedVideos),
    unresolved_hook_videos: unresolvedHookVideos,
    unresolved_hook_rate: pct(unresolvedHookVideos, analyzedVideos),
    unresolved_structure_videos: unresolvedStructureVideos,
    unresolved_structure_rate: pct(unresolvedStructureVideos, analyzedVideos),
    custom_hook_labels: Array.from(new Set(labelRows.filter((row) => row.kind === "hook").map((row) => row.label))).sort(),
    custom_structure_labels: Array.from(new Set(labelRows.filter((row) => row.kind === "structure").map((row) => row.label))).sort(),
    promoted_today: promotedToday,
    promoted_yesterday: promotedYesterday,
    estimated_total_spend_usd: estimatedTotalSpend,
    estimated_today_spend_usd: estimatedTodaySpend,
    estimated_yesterday_spend_usd: estimatedYesterdaySpend,
    estimated_usd_per_classified_video: estimatedUsdPerVideo,
    trend: trendLabel(estimatedTodaySpend || null, estimatedYesterdaySpend || null),
    top_new_labels: labelRows
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 8),
    pattern_lift: {
      generator_ready_patterns: 0,
      high_confidence_patterns: 0,
      patterns_with_taxonomy_backing: 0,
      patterns_without_taxonomy_backing: 0,
      taxonomy_backed_rate: 0,
      next_step: "Сначала связать taxonomy со слоем generator-ready паттернов.",
    },
    by_niche: Object.fromEntries(Array.from(byNiche.entries()).map(([niche, value]) => [
      niche,
      {
        ...value,
        gray_zone_rate: pct(value.unresolved_any_videos, value.analyzed_videos),
      },
    ])),
    status: classifiedVideos >= 500 ? "strong" : classifiedVideos >= 150 ? "learning" : classifiedVideos > 0 ? "bootstrapping" : "planned",
    next_step: classifiedVideos >= 500
      ? "Taxonomy уже достаточно широкая: можно жёстче использовать v2-классы в insight-витрине и discovery ranking."
      : classifiedVideos > 0
        ? "Наращивать nightly taxonomy-refresh, пока direct_claim и unknown_structure не станут редким исключением."
        : "Сначала запустить taxonomy-refresh на analyzed корпусе, потом пересобрать pattern memory.",
  };
}

function buildTaxonomyPatternLift(
  taxonomyBrain: TaxonomyBrain,
  patternDecisionLayer: ReturnType<typeof buildPatternDecisionLayer>,
  corpusSample: CorpusAuditRow[],
) {
  const byUrl = new Map<string, ReturnType<typeof readTaxonomy>>();
  for (const row of corpusSample) {
    const url = String(row.url || "").trim();
    if (!url) continue;
    byUrl.set(url, readTaxonomy(row));
  }
  const patterns = patternDecisionLayer.pattern_details || [];
  const generatorReady = patterns.filter((row) => row.quality_gate === "high_confidence" || row.quality_gate === "medium_confidence");
  const highConfidence = patterns.filter((row) => row.quality_gate === "high_confidence");
  const backed = generatorReady.filter((row) => {
    const references = Array.isArray(row.source_references) ? row.source_references : [];
    return references.some((ref) => {
      const url = String((ref as Record<string, unknown>)?.url || "").trim();
      const tax = byUrl.get(url);
      if (!tax) return false;
      const unresolvedHook = !tax.hookTypeV2 || tax.hookTypeV2 === "direct_claim" || tax.hookTypeV2 === "unknown";
      const unresolvedStructure = !tax.structureV2 || tax.structureV2 === "unknown_structure";
      return tax.classified && !unresolvedHook && !unresolvedStructure;
    });
  });
  const unbacked = Math.max(0, generatorReady.length - backed.length);
  return {
    ...taxonomyBrain,
    pattern_lift: {
      generator_ready_patterns: generatorReady.length,
      high_confidence_patterns: highConfidence.length,
      patterns_with_taxonomy_backing: backed.length,
      patterns_without_taxonomy_backing: unbacked,
      taxonomy_backed_rate: pct(backed.length, generatorReady.length),
      next_step: backed.length >= Math.max(3, Math.ceil(generatorReady.length * 0.5))
        ? "Generator-ready слой уже заметно опирается на очищенные taxonomy-references."
        : "Нужно дальше вычищать gray zone, чтобы больше generator-ready паттернов опирались на явно классифицированные референсы.",
    },
  };
}

function buildCorpusAudit(rows: CorpusAuditRow[]) {
  const total = rows.length;
  const urlMap = new Map<string, number>();
  const byPlatform: Record<string, { total: number; analyzed: number; ru: number; avg_score_sum: number; avg_score_count: number }> = {};
  const byNiche: Record<string, { total: number; analyzed: number; ru: number; avg_score_sum: number; avg_score_count: number }> = {};
  let analyzed = 0;
  let ruLikely = 0;
  let withHook = 0;
  let withSource = 0;
  let lowSignal = 0;
  let missingCaption = 0;

  for (const row of rows) {
    const url = String(row.url || "").trim();
    if (url) urlMap.set(url, (urlMap.get(url) || 0) + 1);
    const platform = String(row.platform || "unknown");
    const niche = String(row.niche || "unknown");
    byPlatform[platform] ||= { total: 0, analyzed: 0, ru: 0, avg_score_sum: 0, avg_score_count: 0 };
    byNiche[niche] ||= { total: 0, analyzed: 0, ru: 0, avg_score_sum: 0, avg_score_count: 0 };
    const text = [row.caption, row.hook_text].filter(Boolean).join(" ");
    const isRu = /[а-яё]/i.test(text);
    const score = num(row.virality_score);
    const hasHook = String(row.hook_text || "").trim().length > 4;
    const hasCaption = String(row.caption || "").trim().length > 8;
    if (row.analyzed) analyzed += 1;
    if (isRu) ruLikely += 1;
    if (hasHook) withHook += 1;
    if (row.source_orbit_id) withSource += 1;
    if (!hasHook && !hasCaption) lowSignal += 1;
    if (!hasCaption) missingCaption += 1;
    for (const bucket of [byPlatform[platform], byNiche[niche]]) {
      bucket.total += 1;
      if (row.analyzed) bucket.analyzed += 1;
      if (isRu) bucket.ru += 1;
      if (score > 0) {
        bucket.avg_score_sum += score;
        bucket.avg_score_count += 1;
      }
    }
  }

  const duplicateUrls = Array.from(urlMap.values()).filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0);
  const normalizeBuckets = (input: typeof byPlatform) => Object.fromEntries(Object.entries(input).map(([key, value]) => [
    key,
    {
      total: value.total,
      analyzed: value.analyzed,
      analyzed_rate: pct(value.analyzed, value.total),
      ru_likely: value.ru,
      ru_likely_rate: pct(value.ru, value.total),
      avg_score: value.avg_score_count ? Math.round((value.avg_score_sum / value.avg_score_count) * 10) / 10 : 0,
    },
  ]));

  const qualityScore = Math.max(0, Math.min(100, Math.round(
    pct(analyzed, total) * 0.35
    + pct(ruLikely, total) * 0.25
    + pct(withHook, total) * 0.2
    + pct(withSource, total) * 0.1
    + Math.max(0, 100 - pct(duplicateUrls, total)) * 0.1
  )));

  return {
    sampled_rows: total,
    analyzed,
    analyzed_rate: pct(analyzed, total),
    ru_likely: ruLikely,
    ru_likely_rate: pct(ruLikely, total),
    with_hook: withHook,
    with_hook_rate: pct(withHook, total),
    with_source: withSource,
    with_source_rate: pct(withSource, total),
    duplicate_urls: duplicateUrls,
    duplicate_rate: pct(duplicateUrls, total),
    low_signal_rows: lowSignal,
    low_signal_rate: pct(lowSignal, total),
    missing_caption: missingCaption,
    missing_caption_rate: pct(missingCaption, total),
    quality_score: qualityScore,
    by_platform: normalizeBuckets(byPlatform),
    by_niche: normalizeBuckets(byNiche),
    verdict: qualityScore >= 78 ? "good" : qualityScore >= 55 ? "watch" : "needs_cleanup",
  };
}

function buildAudioCombinationLayer(rows: CorpusAuditRow[], combinations: Array<Record<string, unknown>>) {
  const byUrl = new Map<string, CorpusAuditRow>();
  for (const row of rows) {
    const url = String(row.url || "").trim();
    if (url) byUrl.set(url, row);
  }

  return combinations.map((combo) => {
    const references = Array.isArray(combo.examples) ? combo.examples as Record<string, unknown>[] : [];
    const mechanicCounts = new Map<string, number>();
    for (const ref of references) {
      const row = byUrl.get(String(ref.url || "").trim());
      if (!row) continue;
      for (const key of classifyAudioMechanics(row)) {
        if (audioMechanicDirection(key) === "negative") continue;
        mechanicCounts.set(key, (mechanicCounts.get(key) || 0) + 1);
      }
    }
    const topAudio = Array.from(mechanicCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 2)
      .map(([key, count]) => ({
        key,
        label: labelAudioMechanic(key),
        count,
      }));
    const audioLogic = topAudio.map((item) => item.label);
    return {
      ...combo,
      audio_logic: audioLogic,
      audio_summary: topAudio.length
        ? `По звуку эту связку чаще всего тянут: ${topAudio.map((item) => item.label).join(" + ")}.`
        : "По звуку у этой связки пока мало подтвержденных audio-ready референсов.",
      next_action: topAudio.length && combo.decision === "scale_now"
        ? `${String(combo.next_action || "").trim()} В звуке держать: ${topAudio.map((item) => item.label.toLowerCase()).join(", ")}.`
        : combo.next_action,
    };
  });
}

function buildAntiPatternBrain(
  audit: ReturnType<typeof buildCorpusAudit>,
  insightPayload: ReturnType<typeof buildInsights>,
  audioBrain?: ReturnType<typeof buildAudioBrain>,
  feedbackLoop?: ReturnType<typeof buildReelsBrainOperatingSystem>["feedback_loop"],
  patternDecisionLayer?: { pattern_details?: Array<Record<string, unknown>> },
) {
  const weakHooks = (insightPayload.top_hooks || []).filter((hook) => hook.confidence === "low" || hook.op_score < 60).slice(0, 4);
  const weakFormats = (insightPayload.winning_formats || []).filter((format) => num(format.avg_score) < 55).slice(0, 4);
  const outcomeWriteback = buildReelsBrainOutcomeAntiPatternMemory({
    feedbackLoop: feedbackLoop || null,
    patternOutcomeMemory: (feedbackLoop && patternDecisionLayer)
      ? buildReelsBrainPatternOutcomeMemory({ patterns: patternDecisionLayer.pattern_details as Record<string, unknown>[], limit: 4 })
      : null,
    limit: 4,
  });
  const rows = [
    audit.duplicate_rate > 2 ? {
      code: "duplicate_source_waste",
      label: "Дубли в корпусе",
      evidence: `${audit.duplicate_rate}% дублей в sampled corpus`,
      action: "Перед покупкой новых видео усиливать dedupe по URL/source id.",
      severity: audit.duplicate_rate > 8 ? "high" : "medium",
    } : null,
    audit.ru_likely_rate < 80 ? {
      code: "not_ru_enough",
      label: "Недостаточно русского сегмента",
      evidence: `${audit.ru_likely_rate}% строк выглядят русскоязычными`,
      action: "Discovery должен повышать вес RU-запросов, русских аккаунтов и кириллических captions.",
      severity: audit.ru_likely_rate < 60 ? "high" : "medium",
    } : null,
    audit.low_signal_rate > 8 ? {
      code: "low_signal_rows",
      label: "Мало текста/хука для анализа",
      evidence: `${audit.low_signal_rate}% строк без нормального caption/hook`,
      action: "Не покупать похожие источники без caption/meta, либо помечать как video-only анализ.",
      severity: audit.low_signal_rate > 18 ? "high" : "medium",
    } : null,
    ...weakHooks.map((hook) => ({
      code: `weak_hook_${hook.hook_type}`,
      label: `Слабый/сырой хук: ${hook.hook_label}`,
      evidence: `OP ${hook.op_score}, confidence ${hook.confidence}, freq ${hook.frequency}`,
      action: "Не использовать как базовый сценарий; держать только как эксперимент.",
      severity: hook.op_score < 45 ? "high" : "medium",
    })),
    ...weakFormats.map((format) => ({
      code: `weak_format_${format.label}`,
      label: `Слабый формат: ${format.label}`,
      evidence: `avg score ${format.avg_score}, freq ${format.frequency}`,
      action: "Не масштабировать формат без A/B теста и сильного hook rewrite.",
      severity: num(format.avg_score) < 40 ? "high" : "medium",
    })),
    ...((audioBrain?.anti_patterns || []).slice(0, 3).map((item) => ({
      code: `audio_${item.key}`,
      label: `Audio-риск: ${item.label}`,
      evidence: `${item.count} кейсов · ${item.reason}`,
      action: item.action,
      severity: item.count >= 20 ? "high" : "medium",
    }))),
    ...outcomeWriteback.items,
  ].filter(Boolean);
  return {
    count: rows.length,
    items: rows.slice(0, 10),
    outcome_writeback: outcomeWriteback,
    summary: rows.length
      ? "Anti-pattern слой уже видит, где мозг тратит насмотренность или рискует генерировать слабые механики."
      : "Критичных anti-pattern сигналов в текущем срезе не найдено.",
  };
}

function buildDiscoveryBrain(sourceMap: ReturnType<typeof buildInsights>["source_map"], audit: ReturnType<typeof buildCorpusAudit>) {
  const ranked = (sourceMap || []).map((source) => {
    const analyzed = num(source.analyzed);
    const inserted = num(source.inserted);
    const errors = num(source.errors);
    const cost = firstPositive(source.cost_per_analyzed, source.cost_per_inserted, source.estimated_spend_usd);
    const yieldScore = Math.max(0, Math.round(
      Math.min(45, analyzed / 20)
      + Math.min(25, inserted / 20)
      + Math.max(0, 20 - errors * 2)
      + Math.max(0, 10 - cost * 100)
    ));
    return {
      ...source,
      discovery_score: yieldScore,
      decision: yieldScore >= 65 ? "scale" : yieldScore >= 38 ? "watch" : "limit",
      reason: yieldScore >= 65
        ? "даёт полезную насмотренность дешевле среднего"
        : yieldScore >= 38
          ? "можно тестировать, но не масштабировать без bake-off"
          : "ограничить, пока не появится доказанный yield",
    };
  }).sort((a, b) => b.discovery_score - a.discovery_score);
  return {
    ru_focus: audit.ru_likely_rate >= 80 ? "healthy" : "increase_ru_weight",
    next_policy: audit.ru_likely_rate >= 80
      ? "Сохранять RU-фокус и добирать маленькие залётные аккаунты в сильных нишах."
      : "Повысить вес русскоязычных queries/accounts и резать источники без кириллицы.",
    providers: ranked.slice(0, 8),
    suppress_rules: [
      "резать источник, если 2 прогона подряд дают low_signal > 20%",
      "понижать запрос, если relevant/inserted ниже 15%",
      "не масштабировать платформу без хотя бы medium confidence паттернов",
    ],
  };
}

function qualityGateForRecipe(recipe: {
  id: string;
  op_score: number;
  confidence: "high" | "medium" | "low";
  examples: InsightExample[];
  niches: string[];
}) {
  const evidence = recipe.examples?.length || 0;
  const nicheCount = recipe.niches?.length || 0;
  if (recipe.op_score >= 85 && recipe.confidence === "high" && evidence >= 1) return "high_confidence" as const;
  if (recipe.op_score >= 70 && recipe.confidence !== "low") return "medium_confidence" as const;
  if (recipe.op_score >= 55) return "experimental" as const;
  if (evidence === 0 || nicheCount === 0) return "noise" as const;
  return "banned" as const;
}

function buildPatternDecisionLayer(insightPayload: ReturnType<typeof buildInsights>) {
  const pattern_details = (insightPayload.recipes || []).map((recipe) => {
    const gate = qualityGateForRecipe(recipe);
    return {
      id: recipe.id,
      title: recipe.title,
      hook_type: recipe.hook_type,
      hook: recipe.hook,
      structure_type: recipe.structure_type,
      format: recipe.format,
      retention: recipe.retention,
      op_score: recipe.op_score,
      confidence: recipe.confidence,
      quality_gate: gate,
      niches: recipe.niches,
      platforms: recipe.platforms,
      examples_count: recipe.examples?.length || 0,
      creative_brief: recipe.creative_brief,
      generator_payload: recipe.generator_payload,
      warnings: [
        gate === "experimental" ? "Только A/B тест, не масштабировать без факта." : "",
        gate === "noise" ? "Мало доказательности: не отдавать в генератор." : "",
        recipe.confidence === "low" ? "Низкая уверенность по данным." : "",
      ].filter(Boolean),
      source_references: (recipe.examples || []).slice(0, 3),
    };
  });
  const quality_gate = {
    high_confidence: pattern_details.filter((row) => row.quality_gate === "high_confidence").length,
    medium_confidence: pattern_details.filter((row) => row.quality_gate === "medium_confidence").length,
    experimental: pattern_details.filter((row) => row.quality_gate === "experimental").length,
    noise: pattern_details.filter((row) => row.quality_gate === "noise").length,
    banned: pattern_details.filter((row) => row.quality_gate === "banned").length,
    rules: [
      "high: OP >= 85 + high confidence + есть source reference",
      "medium: OP >= 70 и confidence не low",
      "experimental: можно тестировать, но не масштабировать",
      "noise/banned: не отдавать в генератор",
    ],
  };
  return { pattern_details, quality_gate };
}

function outcomeAdjustedGate(baseGate: string, outcomeStatus: string) {
  if (outcomeStatus === "weak") {
    if (baseGate === "high_confidence") return "medium_confidence";
    if (baseGate === "medium_confidence") return "experimental";
    return baseGate;
  }
  if (outcomeStatus === "proven" && baseGate === "experimental") return "medium_confidence";
  return baseGate;
}

function patternDecisionPriority(input: {
  opScore: number;
  effectiveGate: string;
  outcomeStatus: string;
  finalDecision: string;
  confidence: string;
}) {
  const gateBoost = input.effectiveGate === "high_confidence"
    ? 16
    : input.effectiveGate === "medium_confidence"
      ? 10
      : input.effectiveGate === "experimental"
        ? 4
        : 0;
  const outcomeBoost = input.outcomeStatus === "proven"
    ? 18
    : input.outcomeStatus === "promising"
      ? 8
      : input.outcomeStatus === "weak"
        ? -18
        : 0;
  const decisionBoost = input.finalDecision === "scale"
    ? 14
    : input.finalDecision === "control"
      ? 6
      : -6;
  const confidenceBoost = input.confidence === "high"
    ? 8
    : input.confidence === "medium"
      ? 4
      : 0;
  return Math.max(0, Math.min(100, Math.round(input.opScore + gateBoost + outcomeBoost + decisionBoost + confidenceBoost)));
}

function attachPatternOutcomes(
  patternDecisionLayer: ReturnType<typeof buildPatternDecisionLayer>,
  feedbackRows: ReelsBrainMetricRow[],
) {
  const outcomeRows = buildPatternOutcomeLayer(
    patternDecisionLayer.pattern_details.map((row) => ({
      id: row.id,
      title: row.title,
      hook_type: typeof (row as Record<string, unknown>).hook_type === "string" ? (row as Record<string, unknown>).hook_type as string : "",
      quality_gate: row.quality_gate,
      confidence: row.confidence,
      niches: Array.isArray((row as Record<string, unknown>).niches) ? (row as Record<string, unknown>).niches as string[] : [],
      structure_type: typeof (row as Record<string, unknown>).structure_type === "string" ? (row as Record<string, unknown>).structure_type as string : "",
      platforms: Array.isArray((row as Record<string, unknown>).platforms) ? (row as Record<string, unknown>).platforms as string[] : [],
    })),
    feedbackRows,
  );
  const outcomeById = new Map(outcomeRows.map((row) => [row.pattern_id, row]));
  const pattern_details = patternDecisionLayer.pattern_details.map((row) => {
    const outcome = outcomeById.get(row.id) || null;
    const effectiveGate = outcomeAdjustedGate(
      String(row.quality_gate || ""),
      String(outcome?.status || "no_feedback"),
    );
    const finalDecision = outcome?.final_decision || (row.quality_gate === "high_confidence" ? "control" : "watch");
    const priority = patternDecisionPriority({
      opScore: Number(row.op_score || 0),
      effectiveGate,
      outcomeStatus: String(outcome?.status || "no_feedback"),
      finalDecision,
      confidence: String(outcome?.confidence || row.confidence || "low"),
    });
    return {
      ...row,
      market_signal: outcome,
      final_decision: finalDecision,
      effective_quality_gate: effectiveGate,
      decision_priority_score: priority,
      outcome_writeback: {
        outcome_status: outcome?.status || "no_feedback",
        quality_gate_override: effectiveGate !== row.quality_gate ? effectiveGate : null,
        final_decision: finalDecision,
        trust_write: outcome?.status === "proven"
          ? "promote_pattern_priority"
          : outcome?.status === "weak"
            ? "degrade_pattern_priority"
            : outcome?.status === "promising"
              ? "keep_validating_pattern"
              : "wait_for_feedback",
      },
      warnings: [
        ...(row.warnings || []),
        outcome?.status === "weak" ? "Рынок пока не подтверждает этот паттерн: держать в watch." : "",
        outcome?.status === "proven" ? "Есть market confirmation: паттерн можно поднимать выше." : "",
      ].filter(Boolean),
    };
  }).sort((a, b) =>
    Number((b as Record<string, unknown>).decision_priority_score || 0) - Number((a as Record<string, unknown>).decision_priority_score || 0)
    || Number(b.op_score || 0) - Number(a.op_score || 0)
    || String(a.title || "").localeCompare(String(b.title || "")),
  );
  return {
    ...patternDecisionLayer,
    pattern_details,
    outcome_summary: {
      proven: outcomeRows.filter((row) => row.status === "proven").length,
      promising: outcomeRows.filter((row) => row.status === "promising").length,
      weak: outcomeRows.filter((row) => row.status === "weak").length,
      no_feedback: outcomeRows.filter((row) => row.status === "no_feedback").length,
      scale: outcomeRows.filter((row) => row.final_decision === "scale").length,
      control: outcomeRows.filter((row) => row.final_decision === "control").length,
      watch: outcomeRows.filter((row) => row.final_decision === "watch").length,
    },
  };
}

function buildNicheComparison(niches: {
  niche: string;
  total_videos: number;
  analyzed_videos: number;
  patterns: number;
  generator_ready_patterns: number;
  cross_platform_patterns: number;
  understanding_score: number;
}[], insightPayload: ReturnType<typeof buildInsights>) {
  return niches.map((niche) => {
    const hooks = (insightPayload.top_hooks || []).filter((hook) => hook.niches?.includes(niche.niche)).slice(0, 3);
    const formats = (insightPayload.winning_formats || []).filter((format) => format.niches?.includes(niche.niche)).slice(0, 3);
    return {
      niche: niche.niche,
      total_videos: niche.total_videos,
      analyzed_videos: niche.analyzed_videos,
      understanding_score: niche.understanding_score,
      generator_ready_patterns: niche.generator_ready_patterns,
      top_hooks: hooks.map((hook) => ({ label: hook.hook_label, op_score: hook.op_score, confidence: hook.confidence })),
      top_formats: formats.map((format) => ({ label: format.label, avg_score: format.avg_score })),
      transfer_note: niche.cross_platform_patterns > 5
        ? "Есть переносимые механики между платформами."
        : "Переносимость пока слабая: тестировать отдельно.",
    };
  }).sort((a, b) => b.understanding_score - a.understanding_score);
}

function buildDailyReport(input: {
  totals: Record<string, unknown>;
  today: Record<string, unknown> | null;
  yesterday: Record<string, unknown> | null;
  insightPayload: ReturnType<typeof buildInsights>;
  antiPatternBrain: ReturnType<typeof buildAntiPatternBrain>;
  discoveryBrain: ReturnType<typeof buildDiscoveryBrain>;
  portfolioReadiness?: {
    summary?: Record<string, unknown>;
  } | null;
}) {
  const todayUseful = firstPositive(input.today?.usd_per_relevant, input.today?.usd_per_analyzed, input.today?.usd_per_inserted);
  const yesterdayUseful = firstPositive(input.yesterday?.usd_per_relevant, input.yesterday?.usd_per_analyzed, input.yesterday?.usd_per_inserted);
  const delta = todayUseful && yesterdayUseful ? Math.round((todayUseful - yesterdayUseful) / yesterdayUseful * 100) : null;
  const portfolio = (input.portfolioReadiness?.summary || {}) as Record<string, unknown>;
  return {
    title: "Что мозг понял за сутки",
    bullets: [
      `В памяти ${num(input.totals.analyzed_videos)} разобранных видео и ${num(input.totals.generator_ready_patterns)} generator-ready паттернов.`,
      input.insightPayload.top_hooks?.[0] ? `Сильнейший хук: ${input.insightPayload.top_hooks[0].hook_label} (${input.insightPayload.top_hooks[0].op_score}/100).` : "Сильный хук пока не определён.",
      delta == null ? "Сравнение стоимости ждёт новых cost-событий." : `Стоимость полезной насмотренности ${delta <= 0 ? "снизилась" : "выросла"} на ${Math.abs(delta)}%.`,
      `High-trust coverage по матрице ниш и платформ: ${num(portfolio.high_trust_coverage_pct)}% (${num(portfolio.stable_segments)} из ${num(portfolio.expected_segments)} сегментов).`,
      input.discoveryBrain.next_policy,
      input.antiPatternBrain.summary,
    ],
    today_cost_usd: todayUseful || null,
    yesterday_cost_usd: yesterdayUseful || null,
    cost_delta_pct: delta,
  };
}

function buildCostGovernor(input: {
  totals: Record<string, unknown>;
  corpusAudit: ReturnType<typeof buildCorpusAudit>;
  discoveryBrain: ReturnType<typeof buildDiscoveryBrain>;
  today: Record<string, unknown> | null;
}) {
  const usefulCost = firstPositive(input.today?.usd_per_relevant, input.today?.usd_per_analyzed, input.today?.usd_per_inserted, input.totals.today_usd_per_useful_video);
  const patternGainUsd = firstPositive(input.today?.usd_per_pattern_gain, input.totals.cost_units_per_pattern_gain_recent ? num(input.totals.cost_units_per_pattern_gain_recent) * estimatedUsdFromCostUnits(1) : 0);
  const patternGainCostUnits = firstPositive(input.today?.cost_units_per_pattern_gain, input.totals.cost_units_per_pattern_gain_recent);
  const dailySpend = num(input.today?.spend_usd);
  const maxDailySpend = Number(process.env.REELS_BRAIN_MAX_DAILY_SPEND_USD || 12);
  const maxUsefulCost = Number(process.env.REELS_BRAIN_MAX_USEFUL_VIDEO_USD || 0.08);
  const maxPatternGainUsd = Number(process.env.REELS_BRAIN_MAX_PATTERN_GAIN_USD || 0.18);
  const weakPatternGain = num(input.totals.pattern_gain_proxy_total) <= 0 && dailySpend > 0;
  const shouldPause = dailySpend > maxDailySpend
    || usefulCost > maxUsefulCost
    || patternGainUsd > maxPatternGainUsd
    || weakPatternGain
    || input.corpusAudit.low_signal_rate > 20;
  const providerLimits = (input.discoveryBrain.providers || []).map((provider) => ({
    provider: provider.provider,
    decision: provider.decision,
    max_next_runs: provider.decision === "scale" ? 3 : provider.decision === "watch" ? 1 : 0,
    reason: provider.reason,
  }));
  return {
    status: shouldPause ? "pause_or_review" : "ok_to_continue",
    max_daily_spend_usd: maxDailySpend,
    max_useful_video_usd: maxUsefulCost,
    max_pattern_gain_usd: maxPatternGainUsd,
    today_spend_usd: dailySpend || null,
    current_useful_video_usd: usefulCost || null,
    current_pattern_gain_usd: patternGainUsd || null,
    current_pattern_gain_cost_units: patternGainCostUnits || null,
    weak_pattern_gain: weakPatternGain,
    rules: [
      "stop if daily spend exceeds max_daily_spend_usd",
      "stop if useful video cost exceeds max_useful_video_usd",
      "stop if pattern gain cost exceeds max_pattern_gain_usd",
      "stop if paid collection produces near-zero pattern gain",
      "stop/inspect if low_signal corpus rate exceeds 20%",
      "scale only providers with discovery decision=scale",
    ],
    provider_limits: providerLimits,
  };
}

function buildAutopilotActions(input: {
  niches: { niche: string; understanding_score: number; generator_ready_patterns: number; analyzed_videos: number }[];
  discoveryBrain: ReturnType<typeof buildDiscoveryBrain>;
  antiPatternBrain: ReturnType<typeof buildAntiPatternBrain>;
  costGovernor: ReturnType<typeof buildCostGovernor>;
  totals?: Record<string, unknown>;
  outcomeMemory?: {
    pattern_memory?: Record<string, unknown>;
  } | null;
  segmentPriorityQueue?: { items?: Array<Record<string, unknown>> };
  generationPolicy?: {
    by_niche?: Array<Record<string, unknown>>;
    by_platform?: Array<Record<string, unknown>>;
    by_segment?: Array<Record<string, unknown>>;
  } | null;
  portfolioReadiness?: {
    summary?: Record<string, unknown>;
    missing_segments?: Array<Record<string, unknown>>;
  } | null;
}) {
  const weakNiches = input.niches
    .filter((niche) => niche.understanding_score < 85 || niche.generator_ready_patterns < 12)
    .sort((a, b) => a.understanding_score - b.understanding_score)
    .slice(0, 3);
  const providers = input.discoveryBrain.providers || [];
  const patternGainCostTrend = String(input.totals?.pattern_gain_cost_trend || "not_enough_data");
  const patternGainProxyTotal = num(input.totals?.pattern_gain_proxy_total);
  const patternGainRecent = num(input.totals?.cost_units_per_pattern_gain_recent);
  const segmentPolicies = (input.generationPolicy?.by_segment || []).slice(0, 8).map((row) => ({
    niche: String(row.niche || ""),
    platform: String(row.platform || ""),
    label: String(row.label || `${String(row.niche || "")} × ${String(row.platform || "")}`),
    policy_mode: String(row.policy_mode || "research_only"),
    trust_band: String(row.trust_band || "low"),
    evidence_band: String(row.evidence_band || "missing"),
    readiness_score: num(row.readiness_score),
  }));
  const portfolioSummary = (input.portfolioReadiness?.summary || {}) as Record<string, unknown>;
  const portfolioGaps = ((input.portfolioReadiness?.missing_segments || []) as Array<Record<string, unknown>>).slice(0, 3);
  const patternMemory = (input.outcomeMemory?.pattern_memory || {}) as Record<string, unknown>;
  const feedbackCoverageQueue = ((patternMemory.no_feedback_queue || []) as Array<Record<string, unknown>>).slice(0, 4).map((row) => ({
    pattern_id: String(row.pattern_id || ""),
    title: String(row.title || row.pattern_id || "pattern"),
    quality_gate: String(row.quality_gate || "unknown"),
    decision_priority_score: num(row.decision_priority_score),
    hook_type: String(row.hook_type || ""),
    structure_type: String(row.structure_type || ""),
    niches: Array.isArray(row.niches) ? row.niches.slice(0, 3) : [],
    platforms: Array.isArray(row.platforms) ? row.platforms.slice(0, 3) : [],
  }));
  const segmentActions = (input.segmentPriorityQueue?.items || []).slice(0, 4).map((segment) => ({
    type: String(segment.action || "watch_segment"),
    priority: Boolean(segment.ready_for_generation) || Number(segment.urgency_score || 0) >= 80 ? "high" : "medium",
    niche: String(segment.niche || ""),
    platform: String(segment.platform || "mixed"),
    action: Boolean(segment.ready_for_generation)
      ? `Перевести ${String(segment.niche || "")} × ${String(segment.platform || "")} в decision-ready lane`
      : String(segment.next_action || `Сфокусировать следующий тик на ${String(segment.niche || "")} × ${String(segment.platform || "")}`),
    reason: Boolean(segment.ready_for_generation)
      ? `${String(segment.decision_grade || "validate")} · trust ${num(segment.trust_score)} · ${String(segment.brief_title || "segment brief")}`
      : `${String(segment.gap_status || "watch")} · gap ${num(segment.gap_score)} · ${String(segment.why_now || "")}`.trim(),
  }));
  const policyActions = segmentPolicies.map((segment) => ({
    type: segment.policy_mode === "primary"
      ? "ship_policy_segment"
      : segment.policy_mode === "control_only"
        ? "validate_policy_segment"
        : "research_policy_segment",
    priority: segment.policy_mode === "primary"
      ? "high"
      : segment.policy_mode === "control_only"
        ? "medium"
        : "medium",
    niche: segment.niche,
    platform: segment.platform,
    action: segment.policy_mode === "primary"
      ? `Использовать ${segment.label} как primary generation policy`
      : segment.policy_mode === "control_only"
        ? `Гонять ${segment.label} только как control batch`
        : `Продолжать исследование ${segment.label} до production-ready policy`,
    reason: `${segment.policy_mode} · trust ${segment.trust_band} · evidence ${segment.evidence_band} · readiness ${segment.readiness_score}`,
  }));
  const actions = [
    ...(input.costGovernor.weak_pattern_gain || patternGainCostTrend === "more_expensive" ? [{
      type: "review_pattern_gain_economics",
      priority: "high",
      niche: "mixed",
      platform: "mixed",
      action: "Снизить paid intake и пересобрать discovery angles с лучшим pattern gain",
      reason: `pattern gain total ${patternGainProxyTotal} · recent cost ${patternGainRecent || "n/a"} · trend ${patternGainCostTrend}`,
    }] : []),
    ...(num(portfolioSummary.high_trust_coverage_pct) < 85 ? portfolioGaps.map((segment) => ({
      type: "close_portfolio_gap",
      priority: num(portfolioSummary.high_trust_coverage_pct) < 60 ? "high" : "medium",
      niche: String(segment.niche || ""),
      platform: String(segment.platform || "mixed"),
      action: `Закрыть portfolio gap для ${String(segment.niche || "")} × ${String(segment.platform || "")}`,
      reason: `${String(segment.evidence_band || "missing")} · stability ${num(segment.stability_score)} · ${Array.isArray(segment.blockers) ? segment.blockers.slice(0, 2).join(" · ") : ""}`.trim(),
    })) : []),
    ...feedbackCoverageQueue.map((pattern) => ({
      type: "validate_pattern_feedback",
      priority: pattern.quality_gate === "high_confidence" ? "high" : "medium",
      niche: Array.isArray(pattern.niches) ? String(pattern.niches[0] || "mixed") : "mixed",
      platform: Array.isArray(pattern.platforms) ? String(pattern.platforms[0] || "mixed") : "mixed",
      pattern_id: pattern.pattern_id,
      action: `Довести до market-proof паттерн ${pattern.title}`,
      reason: `${pattern.quality_gate} · priority ${pattern.decision_priority_score} · ${pattern.hook_type || "hook"} / ${pattern.structure_type || "structure"}`,
    })),
    ...policyActions,
    ...segmentActions,
    ...weakNiches.map((niche) => ({
      type: "collect_more",
      priority: niche.understanding_score < 70 ? "high" : "medium",
      niche: niche.niche,
      platform: "mixed",
      action: `Добрать RU-залётные ролики для ${niche.niche}`,
      reason: `understanding ${niche.understanding_score}%, ready patterns ${niche.generator_ready_patterns}`,
    })),
    ...providers.filter((provider) => provider.decision === "scale").slice(0, 3).map((provider) => ({
      type: "scale_source",
      priority: "high",
      provider: provider.provider,
      action: `Запустить ещё 1-3 прогона через ${provider.provider}`,
      reason: provider.reason,
    })),
    ...providers.filter((provider) => provider.decision === "limit").slice(0, 3).map((provider) => ({
      type: "suppress_source",
      priority: "medium",
      provider: provider.provider,
      action: `Ограничить ${provider.provider}`,
      reason: provider.reason,
    })),
    ...(input.antiPatternBrain.items || []).filter((item): item is NonNullable<typeof item> => Boolean(item)).slice(0, 2).map((item) => ({
      type: "avoid_pattern",
      priority: item.severity === "high" ? "high" : "medium",
      action: `Не масштабировать: ${item.label}`,
      reason: item.evidence,
    })),
  ];
  return {
    mode: input.costGovernor.status === "ok_to_continue" ? "autopilot_ready" : "budget_guarded",
    can_run_paid_collection: input.costGovernor.status === "ok_to_continue",
    portfolio_readiness: {
      high_trust_coverage_pct: num(portfolioSummary.high_trust_coverage_pct),
      stable_segments: num(portfolioSummary.stable_segments),
      expected_segments: num(portfolioSummary.expected_segments),
      verdict: String(portfolioSummary.verdict || "still_building"),
    },
    feedback_coverage: {
      coverage_rate: num(patternMemory.coverage_rate),
      high_confidence_no_feedback: num((patternMemory.coverage_gaps as Record<string, unknown> | undefined)?.high_confidence_no_feedback),
      medium_confidence_no_feedback: num((patternMemory.coverage_gaps as Record<string, unknown> | undefined)?.medium_confidence_no_feedback),
      total_no_feedback_queue: num((patternMemory.coverage_gaps as Record<string, unknown> | undefined)?.total_no_feedback_queue),
      queue: feedbackCoverageQueue,
    },
    generation_policy: {
      primary_segments: segmentPolicies.filter((segment) => segment.policy_mode === "primary").length,
      control_segments: segmentPolicies.filter((segment) => segment.policy_mode === "control_only").length,
      research_segments: segmentPolicies.filter((segment) => segment.policy_mode === "research_only").length,
    },
    learning_economics: {
      pattern_gain_proxy_total: patternGainProxyTotal,
      pattern_gain_cost_trend: patternGainCostTrend,
    },
    actions: actions.slice(0, 10),
  };
}

function buildNextIntelligenceLayers(input: {
  insightPayload: ReturnType<typeof buildInsights>;
  patternDecisionLayer: ReturnType<typeof buildPatternDecisionLayer>;
  corpusAudit: ReturnType<typeof buildCorpusAudit>;
  audioVisualReadiness: AudioVisualReadiness;
}) {
  const strongRecipes = input.patternDecisionLayer.pattern_details.filter((row) => row.quality_gate === "high_confidence");
  const topHooks = input.insightPayload.top_hooks || [];
  return {
    feedback_loop: {
      status: "ready_for_metrics",
      next_step: "Подключить наши опубликованные ролики: views, saves, CTR, retention, orders.",
      memory_write: "winner/loser outcomes должны дополнять pattern_details и anti_pattern_brain.",
    },
    audio_visual_intelligence: {
      status: input.audioVisualReadiness.status,
      next_step: input.audioVisualReadiness.next_step,
      useful_now: "Текущий visual recipe rule-based; следующий слой сделает его video-based.",
      ready_for_worker: input.audioVisualReadiness.ready_for_worker,
      with_media_locators: input.audioVisualReadiness.with_media_locators,
      with_audio_features: input.audioVisualReadiness.with_audio_features,
      with_transcript: input.audioVisualReadiness.with_transcript,
      audio_failed: input.audioVisualReadiness.audio_failed,
      by_platform: input.audioVisualReadiness.by_platform,
    },
    product_brain: {
      status: strongRecipes.length ? "seeded" : "needs_more_patterns",
      best_product_fit: strongRecipes.flatMap((row) => row.creative_brief?.product_fit || []).slice(0, 8),
      next_step: "Маппить тип товара -> hooks/formats/visual proof.",
    },
    audience_brain: {
      status: "rule_based_seed",
      segments: ["мамы", "папы", "дети", "подарки", "импульсные покупатели"],
      next_step: "Привязать аудиторию к hook emotion, voice, colors, pacing.",
    },
    experiment_brain: {
      status: topHooks.length >= 3 ? "ready_to_plan" : "needs_hooks",
      variants: [
        "A/B: меняем только hook",
        "A/B: меняем только proof frame",
        "A/B: меняем только CTA",
      ],
      next_step: "Генерировать experiment matrix, но не подключать контент-завод автоматически.",
    },
    portfolio_manager: {
      status: "planned",
      mix: ["2 продажи", "1 мем", "1 UGC", "1 экспертный", "2 развлекательных"],
      next_step: "После feedback loop распределять контент по бренду, а не по одному ролику.",
    },
    data_quality: {
      status: input.corpusAudit.verdict,
      next_step: input.corpusAudit.ru_likely_rate < 80 ? "Усилить RU discovery." : "Держать RU-фокус и снижать low-signal.",
    },
  };
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
  const safeExample = exampleHook && !/#\w|https?:\/\//i.test(exampleHook) && exampleHook.length < 140 ? exampleHook : "";
  return {
    hook: safeExample || template,
    retention_mechanic: pattern.retention_label || pattern.retention_mechanism || "открытая петля / ожидание доказательства",
    second_by_second: secondsForPattern(pattern),
    visual_recipe: visualRecipeForPattern(pattern),
    audio_strategy: audioStrategyForPattern(pattern),
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

function audioStrategyForPattern(pattern: InsightPattern) {
  const hookType = pattern.hook_type || "unknown";
  const structureType = pattern.structure_type || "demo";
  const strategy = [
    "Звук или голос должны начинаться без длинной пустой подводки.",
    "Речь должна не объяснять абстрактно, а усиливать кадр и proof-момент.",
  ];
  if (hookType === "warning_pattern_break") {
    return [...strategy, "Первые 0.3-0.8с: резкий голосовой вход с предупреждением.", "Темп речи выше среднего, чтобы сразу поднять напряжение."];
  }
  if (hookType === "curiosity_gap" || hookType === "curiosity_question") {
    return [...strategy, "Первые секунды: вопрос/интрига голосом без музыкального вступления.", "Сделать микро-паузу перед payoff, чтобы усилить досмотр."];
  }
  if (structureType === "before_after") {
    return [...strategy, "Звук должен поддерживать трансформацию: быстрый вход и более спокойный payoff.", "Не растягивать вступление, переход к after — как можно раньше."];
  }
  if (structureType === "unboxing") {
    return [...strategy, "Допустимы короткие tactile/packaging sounds, но главный акцент всё равно на смысловом voice proof.", "Монтаж и смена кадров должны поддерживать ритм речи."];
  }
  return [...strategy, "Держать мобильный микс чистым: без тихого, утонувшего голоса.", "Если есть музыка, она должна быть подложкой, а не основным носителем смысла."];
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
    audio_strategy: brief.audio_strategy,
    product_fit: brief.product_fit,
    copy_as_mechanic: brief.copy_as_mechanic,
    do_not_copy: brief.do_not_copy,
  };
}

function safetyFlags(pattern: InsightPattern, example?: { hook?: string | null }) {
  const flags: string[] = [];
  const hook = String(example?.hook || "").trim();
  if (/#\w/.test(hook)) flags.push("raw_hashtags");
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
    errors: number;
    estimated_spend_usd: number;
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
        errors: 0,
        estimated_spend_usd: 0,
        niches: new Set<string>(),
      };
      current.runs += 1;
      current.found += num(run.found);
      current.inserted += num(run.inserted);
      current.analyzed += num(run.analyzed);
      current.errors += num(run.errors);
      current.estimated_spend_usd += spendUsd(run).value;
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
    errors: row.errors,
    estimated_spend_usd: Math.round(row.estimated_spend_usd * 10000) / 10000,
    cost_per_inserted: perUnit(row.estimated_spend_usd, row.inserted),
    cost_per_analyzed: perUnit(row.estimated_spend_usd, row.analyzed),
    niches: Array.from(row.niches).sort(),
  })).sort((a, b) => (a.cost_per_analyzed ?? 999) - (b.cost_per_analyzed ?? 999) || b.analyzed - a.analyzed).slice(0, 8);
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
  const comboMap = new Map<string, {
    hook_type: string;
    hook_label: string;
    structure_type: string;
    structure_label: string;
    retention_labels: Set<string>;
    frequency: number;
    op_score_sum: number;
    quality_score_sum: number;
    count: number;
    niches: Set<string>;
    platforms: Set<string>;
    examples: InsightExample[];
  }>();
  const formatMap = new Map<string, { label: string; frequency: number; score_sum: number; count: number; niches: Set<string> }>();
  const retentionMap = new Map<string, { label: string; frequency: number; score_sum: number; count: number; hooks: Set<string> }>();
  const recipes: Array<{
    id: string;
    title: string;
    hook_type: string;
    hook: string;
    structure_type: string;
    format: string;
    retention: string;
    op_score: number;
    confidence: "high" | "medium" | "low";
    niches: string[];
    platforms: string[];
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

      const patternPlatforms = Object.entries(brain.platform_brains || {})
        .filter(([, platformBrain]) => {
          const ready = Array.isArray(platformBrain?.generator_ready_patterns) ? platformBrain.generator_ready_patterns : [];
          const all = Array.isArray(platformBrain?.patterns) ? platformBrain.patterns : [];
          return [...ready, ...all].some((item) => (item as InsightPattern).pattern_id === pattern.pattern_id);
        })
        .map(([platform]) => platform)
        .sort();

      recipes.push({
        id: pattern.pattern_id || `${hookKey}:${formatKey}:${retentionKey}`,
        title: recipeTitle(pattern),
        hook_type: hookKey,
        hook: pattern.hook_label || hookKey,
        structure_type: formatKey,
        format: pattern.structure_label || formatKey,
        retention: pattern.retention_label || retentionKey,
        op_score: insightScore(pattern, 1, 1),
        confidence: confidenceLevel({ frequency: pattern.frequency, score: pattern.strength_score, niches: 1, platforms: 1, examples: pattern.examples?.length || 0 }),
        niches: [niche],
        platforms: patternPlatforms,
        creative_brief: creativeBriefForPattern(pattern, niche),
        generator_payload: generatorPayload(pattern, niche),
        examples: enrichExamples(pattern, niche),
      });

      const comboKey = `${hookKey}:${formatKey}`;
      const combo = comboMap.get(comboKey) || {
        hook_type: hookKey,
        hook_label: pattern.hook_label || hookKey,
        structure_type: formatKey,
        structure_label: pattern.structure_label || formatKey,
        retention_labels: new Set<string>(),
        frequency: 0,
        op_score_sum: 0,
        quality_score_sum: 0,
        count: 0,
        niches: new Set<string>(),
        platforms: new Set<string>(),
        examples: [],
      };
      combo.frequency += num(pattern.frequency);
      combo.op_score_sum += insightScore(pattern, 1, 1);
      combo.quality_score_sum += num(pattern.quality_score);
      combo.count += 1;
      combo.niches.add(niche);
      combo.retention_labels.add(pattern.retention_label || retentionKey);
      for (const [platform, platformBrain] of Object.entries(brain.platform_brains || {})) {
        const platformPatterns = Array.isArray(platformBrain?.generator_ready_patterns) ? platformBrain.generator_ready_patterns : [];
        if (platformPatterns.some((item) => (item as InsightPattern).hook_type === hookKey && (item as InsightPattern).structure_type === formatKey)) {
          combo.platforms.add(platform);
        }
      }
      for (const example of enrichExamples(pattern, niche)) {
        if (combo.examples.length < 4) combo.examples.push(example);
      }
      comboMap.set(comboKey, combo);
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
  const strong_combinations = Array.from(comboMap.values()).map((row) => {
    const avgOpScore = row.count ? Math.round(row.op_score_sum / row.count) : 0;
    const avgQualityScore = row.count ? Math.round(row.quality_score_sum / row.count) : 0;
    const confidence = confidenceLevel({
      frequency: row.frequency,
      score: avgOpScore,
      niches: row.niches.size,
      platforms: row.platforms.size,
      examples: row.examples.length,
    });
    const decision = avgOpScore >= 85 && confidence === "high"
      ? "scale_now"
      : avgOpScore >= 70 && confidence !== "low"
        ? "test_next"
        : "watch";
    const why_it_wins = [
      row.frequency >= 5 ? `связка повторяется в корпусе ${row.frequency} раз и не выглядит случайной` : "",
      row.niches.size >= 2 ? `уже работает минимум в ${row.niches.size} нишах, значит логика не слишком узкая` : "",
      row.platforms.size >= 2 ? `переносится между ${row.platforms.size} платформами, значит это не локальный артефакт одной сети` : "",
      row.examples.length >= 2 ? `есть несколько референсов с доказательством, а не один удачный ролик` : "",
      avgOpScore >= 85 ? `OP score ${avgOpScore} показывает высокий шанс на сильный первый экран и удержание` : "",
      avgQualityScore >= 70 ? `quality score ${avgQualityScore} говорит, что шум уже низкий и паттерн близок к generator-ready` : "",
    ].filter(Boolean);
    const watchouts = [
      row.platforms.size < 2 ? "пока мало кроссплатформенной проверки" : "",
      row.niches.size < 2 ? "пока подтверждено в ограниченном числе ниш" : "",
      row.examples.length < 2 ? "референсов маловато, лучше не масштабировать вслепую" : "",
      avgQualityScore < 70 ? "quality ещё не идеален, возможен шум в источниках" : "",
    ].filter(Boolean);
    const user_summary = decision === "scale_now"
      ? "Связка уже похожа на рабочую механику для серии новых креативов."
      : decision === "test_next"
        ? "Связка выглядит сильной, но её лучше подтвердить через A/B, а не сразу масштабировать."
        : "Связка пока интересная, но ещё не доказана настолько, чтобы на неё опираться."
    ;
    return {
      id: `${row.hook_type}:${row.structure_type}`,
      hook_type: row.hook_type,
      hook_label: row.hook_label,
      structure_type: row.structure_type,
      structure_label: row.structure_label,
      retention: Array.from(row.retention_labels).slice(0, 2),
      frequency: row.frequency,
      op_score: avgOpScore,
      quality_score: avgQualityScore,
      confidence,
      decision,
      decision_label: decision === "scale_now" ? "Scale" : decision === "test_next" ? "Test" : "Watch",
      user_summary,
      why_it_wins: why_it_wins.slice(0, 3),
      watchouts: watchouts.slice(0, 2),
      evidence: {
        niches: row.niches.size,
        platforms: row.platforms.size,
        references: row.examples.length,
      },
      next_action: decision === "scale_now"
        ? "Можно превращать в серию creative briefs и запускать пачку сценариев."
        : decision === "test_next"
          ? "Запускать через A/B: проверить товар-fit и proof-кадр."
          : "Пока держать в наблюдении и наращивать доказательность корпуса.",
      examples: row.examples.sort((a, b) => num(b.score) - num(a.score) || num(b.views) - num(a.views)).slice(0, 2),
      niches: Array.from(row.niches).sort(),
      platforms: Array.from(row.platforms).sort(),
    };
  }).sort((a, b) => b.op_score - a.op_score || b.frequency - a.frequency).slice(0, 8);

  return {
    summary: [
      top_hooks[0] ? `Самый сильный вход: ${top_hooks[0].hook_label} (${top_hooks[0].op_score}/100).` : "Паттерны хуков пока не найдены.",
      strong_combinations[0] ? `Лучшая связка сейчас: ${strong_combinations[0].hook_label} + ${strong_combinations[0].structure_label}.` : "Сильная связка hook + structure пока не накоплена.",
      `Generator-ready паттерны уже можно отдавать в контент-завод как рецепты, но примеры исходников лучше держать рядом.`,
      `Технические логи спрятаны ниже: витрина показывает только выводы, уверенность и применение.`,
    ],
    top_hooks,
    hook_groups,
    strong_combinations,
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
    source_map: buildSourceMap(rows),
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
    const compactMode = String(req.nextUrl.searchParams.get("compact") || "").trim() === "1";
    const db = getSupabaseAdmin();
    if (!db) {
      return NextResponse.json({ ok: true, niches: [], runs: [], warning: "Supabase не настроен" }, { headers: { "Cache-Control": "no-store" } });
    }

    const niches = splitList(req.nextUrl.searchParams.get("niches") || "ru_toys,ru_clothing,ru_cosmetics");
    const limit = Math.max(4, Math.min(80, Number(req.nextUrl.searchParams.get("limit") || 50)));
    const [
      { data, error },
      { data: corpusRows, error: corpusError },
      { data: recentCorpusRows, error: recentCorpusError },
    ] = await Promise.all([
      db
        .from("niche_playbooks")
        .select("niche,playbook,updated_at")
        .in("niche", niches),
      db
        .from("viral_videos")
        .select("url,platform,niche,caption,hook_text,analyzed,source_orbit_id,virality_score,views,analyzed_full")
        .in("niche", niches)
        .order("virality_score", { ascending: false, nullsFirst: false })
        .limit(10000),
      db
        .from("viral_videos")
        .select("url,platform,niche,caption,hook_text,analyzed,source_orbit_id,virality_score,views,analyzed_full,created_at")
        .in("niche", niches)
        .order("created_at", { ascending: false, nullsFirst: false })
        .limit(1000),
    ]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (corpusError) return NextResponse.json({ error: corpusError.message }, { status: 500 });
    if (recentCorpusError) return NextResponse.json({ error: recentCorpusError.message }, { status: 500 });

    const feedbackRows = await loadFeedbackRows(db);
    const rows = ((data || []) as { niche?: string; playbook?: unknown; updated_at?: string }[]);
    const corpusSample = (corpusRows || []) as CorpusAuditRow[];
    const recentSample = (recentCorpusRows || []) as CorpusAuditRow[];
    const readinessSample = Array.from(new Map(
      [...recentSample, ...corpusSample].map((row) => [String(row.url || ""), row]),
    ).values()).filter((row) => row.url);
    const corpusAudit = buildCorpusAudit(corpusSample);
    const audioVisualReadiness = buildAudioVisualReadiness(readinessSample);
    const segmentAudioVisualReadiness = buildSegmentAudioVisualReadiness(readinessSample);
    const audioBrain = buildAudioBrain(readinessSample);
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
        const patternGainProxy = num(run.pattern_gain_proxy);
        const highTrustGainProxy = num(run.high_trust_gain_proxy);
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
          pattern_gain_proxy: patternGainProxy,
          high_trust_gain_proxy: highTrustGainProxy,
          spend_usd: spendUsd(run).value,
          spend_source: spendUsd(run).source,
          inserted_per_100_cost_units: Math.round((run.inserted / costUnits) * 1000) / 10,
          analyzed_per_100_cost_units: Math.round((run.analyzed / costUnits) * 1000) / 10,
          pattern_gain_per_100_cost_units: costUnits > 0 ? Math.round((patternGainProxy / costUnits) * 1000) / 10 : 0,
          cost_units_per_inserted: run.inserted > 0 ? Math.round((costUnits / run.inserted) * 10) / 10 : null,
          cost_units_per_analyzed: run.analyzed > 0 ? Math.round((costUnits / run.analyzed) * 10) / 10 : null,
          cost_units_per_pattern_gain: patternGainProxy > 0 ? Math.round((costUnits / patternGainProxy) * 10) / 10 : null,
          usd_per_inserted: run.inserted > 0 ? perUnit(spendUsd(run).value, run.inserted) : null,
          usd_per_analyzed: run.analyzed > 0 ? perUnit(spendUsd(run).value, run.analyzed) : null,
          usd_per_relevant: run.relevant > 0 ? perUnit(spendUsd(run).value, run.relevant) : null,
          usd_per_pattern_gain: patternGainProxy > 0 ? perUnit(spendUsd(run).value, patternGainProxy) : null,
        };
      });

    const chronologicalRuns = [...runs].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

    let cumulativeInserted = 0;
    let cumulativeAnalyzed = 0;
    let cumulativeCost = 0;
    let cumulativePatternGain = 0;
    const timeline = chronologicalRuns.map((run) => {
      cumulativeInserted += run.inserted;
      cumulativeAnalyzed += run.analyzed;
      cumulativeCost += run.cost_units;
      cumulativePatternGain += run.pattern_gain_proxy;
      return {
        ...run,
        cumulative_inserted: cumulativeInserted,
        cumulative_analyzed: cumulativeAnalyzed,
        cumulative_cost_units: cumulativeCost,
        cumulative_pattern_gain_proxy: Math.round(cumulativePatternGain * 10) / 10,
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
        pattern_gain_proxy: 0,
        high_trust_gain_proxy: 0,
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
      current.pattern_gain_proxy += row.pattern_gain_proxy;
      current.high_trust_gain_proxy += row.high_trust_gain_proxy;
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
      pattern_gain_proxy: number;
      high_trust_gain_proxy: number;
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
        usd_per_pattern_gain: row.pattern_gain_proxy > 0 ? perUnit(row.spend_usd, row.pattern_gain_proxy) : null,
        cost_units_per_inserted: perUnit(row.cost_units, row.inserted),
        cost_units_per_pattern_gain: row.pattern_gain_proxy > 0 ? perUnit(row.cost_units, row.pattern_gain_proxy) : null,
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
    const avgRecentPatternGainCost = recentIntake.length
      ? recentIntake.reduce((sum, row) => sum + (row.cost_units_per_pattern_gain || 0), 0) / recentIntake.length
      : null;
    const avgPreviousPatternGainCost = previousIntake.length
      ? previousIntake.reduce((sum, row) => sum + (row.cost_units_per_pattern_gain || 0), 0) / previousIntake.length
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
      pattern_gain_proxy_total: Math.round(timeline.reduce((sum, row) => sum + row.pattern_gain_proxy, 0) * 10) / 10,
      high_trust_gain_proxy_total: Math.round(timeline.reduce((sum, row) => sum + row.high_trust_gain_proxy, 0) * 10) / 10,
      cost_units_per_inserted_recent: avgRecentCost == null ? null : Math.round(avgRecentCost * 10) / 10,
      cost_units_per_inserted_previous: avgPreviousCost == null ? null : Math.round(avgPreviousCost * 10) / 10,
      cost_units_per_pattern_gain_recent: avgRecentPatternGainCost == null ? null : Math.round(avgRecentPatternGainCost * 10) / 10,
      cost_units_per_pattern_gain_previous: avgPreviousPatternGainCost == null ? null : Math.round(avgPreviousPatternGainCost * 10) / 10,
      cost_trend: trendLabel(avgRecentCost, avgPreviousCost),
      pattern_gain_cost_trend: trendLabel(avgRecentPatternGainCost, avgPreviousPatternGainCost),
      today_usd_per_useful_video: todayUseful,
      yesterday_usd_per_useful_video: yesterdayUseful,
      day_cost_trend: trendLabel(todayUseful, yesterdayUseful),
    };

    const insightPayload = buildInsights(rows);
    const enrichedStrongCombinations = buildAudioCombinationLayer(
      readinessSample,
      (insightPayload.strong_combinations || []) as unknown as Record<string, unknown>[],
    );
    insightPayload.strong_combinations = enrichedStrongCombinations as unknown as typeof insightPayload.strong_combinations;
    const discoveryBrain = buildDiscoveryBrain(insightPayload.source_map, corpusAudit);
    const patternDecisionLayer = attachPatternOutcomes(buildPatternDecisionLayer(insightPayload), feedbackRows.rows);
    const taxonomyBrain = buildTaxonomyBrain({ corpusSample, recentSample, playbooks: rows });
    const taxonomyWithLift = buildTaxonomyPatternLift(taxonomyBrain, patternDecisionLayer, corpusSample);
    const nicheComparison = buildNicheComparison(nicheSummaries, insightPayload);
    const costGovernor = buildCostGovernor({ totals, corpusAudit, discoveryBrain, today });
    const operatingSystem = buildReelsBrainOperatingSystem({
      patterns: patternDecisionLayer.pattern_details,
      insights: insightPayload,
      feedbackRows: feedbackRows.rows,
    });
    const antiPatternBrain = buildAntiPatternBrain(corpusAudit, insightPayload, audioBrain, operatingSystem.feedback_loop, patternDecisionLayer);
    const outcomeMemoryBrain = buildOutcomeMemoryBrain(operatingSystem.feedback_loop, patternDecisionLayer.pattern_details as Record<string, unknown>[]);
    const baseNextLayers = buildNextIntelligenceLayers({ insightPayload, patternDecisionLayer, corpusAudit, audioVisualReadiness });
    const nextIntelligenceLayers = {
      ...baseNextLayers,
      ...operatingSystem,
      audio_visual_intelligence: {
        ...operatingSystem.audio_visual_intelligence,
        ...baseNextLayers.audio_visual_intelligence,
        top_audio_mechanics: audioBrain.top_mechanics.slice(0, 3),
        anti_audio_patterns: audioBrain.anti_patterns.slice(0, 3),
      },
      data_quality: {
        status: corpusAudit.verdict,
        next_step: corpusAudit.ru_likely_rate < 80 ? "Усилить RU discovery." : "Держать RU-фокус и снижать low-signal.",
      },
      outcome_memory: outcomeMemoryBrain,
    };

    const insightsResponse = compactMode
      ? {
        ...insightPayload,
        top_hooks: takeRecordList(insightPayload.top_hooks, 10).map((row) => ({
          hook_label: row.hook_label,
          hook_type: row.hook_type,
          op_score: row.op_score,
          confidence: row.confidence,
          frequency: row.frequency,
          segment: row.segment,
          niches: takeRecordList(row.niches, 4),
          platforms: takeRecordList(row.platforms, 4),
          examples: takeRecordList(row.examples, 2),
        })),
        winning_formats: takeRecordList(insightPayload.winning_formats, 8),
        retention_mechanics: takeRecordList(insightPayload.retention_mechanics, 8),
        recipes: takeRecordList(insightPayload.recipes, 8),
        strong_combinations: takeRecordList(insightPayload.strong_combinations, 6),
        source_references: takeRecordList(insightPayload.source_references, 6),
        source_map: takeRecordList(insightPayload.source_map, 8),
      }
      : insightPayload;

    const patternDetailsResponse = compactMode
      ? takeRecordList(patternDecisionLayer.pattern_details, 10).map((row) => {
        const record = row as Record<string, unknown>;
        return {
          id: row.id,
          title: row.title,
          hook: row.hook,
          retention: row.retention,
          format: row.format,
          op_score: row.op_score,
          quality_gate: row.quality_gate,
          effective_quality_gate: record.effective_quality_gate,
          final_decision: record.final_decision,
          decision_priority_score: record.decision_priority_score,
          examples_count: row.examples_count,
          platforms: takeRecordList(record.platforms as string[] | undefined, 4),
          niches: takeRecordList(record.niches as string[] | undefined, 4),
          warnings: takeRecordList(record.warnings as string[] | undefined, 4),
          market_signal: record.market_signal,
          outcome_writeback: record.outcome_writeback,
          audio_logic: takeRecordList(record.audio_logic as string[] | undefined, 4),
          creative_brief: row.creative_brief,
        };
      })
      : patternDecisionLayer.pattern_details;

    const antiPatternResponse = compactMode
      ? {
        ...antiPatternBrain,
        items: takeRecordList(antiPatternBrain.items, 8),
      }
      : antiPatternBrain;

    const discoveryResponse = compactMode
      ? {
        ...discoveryBrain,
        providers: takeRecordList(discoveryBrain.providers, 8),
        source_map: takeRecordList((discoveryBrain as Record<string, unknown>).source_map as Record<string, unknown>[] | undefined, 8),
      }
      : discoveryBrain;

    const hypothesisBank = buildReelsBrainHypothesisBank(
      patternDecisionLayer.pattern_details as unknown as Array<Parameters<typeof buildReelsBrainHypothesisBank>[0][number]>,
      compactMode ? 6 : 10,
    );
    const groupedHypothesisBank = buildGroupedReelsBrainHypothesisBanks({
      patterns: patternDecisionLayer.pattern_details as unknown as Array<Parameters<typeof buildGroupedReelsBrainHypothesisBanks>[0]["patterns"][number]>,
      niches: nicheSummaries.map((row) => row.niche),
      platforms: ["tiktok", "instagram", "youtube"],
      limit: compactMode ? 2 : 3,
    });
    const actionPack = buildReelsBrainActionPack(
      patternDecisionLayer.pattern_details as unknown as Array<Parameters<typeof buildReelsBrainActionPack>[0][number]>,
      compactMode ? 4 : 6,
    );
    const groupedActionPacks = buildGroupedReelsBrainActionPacks({
      patterns: patternDecisionLayer.pattern_details as unknown as Array<Parameters<typeof buildGroupedReelsBrainActionPacks>[0]["patterns"][number]>,
      niches: nicheSummaries.map((row) => row.niche),
      platforms: ["tiktok", "instagram", "youtube"],
      limit: compactMode ? 2 : 3,
    });
    const briefPack = buildReelsBrainBriefPack(
      insightPayload.recipes as unknown as Array<Parameters<typeof buildReelsBrainBriefPack>[0][number]>,
      compactMode ? 4 : 6,
      { segmentReadiness: segmentAudioVisualReadiness },
    );
    const groupedBriefPacks = buildGroupedReelsBrainBriefPacks({
      recipes: insightPayload.recipes as unknown as Array<Parameters<typeof buildGroupedReelsBrainBriefPacks>[0]["recipes"][number]>,
      niches: nicheSummaries.map((row) => row.niche),
      platforms: ["tiktok", "instagram", "youtube"],
      limit: compactMode ? 2 : 3,
      segmentReadiness: segmentAudioVisualReadiness,
    });
    const segmentTrust = buildReelsBrainSegmentTrust({
      niches: nicheSummaries as Array<Parameters<typeof buildReelsBrainSegmentTrust>[0]["niches"][number]>,
      platforms: ["tiktok", "instagram", "youtube"],
    });
    const trustedGroupedHypothesisBank = {
      by_niche: applySegmentTrustToGroups({
        groups: groupedHypothesisBank.by_niche,
        trustRows: segmentTrust.by_niche,
        key: "niche",
      }),
      by_platform: applySegmentTrustToGroups({
        groups: groupedHypothesisBank.by_platform,
        trustRows: segmentTrust.by_platform,
        key: "platform",
      }),
      by_segment: groupedHypothesisBank.by_segment,
    };
    const trustedGroupedActionPacks = {
      by_niche: applySegmentTrustToGroups({
        groups: groupedActionPacks.by_niche,
        trustRows: segmentTrust.by_niche,
        key: "niche",
      }),
      by_platform: applySegmentTrustToGroups({
        groups: groupedActionPacks.by_platform,
        trustRows: segmentTrust.by_platform,
        key: "platform",
      }),
      by_segment: groupedActionPacks.by_segment,
    };
    const trustedGroupedBriefPacks = {
      by_niche: applySegmentTrustToGroups({
        groups: groupedBriefPacks.by_niche,
        trustRows: segmentTrust.by_niche,
        key: "niche",
      }),
      by_platform: applySegmentTrustToGroups({
        groups: groupedBriefPacks.by_platform,
        trustRows: segmentTrust.by_platform,
        key: "platform",
      }),
      by_segment: groupedBriefPacks.by_segment,
    };
    const topOpportunities = buildReelsBrainOpportunities({
      nicheSummaries,
      segmentTrust,
      briefPackGroups: trustedGroupedBriefPacks,
      actionPackGroups: trustedGroupedActionPacks,
      hypothesisBankGroups: trustedGroupedHypothesisBank,
      segmentOutputBanks: {
        briefs: trustedGroupedBriefPacks.by_segment,
        actions: trustedGroupedActionPacks.by_segment,
        hypotheses: trustedGroupedHypothesisBank.by_segment,
      },
      platforms: ["tiktok", "instagram", "youtube"],
      limit: compactMode ? 6 : 10,
    });
    const patternAtlas = buildReelsBrainPatternAtlas({
      patterns: patternDecisionLayer.pattern_details,
      nicheSummaries,
      segmentTrust,
      segmentReadiness: segmentAudioVisualReadiness,
      platforms: ["tiktok", "instagram", "youtube"],
      segmentLimit: compactMode ? 6 : 10,
      patternLimit: compactMode ? 2 : 3,
    });
    const segmentPlaybook = buildReelsBrainSegmentPlaybook({
      opportunities: topOpportunities,
      patternAtlas,
      feedbackLoop: operatingSystem.feedback_loop,
      limit: compactMode ? 6 : 10,
    });
    const evidenceLedger = buildReelsBrainEvidenceLedger({
      segmentPlaybook,
      limit: compactMode ? 6 : 10,
    });
    const segmentDecisionDeck = buildReelsBrainSegmentDecisionDeck({
      segmentOutputBanks: {
        briefs: trustedGroupedBriefPacks.by_segment,
        actions: trustedGroupedActionPacks.by_segment,
        hypotheses: trustedGroupedHypothesisBank.by_segment,
      },
      segmentPlaybook,
      evidenceLedger,
      patternAtlas,
      feedbackLoop: operatingSystem.feedback_loop,
      limit: compactMode ? 6 : 10,
    });
    const segmentGapPlan = buildReelsBrainSegmentGapPlanner({
      targetTotal: REELS_BRAIN_CORPUS_TARGET_TOTAL,
      niches: nicheSummaries,
      patternAtlas,
      platforms: ["tiktok", "instagram", "youtube"],
      limit: compactMode ? 6 : 10,
    });
    const segmentPriorityQueue = buildReelsBrainSegmentPriorityQueue({
      segmentPlan: {
        focus_segments: segmentGapPlan.focus_segments,
      },
      segmentDecisionDeck,
      limit: compactMode ? 6 : 10,
    });
    const segmentGenerationPacks = buildReelsBrainSegmentGenerationPacks({
      segmentDecisionDeck,
      limit: compactMode ? 6 : 10,
    });
    const segmentCreativeExports = buildReelsBrainSegmentCreativeExports({
      segmentGenerationPacks,
      limit: compactMode ? 6 : 10,
    });
    const segmentReadinessAudit = buildReelsBrainSegmentReadinessAudit({
      segmentGenerationPacks,
      limit: compactMode ? 6 : 10,
    });
    const segmentDecisionSnapshot = {
      summary: {
        exports: segmentCreativeExports.summary || null,
        audit: segmentReadinessAudit.summary || null,
        filtered_total: Array.isArray(segmentCreativeExports.items) ? segmentCreativeExports.items.length : 0,
      },
      ship_now: segmentCreativeExports.ship_now || [],
      validate_next: segmentCreativeExports.validate_next || [],
      research_queue: segmentCreativeExports.research_queue || [],
      items: (segmentCreativeExports.items || []).map((row) => {
        const audit = (segmentReadinessAudit.items || []).find((auditRow) =>
          String(auditRow.niche || "") === String((row as Record<string, unknown>).niche || "")
          && String(auditRow.platform || "") === String((row as Record<string, unknown>).platform || ""),
        ) || null;
        return {
          ...row,
          audit,
        };
      }),
    };
    const segmentStabilityAudit = buildReelsBrainSegmentStabilityAudit({
      decisionSnapshot: segmentDecisionSnapshot,
      limit: compactMode ? 6 : 10,
    });
    const segmentSolutions = buildReelsBrainSegmentSolutions({
      decisionSnapshot: segmentDecisionSnapshot,
      limit: compactMode ? 6 : 10,
    });
    const segmentSolutionMatrix = buildReelsBrainSegmentSolutionMatrix({
      segmentSolutions,
      niches: nicheSummaries.map((row) => row.niche),
      platforms: ["tiktok", "instagram", "youtube"],
      limit: compactMode ? 6 : 10,
    });
    const generationPolicy = buildReelsBrainGenerationPolicy({
      segmentSolutionMatrix,
    });
    const measurementPlan = buildReelsBrainMeasurementPlan({
      outcomeMemory: outcomeMemoryBrain,
      segmentSolutionMatrix,
      generationPolicy,
      limit: compactMode ? 4 : 6,
    });
    const portfolioReadiness = buildReelsBrainPortfolioReadiness({
      segmentStabilityAudit,
      niches: nicheSummaries.map((row) => row.niche),
      platforms: ["tiktok", "instagram", "youtube"],
    });
    const dailyReport = buildDailyReport({
      totals,
      today,
      yesterday,
      insightPayload,
      antiPatternBrain,
      discoveryBrain,
      portfolioReadiness,
    });
    const autopilotActions = buildAutopilotActions({
      niches: nicheSummaries,
      discoveryBrain,
      antiPatternBrain,
      costGovernor,
      totals,
      outcomeMemory: outcomeMemoryBrain,
      segmentPriorityQueue,
      generationPolicy,
      portfolioReadiness,
    });

    const timelineResponse = compactMode ? takeRecordList(timeline, 12) : timeline;

    return NextResponse.json({
      ok: true,
      niches: nicheSummaries,
      totals,
      corpus_audit: corpusAudit,
      insights: insightsResponse,
      pattern_details: patternDetailsResponse,
      quality_gate: patternDecisionLayer.quality_gate,
      pattern_outcome_summary: patternDecisionLayer.outcome_summary,
      niche_comparison: nicheComparison,
      daily_report: dailyReport,
      feedback_loop: operatingSystem.feedback_loop,
      outcome_memory_brain: outcomeMemoryBrain,
      measurement_plan: measurementPlan,
      audio_visual_intelligence: nextIntelligenceLayers.audio_visual_intelligence,
      product_brain: operatingSystem.product_brain,
      audience_brain: operatingSystem.audience_brain,
      experiment_brain: operatingSystem.experiment_brain,
      portfolio_manager: operatingSystem.portfolio_manager,
      audio_brain: audioBrain,
      audio_visual_readiness: audioVisualReadiness,
      hypothesis_bank: hypothesisBank,
      hypothesis_bank_groups: trustedGroupedHypothesisBank,
      action_pack: actionPack,
      action_pack_groups: trustedGroupedActionPacks,
      brief_pack: briefPack,
      brief_pack_groups: trustedGroupedBriefPacks,
      segment_output_banks: {
        briefs: takeRecordList(trustedGroupedBriefPacks.by_segment, compactMode ? 6 : 10),
        actions: takeRecordList(trustedGroupedActionPacks.by_segment, compactMode ? 6 : 10),
        hypotheses: takeRecordList(trustedGroupedHypothesisBank.by_segment, compactMode ? 6 : 10),
      },
      segment_trust: segmentTrust,
      top_opportunities: topOpportunities,
      pattern_atlas: patternAtlas,
      segment_playbook: segmentPlaybook,
      segment_decision_deck: segmentDecisionDeck,
      segment_priority_queue: segmentPriorityQueue,
      segment_generation_packs: segmentGenerationPacks,
      segment_creative_exports: segmentCreativeExports,
      segment_readiness_audit: segmentReadinessAudit,
      segment_stability_audit: segmentStabilityAudit,
      segment_solutions: segmentSolutions,
      segment_solution_matrix: segmentSolutionMatrix,
      generation_policy: generationPolicy,
      portfolio_readiness: portfolioReadiness,
      evidence_ledger: evidenceLedger,
      feedback_warning: feedbackRows.warning,
      cost_governor: costGovernor,
      autopilot_actions: autopilotActions,
      next_intelligence_layers: nextIntelligenceLayers,
      anti_pattern_brain: antiPatternResponse,
      discovery_brain: discoveryResponse,
      taxonomy_brain: taxonomyWithLift,
      timeline: timelineResponse,
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
