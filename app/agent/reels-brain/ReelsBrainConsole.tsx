"use client";

import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Database,
  ExternalLink,
  Loader2,
  Play,
  Radar,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";

type ProviderHealth = {
  ok?: boolean;
  trend_source?: { configured?: boolean; selected?: string };
  providers?: { provider: string; configured: boolean }[];
  available?: string[];
  env?: Record<string, boolean>;
};

type BakeOffSummary = {
  provider: string;
  configured: boolean;
  runs: number;
  found: number;
  valid: number;
  valid_rate: number;
  relevant: number;
  relevance_rate: number;
  avg_score: number;
  with_followers: number;
  with_sound: number;
  avg_elapsed_ms?: number;
  timeout_runs?: number;
  failed_runs?: number;
  cost_tier?: "low" | "medium" | "high";
};

type BakeOffRun = {
  provider: string;
  query: string;
  configured: boolean;
  elapsed_ms: number;
  error: string | null;
  inserted?: number;
  quality?: {
    found?: number;
    valid?: number;
    relevant?: number;
    avgScore?: number;
    top?: { url: string; platform: string; score: number; views: number | null; caption: string | null }[];
  };
};

type BakeOffResponse = {
  ok?: boolean;
  niche?: string;
  queries?: string[];
  limit?: number;
  persist?: boolean;
  persisted?: number;
  providers?: string[];
  summary_by_provider?: BakeOffSummary[];
  best_provider_by_platform?: Record<string, { provider?: string } | null>;
  source_memory_updated?: boolean;
  target_platform?: string;
  runs?: BakeOffRun[];
  warning?: string;
  error?: string;
};

type CorpusVideo = {
  id: number;
  url: string;
  platform: string | null;
  niche: string | null;
  score: number | null;
  views: number | null;
  likes: number | null;
  followers: number | null;
  analyzed: boolean;
  hook: string | null;
  format: string | null;
  sound: string | null;
  source: string | null;
  caption: string | null;
  created_at: string;
};

type CorpusResponse = {
  ok?: boolean;
  niche?: string | null;
  total?: number;
  warning?: string;
  summary?: {
    by_platform?: Record<string, number>;
    analyzed?: number;
    unanalyzed?: number;
    avg_score?: number;
  };
  videos?: CorpusVideo[];
};

type SourceRunResponse = {
  ok?: boolean;
  provider?: string;
  niche?: string;
  query?: string;
  requested?: number;
  found?: number;
  relevant?: number;
  normalized?: number;
  inserted?: number;
  rejected?: number;
  target_platform?: string;
  remembered_provider?: string | null;
  learned_provider?: string | null;
  source_memory_updated?: boolean;
  recommended_queries?: string[];
  source_provider_history?: {
    platform: string;
    provider: string;
    updated_at: string;
    source: string;
    avg_score?: number;
  }[];
  relearn_policy?: {
    min_found?: number;
    min_relevant?: number;
    min_inserted?: number;
    stale_days?: number;
    bake_off_limit?: number;
    retry_limit?: number;
  };
  recovery_queries?: {
    query: string;
    runs: number;
    found: number;
    relevant: number;
    inserted: number;
    score: number;
    low_yield_runs?: number;
    empty_runs?: number;
    suppressed_until?: string;
    updated_at: string;
  }[];
  sample?: { url: string; views?: number | null; score?: number | null }[];
  quality?: { avgScore?: number };
  error?: string;
};

type ManualSeedResponse = {
  ok?: boolean;
  niche?: string;
  received?: number;
  normalized?: number;
  inserted?: number;
  rejected?: number;
  warning?: string;
  sample?: { url: string; score: number; platform: string | null }[];
  error?: string;
};

type AnalyzeItem = {
  id: number;
  url: string;
  ok: boolean;
  hook?: string;
  format?: string;
  error?: string;
};

type AnalyzeResponse = {
  ok?: boolean;
  niche?: string | null;
  dry_run?: boolean;
  selected?: number;
  analyzed?: number;
  failed?: number;
  results?: AnalyzeItem[];
  error?: string;
};

type PatternMemoryItem = {
  pattern_id: string;
  hook_type: string;
  hook_label?: string;
  structure_type: string;
  structure_label?: string;
  retention_mechanism: string;
  retention_label?: string;
  strength_score: number;
  frequency: number;
  quality_label?: "generator_ready" | "needs_cleanup" | "noise";
  quality_score?: number;
  relevance_score?: number;
  hooks?: string[];
};

type PatternBuildResponse = {
  ok?: boolean;
  niche?: string;
  source_videos?: number;
  persist?: boolean;
  persisted?: boolean;
  warning?: string | null;
  memory?: {
    total_videos?: number;
    analyzed_videos?: number;
    top_hooks?: string[];
    patterns?: PatternMemoryItem[];
    generator_ready_patterns?: PatternMemoryItem[];
    quality_summary?: {
      generator_ready: number;
      needs_cleanup: number;
      noise: number;
      avg_relevance_score: number;
    };
  };
  error?: string;
};

type LoopResponse = {
  ok?: boolean;
  niche?: string;
  queries?: string[];
  source_limit?: number;
  analyze_limit?: number;
  persist_patterns?: boolean;
  target_platform?: string;
  auto_relearn?: boolean;
  log?: string[];
  bake_offs?: unknown[];
  retries?: unknown[];
  analyze?: AnalyzeResponse;
  patterns?: PatternBuildResponse;
  error?: string;
};

type ReelsBrainPlatformHealth = {
  platform: "tiktok" | "instagram" | "youtube";
  videos: number;
  analyzed: number;
  avg_score: number;
  winners: number;
  pattern_count: number;
  source_providers: { provider: string; count: number }[];
  training_readiness: { ready: boolean; score: number; missing: string[] };
  relearn_policy: {
    min_found: number;
    min_relevant: number;
    min_inserted: number;
    stale_days: number;
    bake_off_limit: number;
    retry_limit: number;
  };
  quality_gates: {
    min_videos: number;
    min_analyzed: number;
    min_patterns: number;
    min_winners: number;
  };
  recommended_queries: string[];
  provider_history: {
    provider: string;
    source: string;
    updated_at: string;
    avg_score?: number;
  }[];
  query_leaderboard: {
    query: string;
    runs: number;
    found: number;
    relevant: number;
    inserted: number;
    score: number;
    low_yield_runs?: number;
    empty_runs?: number;
    suppressed_until?: string;
    updated_at: string;
  }[];
  suppressed_queries?: {
    query: string;
    runs: number;
    found: number;
    relevant: number;
    inserted: number;
    score: number;
    low_yield_runs?: number;
    empty_runs?: number;
    suppressed_until?: string;
    updated_at: string;
  }[];
  recovery_queries?: {
    query: string;
    runs: number;
    found: number;
    relevant: number;
    inserted: number;
    score: number;
    low_yield_runs?: number;
    empty_runs?: number;
    suppressed_until?: string;
    updated_at: string;
  }[];
  preferred_provider?: { provider?: string; updated_at?: string; source?: string } | null;
  provider_stale_days?: number | null;
  provider_drift?: boolean;
  alerts?: string[];
  status?: "ready" | "watch" | "weak";
};

type BrainSummaryResponse = {
  ok?: boolean;
  niche?: string;
  total_videos?: number;
  total_winners?: number;
  platforms?: ReelsBrainPlatformHealth[];
  preferred_source_providers?: Record<string, { provider?: string; updated_at?: string; source?: string }>;
  source_provider_history?: {
    platform: string;
    provider: string;
    source: string;
    updated_at: string;
    avg_score?: number;
  }[];
  incidents?: {
    id: string;
    platform: string;
    severity: "info" | "watch" | "critical";
    kind: string;
    message: string;
    created_at: string;
    provider?: string;
    query?: string;
  }[];
  automation_history?: {
    id: string;
    mode?: "daily" | "weekly" | "growth" | "bulk" | "learning" | "analyze";
    strategy?: string;
    created_at: string;
    niche?: string;
    platforms?: string[];
    ok?: boolean;
    found?: number;
    inserted?: number;
    analyzed?: number;
    relevant?: number;
    retries?: number;
    errors?: number;
    best_provider?: string | null;
  }[];
  warnings?: string[];
  error?: string;
};

type AutomationPlatformMetrics = {
  found?: number;
  inserted?: number;
  relevant?: number;
  analyzed?: number;
  bake_offs?: number;
  retries?: number;
  errors?: string[];
};

type AutomationPlatformRun = {
  platform: "tiktok" | "instagram" | "youtube";
  plan?: {
    queries?: string[];
    source_limit?: number;
    analyze_limit?: number;
    bake_off_limit?: number;
  };
  ok?: boolean;
  metrics?: AutomationPlatformMetrics;
  log?: string[];
  error?: string | null;
  bake_off?: {
    ok?: boolean;
    best_provider?: string | null;
    stable_provider?: string | null;
    source_memory_updated?: boolean;
    error?: string | null;
  };
  loop?: {
    ok?: boolean;
    metrics?: AutomationPlatformMetrics;
    log?: string[];
    error?: string | null;
  };
};

type AutomationDigestPlatform = {
  platform: "tiktok" | "instagram" | "youtube";
  status: "ready" | "weak";
  readiness_score: number;
  preferred_provider?: string | null;
  preferred_provider_age_days?: number | null;
  provider_drift?: boolean;
  videos: number;
  analyzed: number;
  winners: number;
  pattern_count: number;
  top_query?: string | null;
};

type AutomationRunResponse = {
  ok?: boolean;
  mode?: "daily" | "weekly" | "growth" | "bulk" | "learning" | "analyze";
  niches?: string[];
  platforms?: string[];
  query_count?: number;
  source_limit?: number;
  analyze_limit?: number;
  persist_memory?: boolean;
  runs?: {
    niche: string;
    platforms: AutomationPlatformRun[];
    digest?: {
      niche: string;
      overall_status: "ready" | "watch";
      total_incidents: number;
      critical_incidents: number;
      platforms: AutomationDigestPlatform[];
    } | null;
    digest_error?: string | null;
  }[];
  warning?: string;
  error?: string;
  meta?: {
    strategy?: "bulk" | "analyze";
    execute?: boolean;
    hours?: number;
    next_run_after_minutes?: number;
    target_ticks?: number;
  };
  captured_at?: string;
};

type AutomationHistoryItem = {
  id: string;
  title: string;
  captured_at: string;
  mode?: "daily" | "weekly" | "growth" | "bulk" | "learning" | "analyze";
  niches: number;
  source?: "local" | "server";
  found: number;
  inserted: number;
  analyzed: number;
  relevant: number;
  retries: number;
  errors: number;
  best_provider?: string | null;
  ok?: boolean;
};

type GrowthRunResponse = {
  ok?: boolean;
  mode?: "daily" | "weekly" | "growth" | "bulk_raw_ingest";
  execute?: boolean;
  niches?: string[];
  platforms?: string[];
  queue?: (AutomationPlatformRun & {
    niche: string;
    current_videos?: number;
    corpus_target?: number;
    gap?: number;
    progress_pct?: number;
  })[];
  runs?: (Partial<AutomationPlatformRun> & {
    niche: string;
    platform: "tiktok" | "instagram" | "youtube";
    found?: number;
    normalized?: number;
    inserted?: number;
    rejected?: number;
    provider?: string;
    query?: string;
  })[];
  warning?: string;
  error?: string;
};

type AnalyzeBacklogResponse = {
  ok?: boolean;
  mode?: "analyze_backlog";
  execute?: boolean;
  niches?: string[];
  platforms?: string[];
  max_lanes?: number;
  limit?: number;
  build_patterns?: boolean;
  lanes?: {
    niche: string;
    platform: "tiktok" | "instagram" | "youtube";
    total?: number;
    analyzed?: number;
    unanalyzed?: number;
    backlog_pct?: number;
  }[];
  queue?: {
    niche: string;
    platform: "tiktok" | "instagram" | "youtube";
    total?: number;
    analyzed?: number;
    unanalyzed?: number;
    backlog_pct?: number;
    analyze_limit?: number;
  }[];
  runs?: (Partial<AutomationPlatformRun> & {
    niche: string;
    platform: "tiktok" | "instagram" | "youtube";
  })[];
  automation_summary?: {
    ok?: boolean;
    found?: number;
    inserted?: number;
    analyzed?: number;
    relevant?: number;
    retries?: number;
    errors?: number;
    best_provider?: string | null;
  };
  warning?: string;
  error?: string;
};

type LearningRunResponse = {
  ok?: boolean;
  mode?: "background_learning";
  strategy?: "bulk" | "analyze";
  execute?: boolean;
  hours?: number;
  schedule?: {
    next_run_after_minutes?: number;
    target_ticks?: number;
  };
  tick?: GrowthRunResponse;
  warning?: string;
  error?: string;
};

type SchedulerTask = {
  task: "bulk" | "analyze" | "daily" | "weekly";
  label: string;
  cadence_minutes: number;
  method: "POST";
  endpoint: string;
  reason: string;
  payload: Record<string, unknown>;
};

type SchedulerPlanResponse = {
  ok?: boolean;
  mode?: "scheduler_plan";
  niches?: string[];
  platforms?: string[];
  tasks?: SchedulerTask[];
  error?: string;
};

type SchedulerTickResponse = {
  ok?: boolean;
  mode?: "scheduler_tick";
  task?: SchedulerTask["task"];
  selected?: SchedulerTask;
  result?: AnalyzeBacklogResponse | GrowthRunResponse | AutomationRunResponse;
  error?: string;
};

type PortfolioDigestResponse = {
  ok?: boolean;
  niches?: {
    niche: string;
    status: "ready" | "watch";
    readiness_avg: number;
    total_incidents: number;
    critical_incidents: number;
    total_videos: number;
    platforms: {
      platform: "tiktok" | "instagram" | "youtube";
      status: "ready" | "weak";
      readiness_score: number;
      videos: number;
      analyzed: number;
      winners: number;
      pattern_count: number;
      preferred_provider?: string | null;
      preferred_provider_age_days?: number | null;
      provider_drift?: boolean;
      top_query?: string | null;
    }[];
  }[];
  portfolio?: {
    total_niches: number;
    ready_niches: number;
    watch_niches: number;
    critical_incidents: number;
    avg_readiness: number;
    corpus_goal?: {
      total_target?: number;
      total_progress?: {
        current?: number;
        target?: number;
        gap?: number;
        progress_pct?: number;
      };
      stage?: {
        stage_label?: string;
        stage_target?: number;
        remaining_to_stage?: number;
      };
    };
  };
  error?: string;
};

type LearningEconomicsResponse = {
  ok?: boolean;
  insights?: {
    summary?: string[];
    top_hooks?: LearningHookInsight[];
    hook_groups?: {
      op_hooks?: LearningHookInsight[];
      frequent_hooks?: LearningHookInsight[];
      experimental_hooks?: LearningHookInsight[];
    };
    winning_formats?: { label: string; frequency: number; avg_score: number; niches: string[] }[];
    retention_mechanics?: { label: string; frequency: number; avg_score: number; hooks: string[] }[];
    recipes?: {
      id: string;
      title: string;
      hook: string;
      format: string;
      retention: string;
      op_score: number;
      confidence?: "high" | "medium" | "low";
      niches: string[];
      creative_brief?: LearningCreativeBrief;
      generator_payload?: LearningGeneratorPayload;
      examples?: LearningReferenceExample[];
    }[];
    source_references?: (LearningReferenceExample & {
      hook_type?: string;
      hook_label?: string;
      op_score?: number;
      confidence?: "high" | "medium" | "low";
    })[];
    source_map?: {
      provider: string;
      runs: number;
      found: number;
      inserted: number;
      analyzed: number;
      relevant?: number;
      errors: number;
      estimated_spend_usd: number;
      actual_spend_usd?: number;
      spend_source?: "estimated" | "actual" | "mixed";
      cost_per_inserted: number | null;
      cost_per_analyzed: number | null;
      cost_per_useful?: number | null;
      waste_score?: number;
      niches: string[];
    }[];
    source_rankings?: LearningSourceRanking[];
    recommended_spend_plan?: {
      split?: {
        exploit_pct?: number;
        explore_pct?: number;
        refresh_pct?: number;
      };
      next_actions?: string[];
      scale_sources?: LearningSourceRanking[];
      explore_sources?: LearningSourceRanking[];
      refresh_sources?: LearningSourceRanking[];
      avoid_sources?: LearningSourceRanking[];
      best_provider?: {
        provider: string;
        runs: number;
        analyzed: number;
        inserted: number;
        cost_per_useful?: number | null;
        spend_source?: "estimated" | "actual" | "mixed";
      } | null;
    };
    economics_summary?: {
      source_memory_count: number;
      scalable_sources: number;
      avoid_sources: number;
      best_source?: {
        label: string;
        yield_score: number;
        estimated_cost_per_relevant_usd: number;
      } | null;
      cheapest_provider?: {
        provider: string;
        cost_per_useful?: number | null;
        spend_source?: "estimated" | "actual" | "mixed";
      } | null;
      billing_truth?: "estimated_only" | "mixed_or_actual";
      note?: string;
    };
    legal_guard?: {
      principle: string;
      allowed: string[];
      forbidden: string[];
    };
    capability_status?: { key: string; label: string; status: string }[];
  };
  niches?: {
    niche: string;
    updated_at?: string | null;
    total_videos: number;
    analyzed_videos: number;
    patterns: number;
    generator_ready_patterns: number;
    cross_platform_patterns: number;
    avg_relevance_score: number;
    understanding_score: number;
    platform_brains?: Record<string, {
      total_videos: number;
      analyzed_videos: number;
      patterns: number;
      generator_ready_patterns: number;
    }>;
  }[];
  totals?: {
    total_videos: number;
    analyzed_videos: number;
    patterns: number;
    generator_ready_patterns: number;
    cross_platform_patterns: number;
    avg_understanding_score: number;
    cost_units_per_inserted_recent: number | null;
    cost_units_per_inserted_previous: number | null;
    cost_trend: "cheaper" | "more_expensive" | "flat" | "not_enough_data";
    today_usd_per_useful_video?: number | null;
    yesterday_usd_per_useful_video?: number | null;
    day_cost_trend?: "cheaper" | "more_expensive" | "flat" | "not_enough_data";
  };
  timeline?: {
    id: string;
    mode: AutomationHistoryItem["mode"];
    strategy?: string | null;
    created_at: string;
    niches: string[];
    ok: boolean;
    found: number;
    inserted: number;
    analyzed: number;
    relevant: number;
    retries: number;
    errors: number;
    best_provider?: string | null;
    cost_units: number;
    inserted_per_100_cost_units: number;
    analyzed_per_100_cost_units: number;
    cost_units_per_inserted: number | null;
    cost_units_per_analyzed: number | null;
    spend_usd?: number;
    spend_source?: "estimated" | "actual";
    usd_per_inserted?: number | null;
    usd_per_analyzed?: number | null;
    usd_per_relevant?: number | null;
    cumulative_inserted: number;
    cumulative_analyzed: number;
    cumulative_cost_units: number;
  }[];
  daily_costs?: {
    today?: LearningEconomicsDailyCost | null;
    yesterday?: LearningEconomicsDailyCost | null;
    rows?: LearningEconomicsDailyCost[];
  };
  warning?: string;
  error?: string;
};

type LearningHookInsight = {
  hook_type: string;
  hook_label: string;
  frequency: number;
  avg_score: number;
  quality_score: number;
  relevance_score: number;
  op_score: number;
  confidence?: "high" | "medium" | "low";
  status: "op_hook" | "strong" | "stable" | "watch";
  segment?: "op_hooks" | "frequent_hooks" | "experimental_hooks";
  evidence?: {
    based_on_videos: number;
    niche_count: number;
    platform_count: number;
    reference_count: number;
  };
  niches: string[];
  platforms: string[];
  templates: string[];
  examples?: LearningReferenceExample[];
};

type LearningCreativeBrief = {
  hook: string;
  retention_mechanic: string;
  second_by_second: string[];
  visual_recipe: string[];
  product_fit: string[];
  copy_as_mechanic: string[];
  do_not_copy: string[];
};

type LearningReferenceExample = {
  reference_id?: string;
  url?: string | null;
  hook?: string | null;
  score?: number;
  views?: number;
  why_selected?: string;
  confidence?: "high" | "medium" | "low";
  safety_flags?: string[];
  creative_brief?: LearningCreativeBrief;
};

type LearningSourceRanking = {
  id: string;
  niche: string;
  platform: "tiktok" | "instagram" | "youtube";
  type: "query" | "hashtag" | "account" | "sound" | "manual_url";
  value: string;
  status: "active" | "paused" | "banned";
  yield_score: number;
  relevance_rate: number;
  breakout_rate: number;
  cost_per_relevant_units: number;
  estimated_cost_per_relevant_usd: number;
  runs: number;
  found: number;
  relevant: number;
  breakout: number;
  inserted: number;
  waste_score: number;
  lane: "exploit" | "explore" | "refresh" | "hold";
  recommendation: "scale" | "explore_more" | "keep_testing" | "avoid" | "skip";
  reason?: string;
};

type LearningGeneratorPayload = {
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

type ReelsBrainActionPlanResponse = {
  ok?: boolean;
  summary?: {
    lanes: number;
    known_sources: number;
    scale_sources: number;
    explore_sources: number;
    stop_sources: number;
    estimated_cost_units_per_useful: number | null;
  };
  next_collection_plan?: {
    instruction?: string;
    payloads?: {
      lane: string;
      provider_hint?: string | null;
      source_run_payload?: {
        niche: string;
        target_platform: string;
        query: string;
        limit: number;
        provider_hint?: string | null;
        discovery_source_id: string;
        discovery_source_type: string;
      };
    }[];
  };
  scale_sources?: LearningSourceRanking[];
  explore_sources?: LearningSourceRanking[];
  stop_list?: {
    id: string;
    niche: string;
    platform: string;
    type: string;
    value: string;
    yield_score: number;
    relevance_rate: number;
    cost_per_relevant: number;
    reason: string;
  }[];
  replay?: {
    enabled?: boolean;
    persisted?: boolean;
    results?: unknown[];
    warnings?: string[];
  };
  error?: string;
};

type ReelsBrainCreativeBriefsResponse = {
  ok?: boolean;
  count?: number;
  briefs?: {
    id: string;
    niche: string;
    title: string;
    hook: string;
    retention_mechanic: string;
    structure: string;
    product_fit: string[];
    confidence: "high" | "medium" | "low";
    op_score: number;
  }[];
  notes?: string[];
  error?: string;
};

type ReelsBrainCreativeMemoryResponse = {
  ok?: boolean;
  summary?: {
    atoms?: number;
    dna?: number;
    anti_patterns?: number;
    experiment_skeletons?: number;
    product_brains?: number;
    audience_brains?: number;
  };
  memory?: {
    atoms?: {
      id: string;
      type: string;
      label: string;
      value: string;
      score: number;
      evidence_count: number;
      niches: string[];
    }[];
    dna?: {
      id: string;
      niche: string;
      score: number;
      confidence: "high" | "medium" | "low";
      atoms: Record<string, string>;
      anti_patterns?: string[];
    }[];
    anti_patterns?: {
      id: string;
      label: string;
      severity: "watch" | "avoid";
      evidence_count: number;
    }[];
    product_brain?: {
      product_type: string;
      recommended_formats?: string[];
    }[];
    audience_brain?: {
      audience: string;
      tone_rules?: string[];
    }[];
    experiment_skeletons?: {
      id: string;
      niche: string;
      variants?: {
        axis: string;
        change_to: string;
        reason: string;
      }[];
    }[];
  };
  notes?: string[];
  error?: string;
};

type ReelsBrainAudioIntelligenceResponse = {
  ok?: boolean;
  summary?: {
    patterns?: number;
    sound_titles?: number;
    strategies?: number;
    worker_stages?: number;
  };
  audio?: {
    patterns?: {
      id: string;
      niche: string;
      score: number;
      confidence: "high" | "medium" | "low";
      strategy: string;
      speech: {
        starts_immediately: boolean;
        suggested_speed: string;
        first_phrase_rule: string;
        pause_rules?: string[];
      };
      music: {
        role: string;
        bpm_range: string;
        energy: string;
        sound_examples?: string[];
      };
      edit_sync: {
        first_sound_event: string;
        cut_rhythm: string;
        beat_map_hint?: string[];
      };
      best_for?: string[];
      avoid?: string[];
    }[];
    top_sound_titles?: {
      title: string;
      evidence_count: number;
      niches: string[];
    }[];
    strategy_mix?: {
      strategy: string;
      count: number;
      avg_score: number;
    }[];
    editor_rules?: string[];
    next_pipeline?: {
      stage: string;
      status: "ready_now" | "needs_worker" | "planned";
      tool: string;
      output: string;
    }[];
  };
  notes?: string[];
  error?: string;
};

type ReelsBrainVisualIntelligenceResponse = {
  ok?: boolean;
  summary?: {
    patterns?: number;
    camera_styles?: number;
    editing_moves?: number;
    editor_payloads?: number;
  };
  visual?: {
    patterns?: {
      id: string;
      niche: string;
      score: number;
      confidence: "high" | "medium" | "low";
      camera: {
        primary: string;
        secondary?: string[];
        framing: string;
        movement: string;
        proof_shot: string;
      };
      editing: {
        rhythm: string;
        moves?: string[];
        first_3_seconds?: string[];
        timeline?: { t: string; action: string }[];
      };
      visual_recipe?: string[];
      product_fit?: string[];
      avoid?: string[];
    }[];
    camera_mix?: {
      camera: string;
      count: number;
      avg_score: number;
    }[];
    editing_mix?: {
      move: string;
      count: number;
      avg_score: number;
    }[];
    editor_payloads?: {
      id: string;
      niche: string;
      score: number;
      camera: string;
      moves: string[];
      timeline: { t: string; action: string }[];
    }[];
    director_rules?: string[];
  };
  notes?: string[];
  error?: string;
};

type ReelsBrainSimulationResponse = {
  ok?: boolean;
  summary?: {
    simulations?: number;
    ship?: number;
    revise?: number;
    hold?: number;
    personas?: number;
  };
  simulation?: {
    simulations?: {
      id: string;
      niche: string;
      score: number;
      readiness: "ship" | "revise" | "hold";
      creative_score: number;
      audio_score: number;
      visual_score: number;
      strongest_reason: string;
      biggest_risk: string;
      recommended_iteration: string;
      persona_scores?: {
        persona: string;
        score: number;
        likely_reaction: string;
        suggested_fix: string;
      }[];
      generator_guardrails?: string[];
    }[];
    persona_summary?: {
      persona: string;
      avg_score: number;
      likely_reactions?: Record<string, number>;
      top_concerns?: string[];
    }[];
    top_ship_candidates?: {
      id: string;
      niche: string;
      score: number;
      readiness: "ship" | "revise" | "hold";
      strongest_reason: string;
      biggest_risk: string;
      recommended_iteration: string;
    }[];
    revise_queue?: {
      id: string;
      niche: string;
      score: number;
      readiness: "ship" | "revise" | "hold";
      biggest_risk: string;
      recommended_iteration: string;
    }[];
    global_guardrails?: string[];
  };
  notes?: string[];
  error?: string;
};

type ReelsBrainExperimentResponse = {
  ok?: boolean;
  summary?: {
    experiments?: number;
    launch?: number;
    hold?: number;
    axes?: number;
  };
  experiment?: {
    experiments?: {
      id: string;
      niche: string;
      readiness: "ship" | "revise" | "hold";
      priority_score: number;
      hypothesis: string;
      axis: string;
      keep_fixed: string[];
      variant: {
        change_to: string;
        reason: string;
      };
      success_metrics: string[];
      stop_rule: string;
      risk: string;
      expected_learning: string;
    }[];
    by_axis?: {
      axis: string;
      count: number;
      avg_priority: number;
    }[];
    launch_queue?: {
      id: string;
      niche: string;
      readiness: "ship" | "revise" | "hold";
      priority_score: number;
      hypothesis: string;
      axis: string;
      variant: { change_to: string; reason: string };
      success_metrics: string[];
      stop_rule: string;
      risk: string;
    }[];
    hold_queue?: {
      id: string;
      niche: string;
      priority_score: number;
      axis: string;
      risk: string;
    }[];
    experiment_rules?: string[];
  };
  notes?: string[];
  error?: string;
};

type LearningEconomicsDailyCost = {
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
  usd_per_found: number | null;
  usd_per_inserted: number | null;
  usd_per_analyzed: number | null;
  usd_per_relevant: number | null;
  cost_units_per_inserted: number | null;
};

const DEFAULT_NICHE = "ru_toys";
const DEFAULT_AUTOMATION_NICHES = "ru_toys,ru_clothing,ru_cosmetics";
const DEFAULT_QUERIES = [
  "водяной пистолет обзор",
  "детская игрушка распаковка",
  "бластер тест",
];
const PLATFORM_OPTIONS = ["tiktok", "instagram", "youtube"] as const;
const AUTOMATION_HISTORY_KEY = "reels-brain-automation-history-v1";
const AUTOMATION_HISTORY_LIMIT = 8;

const PROVIDER_LABELS: Record<string, string> = {
  virlo: "Virlo",
  apify: "Apify generic",
  apify_tiktok: "Apify TikTok",
  apify_instagram: "Apify Instagram",
  apify_youtube: "Apify YouTube",
  youtube: "YouTube API",
  bright_tiktok: "Bright TikTok",
  bright_instagram: "Bright Instagram",
  bright_youtube: "Bright YouTube",
  ensemble_tiktok: "Ensemble TikTok",
  ensemble_instagram: "Ensemble Instagram",
  ensemble_youtube: "Ensemble YouTube",
};

const PROVIDER_PREFERENCE = [
  "virlo",
  "apify_tiktok",
  "youtube",
  "bright_tiktok",
  "bright_youtube",
  "ensemble_tiktok",
  "ensemble_youtube",
  "apify_instagram",
  "ensemble_instagram",
];

const nf = new Intl.NumberFormat("ru-RU");

function providerLabel(provider: string) {
  return PROVIDER_LABELS[provider] || provider;
}

function compactNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return nf.format(Number(value));
}

function formatUsd(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  if (number > 0 && number < 0.01) return `$${number.toFixed(4)}`;
  return `$${number.toFixed(2)}`;
}

function usefulVideoCost(row: LearningEconomicsDailyCost | null | undefined) {
  return row?.usd_per_relevant ?? row?.usd_per_analyzed ?? row?.usd_per_inserted ?? null;
}

function usefulCostBasis(row: LearningEconomicsDailyCost | null | undefined) {
  if (!row) return { label: "no data", count: 0 };
  if (row.usd_per_relevant != null) return { label: "useful", count: row.relevant };
  if (row.usd_per_analyzed != null) return { label: "memory", count: row.analyzed };
  if (row.usd_per_inserted != null) return { label: "saved", count: row.inserted };
  return { label: "no data", count: 0 };
}

function spendSourceLabel(source: LearningEconomicsDailyCost["spend_source"] | "estimated" | "actual" | "mixed" | undefined) {
  if (source === "actual") return "actual billing";
  if (source === "mixed") return "mixed";
  return "estimated";
}

const HOOK_LABELS: Record<string, string> = {
  unknown: "хук не распознан",
  curiosity_question: "вопрос-интрига",
  warning_pattern_break: "предупреждение / слом ожидания",
  list_promise: "обещание списка",
  before_after: "до/после",
  demo_review: "демо / обзор",
  curiosity_gap: "интрига с пробелом",
  direct_claim: "прямое заявление",
};

const STRUCTURE_LABELS: Record<string, string> = {
  unknown_structure: "структура не определена",
  unboxing: "распаковка",
  before_after: "до/после",
  review: "обзор",
  life_hack: "лайфхак",
  pov: "POV-сценка",
  demo: "демонстрация",
};

const RETENTION_LABELS: Record<string, string> = {
  proof_wait: "ожидание доказательства",
  curiosity_gap: "удержание интригой",
  delayed_payoff: "отложенная развязка",
  surprise_hold: "удержание удивлением",
  transformation_wait: "ожидание трансформации",
  open_loop: "открытая петля",
};

function fallbackPatternLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\s+/g, " ").trim() || "не распознано";
}

function patternHookLabel(pattern: PatternMemoryItem) {
  return pattern.hook_label || HOOK_LABELS[pattern.hook_type] || fallbackPatternLabel(pattern.hook_type);
}

function patternStructureLabel(pattern: PatternMemoryItem) {
  return pattern.structure_label || STRUCTURE_LABELS[pattern.structure_type] || fallbackPatternLabel(pattern.structure_type);
}

function patternRetentionLabel(pattern: PatternMemoryItem) {
  return pattern.retention_label || RETENTION_LABELS[pattern.retention_mechanism] || fallbackPatternLabel(pattern.retention_mechanism);
}

function percent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Math.round(Number(value) * 100)}%`;
}

function queriesFromText(value: string) {
  return Array.from(new Set(value.split("\n").map((x) => x.trim()).filter(Boolean))).slice(0, 12);
}

function titlePlatform(value: string) {
  if (value === "instagram") return "Instagram";
  if (value === "youtube") return "YouTube";
  return "TikTok";
}

function statusTone(status: string | undefined) {
  if (status === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "watch") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-red-200 bg-red-50 text-red-700";
}

function manualSeedItemsFromText(value: string): Array<string | Record<string, unknown>> {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.startsWith("{") && line.endsWith("}")) {
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
        } catch {}
      }
      return line;
    });
}

function defaultProviderSelection(available: string[]) {
  const preferred = PROVIDER_PREFERENCE.filter((provider) => available.includes(provider));
  const fallback = available.filter((provider) => provider !== "bright_instagram");
  return (preferred.length ? preferred : fallback).slice(0, 6);
}

function scoreTone(score: number | null | undefined) {
  const value = Number(score || 0);
  if (value >= 40) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value >= 24) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function automationTitle(mode: AutomationHistoryItem["mode"]) {
  if (mode === "weekly") return "Weekly retrain";
  if (mode === "growth") return "10k growth";
  if (mode === "bulk") return "Bulk ingest";
  if (mode === "learning") return "Learning tick";
  if (mode === "analyze") return "Analyze backlog";
  return "Daily loop";
}

function formatMs(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const ms = Math.max(0, Math.round(Number(value)));
  if (ms < 1_000) return `${ms} ms`;
  return `${(ms / 1_000).toFixed(1)} s`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDelta(value: number, invert = false) {
  if (!Number.isFinite(value) || value === 0) return "0";
  const sign = value > 0 ? "+" : "";
  const good = invert ? value < 0 : value > 0;
  return `${sign}${compactNumber(value)}|${good ? "good" : "bad"}`;
}

function costTrendCopy(trend: LearningEconomicsResponse["totals"] extends infer T ? T extends { cost_trend: infer U } ? U : never : never) {
  if (trend === "cheaper") return { label: "дешевеет", tone: "border-emerald-200 bg-emerald-50 text-emerald-700", text: "стоимость нового видео падает" };
  if (trend === "more_expensive") return { label: "дорожает", tone: "border-amber-200 bg-amber-50 text-amber-800", text: "новые видео добываются тяжелее" };
  if (trend === "flat") return { label: "ровно", tone: "border-slate-200 bg-slate-50 text-slate-700", text: "эффективность примерно стабильна" };
  return { label: "мало данных", tone: "border-slate-200 bg-slate-50 text-slate-500", text: "нужно больше сохраненных прогонов" };
}

function hookStatusCopy(status: "op_hook" | "strong" | "stable" | "watch" | undefined) {
  if (status === "op_hook") return { label: "OP hook", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  if (status === "strong") return { label: "strong", tone: "border-cyan-200 bg-cyan-50 text-cyan-800" };
  if (status === "stable") return { label: "stable", tone: "border-slate-200 bg-slate-50 text-slate-700" };
  return { label: "watch", tone: "border-amber-200 bg-amber-50 text-amber-800" };
}

function confidenceCopy(confidence: "high" | "medium" | "low" | undefined) {
  if (confidence === "high") return { label: "high confidence", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  if (confidence === "medium") return { label: "medium confidence", tone: "border-cyan-200 bg-cyan-50 text-cyan-800" };
  return { label: "low confidence", tone: "border-amber-200 bg-amber-50 text-amber-800" };
}

function sourceRecommendationCopy(recommendation: LearningSourceRanking["recommendation"] | undefined) {
  if (recommendation === "scale") return { label: "лить бюджет", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  if (recommendation === "explore_more") return { label: "дотестить", tone: "border-cyan-200 bg-cyan-50 text-cyan-800" };
  if (recommendation === "keep_testing") return { label: "освежить", tone: "border-amber-200 bg-amber-50 text-amber-800" };
  if (recommendation === "avoid") return { label: "стоп", tone: "border-red-200 bg-red-50 text-red-700" };
  return { label: "пропустить", tone: "border-slate-200 bg-slate-50 text-slate-600" };
}

function capabilityTone(status: string) {
  if (status === "live") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "payload_ready" || status === "ui_ready") return "border-cyan-200 bg-cyan-50 text-cyan-800";
  if (status === "planned") return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

async function readJson<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof json?.error === "string" ? json.error : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return json as T;
}

export default function ReelsBrainPage() {
  const [health, setHealth] = useState<ProviderHealth | null>(null);
  const [providerError, setProviderError] = useState("");
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [targetPlatform, setTargetPlatform] = useState<"tiktok" | "instagram" | "youtube">("tiktok");

  const [niche, setNiche] = useState(DEFAULT_NICHE);
  const [queriesText, setQueriesText] = useState(DEFAULT_QUERIES.join("\n"));
  const [limit, setLimit] = useState(10);
  const [persist, setPersist] = useState(false);
  const [running, setRunning] = useState(false);
  const [bakeOff, setBakeOff] = useState<BakeOffResponse | null>(null);
  const [runError, setRunError] = useState("");

  const [corpus, setCorpus] = useState<CorpusResponse | null>(null);
  const [loadingCorpus, setLoadingCorpus] = useState(false);
  const [corpusError, setCorpusError] = useState("");
  const [minScore, setMinScore] = useState("0");

  const [sourceQuery, setSourceQuery] = useState(DEFAULT_QUERIES[0]);
  const [sourceLimit, setSourceLimit] = useState(12);
  const [sourceRunning, setSourceRunning] = useState(false);
  const [sourceRunResult, setSourceRunResult] = useState<SourceRunResponse | null>(null);
  const [sourceRunError, setSourceRunError] = useState("");

  const [manualSeedQuery, setManualSeedQuery] = useState("manual");
  const [manualSeedText, setManualSeedText] = useState("");
  const [manualSeeding, setManualSeeding] = useState(false);
  const [manualSeedResult, setManualSeedResult] = useState<ManualSeedResponse | null>(null);
  const [manualSeedError, setManualSeedError] = useState("");

  const [analyzeLimit, setAnalyzeLimit] = useState(8);
  const [analyzeDryRun, setAnalyzeDryRun] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResponse | null>(null);
  const [analyzeError, setAnalyzeError] = useState("");

  const [patternLimit, setPatternLimit] = useState(300);
  const [patternPersist, setPatternPersist] = useState(true);
  const [buildingPatterns, setBuildingPatterns] = useState(false);
  const [patternResult, setPatternResult] = useState<PatternBuildResponse | null>(null);
  const [patternError, setPatternError] = useState("");

  const [loopSourceLimit, setLoopSourceLimit] = useState(20);
  const [loopAnalyzeLimit, setLoopAnalyzeLimit] = useState(8);
  const [loopPersistPatterns, setLoopPersistPatterns] = useState(true);
  const [loopRunning, setLoopRunning] = useState(false);
  const [loopResult, setLoopResult] = useState<LoopResponse | null>(null);
  const [loopError, setLoopError] = useState("");

  const [brainSummary, setBrainSummary] = useState<BrainSummaryResponse | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [quickActionLoading, setQuickActionLoading] = useState<null | string>(null);
  const [automationNiches, setAutomationNiches] = useState(DEFAULT_AUTOMATION_NICHES);
  const [portfolioDigest, setPortfolioDigest] = useState<PortfolioDigestResponse | null>(null);
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);
  const [portfolioError, setPortfolioError] = useState("");
  const [learningEconomics, setLearningEconomics] = useState<LearningEconomicsResponse | null>(null);
  const [loadingLearningEconomics, setLoadingLearningEconomics] = useState(false);
  const [learningEconomicsError, setLearningEconomicsError] = useState("");
  const [actionPlan, setActionPlan] = useState<ReelsBrainActionPlanResponse | null>(null);
  const [actionPlanLoading, setActionPlanLoading] = useState(false);
  const [actionPlanError, setActionPlanError] = useState("");
  const [creativeBriefs, setCreativeBriefs] = useState<ReelsBrainCreativeBriefsResponse | null>(null);
  const [creativeBriefsLoading, setCreativeBriefsLoading] = useState(false);
  const [creativeBriefsError, setCreativeBriefsError] = useState("");
  const [creativeMemory, setCreativeMemory] = useState<ReelsBrainCreativeMemoryResponse | null>(null);
  const [creativeMemoryLoading, setCreativeMemoryLoading] = useState(false);
  const [creativeMemoryError, setCreativeMemoryError] = useState("");
  const [audioIntelligence, setAudioIntelligence] = useState<ReelsBrainAudioIntelligenceResponse | null>(null);
  const [audioIntelligenceLoading, setAudioIntelligenceLoading] = useState(false);
  const [audioIntelligenceError, setAudioIntelligenceError] = useState("");
  const [visualIntelligence, setVisualIntelligence] = useState<ReelsBrainVisualIntelligenceResponse | null>(null);
  const [visualIntelligenceLoading, setVisualIntelligenceLoading] = useState(false);
  const [visualIntelligenceError, setVisualIntelligenceError] = useState("");
  const [simulationBrain, setSimulationBrain] = useState<ReelsBrainSimulationResponse | null>(null);
  const [simulationBrainLoading, setSimulationBrainLoading] = useState(false);
  const [simulationBrainError, setSimulationBrainError] = useState("");
  const [experimentBrain, setExperimentBrain] = useState<ReelsBrainExperimentResponse | null>(null);
  const [experimentBrainLoading, setExperimentBrainLoading] = useState(false);
  const [experimentBrainError, setExperimentBrainError] = useState("");
  const [insightNicheFilter, setInsightNicheFilter] = useState("all");
  const [insightConfidenceFilter, setInsightConfidenceFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [insightSegmentFilter, setInsightSegmentFilter] = useState<"all" | "op_hooks" | "frequent_hooks" | "experimental_hooks">("all");
  const [automationResult, setAutomationResult] = useState<AutomationRunResponse | null>(null);
  const [automationError, setAutomationError] = useState("");
  const [automationRunning, setAutomationRunning] = useState<null | "daily" | "weekly" | "growth" | "analyze">(null);
  const [automationSyncing, setAutomationSyncing] = useState(false);
  const [automationHistory, setAutomationHistory] = useState<AutomationHistoryItem[]>([]);
  const [schedulerPlan, setSchedulerPlan] = useState<SchedulerPlanResponse | null>(null);
  const [schedulerLoading, setSchedulerLoading] = useState(false);
  const [schedulerError, setSchedulerError] = useState("");
  const [analyzeBacklog, setAnalyzeBacklog] = useState<AnalyzeBacklogResponse | null>(null);
  const [analyzeBacklogLoading, setAnalyzeBacklogLoading] = useState(false);
  const [analyzeBacklogError, setAnalyzeBacklogError] = useState("");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AUTOMATION_HISTORY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setAutomationHistory(parsed.filter((item) => item && typeof item === "object").slice(0, AUTOMATION_HISTORY_LIMIT) as AutomationHistoryItem[]);
      }
    } catch {}
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadInitial() {
      setLoadingProviders(true);
      setProviderError("");
      try {
        const data = await readJson<ProviderHealth>(await fetch("/api/factory/reels-brain/providers", { cache: "no-store" }));
        if (!alive) return;
        setHealth(data);
        const available = Array.isArray(data.available) ? data.available : [];
        setSelectedProviders(defaultProviderSelection(available));
      } catch (e) {
        if (alive) setProviderError(String((e as Error)?.message || e));
      } finally {
        if (alive) setLoadingProviders(false);
      }
    }
    void loadInitial();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadInitialCorpus() {
      setLoadingCorpus(true);
      try {
        const url = `/api/factory/reels-brain/corpus?niche=${encodeURIComponent(DEFAULT_NICHE)}&limit=30`;
        const data = await readJson<CorpusResponse>(await fetch(url, { cache: "no-store" }));
        if (alive) setCorpus(data);
      } catch {
        if (alive) setCorpus(null);
      } finally {
        if (alive) setLoadingCorpus(false);
      }
    }
    void loadInitialCorpus();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadInitialSummary() {
      setLoadingSummary(true);
      try {
        const data = await readJson<BrainSummaryResponse>(await fetch(`/api/factory/reels-brain/summary?niche=${encodeURIComponent(DEFAULT_NICHE)}`, { cache: "no-store" }));
        if (alive) setBrainSummary(data);
      } catch {
        if (alive) setBrainSummary(null);
      } finally {
        if (alive) setLoadingSummary(false);
      }
    }
    void loadInitialSummary();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadInitialPortfolio() {
      setLoadingPortfolio(true);
      try {
        const data = await readJson<PortfolioDigestResponse>(await fetch(`/api/factory/reels-brain/digest-all?niches=${encodeURIComponent(DEFAULT_AUTOMATION_NICHES)}`, { cache: "no-store" }));
        if (alive) setPortfolioDigest(data);
      } catch {
        if (alive) setPortfolioDigest(null);
      } finally {
        if (alive) setLoadingPortfolio(false);
      }
    }
    void loadInitialPortfolio();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadInitialLearningEconomics() {
      setLoadingLearningEconomics(true);
      try {
        const data = await readJson<LearningEconomicsResponse>(await fetch(`/api/factory/reels-brain/learning-economics?niches=${encodeURIComponent(DEFAULT_AUTOMATION_NICHES)}`, { cache: "no-store" }));
        if (alive) setLearningEconomics(data);
      } catch {
        if (alive) setLearningEconomics(null);
      } finally {
        if (alive) setLoadingLearningEconomics(false);
      }
    }
    void loadInitialLearningEconomics();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadInitialAnalyzeBacklog() {
      setAnalyzeBacklogLoading(true);
      try {
        const params = new URLSearchParams({
          niches: DEFAULT_AUTOMATION_NICHES,
          platforms: PLATFORM_OPTIONS.join(","),
          max_lanes: "9",
          limit: "18",
        });
        const data = await readJson<AnalyzeBacklogResponse>(await fetch(`/api/factory/jobs/reels-brain-analyze-backlog?${params}`, { cache: "no-store" }));
        if (alive) setAnalyzeBacklog(data);
      } catch {
        if (alive) setAnalyzeBacklog(null);
      } finally {
        if (alive) setAnalyzeBacklogLoading(false);
      }
    }
    void loadInitialAnalyzeBacklog();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadInitialCreativeLayers() {
      setCreativeMemoryLoading(true);
      setAudioIntelligenceLoading(true);
      setVisualIntelligenceLoading(true);
      setSimulationBrainLoading(true);
      setExperimentBrainLoading(true);
      try {
        const [memory, audio, visual, simulation, experiment] = await Promise.allSettled([
          readJson<ReelsBrainCreativeMemoryResponse>(await fetch(`/api/factory/reels-brain/creative-memory?niches=${encodeURIComponent(DEFAULT_AUTOMATION_NICHES)}&limit=80`, { cache: "no-store" })),
          readJson<ReelsBrainAudioIntelligenceResponse>(await fetch(`/api/factory/reels-brain/audio-intelligence?niches=${encodeURIComponent(DEFAULT_AUTOMATION_NICHES)}&limit=80`, { cache: "no-store" })),
          readJson<ReelsBrainVisualIntelligenceResponse>(await fetch(`/api/factory/reels-brain/visual-intelligence?niches=${encodeURIComponent(DEFAULT_AUTOMATION_NICHES)}&limit=80`, { cache: "no-store" })),
          readJson<ReelsBrainSimulationResponse>(await fetch(`/api/factory/reels-brain/simulation?niches=${encodeURIComponent(DEFAULT_AUTOMATION_NICHES)}&limit=50`, { cache: "no-store" })),
          readJson<ReelsBrainExperimentResponse>(await fetch(`/api/factory/reels-brain/experiment-brain?niches=${encodeURIComponent(DEFAULT_AUTOMATION_NICHES)}&limit=50`, { cache: "no-store" })),
        ]);
        if (!alive) return;
        setCreativeMemory(memory.status === "fulfilled" ? memory.value : null);
        setAudioIntelligence(audio.status === "fulfilled" ? audio.value : null);
        setVisualIntelligence(visual.status === "fulfilled" ? visual.value : null);
        setSimulationBrain(simulation.status === "fulfilled" ? simulation.value : null);
        setExperimentBrain(experiment.status === "fulfilled" ? experiment.value : null);
      } catch {
        if (alive) {
          setCreativeMemory(null);
          setAudioIntelligence(null);
          setVisualIntelligence(null);
          setSimulationBrain(null);
          setExperimentBrain(null);
        }
      } finally {
        if (alive) {
          setCreativeMemoryLoading(false);
          setAudioIntelligenceLoading(false);
          setVisualIntelligenceLoading(false);
          setSimulationBrainLoading(false);
          setExperimentBrainLoading(false);
        }
      }
    }
    void loadInitialCreativeLayers();
    return () => { alive = false; };
  }, []);

  const availableProviders = Array.isArray(health?.available) ? health.available : [];
  const configuredCount = health?.providers?.filter((provider) => provider.configured).length || 0;
  const queries = queriesFromText(queriesText);
  const bakeOffSummary = bakeOff?.summary_by_provider || [];
  const corpusVideos = corpus?.videos || [];
  const summaryPlatforms = brainSummary?.platforms || [];
  const activePlatformSummary = summaryPlatforms.find((item) => item.platform === targetPlatform) || null;
  const portfolioRows = portfolioDigest?.niches || [];
  const portfolioCorpusCurrent = Number(
    portfolioDigest?.portfolio?.corpus_goal?.total_progress?.current
    || portfolioRows.reduce((sum, row) => sum + Number(row.total_videos || 0), 0),
  );
  const portfolioCorpusTarget = Number(portfolioDigest?.portfolio?.corpus_goal?.total_target || 10000);
  const portfolioStageTarget = Number(portfolioDigest?.portfolio?.corpus_goal?.stage?.stage_target || 0);
  const portfolioStageLabel = portfolioDigest?.portfolio?.corpus_goal?.stage?.stage_label || "Corpus target";
  const learningTotals = learningEconomics?.totals;
  const learningTrend = costTrendCopy(learningTotals?.cost_trend || "not_enough_data");
  const dayLearningTrend = costTrendCopy(learningTotals?.day_cost_trend || "not_enough_data");
  const todayCost = learningEconomics?.daily_costs?.today || null;
  const yesterdayCost = learningEconomics?.daily_costs?.yesterday || null;
  const todayUsefulCost = usefulVideoCost(todayCost);
  const yesterdayUsefulCost = usefulVideoCost(yesterdayCost);
  const todayCostBasis = usefulCostBasis(todayCost);
  const yesterdayCostBasis = usefulCostBasis(yesterdayCost);
  const usefulCostDeltaPct = todayUsefulCost != null && yesterdayUsefulCost != null && yesterdayUsefulCost > 0
    ? Math.round(((todayUsefulCost - yesterdayUsefulCost) / yesterdayUsefulCost) * 100)
    : null;
  const learningTimeline = learningEconomics?.timeline || [];
  const learningNiches = learningEconomics?.niches || [];
  const insightSummary = learningEconomics?.insights?.summary || [];
  const topHooks = learningEconomics?.insights?.top_hooks || [];
  const hookGroups = learningEconomics?.insights?.hook_groups || {};
  const winningFormats = learningEconomics?.insights?.winning_formats || [];
  const retentionMechanics = learningEconomics?.insights?.retention_mechanics || [];
  const generatorRecipes = learningEconomics?.insights?.recipes || [];
  const sourceReferences = learningEconomics?.insights?.source_references || [];
  const sourceMap = learningEconomics?.insights?.source_map || [];
  const sourceRankings = learningEconomics?.insights?.source_rankings || [];
  const recommendedSpendPlan = learningEconomics?.insights?.recommended_spend_plan || null;
  const economicsSummary = learningEconomics?.insights?.economics_summary || null;
  const scalableSources = recommendedSpendPlan?.scale_sources || sourceRankings.filter((source) => source.recommendation === "scale");
  const exploreSources = recommendedSpendPlan?.explore_sources || sourceRankings.filter((source) => source.recommendation === "explore_more");
  const avoidSources = recommendedSpendPlan?.avoid_sources || sourceRankings.filter((source) => source.recommendation === "avoid");
  const legalGuard = learningEconomics?.insights?.legal_guard || null;
  const capabilityStatus = learningEconomics?.insights?.capability_status || [];
  const insightNicheOptions = Array.from(new Set([
    ...topHooks.flatMap((hook) => hook.niches || []),
    ...generatorRecipes.flatMap((recipe) => recipe.niches || []),
  ])).sort();
  const filteredTopHooks = topHooks.filter((hook) =>
    (insightNicheFilter === "all" || hook.niches.includes(insightNicheFilter))
    && (insightConfidenceFilter === "all" || hook.confidence === insightConfidenceFilter)
    && (insightSegmentFilter === "all" || hook.segment === insightSegmentFilter)
  );
  const filteredRecipes = generatorRecipes.filter((recipe) =>
    (insightNicheFilter === "all" || recipe.niches.includes(insightNicheFilter))
    && (insightConfidenceFilter === "all" || recipe.confidence === insightConfidenceFilter)
  );
  const creativeMemorySummary = creativeMemory?.summary || {};
  const topCreativeDna = creativeMemory?.memory?.dna || [];
  const topCreativeAtoms = creativeMemory?.memory?.atoms || [];
  const topAntiPatterns = creativeMemory?.memory?.anti_patterns || [];
  const creativeExperiments = creativeMemory?.memory?.experiment_skeletons || [];
  const audioSummary = audioIntelligence?.summary || {};
  const audioPatterns = audioIntelligence?.audio?.patterns || [];
  const audioStrategyMix = audioIntelligence?.audio?.strategy_mix || [];
  const topSoundTitles = audioIntelligence?.audio?.top_sound_titles || [];
  const audioEditorRules = audioIntelligence?.audio?.editor_rules || [];
  const audioNextPipeline = audioIntelligence?.audio?.next_pipeline || [];
  const visualSummary = visualIntelligence?.summary || {};
  const visualPatterns = visualIntelligence?.visual?.patterns || [];
  const cameraMix = visualIntelligence?.visual?.camera_mix || [];
  const editingMix = visualIntelligence?.visual?.editing_mix || [];
  const editorPayloads = visualIntelligence?.visual?.editor_payloads || [];
  const directorRules = visualIntelligence?.visual?.director_rules || [];
  const simulationSummary = simulationBrain?.summary || {};
  const simulations = simulationBrain?.simulation?.simulations || [];
  const topShipCandidates = simulationBrain?.simulation?.top_ship_candidates || [];
  const reviseQueue = simulationBrain?.simulation?.revise_queue || [];
  const personaSummary = simulationBrain?.simulation?.persona_summary || [];
  const simulationGuardrails = simulationBrain?.simulation?.global_guardrails || [];
  const experimentSummary = experimentBrain?.summary || {};
  const launchExperiments = experimentBrain?.experiment?.launch_queue || [];
  const holdExperiments = experimentBrain?.experiment?.hold_queue || [];
  const experimentAxes = experimentBrain?.experiment?.by_axis || [];
  const experimentRules = experimentBrain?.experiment?.experiment_rules || [];
  const maxTimelineInserted = Math.max(1, ...learningTimeline.map((row) => row.inserted));
  const analyzeBacklogLanes = analyzeBacklog?.lanes || [];
  const analyzeBacklogQueue = analyzeBacklog?.queue || [];
  const analyzeBacklogTotals = analyzeBacklogLanes.reduce((acc, lane) => {
    acc.total += Number(lane.total || 0);
    acc.analyzed += Number(lane.analyzed || 0);
    acc.unanalyzed += Number(lane.unanalyzed || 0);
    return acc;
  }, { total: 0, analyzed: 0, unanalyzed: 0 });
  const analyzeBacklogProgress = analyzeBacklogTotals.total
    ? Math.round((analyzeBacklogTotals.analyzed / analyzeBacklogTotals.total) * 100)
    : 0;
  const cockpitCorpusCurrent = Math.max(portfolioCorpusCurrent, analyzeBacklogTotals.total);
  const cockpitCorpusSource = analyzeBacklogTotals.total > portfolioCorpusCurrent ? "backlog" : "portfolio";
  const corpusProgress = portfolioCorpusTarget ? Math.min(100, Math.round((cockpitCorpusCurrent / portfolioCorpusTarget) * 100)) : 0;
  const discoveryReady = cockpitCorpusCurrent >= 2500;
  const analysisReady = analyzeBacklogTotals.total > 0 && analyzeBacklogTotals.unanalyzed === 0;
  const brainStage = analysisReady
    ? "Готов к регулярному дообучению"
    : discoveryReady
      ? "Идет превращение корпуса в память"
      : "Набираем насмотренность";
  const nextOperatorAction = analyzeBacklogTotals.unanalyzed > 0
    ? `разобрать ${compactNumber(analyzeBacklogTotals.unanalyzed)} видео в память`
    : cockpitCorpusCurrent < portfolioCorpusTarget
      ? `добрать ${compactNumber(Math.max(0, portfolioCorpusTarget - cockpitCorpusCurrent))} видео до цели`
      : "снять карту источников и сравнить качество";
  const serverAutomationHistory: AutomationHistoryItem[] = (brainSummary?.automation_history || []).map((item) => ({
    id: `server:${item.id}`,
    title: automationTitle(item.mode),
    captured_at: item.created_at,
    mode: item.mode,
    niches: item.niche ? 1 : 0,
    source: "server",
    found: Number(item.found || 0),
    inserted: Number(item.inserted || 0),
    analyzed: Number(item.analyzed || 0),
    relevant: Number(item.relevant || 0),
    retries: Number(item.retries || 0),
    errors: Number(item.errors || 0),
    best_provider: item.best_provider,
    ok: item.ok,
  }));
  const combinedAutomationHistory = [...serverAutomationHistory, ...automationHistory]
    .filter((item, index, rows) => rows.findIndex((candidate) => candidate.id === item.id) === index)
    .sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)))
    .slice(0, 12);
  const automationRuns = automationResult?.runs || [];
  const automationOverview = (() => {
    const summary = {
      found: 0,
      inserted: 0,
      analyzed: 0,
      relevant: 0,
      retries: 0,
      errors: 0,
      providerWinners: new Map<string, number>(),
    };

    for (const run of automationRuns) {
      for (const platformRun of run.platforms || []) {
        const metrics = platformRun.loop?.metrics || platformRun.metrics;
        summary.found += Number(metrics?.found || 0);
        summary.inserted += Number(metrics?.inserted || 0);
        summary.analyzed += Number(metrics?.analyzed || 0);
        summary.relevant += Number(metrics?.relevant || 0);
        summary.retries += Number(metrics?.retries || 0);
        if (platformRun.error || platformRun.loop?.error || platformRun.bake_off?.error || platformRun.ok === false || platformRun.loop?.ok === false) {
          summary.errors += 1;
        }
        const winner = platformRun.bake_off?.stable_provider || platformRun.bake_off?.best_provider;
        if (winner) summary.providerWinners.set(winner, (summary.providerWinners.get(winner) || 0) + 1);
      }
    }

    const bestProvider = Array.from(summary.providerWinners.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    return {
      found: summary.found,
      inserted: summary.inserted,
      analyzed: summary.analyzed,
      relevant: summary.relevant,
      retries: summary.retries,
      errors: summary.errors,
      bestProvider,
    };
  })();

  function pushAutomationHistory(result: AutomationRunResponse, overview: typeof automationOverview) {
    const title = automationTitle(result.mode);
    const item: AutomationHistoryItem = {
      id: `${result.mode || "run"}:${result.captured_at || new Date().toISOString()}`,
      title,
      captured_at: result.captured_at || new Date().toISOString(),
      mode: result.mode,
      niches: (result.runs || []).length,
      source: "local",
      found: overview.found,
      inserted: overview.inserted,
      analyzed: overview.analyzed,
      relevant: overview.relevant,
      retries: overview.retries,
      errors: overview.errors,
      best_provider: overview.bestProvider,
      ok: result.ok,
    };
    setAutomationHistory((prev) => {
      const next = [item, ...prev.filter((row) => row.id !== item.id)].slice(0, AUTOMATION_HISTORY_LIMIT);
      try {
        window.localStorage.setItem(AUTOMATION_HISTORY_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  function summarizeAutomationResult(result: AutomationRunResponse) {
    const snapshot = {
      found: 0,
      inserted: 0,
      analyzed: 0,
      relevant: 0,
      retries: 0,
      errors: 0,
      bestProvider: null as string | null,
    };
    for (const run of result.runs || []) {
      for (const platformRun of run.platforms || []) {
        const metrics = platformRun.loop?.metrics || platformRun.metrics;
        snapshot.found += Number(metrics?.found || 0);
        snapshot.inserted += Number(metrics?.inserted || 0);
        snapshot.analyzed += Number(metrics?.analyzed || 0);
        snapshot.relevant += Number(metrics?.relevant || 0);
        snapshot.retries += Number(metrics?.retries || 0);
        if (platformRun.error || platformRun.loop?.error || platformRun.bake_off?.error || platformRun.ok === false || platformRun.loop?.ok === false) {
          snapshot.errors += 1;
        }
        snapshot.bestProvider = snapshot.bestProvider || platformRun.bake_off?.stable_provider || platformRun.bake_off?.best_provider || null;
      }
    }
    return snapshot;
  }
  const topRuns = (bakeOff?.runs || [])
    .flatMap((run) => (run.quality?.top || []).map((top) => ({ ...top, provider: run.provider, query: run.query })))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 8);

  function activeNiche() {
    return niche.trim() || DEFAULT_NICHE;
  }

  async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
    return readJson<T>(await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  async function reloadProviders() {
    setLoadingProviders(true);
    setProviderError("");
    try {
      const data = await readJson<ProviderHealth>(await fetch("/api/factory/reels-brain/providers", { cache: "no-store" }));
      setHealth(data);
      const available = Array.isArray(data.available) ? data.available : [];
      setSelectedProviders((prev) => {
        const stillAvailable = prev.filter((provider) => available.includes(provider));
        return stillAvailable.length ? stillAvailable : defaultProviderSelection(available);
      });
    } catch (e) {
      setProviderError(String((e as Error)?.message || e));
    } finally {
      setLoadingProviders(false);
    }
  }

  async function loadCorpus(currentNiche = niche) {
    setLoadingCorpus(true);
    setCorpusError("");
    try {
      const params = new URLSearchParams({
        niche: currentNiche.trim(),
        limit: "60",
        min_score: minScore.trim() || "0",
      });
      const data = await readJson<CorpusResponse>(await fetch(`/api/factory/reels-brain/corpus?${params}`, { cache: "no-store" }));
      setCorpus(data);
    } catch (e) {
      setCorpusError(String((e as Error)?.message || e));
    } finally {
      setLoadingCorpus(false);
    }
  }

  async function loadSummary(currentNiche = niche) {
    setLoadingSummary(true);
    setSummaryError("");
    try {
      const data = await readJson<BrainSummaryResponse>(await fetch(`/api/factory/reels-brain/summary?niche=${encodeURIComponent(currentNiche.trim() || DEFAULT_NICHE)}`, { cache: "no-store" }));
      setBrainSummary(data);
    } catch (e) {
      setSummaryError(String((e as Error)?.message || e));
    } finally {
      setLoadingSummary(false);
    }
  }

  async function loadPortfolio(currentNiches = automationNiches) {
    setLoadingPortfolio(true);
    setPortfolioError("");
    try {
      const data = await readJson<PortfolioDigestResponse>(await fetch(`/api/factory/reels-brain/digest-all?niches=${encodeURIComponent(currentNiches.trim() || DEFAULT_AUTOMATION_NICHES)}`, { cache: "no-store" }));
      setPortfolioDigest(data);
    } catch (e) {
      setPortfolioError(String((e as Error)?.message || e));
    } finally {
      setLoadingPortfolio(false);
    }
  }

  async function loadLearningEconomics(currentNiches = automationNiches) {
    setLoadingLearningEconomics(true);
    setLearningEconomicsError("");
    try {
      const data = await readJson<LearningEconomicsResponse>(await fetch(`/api/factory/reels-brain/learning-economics?niches=${encodeURIComponent(currentNiches.trim() || DEFAULT_AUTOMATION_NICHES)}`, { cache: "no-store" }));
      setLearningEconomics(data);
    } catch (e) {
      setLearningEconomicsError(String((e as Error)?.message || e));
    } finally {
      setLoadingLearningEconomics(false);
    }
  }

  async function loadActionPlan(currentNiches = automationNiches) {
    setActionPlanLoading(true);
    setActionPlanError("");
    try {
      const params = new URLSearchParams({
        niches: currentNiches.trim() || DEFAULT_AUTOMATION_NICHES,
        platforms: PLATFORM_OPTIONS.join(","),
        replay: "true",
        persist_replay: "true",
        replay_limit: "1500",
        max_items: "8",
      });
      const data = await readJson<ReelsBrainActionPlanResponse>(await fetch(`/api/factory/reels-brain/discovery/action-plan?${params.toString()}`, { cache: "no-store" }));
      setActionPlan(data);
      await loadLearningEconomics(currentNiches);
    } catch (e) {
      setActionPlanError(String((e as Error)?.message || e));
    } finally {
      setActionPlanLoading(false);
    }
  }

  async function loadCreativeBriefs(currentNiches = automationNiches) {
    setCreativeBriefsLoading(true);
    setCreativeBriefsError("");
    try {
      const params = new URLSearchParams({
        niches: currentNiches.trim() || DEFAULT_AUTOMATION_NICHES,
        limit: "10",
      });
      const data = await readJson<ReelsBrainCreativeBriefsResponse>(await fetch(`/api/factory/reels-brain/creative-briefs?${params.toString()}`, { cache: "no-store" }));
      setCreativeBriefs(data);
    } catch (e) {
      setCreativeBriefsError(String((e as Error)?.message || e));
    } finally {
      setCreativeBriefsLoading(false);
    }
  }

  async function loadCreativeMemory(currentNiches = automationNiches) {
    setCreativeMemoryLoading(true);
    setCreativeMemoryError("");
    try {
      const params = new URLSearchParams({
        niches: currentNiches.trim() || DEFAULT_AUTOMATION_NICHES,
        limit: "80",
      });
      const data = await readJson<ReelsBrainCreativeMemoryResponse>(await fetch(`/api/factory/reels-brain/creative-memory?${params.toString()}`, { cache: "no-store" }));
      setCreativeMemory(data);
    } catch (e) {
      setCreativeMemoryError(String((e as Error)?.message || e));
    } finally {
      setCreativeMemoryLoading(false);
    }
  }

  async function loadAudioIntelligence(currentNiches = automationNiches) {
    setAudioIntelligenceLoading(true);
    setAudioIntelligenceError("");
    try {
      const params = new URLSearchParams({
        niches: currentNiches.trim() || DEFAULT_AUTOMATION_NICHES,
        limit: "80",
      });
      const data = await readJson<ReelsBrainAudioIntelligenceResponse>(await fetch(`/api/factory/reels-brain/audio-intelligence?${params.toString()}`, { cache: "no-store" }));
      setAudioIntelligence(data);
    } catch (e) {
      setAudioIntelligenceError(String((e as Error)?.message || e));
    } finally {
      setAudioIntelligenceLoading(false);
    }
  }

  async function loadVisualIntelligence(currentNiches = automationNiches) {
    setVisualIntelligenceLoading(true);
    setVisualIntelligenceError("");
    try {
      const params = new URLSearchParams({
        niches: currentNiches.trim() || DEFAULT_AUTOMATION_NICHES,
        limit: "80",
      });
      const data = await readJson<ReelsBrainVisualIntelligenceResponse>(await fetch(`/api/factory/reels-brain/visual-intelligence?${params.toString()}`, { cache: "no-store" }));
      setVisualIntelligence(data);
    } catch (e) {
      setVisualIntelligenceError(String((e as Error)?.message || e));
    } finally {
      setVisualIntelligenceLoading(false);
    }
  }

  async function loadSimulationBrain(currentNiches = automationNiches) {
    setSimulationBrainLoading(true);
    setSimulationBrainError("");
    try {
      const params = new URLSearchParams({
        niches: currentNiches.trim() || DEFAULT_AUTOMATION_NICHES,
        limit: "50",
      });
      const data = await readJson<ReelsBrainSimulationResponse>(await fetch(`/api/factory/reels-brain/simulation?${params.toString()}`, { cache: "no-store" }));
      setSimulationBrain(data);
    } catch (e) {
      setSimulationBrainError(String((e as Error)?.message || e));
    } finally {
      setSimulationBrainLoading(false);
    }
  }

  async function loadExperimentBrain(currentNiches = automationNiches) {
    setExperimentBrainLoading(true);
    setExperimentBrainError("");
    try {
      const params = new URLSearchParams({
        niches: currentNiches.trim() || DEFAULT_AUTOMATION_NICHES,
        limit: "50",
      });
      const data = await readJson<ReelsBrainExperimentResponse>(await fetch(`/api/factory/reels-brain/experiment-brain?${params.toString()}`, { cache: "no-store" }));
      setExperimentBrain(data);
    } catch (e) {
      setExperimentBrainError(String((e as Error)?.message || e));
    } finally {
      setExperimentBrainLoading(false);
    }
  }

  async function refreshAutomationSurfaces(currentNiches = automationNiches, currentNiche = activeNiche()) {
    setAutomationSyncing(true);
    try {
      for (const delayMs of [0, 3000, 9000]) {
        if (delayMs) await sleep(delayMs);
        await Promise.allSettled([
          loadPortfolio(currentNiches),
          loadSummary(currentNiche),
          loadCorpus(currentNiche),
          loadAnalyzeBacklogPlan(currentNiches),
          loadLearningEconomics(currentNiches),
          loadCreativeMemory(currentNiches),
          loadAudioIntelligence(currentNiches),
          loadVisualIntelligence(currentNiches),
          loadSimulationBrain(currentNiches),
          loadExperimentBrain(currentNiches),
        ]);
      }
    } finally {
      setAutomationSyncing(false);
    }
  }

  async function loadSchedulerPlan() {
    setSchedulerLoading(true);
    setSchedulerError("");
    try {
      const params = new URLSearchParams({
        niches: automationNiches.trim() || DEFAULT_AUTOMATION_NICHES,
        platforms: PLATFORM_OPTIONS.join(","),
      });
      const data = await readJson<SchedulerPlanResponse>(await fetch(`/api/factory/jobs/reels-brain-scheduler?${params}`, { cache: "no-store" }));
      setSchedulerPlan(data);
    } catch (e) {
      setSchedulerError(String((e as Error)?.message || e));
    } finally {
      setSchedulerLoading(false);
    }
  }

  async function loadAnalyzeBacklogPlan(currentNiches = automationNiches) {
    setAnalyzeBacklogLoading(true);
    setAnalyzeBacklogError("");
    try {
      const params = new URLSearchParams({
        niches: currentNiches.trim() || DEFAULT_AUTOMATION_NICHES,
        platforms: PLATFORM_OPTIONS.join(","),
        max_lanes: "9",
        limit: "18",
      });
      const data = await readJson<AnalyzeBacklogResponse>(await fetch(`/api/factory/jobs/reels-brain-analyze-backlog?${params}`, { cache: "no-store" }));
      setAnalyzeBacklog(data);
    } catch (e) {
      setAnalyzeBacklogError(String((e as Error)?.message || e));
    } finally {
      setAnalyzeBacklogLoading(false);
    }
  }

  async function runBakeOff() {
    setRunError("");
    setBakeOff(null);
    if (!queries.length) {
      setRunError("Добавь хотя бы один query.");
      return;
    }
    if (!selectedProviders.length) {
      setRunError("Выбери хотя бы один настроенный provider.");
      return;
    }
    setRunning(true);
    try {
      const data = await readJson<BakeOffResponse>(await fetch("/api/factory/reels-brain/bake-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: niche.trim() || DEFAULT_NICHE,
          queries,
          providers: selectedProviders,
          limit,
          persist,
          target_platform: targetPlatform,
        }),
      }));
      setBakeOff(data);
      if (persist) await loadCorpus(niche.trim() || DEFAULT_NICHE);
      await loadSummary(niche.trim() || DEFAULT_NICHE);
    } catch (e) {
      setRunError(String((e as Error)?.message || e));
    } finally {
      setRunning(false);
    }
  }

  async function runSource() {
    setSourceRunError("");
    setSourceRunResult(null);
    setSourceRunning(true);
    try {
      const data = await postJson<SourceRunResponse>("/api/factory/reels-brain/source-run", {
        niche: activeNiche(),
        query: sourceQuery.trim() || activeNiche(),
        limit: sourceLimit,
        target_platform: targetPlatform,
      });
      setSourceRunResult(data);
      await loadCorpus(activeNiche());
      await loadSummary(activeNiche());
    } catch (e) {
      setSourceRunError(String((e as Error)?.message || e));
    } finally {
      setSourceRunning(false);
    }
  }

  async function submitManualSeed() {
    setManualSeedError("");
    setManualSeedResult(null);
    const videos = manualSeedItemsFromText(manualSeedText);
    if (!videos.length) {
      setManualSeedError("Добавь хотя бы один URL или JSON-объект в textarea.");
      return;
    }
    setManualSeeding(true);
    try {
      const data = await postJson<ManualSeedResponse>("/api/factory/reels-brain/manual-seed", {
        niche: activeNiche(),
        source_query: manualSeedQuery.trim() || "manual",
        videos,
      });
      setManualSeedResult(data);
      await loadCorpus(activeNiche());
    } catch (e) {
      setManualSeedError(String((e as Error)?.message || e));
    } finally {
      setManualSeeding(false);
    }
  }

  async function runAnalyze() {
    setAnalyzeError("");
    setAnalyzeResult(null);
    setAnalyzing(true);
    try {
      const data = await postJson<AnalyzeResponse>("/api/factory/reels-brain/analyze", {
        niche: activeNiche(),
        limit: analyzeLimit,
        dry_run: analyzeDryRun,
        target_platform: targetPlatform,
      });
      setAnalyzeResult(data);
      if (!analyzeDryRun) {
        await loadCorpus(activeNiche());
        await loadSummary(activeNiche());
      }
    } catch (e) {
      setAnalyzeError(String((e as Error)?.message || e));
    } finally {
      setAnalyzing(false);
    }
  }

  async function buildPatterns() {
    setPatternError("");
    setPatternResult(null);
    setBuildingPatterns(true);
    try {
      const data = await postJson<PatternBuildResponse>("/api/factory/reels-brain/patterns/build", {
        niche: activeNiche(),
        limit: patternLimit,
        persist: patternPersist,
      });
      setPatternResult(data);
      await loadSummary(activeNiche());
    } catch (e) {
      setPatternError(String((e as Error)?.message || e));
    } finally {
      setBuildingPatterns(false);
    }
  }

  async function runLoop() {
    setLoopError("");
    setLoopResult(null);
    setLoopRunning(true);
    try {
      const data = await postJson<LoopResponse>("/api/factory/reels-brain/loop", {
        niche: activeNiche(),
        queries,
        source_limit: loopSourceLimit,
        analyze_limit: loopAnalyzeLimit,
        persist_patterns: loopPersistPatterns,
        target_platform: targetPlatform,
      });
      setLoopResult(data);
      await loadCorpus(activeNiche());
      await loadSummary(activeNiche());
    } catch (e) {
      setLoopError(String((e as Error)?.message || e));
    } finally {
      setLoopRunning(false);
    }
  }

  function toggleProvider(provider: string) {
    setSelectedProviders((prev) => (
      prev.includes(provider)
        ? prev.filter((item) => item !== provider)
        : [...prev, provider]
    ));
  }

  async function runMiniBakeOff(platform: "tiktok" | "instagram" | "youtube", queriesOverride?: string[]) {
    setQuickActionLoading(`bake-off:${platform}`);
    setRunError("");
    try {
      const q = (queriesOverride && queriesOverride.length ? queriesOverride : activePlatformSummary?.recommended_queries || queries).slice(0, 3);
      const data = await postJson<BakeOffResponse>("/api/factory/reels-brain/bake-off", {
        niche: activeNiche(),
        queries: q,
        providers: selectedProviders,
        limit,
        persist: false,
        persist_memory: true,
        target_platform: platform,
      });
      setBakeOff(data);
      setTargetPlatform(platform);
      await loadSummary(activeNiche());
    } catch (e) {
      setRunError(String((e as Error)?.message || e));
    } finally {
      setQuickActionLoading(null);
    }
  }

  async function runSourceRefresh(platform: "tiktok" | "instagram" | "youtube", queryOverride?: string) {
    setQuickActionLoading(`source:${platform}`);
    setSourceRunError("");
    try {
      const query = queryOverride || activePlatformSummary?.recommended_queries?.[0] || sourceQuery.trim() || activeNiche();
      const data = await postJson<SourceRunResponse>("/api/factory/reels-brain/source-run", {
        niche: activeNiche(),
        query,
        limit: sourceLimit,
        target_platform: platform,
      });
      setSourceRunResult(data);
      setTargetPlatform(platform);
      setSourceQuery(query);
      await loadCorpus(activeNiche());
      await loadSummary(activeNiche());
    } catch (e) {
      setSourceRunError(String((e as Error)?.message || e));
    } finally {
      setQuickActionLoading(null);
    }
  }

  function normalizeGrowthRun(data: GrowthRunResponse): AutomationRunResponse {
    const rows = (data.runs?.length ? data.runs : data.queue) || [];
    const byNiche = new Map<string, AutomationPlatformRun[]>();
    for (const row of rows) {
      const bulkFound = "found" in row ? row.found : undefined;
      const bulkInserted = "inserted" in row ? row.inserted : undefined;
      const bulkNormalized = "normalized" in row ? row.normalized : undefined;
      const provider = "provider" in row ? row.provider : undefined;
      const query = "query" in row ? row.query : undefined;
      const current = byNiche.get(row.niche) || [];
      current.push({
        platform: row.platform,
        ok: row.ok,
        plan: row.plan,
        metrics: row.metrics || {
          found: bulkFound ?? 0,
          inserted: bulkInserted ?? 0,
          analyzed: bulkNormalized ?? 0,
        },
        log: row.log || [
          provider ? `provider: ${provider}` : null,
          query ? `query: ${query}` : null,
          bulkInserted != null ? `raw inserted: ${bulkInserted}` : null,
        ].filter(Boolean) as string[],
        error: row.error,
      });
      byNiche.set(row.niche, current);
    }
    return {
      ok: data.ok,
      mode: "growth",
      niches: data.niches,
      platforms: data.platforms,
      runs: Array.from(byNiche.entries()).map(([runNiche, platforms]) => ({
        niche: runNiche,
        platforms,
        digest: null,
      })),
      warning: data.warning,
      error: data.error,
      captured_at: new Date().toISOString(),
    };
  }

  function normalizeAnalyzeBacklog(data: AnalyzeBacklogResponse): AutomationRunResponse {
    const rows = data.runs?.length ? data.runs : (data.queue || []).map((lane) => ({
      niche: lane.niche,
      platform: lane.platform,
      ok: true,
      plan: { queries: [], source_limit: 0, analyze_limit: lane.analyze_limit || 0 },
      metrics: {
        found: 0,
        inserted: 0,
        analyzed: 0,
        relevant: 0,
        retries: 0,
      },
      log: [
        `queue total: ${compactNumber(lane.total || 0)}`,
        `unanalyzed: ${compactNumber(lane.unanalyzed || 0)}`,
        `backlog: ${compactNumber(lane.backlog_pct || 0)}%`,
      ],
      error: null,
    }));
    const byNiche = new Map<string, AutomationPlatformRun[]>();
    for (const row of rows) {
      const current = byNiche.get(row.niche) || [];
      current.push({
        platform: row.platform,
        ok: row.ok,
        plan: row.plan,
        metrics: row.metrics,
        log: row.log,
        error: row.error,
      });
      byNiche.set(row.niche, current);
    }
    return {
      ok: data.ok,
      mode: "analyze",
      niches: data.niches,
      platforms: data.platforms,
      analyze_limit: data.limit,
      runs: Array.from(byNiche.entries()).map(([runNiche, platforms]) => ({
        niche: runNiche,
        platforms,
        digest: null,
      })),
      warning: data.warning,
      error: data.error,
      meta: {
        strategy: data.build_patterns ? "analyze" : undefined,
        execute: data.execute,
      },
      captured_at: new Date().toISOString(),
    };
  }

  function normalizeSchedulerTick(data: SchedulerTickResponse): AutomationRunResponse {
    if (data.task === "analyze") return normalizeAnalyzeBacklog((data.result || {}) as AnalyzeBacklogResponse);
    if (data.task === "bulk") return normalizeGrowthRun((data.result || {}) as GrowthRunResponse);
    const result = (data.result || {}) as AutomationRunResponse;
    return {
      ...result,
      mode: data.task === "weekly" ? "weekly" : "daily",
      captured_at: new Date().toISOString(),
    };
  }

  async function runAutomation(mode: "daily" | "weekly" | "growth" | "analyze") {
    setAutomationRunning(mode);
    setAutomationError("");
    setAutomationResult(null);
    try {
      if (mode === "analyze") {
        const data = await postJson<AnalyzeBacklogResponse>("/api/factory/jobs/reels-brain-analyze-backlog", {
          niches: automationNiches,
          platforms: PLATFORM_OPTIONS.join(","),
          max_lanes: 6,
          limit: 18,
          build_patterns: false,
        });
        const normalized = normalizeAnalyzeBacklog(data);
        setAutomationResult(normalized);
        pushAutomationHistory(normalized, summarizeAutomationResult(normalized));
      } else if (mode === "growth") {
        const data = await postJson<LearningRunResponse>("/api/factory/jobs/reels-brain-learning", {
          niches: automationNiches,
          platforms: PLATFORM_OPTIONS.join(","),
          strategy: "bulk",
          max_lanes: 3,
          limit: 25,
          providers_per_lane: 2,
          provider_timeout_ms: 30000,
          hours: 72,
        });
        const normalized = normalizeGrowthRun(data.tick || { ok: data.ok, warning: data.warning, error: data.error });
        normalized.meta = {
          strategy: data.strategy,
          execute: data.execute,
          hours: data.hours,
          next_run_after_minutes: data.schedule?.next_run_after_minutes,
          target_ticks: data.schedule?.target_ticks,
        };
        normalized.warning = normalized.warning || data.warning;
        normalized.error = normalized.error || data.error;
        setAutomationResult(normalized);
        pushAutomationHistory(normalized, summarizeAutomationResult(normalized));
      } else {
        const data = await postJson<AutomationRunResponse>(`/api/factory/jobs/reels-brain-${mode}`, {
          niches: automationNiches,
          platforms: PLATFORM_OPTIONS.join(","),
        });
        data.captured_at = new Date().toISOString();
        setAutomationResult(data);
        pushAutomationHistory(data, summarizeAutomationResult(data));
      }
      void refreshAutomationSurfaces(automationNiches, activeNiche());
    } catch (e) {
      setAutomationError(String((e as Error)?.message || e));
    } finally {
      setAutomationRunning(null);
    }
  }

  return (
    <div className="space-y-6 text-slate-950">
      <section className="relative overflow-hidden rounded-[2rem] border border-slate-900 bg-slate-950 p-6 text-white shadow-2xl shadow-slate-200">
        <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-cyan-400/25 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-amber-300/20 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100">
              <BrainCircuit className="h-4 w-4" />
              Self-learning Reels Intelligence Brain
            </div>
            <h1 className="text-3xl font-black tracking-tight sm:text-5xl">
              Пульт насмотренности для Reels / TikTok / Shorts
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Проверяем источники, сравниваем качество выдачи, пишем только осознанно и сразу видим,
              что попало в viral corpus. Это мост между scraper-слоем и Pattern Brain.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <a
                href="/inferno/vendor/reels-brain-demo"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-950 shadow-lg shadow-slate-950/15 transition hover:bg-cyan-50"
              >
                <ExternalLink className="h-4 w-4" />
                Public demo
              </a>
              <span className="inline-flex min-h-11 items-center rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-slate-200">
                demo route read-only, live мутации остаются только в этом пульте
              </span>
              <a
                href="/inferno/vendor/reels-brain-portfolio"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15"
              >
                <ExternalLink className="h-4 w-4" />
                Portfolio report
              </a>
            </div>
          </div>
          <div className="grid min-w-72 grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur">
            <Metric label="Доступно" value={availableProviders.length} />
            <Metric label="Настроено" value={configuredCount} />
            <Metric label="В корпусе" value={corpus?.total || 0} />
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
              <Clock3 className="h-4 w-4" />
              Automation Control Center
            </div>
            <h2 className="mt-1 text-2xl font-black tracking-tight">Ежедневный и недельный self-learning прогон</h2>
          </div>
          <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
            chat-first: настройки через диалог, экран только для контроля
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="rounded-[1.75rem] border border-slate-900 bg-slate-950 p-5 text-white shadow-xl shadow-slate-200">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-200">Brain cockpit</p>
                  <h3 className="mt-2 text-2xl font-black tracking-tight">{brainStage}</h3>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                    Экран больше не требует крутить параметры руками. Команды на сбор, анализ и replay даются через чат,
                    а здесь виден статус системы и следующий безопасный шаг.
                  </p>
                </div>
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold text-cyan-100">
                  {automationNiches}
                </span>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-300">Corpus</div>
                  <div className="mt-2 text-3xl font-black">{compactNumber(cockpitCorpusCurrent)}</div>
                  <div className="mt-1 text-xs text-slate-300">
                    из {compactNumber(portfolioCorpusTarget)} · {compactNumber(corpusProgress)}% · источник {cockpitCorpusSource}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-300">Memory backlog</div>
                  <div className="mt-2 text-3xl font-black">{compactNumber(analyzeBacklogTotals.unanalyzed)}</div>
                  <div className="mt-1 text-xs text-slate-300">не разобрано · progress {compactNumber(analyzeBacklogProgress)}%</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-300">Providers</div>
                  <div className="mt-2 text-3xl font-black">{compactNumber(configuredCount)}</div>
                  <div className="mt-1 text-xs text-slate-300">настроено из {compactNumber(availableProviders.length)}</div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-amber-100">Следующее действие</div>
                <div className="mt-1 text-lg font-black text-white">{nextOperatorAction}</div>
                <div className="mt-2 text-xs text-amber-50/80">
                  Если нужно изменить бюджет, платформы, нишу или лимит Apify, пиши это в чат. UI остается пультом наблюдения.
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void loadPortfolio();
                  void loadAnalyzeBacklogPlan();
                  void loadSummary(activeNiche());
                }}
                disabled={loadingPortfolio || analyzeBacklogLoading || loadingSummary}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-slate-200 hover:bg-slate-800 disabled:bg-slate-300"
              >
                {loadingPortfolio || analyzeBacklogLoading || loadingSummary ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Обновить статус
              </button>
              <a
                href={`/inferno/vendor/reels-brain-portfolio?niches=${encodeURIComponent(automationNiches.trim() || DEFAULT_AUTOMATION_NICHES)}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-cyan-300"
              >
                <ExternalLink className="h-4 w-4" />
                Открыть отчет
              </a>
              <a
                href="/inferno/vendor/reels-brain-demo"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-cyan-300"
              >
                <ExternalLink className="h-4 w-4" />
                Public demo
              </a>
            </div>

            <details className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <summary className="cursor-pointer text-sm font-black text-slate-900">
                Advanced operator tools
                <span className="ml-2 text-xs font-semibold text-slate-400">ручной запуск, если чат недоступен</span>
              </summary>
              <div className="mt-4">
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Niches через запятую</span>
                  <input
                    value={automationNiches}
                    onChange={(e) => setAutomationNiches(e.target.value)}
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-400"
                  />
                </label>

                <div className="mt-4 grid gap-3 lg:grid-cols-4">
                  <button
                    type="button"
                    onClick={() => runAutomation("daily")}
                    disabled={automationRunning !== null}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-slate-200 hover:bg-slate-800 disabled:bg-slate-300"
                  >
                    {automationRunning === "daily" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Run daily loop
                  </button>
                  <button
                    type="button"
                    onClick={() => runAutomation("weekly")}
                    disabled={automationRunning !== null}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-sm hover:border-cyan-300 disabled:opacity-50"
                  >
                    {automationRunning === "weekly" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
                    Run weekly retrain
                  </button>
                  <button
                    type="button"
                    onClick={() => runAutomation("growth")}
                    disabled={automationRunning !== null}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-bold text-cyan-900 shadow-sm hover:border-cyan-300 hover:bg-cyan-100 disabled:opacity-50"
                  >
                    {automationRunning === "growth" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                    Run bulk ingest
                  </button>
                  <button
                    type="button"
                    onClick={() => runAutomation("analyze")}
                    disabled={automationRunning !== null}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-900 shadow-sm hover:border-emerald-300 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    {automationRunning === "analyze" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BrainCircuit className="h-4 w-4" />}
                    Analyze backlog x108
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => loadSchedulerPlan()}
                    disabled={schedulerLoading}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-cyan-300 disabled:opacity-50"
                  >
                    {schedulerLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SlidersHorizontal className="h-4 w-4" />}
                    Scheduler plan
                  </button>
                  <button
                    type="button"
                    onClick={() => loadAnalyzeBacklogPlan()}
                    disabled={analyzeBacklogLoading}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-emerald-300 disabled:opacity-50"
                  >
                    {analyzeBacklogLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                    Backlog status
                  </button>
                </div>
              </div>
            </details>

            {schedulerPlan?.tasks?.length ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Scheduler contract</div>
                <div className="mt-3 space-y-2">
                  {schedulerPlan.tasks.map((task) => (
                    <div key={task.task} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold text-slate-900">{task.label}</span>
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                          every {compactNumber(task.cadence_minutes)} min
                        </span>
                      </div>
                      <div className="mt-1">{task.endpoint}</div>
                      <div className="mt-1 text-slate-500">{task.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Analyze backlog status</div>
                  <div className="mt-1 text-lg font-black text-emerald-950">
                    Осталось к анализу {compactNumber(analyzeBacklogTotals.unanalyzed)} из raw backlog {compactNumber(analyzeBacklogTotals.total)}
                  </div>
                  <div className="mt-1 text-xs font-medium text-emerald-800">
                    analyzed {compactNumber(analyzeBacklogTotals.analyzed)} · progress {compactNumber(analyzeBacklogProgress)}% · queue lanes {compactNumber(analyzeBacklogQueue.length)}
                  </div>
                  <div className="mt-2 text-xs font-semibold text-emerald-900">
                    Corpus сейчас: {compactNumber(cockpitCorpusCurrent)} / {compactNumber(portfolioCorpusTarget)}
                    {portfolioStageTarget ? ` · milestone ${portfolioStageLabel}: ${compactNumber(portfolioStageTarget)}` : ""}
                  </div>
                </div>
                <span className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-bold text-emerald-700">
                  {analyzeBacklog?.execute === false ? "dry status" : "live"}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {analyzeBacklogLanes.length ? analyzeBacklogLanes.slice(0, 6).map((lane) => (
                  <div key={`${lane.niche}-${lane.platform}`} className="rounded-xl border border-emerald-100 bg-white px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-900">{lane.niche} · {titlePlatform(lane.platform)}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-600">
                        left {compactNumber(lane.unanalyzed || 0)}
                      </span>
                    </div>
                    <div className="mt-1 text-slate-500">
                      analyzed {compactNumber(lane.analyzed || 0)} / {compactNumber(lane.total || 0)} · backlog {compactNumber(lane.backlog_pct || 0)}%
                    </div>
                  </div>
                )) : (
                  <div className="rounded-xl border border-emerald-100 bg-white px-3 py-2 text-xs font-medium text-emerald-800">
                    {analyzeBacklogLoading ? "Loading backlog..." : "Backlog пуст или статус ещё не загружен."}
                  </div>
                )}
              </div>
            </div>

            {automationError && <Alert tone="red" text={automationError} />}
            {portfolioError && <Alert tone="red" text={portfolioError} />}
            {schedulerError && <Alert tone="red" text={schedulerError} />}
            {analyzeBacklogError && <Alert tone="red" text={analyzeBacklogError} />}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Portfolio snapshot</p>
            <h3 className="mt-1 text-xl font-black tracking-tight text-slate-900">Что по всем нишам сейчас</h3>

            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              <MetricCard label="Niches" value={portfolioDigest?.portfolio?.total_niches || 0} />
              <MetricCard label="Ready" value={portfolioDigest?.portfolio?.ready_niches || 0} />
              <MetricCard label="Watch" value={portfolioDigest?.portfolio?.watch_niches || 0} />
              <MetricCard label="Avg readiness" value={portfolioDigest?.portfolio?.avg_readiness || 0} />
            </div>

            <div className="mt-4 space-y-2">
              {portfolioRows.length ? portfolioRows.map((row) => (
                <div key={row.niche} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-bold text-slate-900">{row.niche}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        readiness {compactNumber(row.readiness_avg)}% · videos {compactNumber(row.total_videos)} · incidents {compactNumber(row.total_incidents)}
                      </div>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(row.status === "ready" ? "ready" : "watch")}`}>
                      {row.status}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(row.platforms || []).map((platform) => (
                      <span key={`${row.niche}-${platform.platform}`} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        {titlePlatform(platform.platform)} · {providerLabel(platform.preferred_provider || "none")} · {compactNumber(platform.readiness_score)}%
                      </span>
                    ))}
                  </div>
                </div>
              )) : <EmptyState title="Portfolio snapshot пуст" text="Сначала загрузи digest-all или запусти daily loop." />}
            </div>
          </div>
        </div>

        {automationResult && (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Last automation run</p>
                <h3 className="mt-1 text-xl font-black tracking-tight text-slate-900">
                  {automationTitle(automationResult.mode)}
                </h3>
              </div>
              <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500">
                niches {(automationResult.runs || []).length} · platforms {(automationResult.platforms || []).join(", ")}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className={`rounded-full border px-2.5 py-1 font-semibold ${
                automationResult.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}>
                {automationResult.ok ? "run ok" : "run failed"}
              </span>
              {automationResult.meta?.strategy ? (
                <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 font-semibold text-cyan-700">
                  strategy {automationResult.meta.strategy}
                </span>
              ) : null}
              {automationResult.meta?.hours ? (
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                  horizon {compactNumber(automationResult.meta.hours)}h
                </span>
              ) : null}
              {automationResult.meta?.next_run_after_minutes ? (
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                  next tick {compactNumber(automationResult.meta.next_run_after_minutes)} min
                </span>
              ) : null}
              {automationResult.meta?.target_ticks ? (
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                  target ticks {compactNumber(automationResult.meta.target_ticks)}
                </span>
              ) : null}
              {automationResult.captured_at ? (
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                  {new Date(automationResult.captured_at).toLocaleString("ru-RU")}
                </span>
              ) : null}
              {automationSyncing ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 font-semibold text-cyan-700">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  syncing portfolio + brain
                </span>
              ) : null}
            </div>

            {automationResult.warning ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                {automationResult.warning}
              </div>
            ) : null}

            {automationResult.error ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                {automationResult.error}
              </div>
            ) : null}

            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
              <MetricCard label="Found" value={automationOverview.found} />
              <MetricCard label="Inserted" value={automationOverview.inserted} />
              <MetricCard label="Analyzed" value={automationOverview.analyzed} />
              <MetricCard label="Relevant" value={automationOverview.relevant} />
              <MetricCard label="Retries" value={automationOverview.retries} />
              <MetricCard label="Errors" value={automationOverview.errors} />
            </div>

            {automationOverview.bestProvider ? (
              <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-800">
                best provider winner: {providerLabel(automationOverview.bestProvider)}
              </div>
            ) : null}

            {automationResult ? (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => pushAutomationHistory(automationResult, automationOverview)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-cyan-300"
                >
                  Save snapshot to history
                </button>
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              {automationRuns.map((run) => (
                <div key={run.niche} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-black text-slate-900">{run.niche}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {run.digest?.overall_status || "unknown"} · incidents {compactNumber(run.digest?.total_incidents || 0)}
                      </div>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(run.digest?.overall_status === "ready" ? "ready" : "watch")}`}>
                      {run.digest?.overall_status || "watch"}
                    </span>
                  </div>

                  <div className="mt-3 space-y-2">
                    {(run.platforms || []).map((platformRun) => {
                      const loopMetrics = platformRun.loop?.metrics || platformRun.metrics;
                      return (
                        <div key={`${run.niche}-${platformRun.platform}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-bold text-slate-800">{titlePlatform(platformRun.platform)}</div>
                              <div className="mt-1 text-xs text-slate-500">
                                queries {(platformRun.plan?.queries || []).join(" · ") || "—"}
                              </div>
                            </div>
                            {platformRun.bake_off?.stable_provider && (
                              <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-bold text-cyan-700">
                                {providerLabel(platformRun.bake_off.stable_provider)}
                              </span>
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">found {compactNumber(loopMetrics?.found || 0)}</span>
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">inserted {compactNumber(loopMetrics?.inserted || 0)}</span>
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">analyzed {compactNumber(loopMetrics?.analyzed || 0)}</span>
                            {loopMetrics?.relevant != null ? (
                              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">relevant {compactNumber(loopMetrics.relevant || 0)}</span>
                            ) : null}
                            {loopMetrics?.retries != null ? (
                              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">retries {compactNumber(loopMetrics.retries || 0)}</span>
                            ) : null}
                            {platformRun.bake_off?.source_memory_updated ? (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">memory updated</span>
                            ) : null}
                            {platformRun.ok === false || platformRun.loop?.ok === false ? (
                              <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 font-semibold text-red-700">failed</span>
                            ) : (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">ok</span>
                            )}
                          </div>
                          {(platformRun.log || platformRun.loop?.log)?.length ? (
                            <div className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                              {((platformRun.log || platformRun.loop?.log) || []).slice(-3).join(" · ")}
                            </div>
                          ) : null}
                          {(platformRun.error || platformRun.loop?.error || platformRun.bake_off?.error) && (
                            <p className="mt-2 text-xs font-medium text-red-600">
                              {platformRun.error || platformRun.loop?.error || platformRun.bake_off?.error}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-700">Analyzed intelligence</p>
              <h3 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Витрина инсайтов из разобранных видео</h3>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">
                Не логи и не настройки. Здесь только то, что можно понять как пользователь: какие хуки выигрывают, какие форматы держат внимание и что уже можно отдать в генератор.
              </p>
            </div>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
              {compactNumber(learningTotals?.generator_ready_patterns || 0)} generator-ready
            </span>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {(insightSummary.length ? insightSummary : [
              "Мозг еще собирает витрину инсайтов: нужен Pattern Brain по выбранным нишам.",
            ]).slice(0, 3).map((line, index) => (
              <div key={`${line}:${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Вывод {index + 1}</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-800">{line}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Filters</span>
              <select value={insightNicheFilter} onChange={(event) => setInsightNicheFilter(event.target.value)} className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">
                <option value="all">all niches</option>
                {insightNicheOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <select value={insightConfidenceFilter} onChange={(event) => setInsightConfidenceFilter(event.target.value as typeof insightConfidenceFilter)} className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">
                <option value="all">all confidence</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
              <select value={insightSegmentFilter} onChange={(event) => setInsightSegmentFilter(event.target.value as typeof insightSegmentFilter)} className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">
                <option value="all">all hook types</option>
                <option value="op_hooks">OP hooks</option>
                <option value="frequent_hooks">frequent</option>
                <option value="experimental_hooks">experimental</option>
              </select>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500">
                {compactNumber(filteredTopHooks.length)} hooks · {compactNumber(filteredRecipes.length)} recipes
              </span>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-cyan-100 bg-cyan-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">Action loop</p>
                <h4 className="mt-1 text-lg font-black text-slate-950">Следующий сбор и briefs без ручной аналитики</h4>
                <p className="mt-1 max-w-2xl text-sm font-medium text-cyan-900">
                  Replay бесплатно пересматривает уже собранный корпус, обновляет карту источников и готовит payloads для следующего платного сбора.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => loadActionPlan(automationNiches)}
                  disabled={actionPlanLoading}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-cyan-900 px-3 py-2 text-sm font-black text-white hover:bg-cyan-800 disabled:opacity-50"
                >
                  {actionPlanLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
                  Next collection plan
                </button>
                <button
                  type="button"
                  onClick={() => loadCreativeBriefs(automationNiches)}
                  disabled={creativeBriefsLoading}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-cyan-200 bg-white px-3 py-2 text-sm font-black text-cyan-900 hover:border-cyan-400 disabled:opacity-50"
                >
                  {creativeBriefsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Export 10 briefs
                </button>
                <button
                  type="button"
                  onClick={() => loadCreativeMemory(automationNiches)}
                  disabled={creativeMemoryLoading}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-cyan-200 bg-white px-3 py-2 text-sm font-black text-cyan-900 hover:border-cyan-400 disabled:opacity-50"
                >
                  {creativeMemoryLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BrainCircuit className="h-4 w-4" />}
                  Refresh memory
                </button>
                <button
                  type="button"
                  onClick={() => loadAudioIntelligence(automationNiches)}
                  disabled={audioIntelligenceLoading}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-cyan-200 bg-white px-3 py-2 text-sm font-black text-cyan-900 hover:border-cyan-400 disabled:opacity-50"
                >
                  {audioIntelligenceLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                  Refresh audio
                </button>
                <button
                  type="button"
                  onClick={() => loadVisualIntelligence(automationNiches)}
                  disabled={visualIntelligenceLoading}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-cyan-200 bg-white px-3 py-2 text-sm font-black text-cyan-900 hover:border-cyan-400 disabled:opacity-50"
                >
                  {visualIntelligenceLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  Refresh visual
                </button>
                <button
                  type="button"
                  onClick={() => loadSimulationBrain(automationNiches)}
                  disabled={simulationBrainLoading}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-cyan-200 bg-white px-3 py-2 text-sm font-black text-cyan-900 hover:border-cyan-400 disabled:opacity-50"
                >
                  {simulationBrainLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Refresh simulation
                </button>
                <button
                  type="button"
                  onClick={() => loadExperimentBrain(automationNiches)}
                  disabled={experimentBrainLoading}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-cyan-200 bg-white px-3 py-2 text-sm font-black text-cyan-900 hover:border-cyan-400 disabled:opacity-50"
                >
                  {experimentBrainLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SlidersHorizontal className="h-4 w-4" />}
                  Refresh experiments
                </button>
              </div>
            </div>
            {(actionPlanError || creativeBriefsError || creativeMemoryError || audioIntelligenceError || visualIntelligenceError || simulationBrainError || experimentBrainError) ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                {actionPlanError || creativeBriefsError || creativeMemoryError || audioIntelligenceError || visualIntelligenceError || simulationBrainError || experimentBrainError}
              </div>
            ) : null}
            {(actionPlan || creativeBriefs) ? (
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {actionPlan ? (
                  <div className="rounded-xl border border-cyan-200 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-black text-slate-950">Next collection plan</p>
                      <span className="rounded-full border border-cyan-100 bg-cyan-50 px-2.5 py-1 text-xs font-black text-cyan-700">
                        {compactNumber(actionPlan.summary?.known_sources || 0)} sources
                      </span>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-slate-600">
                      scale {compactNumber(actionPlan.summary?.scale_sources || 0)} · explore {compactNumber(actionPlan.summary?.explore_sources || 0)} · stop {compactNumber(actionPlan.summary?.stop_sources || 0)}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">{actionPlan.next_collection_plan?.instruction}</p>
                    <div className="mt-2 space-y-1">
                      {(actionPlan.next_collection_plan?.payloads || []).slice(0, 3).map((payload, index) => (
                        <div key={`${payload.source_run_payload?.discovery_source_id || index}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs">
                          <span className="font-black text-slate-800">{payload.lane}</span>
                          <span className="text-slate-500"> · {payload.source_run_payload?.target_platform} · {payload.source_run_payload?.query}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {creativeBriefs ? (
                  <div className="rounded-xl border border-cyan-200 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-black text-slate-950">Creative briefs export</p>
                      <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">
                        {compactNumber(creativeBriefs.count || 0)} briefs
                      </span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {(creativeBriefs.briefs || []).slice(0, 3).map((brief) => (
                        <div key={brief.id} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs">
                          <div className="font-black text-slate-800">{brief.title}</div>
                          <div className="mt-1 text-slate-500">{brief.hook}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">Creative Memory / DNA</p>
                <h4 className="mt-1 text-lg font-black text-slate-950">Из чего мозг собирает новые ролики</h4>
                <p className="mt-1 max-w-2xl text-sm font-medium text-amber-900">
                  Это слой между трендами и генератором: лучшие хуки, эмоции, камера, монтаж, B-roll, CTA, продукт, аудитория и запреты на копирование.
                </p>
              </div>
              <span className="rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-black text-amber-800">
                {creativeMemoryLoading ? "loading" : `${compactNumber(creativeMemorySummary.dna || 0)} DNA`}
              </span>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
              <MetricCard label="Atoms" value={creativeMemorySummary.atoms || 0} />
              <MetricCard label="DNA combos" value={creativeMemorySummary.dna || 0} />
              <MetricCard label="Anti-patterns" value={creativeMemorySummary.anti_patterns || 0} />
              <MetricCard label="Experiments" value={creativeMemorySummary.experiment_skeletons || 0} />
              <MetricCard label="Product brains" value={creativeMemorySummary.product_brains || 0} />
              <MetricCard label="Audience brains" value={creativeMemorySummary.audience_brains || 0} />
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-2xl border border-amber-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-black text-slate-950">Топ Creative DNA</p>
                  <span className="rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-xs font-black text-amber-800">
                    combinations
                  </span>
                </div>
                <div className="mt-3 grid gap-2 lg:grid-cols-2">
                  {topCreativeDna.length ? topCreativeDna.slice(0, 4).map((dna) => (
                    <div key={dna.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-black text-slate-900">{dna.niche}</span>
                        <span className={`rounded-full border px-2 py-1 font-black ${confidenceCopy(dna.confidence).tone}`}>
                          {compactNumber(dna.score)}
                        </span>
                      </div>
                      <p className="mt-2 font-semibold text-slate-700">{dna.atoms.hook || "hook"} · {dna.atoms.structure || "structure"}</p>
                      <p className="mt-1 text-slate-500">camera: {dna.atoms.camera || "—"}</p>
                      <p className="mt-1 text-slate-500">audio: {dna.atoms.audio || "—"}</p>
                      <p className="mt-1 text-slate-500">cta: {dna.atoms.cta || "—"}</p>
                    </div>
                  )) : (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                      Creative DNA появится после Pattern Brain по выбранным нишам.
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-2xl border border-amber-200 bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Лучшие атомы</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {topCreativeAtoms.length ? topCreativeAtoms.slice(0, 10).map((atom) => (
                      <span key={atom.id} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700">
                        {atom.type}: {atom.label} · {compactNumber(atom.score)}
                      </span>
                    )) : <span className="text-sm text-slate-500">Атомы пока не собраны.</span>}
                  </div>
                </div>

                <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">Anti Pattern Brain</p>
                  <div className="mt-3 space-y-2">
                    {topAntiPatterns.length ? topAntiPatterns.slice(0, 3).map((anti) => (
                      <div key={anti.id} className="rounded-xl border border-red-100 bg-white px-3 py-2 text-xs text-red-800">
                        <span className="font-black">{anti.severity === "avoid" ? "avoid" : "watch"}:</span> {anti.label}
                      </div>
                    )) : <p className="text-sm text-red-800">Запреты появятся после оценки слабых/шумных паттернов.</p>}
                  </div>
                </div>

                <div className="rounded-2xl border border-cyan-100 bg-cyan-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">Experiment Brain</p>
                  <p className="mt-2 text-sm font-semibold text-cyan-950">
                    {creativeExperiments.length
                      ? `${compactNumber(creativeExperiments.length)} A/B скелетов: менять hook, CTA, camera или audio при фиксированной структуре.`
                      : "Эксперименты появятся после генерации Creative DNA."}
                  </p>
                  {creativeExperiments[0]?.variants?.[0] ? (
                    <p className="mt-2 rounded-xl border border-cyan-100 bg-white px-3 py-2 text-xs text-cyan-800">
                      first test: {creativeExperiments[0].variants[0].axis} → {creativeExperiments[0].variants[0].change_to}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-cyan-100 bg-cyan-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">Audio Intelligence</p>
                <h4 className="mt-1 text-lg font-black text-slate-950">Как должен звучать viral-ролик</h4>
                <p className="mt-1 max-w-2xl text-sm font-medium text-cyan-900">
                  MVP без скачивания видео: строим speech/music/edit-sync правила из Pattern Brain и sound titles. Следующий слой — FFmpeg, WhisperX, Librosa и beat map.
                </p>
              </div>
              <span className="rounded-full border border-cyan-200 bg-white px-3 py-1 text-xs font-black text-cyan-800">
                {audioIntelligenceLoading ? "loading" : `${compactNumber(audioSummary.patterns || 0)} audio patterns`}
              </span>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              <MetricCard label="Audio patterns" value={audioSummary.patterns || 0} />
              <MetricCard label="Sound titles" value={audioSummary.sound_titles || 0} />
              <MetricCard label="Strategies" value={audioSummary.strategies || 0} />
              <MetricCard label="Worker stages" value={audioSummary.worker_stages || 0} />
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-[1fr_1fr]">
              <div className="rounded-2xl border border-cyan-200 bg-white p-4">
                <p className="font-black text-slate-950">Топ аудио-стратегии</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {audioPatterns.length ? audioPatterns.slice(0, 4).map((pattern) => (
                    <div key={pattern.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-black text-slate-900">{pattern.strategy}</span>
                        <span className={`rounded-full border px-2 py-1 font-black ${confidenceCopy(pattern.confidence).tone}`}>
                          {compactNumber(pattern.score)}
                        </span>
                      </div>
                      <p className="mt-2 font-semibold text-slate-700">{pattern.speech.first_phrase_rule}</p>
                      <p className="mt-1 text-slate-500">speed: {pattern.speech.suggested_speed} · music: {pattern.music.role} · BPM {pattern.music.bpm_range}</p>
                      <p className="mt-1 text-slate-500">edit: {pattern.edit_sync.cut_rhythm}</p>
                    </div>
                  )) : <p className="text-sm text-slate-500">Audio patterns появятся после Pattern Brain.</p>}
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-2xl border border-cyan-200 bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Strategy mix</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {audioStrategyMix.length ? audioStrategyMix.map((row) => (
                      <span key={row.strategy} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700">
                        {row.strategy}: {compactNumber(row.count)} · {compactNumber(row.avg_score)}
                      </span>
                    )) : <span className="text-sm text-slate-500">Микс стратегий пока пуст.</span>}
                  </div>
                </div>

                <div className="rounded-2xl border border-cyan-200 bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Sound memory</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {topSoundTitles.length ? topSoundTitles.slice(0, 8).map((sound) => (
                      <span key={sound.title} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700">
                        {sound.title} · {compactNumber(sound.evidence_count)}
                      </span>
                    )) : <span className="text-sm text-slate-500">Sound titles пока не накоплены.</span>}
                  </div>
                </div>

                <details className="rounded-2xl border border-cyan-200 bg-white p-4">
                  <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.18em] text-slate-500">Audio worker roadmap</summary>
                  <div className="mt-3 space-y-2">
                    {audioNextPipeline.map((stage) => (
                      <div key={stage.stage} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-black text-slate-900">{stage.stage}</span>
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-1 font-bold text-slate-600">{stage.status}</span>
                        </div>
                        <p className="mt-1 text-slate-500">{stage.tool} → {stage.output}</p>
                      </div>
                    ))}
                    {audioEditorRules.slice(0, 3).map((rule) => (
                      <p key={rule} className="rounded-xl border border-cyan-100 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-900">{rule}</p>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Camera / Editing Brain</p>
                <h4 className="mt-1 text-lg font-black text-slate-950">Как снимать и где резать кадр</h4>
                <p className="mt-1 max-w-2xl text-sm font-medium text-emerald-900">
                  Этот слой превращает паттерны в режиссёрский payload: ракурс, движение камеры, proof shot, склейки, zoom/pop/freeze и структуру по секундам.
                </p>
              </div>
              <span className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-black text-emerald-800">
                {visualIntelligenceLoading ? "loading" : `${compactNumber(visualSummary.patterns || 0)} visual patterns`}
              </span>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              <MetricCard label="Visual patterns" value={visualSummary.patterns || 0} />
              <MetricCard label="Camera styles" value={visualSummary.camera_styles || 0} />
              <MetricCard label="Editing moves" value={visualSummary.editing_moves || 0} />
              <MetricCard label="Editor payloads" value={visualSummary.editor_payloads || 0} />
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-2xl border border-emerald-200 bg-white p-4">
                <p className="font-black text-slate-950">Топ режиссёрские рецепты</p>
                <div className="mt-3 grid gap-2 lg:grid-cols-2">
                  {visualPatterns.length ? visualPatterns.slice(0, 4).map((pattern) => (
                    <div key={pattern.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-black text-slate-900">{pattern.camera.primary}</span>
                        <span className={`rounded-full border px-2 py-1 font-black ${confidenceCopy(pattern.confidence).tone}`}>
                          {compactNumber(pattern.score)}
                        </span>
                      </div>
                      <p className="mt-2 font-semibold text-slate-700">{pattern.camera.proof_shot}</p>
                      <p className="mt-1 text-slate-500">movement: {pattern.camera.movement}</p>
                      <p className="mt-1 text-slate-500">rhythm: {pattern.editing.rhythm}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(pattern.editing.moves || []).slice(0, 4).map((move) => (
                          <span key={move} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-bold text-slate-600">{move}</span>
                        ))}
                      </div>
                    </div>
                  )) : <p className="text-sm text-slate-500">Visual patterns появятся после Pattern Brain.</p>}
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-2xl border border-emerald-200 bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Camera mix</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {cameraMix.length ? cameraMix.map((row) => (
                      <span key={row.camera} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700">
                        {row.camera}: {compactNumber(row.count)} · {compactNumber(row.avg_score)}
                      </span>
                    )) : <span className="text-sm text-slate-500">Camera mix пока пуст.</span>}
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-200 bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Editing moves</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {editingMix.length ? editingMix.slice(0, 10).map((row) => (
                      <span key={row.move} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700">
                        {row.move}: {compactNumber(row.count)} · {compactNumber(row.avg_score)}
                      </span>
                    )) : <span className="text-sm text-slate-500">Editing moves пока пусты.</span>}
                  </div>
                </div>

                <details className="rounded-2xl border border-emerald-200 bg-white p-4">
                  <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.18em] text-slate-500">Editor payload example</summary>
                  <div className="mt-3 space-y-2">
                    {editorPayloads[0]?.timeline?.length ? editorPayloads[0].timeline.map((step) => (
                      <div key={`${editorPayloads[0].id}:${step.t}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                        <span className="font-black text-slate-900">{step.t}</span>
                        <span className="text-slate-500"> · {step.action}</span>
                      </div>
                    )) : <p className="text-sm text-slate-500">Payload появится после visual patterns.</p>}
                    {directorRules.slice(0, 3).map((rule) => (
                      <p key={rule} className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">{rule}</p>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200">Simulation / Critic Brain</p>
                <h4 className="mt-1 text-lg font-black">Виртуальная фокус-группа до генерации</h4>
                <p className="mt-1 max-w-2xl text-sm font-medium text-slate-300">
                  Проверяет Creative DNA + Audio + Visual глазами разных покупателей: родитель, импульсный покупатель, скептик, native-зритель и покупатель деталей.
                </p>
              </div>
              <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-black text-cyan-100">
                {simulationBrainLoading ? "loading" : `${compactNumber(simulationSummary.simulations || 0)} simulations`}
              </span>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-5">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-300">Ship</p>
                <p className="mt-1 text-2xl font-black text-emerald-200">{compactNumber(simulationSummary.ship || 0)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-300">Revise</p>
                <p className="mt-1 text-2xl font-black text-amber-200">{compactNumber(simulationSummary.revise || 0)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-300">Hold</p>
                <p className="mt-1 text-2xl font-black text-red-200">{compactNumber(simulationSummary.hold || 0)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-300">Personas</p>
                <p className="mt-1 text-2xl font-black">{compactNumber(simulationSummary.personas || 0)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-300">Total</p>
                <p className="mt-1 text-2xl font-black">{compactNumber(simulations.length)}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <p className="font-black text-white">Лучшие кандидаты на генерацию</p>
                <div className="mt-3 grid gap-2 lg:grid-cols-2">
                  {(topShipCandidates.length ? topShipCandidates : simulations).slice(0, 4).map((sim) => (
                    <div key={sim.id} className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-black text-white">{sim.niche}</span>
                        <span className={`rounded-full border px-2 py-1 font-black ${
                          sim.readiness === "ship"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : sim.readiness === "revise"
                              ? "border-amber-200 bg-amber-50 text-amber-800"
                              : "border-red-200 bg-red-50 text-red-700"
                        }`}>
                          {sim.readiness} · {compactNumber(sim.score)}
                        </span>
                      </div>
                      <p className="mt-2 text-slate-200">{sim.strongest_reason}</p>
                      <p className="mt-1 text-amber-100">risk: {sim.biggest_risk}</p>
                      <p className="mt-1 text-cyan-100">fix: {sim.recommended_iteration}</p>
                    </div>
                  ))}
                  {!simulations.length ? <p className="text-sm text-slate-300">Simulation появится после Creative DNA.</p> : null}
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/70">Persona scores</p>
                  <div className="mt-3 space-y-2">
                    {personaSummary.length ? personaSummary.map((persona) => (
                      <div key={persona.persona} className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-black text-white">{persona.persona}</span>
                          <span className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-cyan-100">{compactNumber(persona.avg_score)}</span>
                        </div>
                        <p className="mt-1 text-slate-300">{persona.top_concerns?.[0] || "без явного риска"}</p>
                      </div>
                    )) : <p className="text-sm text-slate-300">Persona scores пока пусты.</p>}
                  </div>
                </div>

                <details className="rounded-2xl border border-white/10 bg-white/10 p-4">
                  <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.18em] text-cyan-100/70">Revise queue + guardrails</summary>
                  <div className="mt-3 space-y-2">
                    {reviseQueue.slice(0, 3).map((sim) => (
                      <div key={sim.id} className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-xs">
                        <span className="font-black text-amber-100">{sim.readiness} · {compactNumber(sim.score)}</span>
                        <p className="mt-1 text-slate-300">{sim.biggest_risk}</p>
                        <p className="mt-1 text-cyan-100">{sim.recommended_iteration}</p>
                      </div>
                    ))}
                    {simulationGuardrails.slice(0, 3).map((rule) => (
                      <p key={rule} className="rounded-xl border border-cyan-200/20 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100">{rule}</p>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-700">Experiment Brain</p>
                <h4 className="mt-1 text-lg font-black text-slate-950">A/B-план без хаотичных вариантов</h4>
                <p className="mt-1 max-w-2xl text-sm font-medium text-indigo-900">
                  Берём Creative DNA и Simulation risks, меняем только одну переменную и заранее задаём метрики успеха.
                </p>
              </div>
              <span className="rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-black text-indigo-800">
                {experimentBrainLoading ? "loading" : `${compactNumber(experimentSummary.experiments || 0)} experiments`}
              </span>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              <MetricCard label="Launch queue" value={experimentSummary.launch || 0} />
              <MetricCard label="Hold queue" value={experimentSummary.hold || 0} />
              <MetricCard label="Axes" value={experimentSummary.axes || 0} />
              <MetricCard label="Total tests" value={experimentSummary.experiments || 0} />
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-2xl border border-indigo-200 bg-white p-4">
                <p className="font-black text-slate-950">Что запускать первым</p>
                <div className="mt-3 grid gap-2 lg:grid-cols-2">
                  {launchExperiments.length ? launchExperiments.slice(0, 4).map((exp) => (
                    <div key={exp.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-black text-slate-900">{exp.niche} · {exp.axis}</span>
                        <span className="rounded-full border border-indigo-200 bg-white px-2 py-1 font-black text-indigo-800">
                          {compactNumber(exp.priority_score)}
                        </span>
                      </div>
                      <p className="mt-2 font-semibold text-slate-700">{exp.hypothesis}</p>
                      <p className="mt-1 text-slate-500">variant: {exp.variant.change_to}</p>
                      <p className="mt-1 text-slate-500">metrics: {exp.success_metrics.join(" · ")}</p>
                      <p className="mt-1 text-amber-700">stop: {exp.stop_rule}</p>
                    </div>
                  )) : <p className="text-sm text-slate-500">Launch queue появится после Simulation + Creative DNA.</p>}
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-2xl border border-indigo-200 bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Axes</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {experimentAxes.length ? experimentAxes.map((axis) => (
                      <span key={axis.axis} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700">
                        {axis.axis}: {compactNumber(axis.count)} · {compactNumber(axis.avg_priority)}
                      </span>
                    )) : <span className="text-sm text-slate-500">Axes пока пусты.</span>}
                  </div>
                </div>

                <details className="rounded-2xl border border-indigo-200 bg-white p-4">
                  <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.18em] text-slate-500">Rules + hold queue</summary>
                  <div className="mt-3 space-y-2">
                    {holdExperiments.slice(0, 3).map((exp) => (
                      <div key={exp.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                        <span className="font-black text-amber-700">hold · {exp.axis} · {compactNumber(exp.priority_score)}</span>
                        <p className="mt-1 text-slate-500">{exp.risk}</p>
                      </div>
                    ))}
                    {experimentRules.slice(0, 4).map((rule) => (
                      <p key={rule} className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-900">{rule}</p>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 p-4 text-white">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/70">Winning hooks</p>
                  <h4 className="mt-1 text-xl font-black">OP hooks, которые чаще всего побеждают</h4>
                </div>
                <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-bold text-slate-200">
                  top {compactNumber(filteredTopHooks.length)}
                </span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {filteredTopHooks.length ? filteredTopHooks.slice(0, 4).map((hook, index) => {
                  const status = hookStatusCopy(hook.status);
                  const confidence = confidenceCopy(hook.confidence);
                  return (
                    <div key={hook.hook_type} className="rounded-2xl border border-white/10 bg-white/10 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/70">#{index + 1}</p>
                          <h5 className="mt-1 text-lg font-black">{hook.hook_label}</h5>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-black ${status.tone}`}>{status.label}</span>
                      </div>
                      <span className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${confidence.tone}`}>{confidence.label}</span>
                      <div className="mt-3 flex items-end gap-2">
                        <span className="text-4xl font-black">{compactNumber(hook.op_score)}</span>
                        <span className="pb-1 text-xs font-bold uppercase tracking-wide text-slate-300">OP score</span>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-200">
                        <span className="rounded-xl bg-white/10 px-2 py-1">freq {compactNumber(hook.frequency)}</span>
                        <span className="rounded-xl bg-white/10 px-2 py-1">avg {compactNumber(hook.avg_score)}</span>
                        <span className="rounded-xl bg-white/10 px-2 py-1">niches {compactNumber(hook.niches.length)}</span>
                      </div>
                      {hook.evidence ? (
                        <p className="mt-2 text-xs text-slate-300">
                          evidence: {compactNumber(hook.evidence.based_on_videos)} videos · {compactNumber(hook.evidence.platform_count)} platforms · {compactNumber(hook.evidence.reference_count)} refs
                        </p>
                      ) : null}
                      {hook.templates?.[0] ? (
                        <p className="mt-3 rounded-xl bg-slate-950/40 px-3 py-2 text-xs leading-5 text-slate-200">
                          Шаблон: {hook.templates[0]}
                        </p>
                      ) : null}
                    </div>
                  );
                }) : <div className="rounded-2xl border border-white/10 bg-white/10 p-4 text-sm text-slate-300">OP hooks пока не собраны.</div>}
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-3">
                {[
                  ["OP", hookGroups.op_hooks?.length || 0],
                  ["Frequent", hookGroups.frequent_hooks?.length || 0],
                  ["Experimental", hookGroups.experimental_hooks?.length || 0],
                ].map(([label, count]) => (
                  <div key={label} className="rounded-xl border border-white/10 bg-white/10 px-3 py-2">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/70">{label}</p>
                    <p className="mt-1 text-2xl font-black">{compactNumber(Number(count))}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Winning formats</p>
                <h4 className="mt-1 text-lg font-black text-slate-950">Какие форматы работают</h4>
                <div className="mt-3 space-y-2">
                  {winningFormats.length ? winningFormats.slice(0, 4).map((format) => (
                    <div key={format.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900">{format.label}</span>
                        <span className="text-xs font-black text-cyan-700">{compactNumber(format.avg_score)}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">freq {compactNumber(format.frequency)} · {format.niches.join(", ") || "all niches"}</p>
                    </div>
                  )) : <p className="text-sm text-slate-500">Форматы пока не найдены.</p>}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Retention mechanics</p>
                <h4 className="mt-1 text-lg font-black text-slate-950">Почему досматривают</h4>
                <div className="mt-3 space-y-2">
                  {retentionMechanics.length ? retentionMechanics.slice(0, 4).map((retention) => (
                    <div key={retention.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900">{retention.label}</span>
                        <span className="text-xs font-black text-emerald-700">{compactNumber(retention.avg_score)}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{retention.hooks.slice(0, 2).join(" · ") || "hook mix"}</p>
                    </div>
                  )) : <p className="text-sm text-slate-500">Механики удержания пока не найдены.</p>}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Generator-ready recipes</p>
                <h4 className="mt-1 text-lg font-black text-slate-950">Что можно сразу отдавать контент-заводу</h4>
              </div>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-500">
                {compactNumber(filteredRecipes.length)} recipes
              </span>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              {filteredRecipes.length ? filteredRecipes.slice(0, 3).map((recipe) => (
                <div key={recipe.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h5 className="text-sm font-black leading-5 text-slate-950">{recipe.title}</h5>
                    <span className="shrink-0 rounded-full border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs font-black text-cyan-800">
                      {compactNumber(recipe.op_score)}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-slate-600">
                    <p><span className="font-bold text-slate-900">Hook:</span> {recipe.creative_brief?.hook || recipe.hook}</p>
                    <p><span className="font-bold text-slate-900">Retention:</span> {recipe.creative_brief?.retention_mechanic || recipe.retention}</p>
                    <p><span className="font-bold text-slate-900">Fit:</span> {(recipe.creative_brief?.product_fit || recipe.niches).slice(0, 2).join(" · ")}</p>
                  </div>
                  <span className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${confidenceCopy(recipe.confidence).tone}`}>
                    {confidenceCopy(recipe.confidence).label}
                  </span>
                  {recipe.creative_brief ? (
                    <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                        Creative brief
                      </summary>
                      <div className="mt-3 space-y-3 text-xs leading-5 text-slate-600">
                        <div>
                          <p className="font-black text-slate-900">Структура по секундам</p>
                          <ol className="mt-1 list-decimal space-y-1 pl-4">
                            {recipe.creative_brief.second_by_second.slice(0, 5).map((step) => <li key={step}>{step}</li>)}
                          </ol>
                        </div>
                        <div>
                          <p className="font-black text-slate-900">Visual recipe</p>
                          <ul className="mt-1 list-disc space-y-1 pl-4">
                            {recipe.creative_brief.visual_recipe.slice(0, 4).map((step) => <li key={step}>{step}</li>)}
                          </ul>
                        </div>
                        <div>
                          <p className="font-black text-slate-900">Копируем механику</p>
                          <p className="mt-1">{recipe.creative_brief.copy_as_mechanic.slice(0, 2).join(" · ")}</p>
                        </div>
                        <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-red-700">
                          <p className="font-black">Запрещено копировать</p>
                          <p className="mt-1">{recipe.creative_brief.do_not_copy.slice(0, 2).join(" · ")}</p>
                        </div>
                        {recipe.generator_payload ? (
                          <div className="rounded-lg border border-cyan-100 bg-cyan-50 px-3 py-2 text-cyan-800">
                            <p className="font-black">Use in generator payload</p>
                            <p className="mt-1">hook + retention + structure + visual_recipe + do_not_copy готовы для генератора.</p>
                          </div>
                        ) : null}
                        {recipe.examples?.length ? (
                          <div>
                            <p className="font-black text-slate-900">Source references</p>
                            <div className="mt-1 space-y-2">
                              {recipe.examples.slice(0, 2).map((example) => (
                                <div key={example.reference_id || example.url || example.hook || "ref"} className="rounded-lg border border-slate-200 bg-white px-2 py-2">
                                  <p className="font-semibold text-slate-700">{example.why_selected || "Референс механики"}</p>
                                  <p className="mt-1 text-slate-500">score {compactNumber(example.score || 0)} · views {compactNumber(example.views || 0)}</p>
                                  {example.url ? <p className="mt-1 truncate text-cyan-700">{example.url}</p> : null}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                  <p className="mt-3 text-xs font-semibold text-slate-400">{recipe.niches.join(", ")}</p>
                </div>
              )) : <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">Рецепты появятся после сборки Pattern Brain.</div>}
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Source references</p>
              <h4 className="mt-1 text-lg font-black text-slate-950">На чем основаны выводы</h4>
              <div className="mt-3 space-y-2">
                {sourceReferences.length ? sourceReferences.slice(0, 4).map((reference) => (
                  <div key={reference.reference_id || reference.url || reference.hook || reference.hook_type} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-900">{reference.hook_label || reference.hook_type || "reference"}</span>
                      <span className={`rounded-full border px-2 py-1 text-xs font-black ${confidenceCopy(reference.confidence).tone}`}>{confidenceCopy(reference.confidence).label}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{reference.why_selected || "Референс механики"}</p>
                    <p className="mt-1 text-xs text-slate-400">score {compactNumber(reference.score || 0)} · views {compactNumber(reference.views || 0)}</p>
                  </div>
                )) : <p className="text-sm text-slate-500">Референсы появятся после пересборки Pattern Brain.</p>}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Source map / discovery economics</p>
              <h4 className="mt-1 text-lg font-black text-slate-950">Куда тратить следующий Apify-бюджет</h4>
              {economicsSummary ? (
                <div className="mt-3 rounded-xl border border-cyan-100 bg-cyan-50 px-3 py-2 text-xs text-cyan-900">
                  <div className="font-black">
                    Источников в памяти: {compactNumber(economicsSummary.source_memory_count)} · scale {compactNumber(economicsSummary.scalable_sources)} · stop {compactNumber(economicsSummary.avoid_sources)}
                  </div>
                  <div className="mt-1 font-semibold">
                    {economicsSummary.best_source?.label ? `Лучший источник: ${economicsSummary.best_source.label} (${compactNumber(economicsSummary.best_source.yield_score)}/100)` : "Лучший источник пока не доказан."}
                  </div>
                  <div className="mt-1 text-cyan-800">{economicsSummary.note}</div>
                </div>
              ) : null}

              {recommendedSpendPlan?.split ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-xl border border-emerald-100 bg-white px-3 py-2">
                    <p className="text-xs font-black uppercase tracking-wide text-emerald-700">Exploit</p>
                    <p className="mt-1 text-2xl font-black text-slate-950">{compactNumber(recommendedSpendPlan.split.exploit_pct)}%</p>
                  </div>
                  <div className="rounded-xl border border-cyan-100 bg-white px-3 py-2">
                    <p className="text-xs font-black uppercase tracking-wide text-cyan-700">Explore</p>
                    <p className="mt-1 text-2xl font-black text-slate-950">{compactNumber(recommendedSpendPlan.split.explore_pct)}%</p>
                  </div>
                  <div className="rounded-xl border border-amber-100 bg-white px-3 py-2">
                    <p className="text-xs font-black uppercase tracking-wide text-amber-700">Refresh</p>
                    <p className="mt-1 text-2xl font-black text-slate-950">{compactNumber(recommendedSpendPlan.split.refresh_pct)}%</p>
                  </div>
                </div>
              ) : null}

              {recommendedSpendPlan?.next_actions?.length ? (
                <div className="mt-3 space-y-1">
                  {recommendedSpendPlan.next_actions.slice(0, 3).map((action) => (
                    <p key={action} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">{action}</p>
                  ))}
                </div>
              ) : null}

              <div className="mt-3 grid gap-2">
                {[...scalableSources.slice(0, 2), ...exploreSources.slice(0, 1), ...avoidSources.slice(0, 1)].length ? (
                  [...scalableSources.slice(0, 2), ...exploreSources.slice(0, 1), ...avoidSources.slice(0, 1)].map((source) => {
                    const recommendation = sourceRecommendationCopy(source.recommendation);
                    return (
                      <div key={source.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold text-slate-900">{titlePlatform(source.platform)} · {source.type}: {source.value}</span>
                          <span className={`rounded-full border px-2 py-1 text-xs font-black ${recommendation.tone}`}>{recommendation.label}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          yield {compactNumber(source.yield_score)} · relevant {compactNumber(Math.round(source.relevance_rate * 100))}% · breakout {compactNumber(Math.round(source.breakout_rate * 100))}% · cost/useful {formatUsd(source.estimated_cost_per_relevant_usd)}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">{source.reason}</p>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-500">Source rankings появятся после Discovery replay или новых source-aware прогонов.</p>
                )}
              </div>

              <details className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.16em] text-slate-500">Provider economics</summary>
                <div className="mt-3 space-y-2">
                  {sourceMap.length ? sourceMap.slice(0, 5).map((source) => (
                    <div key={source.provider} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold text-slate-900">{providerLabel(source.provider)}</span>
                        <span className="text-xs font-black text-cyan-700">{formatUsd(source.cost_per_useful ?? source.cost_per_analyzed)}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        runs {compactNumber(source.runs)} · analyzed {compactNumber(source.analyzed)} · relevant {compactNumber(source.relevant || 0)} · waste {compactNumber(source.waste_score || 0)} · {spendSourceLabel(source.spend_source)}
                      </p>
                    </div>
                  )) : <p className="text-sm text-slate-500">Provider economics появится после cost-aware прогонов.</p>}
                </div>
              </details>
            </div>
          </div>

          {legalGuard ? (
            <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 p-4 text-red-800">
              <p className="text-xs font-black uppercase tracking-[0.18em]">Legal / safety guard</p>
              <p className="mt-1 text-sm font-semibold">{legalGuard.principle}</p>
              <p className="mt-2 text-xs"><span className="font-black">Можно:</span> {legalGuard.allowed.slice(0, 5).join(" · ")}</p>
              <p className="mt-1 text-xs"><span className="font-black">Нельзя:</span> {legalGuard.forbidden.slice(0, 5).join(" · ")}</p>
            </div>
          ) : null}

          <details className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-black uppercase tracking-[0.18em] text-slate-500">
              15-layer roadmap status
            </summary>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {capabilityStatus.map((capability) => (
                <div key={capability.key} className={`rounded-xl border px-3 py-2 text-xs font-bold ${capabilityTone(capability.status)}`}>
                  <p>{capability.label}</p>
                  <p className="mt-1 opacity-75">{capability.status}</p>
                </div>
              ))}
            </div>
          </details>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 p-4 text-white">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200/80">Learning economics</p>
              <h3 className="mt-1 text-xl font-black tracking-tight">Рост понимания и цена насмотренности</h3>
              <p className="mt-1 max-w-2xl text-sm text-slate-300">
                Показывает, умнеет ли мозг от прогона к прогону: сколько видео превратилось в память, сколько появилось generator-ready паттернов и дешевле ли добывается новое полезное видео.
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadLearningEconomics(automationNiches)}
              disabled={loadingLearningEconomics}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm font-bold text-white hover:bg-white/15 disabled:opacity-50"
            >
              {loadingLearningEconomics ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Обновить economics
            </button>
          </div>

          {learningEconomicsError && <div className="mt-3 rounded-xl border border-red-300/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">{learningEconomicsError}</div>}

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-cyan-100/70">Понимание ниш</p>
              <div className="mt-2 text-3xl font-black">{compactNumber(learningTotals?.avg_understanding_score || 0)}%</div>
              <p className="mt-1 text-xs text-slate-300">средний score по pattern brain</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-cyan-100/70">В памяти</p>
              <div className="mt-2 text-3xl font-black">{compactNumber(learningTotals?.analyzed_videos || 0)}</div>
              <p className="mt-1 text-xs text-slate-300">из {compactNumber(learningTotals?.total_videos || 0)} видео</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-cyan-100/70">Generator-ready</p>
              <div className="mt-2 text-3xl font-black">{compactNumber(learningTotals?.generator_ready_patterns || 0)}</div>
              <p className="mt-1 text-xs text-slate-300">паттернов для генератора</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-cyan-100/70">Cross-platform</p>
              <div className="mt-2 text-3xl font-black">{compactNumber(learningTotals?.cross_platform_patterns || 0)}</div>
              <p className="mt-1 text-xs text-slate-300">паттернов между платформами</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-cyan-100/70">Цена нового видео</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-3xl font-black">{learningTotals?.cost_units_per_inserted_recent == null ? "—" : compactNumber(learningTotals.cost_units_per_inserted_recent)}</span>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${learningTrend.tone}`}>{learningTrend.label}</span>
              </div>
              <p className="mt-1 text-xs text-slate-300">{learningTrend.text}</p>
            </div>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <div className="rounded-2xl border border-cyan-200/20 bg-cyan-300/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-cyan-100/70">Сегодня $ / полезное видео</p>
                  <div className="mt-2 text-3xl font-black">{formatUsd(todayUsefulCost)}</div>
                  <p className="mt-1 text-xs text-slate-300">
                    {todayCost
                      ? `${compactNumber(todayCost.inserted)} saved · ${compactNumber(todayCost.analyzed)} memory · ${compactNumber(todayCost.relevant)} relevant · basis ${todayCostBasis.label} ${compactNumber(todayCostBasis.count)}`
                      : "сегодня intake-прогонов пока нет"}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold ${dayLearningTrend.tone}`}>{dayLearningTrend.label}</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-200">
                <span className="rounded-xl bg-white/10 px-2 py-1">spend {formatUsd(todayCost?.spend_usd)}</span>
                <span className="rounded-xl bg-white/10 px-2 py-1">runs {compactNumber(todayCost?.runs || 0)}</span>
                <span className="rounded-xl bg-white/10 px-2 py-1">{spendSourceLabel(todayCost?.spend_source)}</span>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-cyan-100/70">Вчера $ / полезное видео</p>
              <div className="mt-2 text-3xl font-black">{formatUsd(yesterdayUsefulCost)}</div>
              <p className="mt-1 text-xs text-slate-300">
                {yesterdayCost
                  ? `${compactNumber(yesterdayCost.inserted)} saved · ${compactNumber(yesterdayCost.analyzed)} memory · ${compactNumber(yesterdayCost.relevant)} relevant · basis ${yesterdayCostBasis.label} ${compactNumber(yesterdayCostBasis.count)}`
                  : "за вчера нет сохраненных cost-событий"}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-200">
                <span className="rounded-xl bg-white/10 px-2 py-1">spend {formatUsd(yesterdayCost?.spend_usd)}</span>
                <span className="rounded-xl bg-white/10 px-2 py-1">runs {compactNumber(yesterdayCost?.runs || 0)}</span>
                <span className="rounded-xl bg-white/10 px-2 py-1">{spendSourceLabel(yesterdayCost?.spend_source)}</span>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-cyan-100/70">Дельта день ко дню</p>
              <div className="mt-2 text-3xl font-black">
                {usefulCostDeltaPct == null ? "—" : `${usefulCostDeltaPct > 0 ? "+" : ""}${compactNumber(usefulCostDeltaPct)}%`}
              </div>
              <p className="mt-1 text-xs text-slate-300">
                Считаем по полезной насмотренности: relevant, если есть; иначе analyzed; иначе inserted.
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-200">
                <span className="rounded-xl bg-white/10 px-2 py-1">found {compactNumber(todayCost?.found || 0)}</span>
                <span className="rounded-xl bg-white/10 px-2 py-1">errors {compactNumber(todayCost?.errors || 0)}</span>
                <span className="rounded-xl bg-white/10 px-2 py-1">unit {compactNumber(todayCost?.cost_units_per_inserted || 0)}</span>
              </div>
            </div>
          </div>

          <details className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
            <summary className="cursor-pointer text-sm font-black text-cyan-100">
              Technical learning trail: timeline и детальная сила ниш
            </summary>
          <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-100/70">Run timeline</p>
                  <h4 className="mt-1 text-lg font-black">От прогона к прогону</h4>
                </div>
                <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
                  {compactNumber(learningTimeline.length)} точек
                </span>
              </div>
              <div className="mt-4 space-y-2">
                {learningTimeline.length ? learningTimeline.slice(-10).map((run) => {
                  const width = Math.max(4, Math.min(100, Math.round((run.inserted / maxTimelineInserted) * 100)));
                  return (
                    <div key={`${run.id}:${run.created_at}`} className="rounded-xl border border-white/10 bg-slate-950/35 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-white">{automationTitle(run.mode)}</span>
                        <span className="text-slate-300">{new Date(run.created_at).toLocaleString("ru-RU")}</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-cyan-300" style={{ width: `${width}%` }} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-200">
                        <span>+{compactNumber(run.inserted)} video</span>
                        <span>+{compactNumber(run.analyzed)} memory</span>
                        <span>{run.usd_per_inserted == null ? "$/video —" : `${formatUsd(run.usd_per_inserted)} / video`}</span>
                        <span>{run.cost_units_per_inserted == null ? "cost/video —" : `${compactNumber(run.cost_units_per_inserted)} units/video`}</span>
                        {run.best_provider ? <span>{providerLabel(run.best_provider)}</span> : null}
                      </div>
                    </div>
                  );
                }) : <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-4 text-sm text-slate-300">Истории прогонов пока нет.</div>}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-100/70">Niche understanding</p>
              <h4 className="mt-1 text-lg font-black">Где мозг сильнее</h4>
              <div className="mt-4 space-y-3">
                {learningNiches.length ? learningNiches.map((row) => (
                  <div key={row.niche} className="rounded-xl border border-white/10 bg-slate-950/35 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-black">{row.niche}</div>
                      <span className="rounded-full border border-cyan-200/30 bg-cyan-300/10 px-2.5 py-1 text-xs font-bold text-cyan-100">
                        {compactNumber(row.understanding_score)}%
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-emerald-300" style={{ width: `${Math.max(4, Math.min(100, row.understanding_score))}%` }} />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300">
                      <span>videos {compactNumber(row.total_videos)}</span>
                      <span>analyzed {compactNumber(row.analyzed_videos)}</span>
                      <span>patterns {compactNumber(row.patterns)}</span>
                      <span>ready {compactNumber(row.generator_ready_patterns)}</span>
                    </div>
                  </div>
                )) : <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-4 text-sm text-slate-300">Pattern Brain пока не найден.</div>}
              </div>
            </div>
          </div>
          </details>
        </div>

        <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <summary className="cursor-pointer text-sm font-black uppercase tracking-[0.18em] text-slate-500">
            Technical details: automation history
          </summary>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Automation history</p>
              <h3 className="mt-1 text-xl font-black tracking-tight text-slate-900">Последние прогоны</h3>
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500">
              saved {automationHistory.length}
              {serverAutomationHistory.length ? ` · server ${serverAutomationHistory.length}` : ""}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {combinedAutomationHistory.length ? combinedAutomationHistory.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                {(() => {
                  const previous = combinedAutomationHistory.find((candidate) => candidate.captured_at < item.captured_at);
                  const insertedDelta = previous ? item.inserted - previous.inserted : 0;
                  const analyzedDelta = previous ? item.analyzed - previous.analyzed : 0;
                  const errorsDelta = previous ? item.errors - previous.errors : 0;
                  const insertedToken = formatDelta(insertedDelta);
                  const analyzedToken = formatDelta(analyzedDelta);
                  const errorsToken = formatDelta(errorsDelta, true);
                  const [insertedText, insertedTone] = insertedToken.split("|");
                  const [analyzedText, analyzedTone] = analyzedToken.split("|");
                  const [errorsText, errorsTone] = errorsToken.split("|");
                  return (
                    <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-slate-900">{item.title}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {new Date(item.captured_at).toLocaleString("ru-RU")} · niches {compactNumber(item.niches)}
                      {item.source ? ` · ${item.source}` : ""}
                    </div>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-bold ${item.ok ? statusTone("ready") : statusTone("weak")}`}>
                    {item.ok ? "ok" : "failed"}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">found {compactNumber(item.found)}</span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">inserted {compactNumber(item.inserted)}</span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">analyzed {compactNumber(item.analyzed)}</span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">relevant {compactNumber(item.relevant)}</span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">retries {compactNumber(item.retries)}</span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">errors {compactNumber(item.errors)}</span>
                  {item.best_provider ? (
                    <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 font-semibold text-cyan-700">
                      {providerLabel(item.best_provider)}
                    </span>
                  ) : null}
                </div>
                {previous ? (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className={`rounded-full border px-2.5 py-1 font-semibold ${insertedTone === "good" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                      inserted Δ {insertedText}
                    </span>
                    <span className={`rounded-full border px-2.5 py-1 font-semibold ${analyzedTone === "good" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                      analyzed Δ {analyzedText}
                    </span>
                    <span className={`rounded-full border px-2.5 py-1 font-semibold ${errorsTone === "good" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                      errors Δ {errorsText}
                    </span>
                  </div>
                ) : null}
                    </>
                  );
                })()}
              </div>
            )) : <EmptyState title="История пока пустая" text="Запусти daily, weekly или bulk ingest и сохрани snapshot." />}
          </div>
        </details>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
              <BrainCircuit className="h-4 w-4" />
              Reels Brain Health
            </div>
            <h2 className="mt-1 text-2xl font-black tracking-tight">Готовность мозга и drift сигналов</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PLATFORM_OPTIONS.map((platform) => (
              <button
                key={platform}
                type="button"
                onClick={() => setTargetPlatform(platform)}
                className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-bold transition ${
                  targetPlatform === platform
                    ? "border-cyan-300 bg-cyan-50 text-cyan-800"
                    : "border-slate-200 bg-white text-slate-600 hover:border-cyan-200"
                }`}
              >
                {titlePlatform(platform)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => loadSummary(activeNiche())}
              disabled={loadingSummary}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {loadingSummary ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Обновить health
            </button>
          </div>
        </div>

        {summaryError && <Alert tone="red" text={summaryError} />}

        {activePlatformSummary ? (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Status</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(activePlatformSummary.status)}`}>
                    {activePlatformSummary.status || "weak"}
                  </span>
                  <span className="font-mono text-sm font-black text-slate-900">
                    {compactNumber(activePlatformSummary.training_readiness.score)}%
                  </span>
                </div>
              </div>
              <MetricCard label="Videos" value={activePlatformSummary.videos || 0} />
              <MetricCard label="Analyzed" value={activePlatformSummary.analyzed || 0} />
              <MetricCard label="Patterns" value={activePlatformSummary.pattern_count || 0} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Platform lane</p>
                    <h3 className="mt-1 text-xl font-black tracking-tight text-slate-900">{titlePlatform(activePlatformSummary.platform)}</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => runMiniBakeOff(activePlatformSummary.platform, activePlatformSummary.recommended_queries)}
                      disabled={quickActionLoading === `bake-off:${activePlatformSummary.platform}`}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:border-cyan-300 disabled:opacity-50"
                    >
                      {quickActionLoading === `bake-off:${activePlatformSummary.platform}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
                      Mini bake-off
                    </button>
                    <button
                      type="button"
                      onClick={() => runSourceRefresh(activePlatformSummary.platform, activePlatformSummary.recommended_queries?.[0])}
                      disabled={quickActionLoading === `source:${activePlatformSummary.platform}`}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {quickActionLoading === `source:${activePlatformSummary.platform}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                      Source refresh
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {(activePlatformSummary.alerts || []).length ? (
                    (activePlatformSummary.alerts || []).map((alert) => (
                      <span key={alert} className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                        {alert}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                      alerts none
                    </span>
                  )}
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Preferred provider</p>
                    <p className="mt-2 text-sm font-black text-slate-900">
                      {providerLabel(activePlatformSummary.preferred_provider?.provider || "unknown")}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      stale {compactNumber(activePlatformSummary.provider_stale_days ?? 0)} d
                      {activePlatformSummary.provider_drift ? " · drift detected" : ""}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Readiness gaps</p>
                    <p className="mt-2 text-sm text-slate-700">
                      {activePlatformSummary.training_readiness.missing?.length
                        ? activePlatformSummary.training_readiness.missing.join(" · ")
                        : "brain is ready"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Policy + queries</p>
                <h3 className="mt-1 text-xl font-black tracking-tight text-slate-900">Что делать дальше</h3>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <MetricCard label="Min found" value={activePlatformSummary.relearn_policy.min_found} />
                  <MetricCard label="Min relevant" value={activePlatformSummary.relearn_policy.min_relevant} />
                  <MetricCard label="Min inserted" value={activePlatformSummary.relearn_policy.min_inserted} />
                  <MetricCard label="Stale days" value={activePlatformSummary.relearn_policy.stale_days} />
                </div>
                <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Recommended queries</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(activePlatformSummary.recommended_queries || []).map((query) => (
                      <button
                        key={query}
                        type="button"
                        onClick={() => setSourceQuery(query)}
                        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-cyan-300 hover:bg-cyan-50"
                      >
                        {query}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Recovery queue</p>
                      <h4 className="mt-1 text-sm font-black text-slate-900">Query, которые вышли из cooldown</h4>
                    </div>
                    <span className="rounded-full border border-emerald-200 bg-white px-2 py-1 text-xs font-bold text-emerald-700">
                      {compactNumber((activePlatformSummary.recovery_queries || []).length)}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(activePlatformSummary.recovery_queries || []).length ? (
                      (activePlatformSummary.recovery_queries || []).map((row) => (
                        <button
                          key={`${row.query}-${row.updated_at}-recovery`}
                          type="button"
                          onClick={() => setSourceQuery(row.query)}
                          className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-emerald-800 hover:border-cyan-300 hover:text-cyan-700"
                        >
                          {row.query}
                        </button>
                      ))
                    ) : (
                      <span className="text-xs text-slate-500">После окончания cooldown мозг покажет query здесь и мягко вернет их в ротацию.</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Provider history</p>
                <h3 className="mt-1 text-lg font-black tracking-tight text-slate-900">Смена champion</h3>
                <div className="mt-3 space-y-2">
                  {(activePlatformSummary.provider_history || []).length ? (activePlatformSummary.provider_history || []).map((row, index) => (
                    <div key={`${row.provider}-${row.updated_at}-${index}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-800">{providerLabel(row.provider)}</span>
                        <span className="text-xs text-slate-400">{row.source}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {row.updated_at ? new Date(row.updated_at).toLocaleString("ru-RU") : "unknown"} · avg {compactNumber(row.avg_score)}
                      </div>
                    </div>
                  )) : <EmptyState title="История пока пустая" text="Champion history появится после bake-off и source-run." />}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Quality gates</p>
                <h3 className="mt-1 text-lg font-black tracking-tight text-slate-900">Порог обученности</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <MetricCard label="Min videos" value={activePlatformSummary.quality_gates.min_videos} />
                  <MetricCard label="Min analyzed" value={activePlatformSummary.quality_gates.min_analyzed} />
                  <MetricCard label="Min patterns" value={activePlatformSummary.quality_gates.min_patterns} />
                  <MetricCard label="Min winners" value={activePlatformSummary.quality_gates.min_winners} />
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Query leaderboard</p>
                <h3 className="mt-1 text-lg font-black tracking-tight text-slate-900">Какие запросы реально тянут intake</h3>
                <div className="mt-3 space-y-2">
                  {(activePlatformSummary.query_leaderboard || []).length ? (activePlatformSummary.query_leaderboard || []).map((row) => (
                    <button
                      key={`${row.query}-${row.updated_at}`}
                      type="button"
                      onClick={() => setSourceQuery(row.query)}
                      className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm transition hover:border-cyan-300"
                    >
                      <div className="font-semibold text-slate-800">{row.query}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        score {compactNumber(row.score)} · runs {compactNumber(row.runs)} · inserted {compactNumber(row.inserted)}
                      </div>
                    </button>
                  )) : <EmptyState title="Лидерборд пустой" text="Он наполнится после нескольких source-run по этой платформе." />}
                </div>
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Suppressed queries</p>
                      <h4 className="mt-1 text-sm font-black text-slate-900">Временно отключенные query-ветки</h4>
                    </div>
                    <span className="rounded-full border border-amber-200 bg-white px-2 py-1 text-xs font-bold text-amber-700">
                      {compactNumber((activePlatformSummary.suppressed_queries || []).length)}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {(activePlatformSummary.suppressed_queries || []).length ? (
                      (activePlatformSummary.suppressed_queries || []).map((row) => (
                        <div
                          key={`${row.query}-${row.updated_at}-suppressed`}
                          className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => setSourceQuery(row.query)}
                              className="text-left font-semibold text-slate-800 transition hover:text-cyan-700"
                            >
                              {row.query}
                            </button>
                            <span className="text-[11px] font-medium text-amber-700">
                              until {row.suppressed_until ? new Date(row.suppressed_until).toLocaleString("ru-RU") : "manual reset"}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            score {compactNumber(row.score)} · runs {compactNumber(row.runs)} · found {compactNumber(row.found)} · relevant {compactNumber(row.relevant)} · inserted {compactNumber(row.inserted)}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            weak runs {compactNumber(row.low_yield_runs || 0)} · empty runs {compactNumber(row.empty_runs || 0)}
                          </div>
                        </div>
                      ))
                    ) : (
                      <EmptyState
                        title="Подавленных запросов нет"
                        text="Если запросы начнут давать пустой или слабый intake, мозг временно уберет их из ротации."
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Incident feed</p>
                <h3 className="mt-1 text-lg font-black tracking-tight text-slate-900">Что мозг считает проблемой</h3>
                <div className="mt-3 space-y-2">
                  {(brainSummary?.incidents || []).filter((row) => row.platform === activePlatformSummary.platform).slice(0, 6).length ? (
                    (brainSummary?.incidents || []).filter((row) => row.platform === activePlatformSummary.platform).slice(0, 6).map((row) => (
                      <div key={row.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`rounded-full border px-2 py-1 text-[11px] font-bold ${
                            row.severity === "critical"
                              ? "border-red-200 bg-red-50 text-red-700"
                              : row.severity === "watch"
                                ? "border-amber-200 bg-amber-50 text-amber-800"
                                : "border-slate-200 bg-slate-50 text-slate-600"
                          }`}>
                            {row.severity}
                          </span>
                          <span className="text-xs text-slate-400">{new Date(row.created_at).toLocaleString("ru-RU")}</span>
                        </div>
                        <div className="mt-2 font-semibold text-slate-800">{row.message}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.provider ? `${providerLabel(row.provider)} · ` : ""}{row.query || row.kind}
                        </div>
                      </div>
                    ))
                  ) : <EmptyState title="Инцидентов нет" text="По этой платформе сейчас нет свежих warnings/critical событий." />}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState title="Health summary пока пустой" text="Собери corpus и Pattern Memory, затем обнови health." />
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
                <Radar className="h-4 w-4" />
                Source Map
              </div>
              <h2 className="mt-1 text-2xl font-black tracking-tight">Провайдеры и ключи</h2>
            </div>
            <button
              type="button"
              onClick={reloadProviders}
              disabled={loadingProviders}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {loadingProviders ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Обновить
            </button>
          </div>

          {providerError && <Alert tone="red" text={providerError} />}
          {health?.trend_source && (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-slate-500">Legacy trend source</span>
                <span className="rounded-full bg-white px-2.5 py-1 font-mono text-xs text-slate-700">
                  {health.trend_source.selected || "none"}
                </span>
              </div>
            </div>
          )}

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {(health?.providers || []).map((item) => {
              const available = availableProviders.includes(item.provider);
              const checked = selectedProviders.includes(item.provider);
              return (
                <label
                  key={item.provider}
                  className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2 transition ${
                    item.configured
                      ? checked
                        ? "border-cyan-300 bg-cyan-50"
                        : "border-slate-200 bg-white hover:border-cyan-200"
                      : "border-slate-100 bg-slate-50 text-slate-400"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!available}
                    onChange={() => toggleProvider(item.provider)}
                    className="h-4 w-4 accent-cyan-600"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{providerLabel(item.provider)}</span>
                    <span className="text-xs">{item.configured ? "configured" : "env missing"}</span>
                  </span>
                  {item.configured ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <TriangleAlert className="h-4 w-4 text-slate-300" />}
                </label>
              );
            })}
          </div>

          <div className="mt-5">
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Env health</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(health?.env || {}).map(([key, value]) => (
                <span
                  key={key}
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                    value ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-400"
                  }`}
                >
                  {key}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
            <SlidersHorizontal className="h-4 w-4" />
            Bake-off runner
          </div>
          <h2 className="mt-1 text-2xl font-black tracking-tight">Сравнить выдачу</h2>
          <div className="mt-5 grid gap-4 lg:grid-cols-[180px_1fr]">
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Ниша</span>
              <input
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-400"
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Queries, по одному в строке</span>
              <textarea
                value={queriesText}
                onChange={(e) => setQueriesText(e.target.value)}
                rows={4}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-400"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Limit</span>
              <input
                type="number"
                min={1}
                max={50}
                value={limit}
                onChange={(e) => setLimit(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
                className="mt-1 min-h-11 w-24 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-400"
              />
            </label>
            <label className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${persist ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
              <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} className="h-4 w-4 accent-amber-500" />
              persist=true
            </label>
            <button
              type="button"
              onClick={runBakeOff}
              disabled={running || !queries.length || !selectedProviders.length}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {persist ? "Запустить и сохранить" : "Запустить report-only"}
            </button>
          </div>

          <div className="mt-4 rounded-2xl border border-cyan-100 bg-cyan-50 p-4 text-sm text-cyan-950">
            <div className="flex gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                По умолчанию это безопасный dry-run. Запись в `viral_videos` включается только чекбоксом `persist=true`.
              </p>
            </div>
          </div>
          {runError && <Alert tone="red" text={runError} />}
          {bakeOff?.warning && <Alert tone="amber" text={bakeOff.warning} />}
        </section>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
              <Database className="h-4 w-4" />
              Corpus intake
            </div>
            <h2 className="mt-1 text-2xl font-black tracking-tight">Сбор и seed в viral corpus</h2>
          </div>
          <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
            source-run пишет из активного scraper source, manual seed добавляет руками
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Scraper</p>
                <h3 className="mt-1 text-xl font-black tracking-tight text-slate-900">Source-run</h3>
              </div>
              {sourceRunResult?.provider && (
                <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-700">
                  {providerLabel(sourceRunResult.provider)}
                </span>
              )}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_112px]">
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Query</span>
                <input
                  value={sourceQuery}
                  onChange={(e) => setSourceQuery(e.target.value)}
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-400"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Limit</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={sourceLimit}
                  onChange={(e) => setSourceLimit(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-400"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={runSource}
              disabled={sourceRunning}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {sourceRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Запустить source-run
            </button>

            {sourceRunError && <Alert tone="red" text={sourceRunError} />}
            {sourceRunResult && (
              <div className="mt-4 space-y-3">
                <div className="grid gap-2 sm:grid-cols-4">
                  <MetricCard label="Found" value={sourceRunResult.found || 0} />
                  <MetricCard label="Relevant" value={sourceRunResult.relevant || 0} />
                  <MetricCard label="Normalized" value={sourceRunResult.normalized || 0} />
                  <MetricCard label="Inserted" value={sourceRunResult.inserted || 0} />
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Provider memory</p>
                    <p className="mt-2 font-semibold text-slate-800">
                      remembered {providerLabel(sourceRunResult.remembered_provider || "unknown")}
                    </p>
                    <p className="mt-1 text-slate-600">
                      learned {providerLabel(sourceRunResult.learned_provider || "unknown")}
                      {sourceRunResult.source_memory_updated ? " · memory updated" : ""}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Recommended next queries</p>
                    <p className="mt-2 text-slate-700">
                      {(sourceRunResult.recommended_queries || []).slice(0, 3).join(" · ") || "—"}
                    </p>
                  </div>
                </div>
                {(sourceRunResult.sample || []).length > 0 && (
                  <div className="grid gap-2">
                    {(sourceRunResult.sample || []).slice(0, 3).map((item) => (
                      <a
                        key={item.url}
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-cyan-300"
                      >
                        <div className="line-clamp-1 font-semibold">{item.url}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
                          <span>views {compactNumber(item.views)}</span>
                          <span>score {compactNumber(item.score)}</span>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Manual intake</p>
              <h3 className="mt-1 text-xl font-black tracking-tight text-slate-900">Manual seed</h3>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.4fr]">
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Source query</span>
                <input
                  value={manualSeedQuery}
                  onChange={(e) => setManualSeedQuery(e.target.value)}
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-400"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">URLs или JSON, по одному в строке</span>
                <textarea
                  value={manualSeedText}
                  onChange={(e) => setManualSeedText(e.target.value)}
                  rows={5}
                  placeholder={"https://www.tiktok.com/@brand/video/123\n{\"url\":\"https://www.youtube.com/shorts/abc\",\"caption\":\"hook text\"}"}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-400"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={submitManualSeed}
              disabled={manualSeeding}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-sm hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {manualSeeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
              Добавить в corpus
            </button>

            {manualSeedError && <Alert tone="red" text={manualSeedError} />}
            {manualSeedResult?.warning && <Alert tone="amber" text={manualSeedResult.warning} />}
            {manualSeedResult && (
              <div className="mt-4 space-y-3">
                <div className="grid gap-2 sm:grid-cols-4">
                  <MetricCard label="Received" value={manualSeedResult.received || 0} />
                  <MetricCard label="Normalized" value={manualSeedResult.normalized || 0} />
                  <MetricCard label="Inserted" value={manualSeedResult.inserted || 0} />
                  <MetricCard label="Rejected" value={manualSeedResult.rejected || 0} />
                </div>
                {(manualSeedResult.sample || []).length > 0 && (
                  <div className="grid gap-2">
                    {(manualSeedResult.sample || []).slice(0, 3).map((item) => (
                      <a
                        key={item.url}
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-cyan-300"
                      >
                        <div className="line-clamp-1 font-semibold">{item.url}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
                          <span>{item.platform || "unknown"}</span>
                          <span>score {compactNumber(item.score)}</span>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
              <BrainCircuit className="h-4 w-4" />
              Learning cycle
            </div>
            <h2 className="mt-1 text-2xl font-black tracking-tight">Разбор, паттерны и self-learning loop</h2>
          </div>
          <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
            analyze enriches corpus, patterns/build compresses memory, loop stitches it together
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Reels intelligence agent</p>
            <h3 className="mt-1 text-xl font-black tracking-tight text-slate-900">Analyze</h3>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Limit</span>
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={analyzeLimit}
                  onChange={(e) => setAnalyzeLimit(Math.min(25, Math.max(1, Number(e.target.value) || 1)))}
                  className="mt-1 min-h-11 w-24 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-400"
                />
              </label>
              <label className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${analyzeDryRun ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-600"}`}>
                <input type="checkbox" checked={analyzeDryRun} onChange={(e) => setAnalyzeDryRun(e.target.checked)} className="h-4 w-4 accent-amber-500" />
                dry-run
              </label>
            </div>

            <button
              type="button"
              onClick={runAnalyze}
              disabled={analyzing}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {analyzeDryRun ? "Проверить analyze" : "Запустить analyze"}
            </button>

            {analyzeError && <Alert tone="red" text={analyzeError} />}
            {analyzeResult && (
              <div className="mt-4 space-y-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <MetricCard label="Selected" value={analyzeResult.selected || 0} />
                  <MetricCard label="Analyzed" value={analyzeResult.analyzed || 0} />
                  <MetricCard label="Failed" value={analyzeResult.failed || 0} />
                </div>
                {(analyzeResult.results || []).slice(0, 4).map((item) => (
                  <a
                    key={item.id}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm transition hover:border-cyan-300"
                  >
                    <div className="line-clamp-1 font-semibold text-slate-800">{item.hook || item.url}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
                      <span>{item.ok ? "ok" : "error"}</span>
                      {item.format && <span>{item.format}</span>}
                      {item.error && <span>{item.error}</span>}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Pattern memory</p>
            <h3 className="mt-1 text-xl font-black tracking-tight text-slate-900">Patterns build</h3>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Limit</span>
                <input
                  type="number"
                  min={10}
                  max={3000}
                  value={patternLimit}
                  onChange={(e) => setPatternLimit(Math.min(3000, Math.max(10, Number(e.target.value) || 10)))}
                  className="mt-1 min-h-11 w-28 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-400"
                />
              </label>
              <label className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${patternPersist ? "border-cyan-300 bg-cyan-50 text-cyan-800" : "border-slate-200 bg-white text-slate-600"}`}>
                <input type="checkbox" checked={patternPersist} onChange={(e) => setPatternPersist(e.target.checked)} className="h-4 w-4 accent-cyan-600" />
                persist
              </label>
            </div>

            <button
              type="button"
              onClick={buildPatterns}
              disabled={buildingPatterns}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-sm hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {buildingPatterns ? <Loader2 className="h-4 w-4 animate-spin" /> : <BrainCircuit className="h-4 w-4" />}
              Собрать memory
            </button>

            {patternError && <Alert tone="red" text={patternError} />}
            {patternResult?.warning && <Alert tone="amber" text={patternResult.warning} />}
            {patternResult && (
              <div className="mt-4 space-y-3">
                <div className="grid gap-2 sm:grid-cols-4">
                  <MetricCard label="Videos" value={patternResult.memory?.total_videos || patternResult.source_videos || 0} />
                  <MetricCard label="Analyzed" value={patternResult.memory?.analyzed_videos || 0} />
                  <MetricCard label="Patterns" value={patternResult.memory?.patterns?.length || 0} />
                  <MetricCard label="Ready" value={patternResult.memory?.generator_ready_patterns?.length || patternResult.memory?.quality_summary?.generator_ready || 0} />
                </div>
                {(patternResult.memory?.generator_ready_patterns?.length ? patternResult.memory.generator_ready_patterns : patternResult.memory?.patterns || []).slice(0, 4).map((pattern) => (
                  <div key={pattern.pattern_id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800">{`${patternHookLabel(pattern)} -> ${patternStructureLabel(pattern)}`}</span>
                      <div className="flex flex-wrap items-center gap-2">
                        {pattern.quality_label && (
                          <span className={`rounded-full border px-2 py-1 text-xs font-bold ${
                            pattern.quality_label === "generator_ready" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : pattern.quality_label === "noise" ? "border-rose-200 bg-rose-50 text-rose-700"
                                : "border-amber-200 bg-amber-50 text-amber-700"
                          }`}>
                            {pattern.quality_label.replace(/_/g, " ")}
                          </span>
                        )}
                        <span className={`rounded-full border px-2 py-1 font-mono text-xs ${scoreTone(pattern.strength_score)}`}>
                          {compactNumber(pattern.strength_score)}
                        </span>
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      частота {compactNumber(pattern.frequency)} · {patternRetentionLabel(pattern)}
                      {typeof pattern.quality_score === "number" ? ` · quality ${compactNumber(pattern.quality_score)}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Self-learning orchestrator</p>
            <h3 className="mt-1 text-xl font-black tracking-tight text-slate-900">Loop</h3>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Source limit</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={loopSourceLimit}
                  onChange={(e) => setLoopSourceLimit(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-400"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Analyze limit</span>
                <input
                  type="number"
                  min={0}
                  max={25}
                  value={loopAnalyzeLimit}
                  onChange={(e) => setLoopAnalyzeLimit(Math.min(25, Math.max(0, Number(e.target.value) || 0)))}
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-400"
                />
              </label>
            </div>
            <label className={`mt-3 flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${loopPersistPatterns ? "border-cyan-300 bg-cyan-50 text-cyan-800" : "border-slate-200 bg-white text-slate-600"}`}>
              <input type="checkbox" checked={loopPersistPatterns} onChange={(e) => setLoopPersistPatterns(e.target.checked)} className="h-4 w-4 accent-cyan-600" />
              persist patterns
            </label>

            <button
              type="button"
              onClick={runLoop}
              disabled={loopRunning || !queries.length}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {loopRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Запустить loop
            </button>

            {loopError && <Alert tone="red" text={loopError} />}
            {loopResult && (
              <div className="mt-4 space-y-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <MetricCard label="Queries" value={loopResult.queries?.length || 0} />
                  <MetricCard label="Analyze ok" value={loopResult.analyze?.analyzed || 0} />
                  <MetricCard label="Patterns" value={loopResult.patterns?.memory?.patterns?.length || 0} />
                </div>
                {(loopResult.log || []).length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Log</p>
                    <div className="mt-2 space-y-1 font-mono text-xs text-slate-600">
                      {(loopResult.log || []).map((line) => (
                        <div key={line}>{line}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
              <Activity className="h-4 w-4" />
              Provider scorecard
            </div>
            <h2 className="mt-1 text-2xl font-black tracking-tight">Результаты bake-off</h2>
          </div>
          {bakeOff && (
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
              {bakeOff.persist ? `saved ${bakeOff.persisted || 0}` : "report-only"} · {bakeOff.queries?.length || 0} queries
            </div>
          )}
        </div>

        {bakeOffSummary.length ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Provider</th>
                    <th className="px-4 py-3">Found</th>
                    <th className="px-4 py-3">Valid</th>
                    <th className="px-4 py-3">Relevant</th>
                    <th className="px-4 py-3">Avg score</th>
                    <th className="px-4 py-3">Latency</th>
                    <th className="px-4 py-3">Cost</th>
                    <th className="px-4 py-3">Signals</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bakeOffSummary.map((row) => (
                    <tr key={row.provider} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-bold text-slate-800">{providerLabel(row.provider)}</td>
                      <td className="px-4 py-3 font-mono text-slate-700">{compactNumber(row.found)}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-slate-100 px-2 py-1 font-mono text-xs">{compactNumber(row.valid)} · {percent(row.valid_rate)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-cyan-50 px-2 py-1 font-mono text-xs text-cyan-700">{compactNumber(row.relevant)} · {percent(row.relevance_rate)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2 py-1 font-mono text-xs ${scoreTone(row.avg_score)}`}>{compactNumber(row.avg_score)}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {formatMs(row.avg_elapsed_ms)}
                        {(row.timeout_runs || row.failed_runs) ? ` · t${compactNumber(row.timeout_runs)} f${compactNumber(row.failed_runs)}` : ""}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2 py-1 text-xs font-bold ${
                          row.cost_tier === "low"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : row.cost_tier === "medium"
                              ? "border-amber-200 bg-amber-50 text-amber-800"
                              : "border-rose-200 bg-rose-50 text-rose-700"
                        }`}>
                          {row.cost_tier || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        followers {compactNumber(row.with_followers)} · sound {compactNumber(row.with_sound)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState title="Пока нет bake-off" text="Выбери провайдеры, queries и запусти report-only сравнение." />
        )}

        {topRuns.length > 0 && (
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {topRuns.map((item) => (
              <a
                key={`${item.provider}-${item.url}`}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="group rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-cyan-300 hover:bg-cyan-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{providerLabel(item.provider)} · {item.platform}</p>
                    <p className="mt-1 line-clamp-2 text-sm font-semibold text-slate-800">{item.caption || item.query}</p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-slate-400 group-hover:text-cyan-600" />
                </div>
                <div className="mt-3 flex gap-2 text-xs">
                  <span className={`rounded-full border px-2 py-1 font-mono ${scoreTone(item.score)}`}>score {compactNumber(item.score)}</span>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 font-mono text-slate-500">views {compactNumber(item.views)}</span>
                </div>
              </a>
            ))}
          </div>
        )}

        {(bakeOff?.runs || []).length > 0 && (
          <div className="mt-5 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {(bakeOff?.runs || []).map((run) => (
              <div key={`${run.provider}-${run.query}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{providerLabel(run.provider)}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{run.query}</p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-500">
                    {formatMs(run.elapsed_ms)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-500">found {compactNumber(run.quality?.found)}</span>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-500">relevant {compactNumber(run.quality?.relevant)}</span>
                  <span className={`rounded-full border px-2 py-1 font-mono ${scoreTone(run.quality?.avgScore)}`}>avg {compactNumber(run.quality?.avgScore)}</span>
                </div>
                {run.error && (
                  <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    {run.error}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
              <Database className="h-4 w-4" />
              Corpus monitor
            </div>
            <h2 className="mt-1 text-2xl font-black tracking-tight">Что лежит в viral corpus</h2>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Min score</span>
              <input
                value={minScore}
                onChange={(e) => setMinScore(e.target.value)}
                className="mt-1 min-h-11 w-28 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-400"
              />
            </label>
            <button
              type="button"
              onClick={() => loadCorpus()}
              disabled={loadingCorpus}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {loadingCorpus ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Обновить корпус
            </button>
          </div>
        </div>

        {corpusError && <Alert tone="red" text={corpusError} />}
        {corpus?.warning && <Alert tone="amber" text={corpus.warning} />}

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <MetricCard label="Всего в выборке" value={corpus?.total || 0} />
          <MetricCard label="Средний score" value={corpus?.summary?.avg_score || 0} />
          <MetricCard label="Analyzed" value={corpus?.summary?.analyzed || 0} />
          <MetricCard label="Unanalyzed" value={corpus?.summary?.unanalyzed || 0} />
        </div>

        {Object.keys(corpus?.summary?.by_platform || {}).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(corpus?.summary?.by_platform || {}).map(([platform, count]) => (
              <span key={platform} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                {platform}: {count}
              </span>
            ))}
          </div>
        )}

        {corpusVideos.length ? (
          <div className="mt-4 grid gap-3">
            {corpusVideos.slice(0, 24).map((video) => (
              <a
                key={video.id}
                href={video.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-2xl border border-slate-200 p-4 transition hover:border-cyan-300 hover:bg-slate-50"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-950 px-2 py-1 text-xs font-bold text-white">{video.platform || "unknown"}</span>
                      <span className={`rounded-full border px-2 py-1 font-mono text-xs ${scoreTone(video.score)}`}>score {compactNumber(video.score)}</span>
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-500">
                        {video.analyzed ? "analyzed" : "raw"}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm font-semibold text-slate-800">{video.hook || video.caption || video.url}</p>
                    {video.sound && <p className="mt-1 text-xs text-slate-400">sound: {video.sound}</p>}
                  </div>
                  <div className="grid shrink-0 grid-cols-3 gap-2 text-right text-xs text-slate-500 md:w-64">
                    <MiniStat label="views" value={video.views} />
                    <MiniStat label="likes" value={video.likes} />
                    <MiniStat label="followers" value={video.followers} />
                  </div>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <EmptyState title="Корпус пустой для этой ниши" text="Запусти bake-off с persist=true или добавь manual seed через API." />
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white/10 px-3 py-2 text-center">
      <div className="font-mono text-2xl font-black">{compactNumber(value)}</div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-300">{label}</div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 font-mono text-2xl font-black text-slate-900">{compactNumber(value)}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl bg-slate-50 px-2 py-1">
      <div className="font-mono font-bold text-slate-800">{compactNumber(value)}</div>
      <div className="uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

function Alert({ tone, text }: { tone: "red" | "amber"; text: string }) {
  const classes = tone === "red"
    ? "border-red-200 bg-red-50 text-red-700"
    : "border-amber-200 bg-amber-50 text-amber-800";
  return (
    <div className={`mt-4 rounded-2xl border p-3 text-sm font-medium ${classes}`}>
      {text}
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center">
      <p className="font-bold text-slate-700">{title}</p>
      <p className="mt-1 text-sm text-slate-400">{text}</p>
    </div>
  );
}
