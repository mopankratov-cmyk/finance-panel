export type ReelsBrainMetricRow = {
  recipe_id?: number | null;
  platform?: string | null;
  views?: number | null;
  watch_rate?: number | null;
  hook_rate?: number | null;
  hold_rate?: number | null;
  completion_rate?: number | null;
  ctr_card?: number | null;
  saves?: number | null;
  marketplace_orders?: number | null;
  revenue?: number | null;
  posted_at?: string | null;
  pulled_at?: string | null;
  publication_id?: string | null;
  external_post_id?: string | null;
  source?: string | null;
  niche?: string | null;
  article?: string | null;
  target_platform?: string | null;
  segment_label?: string | null;
};

type PatternLike = {
  id?: string;
  title?: string;
  hook?: string;
  format?: string;
  retention?: string;
  op_score?: number;
  quality_gate?: string;
  niches?: string[];
  creative_brief?: {
    product_fit?: string[];
    visual_recipe?: string[];
    second_by_second?: string[];
  };
};

type InsightLike = {
  top_hooks?: Array<{ hook_label?: string; hook_type?: string; op_score?: number; confidence?: string; segment?: string }>;
  winning_formats?: Array<{ label?: string; avg_score?: number; frequency?: number; niches?: string[] }>;
  retention_mechanics?: Array<{ label?: string; avg_score?: number; frequency?: number; hooks?: string[] }>;
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function avg(rows: number[]): number | null {
  const clean = rows.filter((row) => Number.isFinite(row) && row > 0);
  return clean.length ? Math.round((clean.reduce((sum, row) => sum + row, 0) / clean.length) * 1000) / 1000 : null;
}

function normalizePlatform(value: unknown): string {
  const raw = String(value || "").trim().toLowerCase();
  if (raw.includes("inst") || raw.includes("reels")) return "instagram";
  if (raw.includes("you") || raw.includes("short")) return "youtube";
  if (raw.includes("tik")) return "tiktok";
  return raw || "unknown";
}

function productTypeFromText(value: string): string {
  const text = value.toLowerCase();
  if (/toy|игр|реб|дет|подар/.test(text)) return "детские товары / игрушки";
  if (/cloth|одеж|плать|куртк|размер|посадк|ткан/.test(text)) return "одежда / образ";
  if (/cosm|крем|кожа|макияж|уход|beauty/.test(text)) return "косметика / уход";
  if (/еда|кух|рецепт|food/.test(text)) return "еда / кухня";
  return "универсальный товар";
}

function audienceFromText(value: string): string {
  const text = value.toLowerCase();
  if (/мам|дет|реб|подар/.test(text)) return "мамы / подарки детям";
  if (/лайфхак|эконом|быстр|ошиб/.test(text)) return "импульсные покупатели";
  if (/обзор|тест|сравн|провер/.test(text)) return "рациональные сравнивающие";
  if (/крас|уход|образ|стиль/.test(text)) return "визуально-эстетическая аудитория";
  return "широкая аудитория";
}

function segmentStatus(input: {
  posts: number;
  winners: number;
  losers: number;
  orders: number;
  revenue: number;
  avgCompletion: number | null;
  avgCtr: number | null;
}) {
  if (input.posts === 0) return "no_feedback" as const;
  const score = (input.winners * 18)
    + Math.min(20, (input.avgCompletion || 0) * 40)
    + Math.min(16, (input.avgCtr || 0) * 400)
    + Math.min(18, input.orders * 4)
    + Math.min(12, input.revenue > 0 ? Math.log10(Math.max(1, input.revenue + 1)) * 8 : 0)
    - (input.losers * 12);
  if (score >= 65) return "proven" as const;
  if (score >= 34) return "promising" as const;
  return "weak" as const;
}

export function buildReelsBrainFeedbackLoop(metrics: ReelsBrainMetricRow[]) {
  const rows = metrics.map((row) => ({
    ...row,
    platform: normalizePlatform(row.target_platform || row.platform),
    views: num(row.views),
    watch_rate: num(row.watch_rate),
    hook_rate: num(row.hook_rate),
    hold_rate: num(row.hold_rate),
    completion_rate: num(row.completion_rate),
    ctr_card: num(row.ctr_card),
    saves: num(row.saves),
    marketplace_orders: num(row.marketplace_orders),
    revenue: num(row.revenue),
    niche: typeof row.niche === "string" ? row.niche.trim() : "",
    segment_label: typeof row.segment_label === "string" ? row.segment_label.trim() : "",
  }));
  const winners = rows.filter((row) =>
    row.views >= 10000
    || row.marketplace_orders > 0
    || row.revenue > 0
    || row.saves >= 50
    || row.completion_rate >= 0.45
  );
  const losers = rows.filter((row) =>
    row.views > 0
    && row.views < 1000
    && (!row.completion_rate || row.completion_rate < 0.2)
    && (!row.ctr_card || row.ctr_card < 0.01)
  );
  const byPlatform = Array.from(rows.reduce((map, row) => {
    const current = map.get(row.platform) || { platform: row.platform, posts: 0, views: 0, orders: 0, revenue: 0 };
    current.posts += 1;
    current.views += row.views;
    current.orders += row.marketplace_orders;
    current.revenue += row.revenue;
    map.set(row.platform, current);
    return map;
  }, new Map<string, { platform: string; posts: number; views: number; orders: number; revenue: number }>()).values())
    .sort((a, b) => b.views - a.views);

  const bySegment = Array.from(rows.reduce((map, row) => {
    const segmentLabel = row.segment_label || (row.niche && row.platform !== "unknown" ? `${row.niche} × ${row.platform}` : "");
    if (!segmentLabel) return map;
    const current = map.get(segmentLabel) || {
      segment: segmentLabel,
      niche: row.niche || "",
      platform: row.platform,
      posts: 0,
      views: 0,
      winners: 0,
      losers: 0,
      orders: 0,
      revenue: 0,
      completion: [] as number[],
      ctr: [] as number[],
    };
    current.posts += 1;
    current.views += row.views;
    current.orders += row.marketplace_orders;
    current.revenue += row.revenue;
    if (winners.includes(row)) current.winners += 1;
    if (losers.includes(row)) current.losers += 1;
    if (row.completion_rate > 0) current.completion.push(row.completion_rate);
    if (row.ctr_card > 0) current.ctr.push(row.ctr_card);
    map.set(segmentLabel, current);
    return map;
  }, new Map<string, {
    segment: string;
    niche: string;
    platform: string;
    posts: number;
    views: number;
    winners: number;
    losers: number;
    orders: number;
    revenue: number;
    completion: number[];
    ctr: number[];
  }>()).values()).map((row) => {
    const avgCompletion = avg(row.completion);
    const avgCtr = avg(row.ctr);
    const status = segmentStatus({
      posts: row.posts,
      winners: row.winners,
      losers: row.losers,
      orders: row.orders,
      revenue: row.revenue,
      avgCompletion,
      avgCtr,
    });
    return {
      segment: row.segment,
      niche: row.niche,
      platform: row.platform,
      posts: row.posts,
      views: row.views,
      winners: row.winners,
      losers: row.losers,
      orders: row.orders,
      revenue: Math.round(row.revenue * 100) / 100,
      avg_completion_rate: avgCompletion,
      avg_ctr: avgCtr,
      status,
      trust_action: status === "proven"
        ? "promote_segment_trust"
        : status === "promising"
          ? "keep_validating_segment"
          : status === "weak"
            ? "review_or_penalize_segment"
            : "wait_for_feedback",
    };
  }).sort((a, b) =>
    b.winners - a.winners
    || b.orders - a.orders
    || b.views - a.views
    || a.segment.localeCompare(b.segment),
  );

  const trustUpdateQueue = bySegment
    .filter((row) => row.status !== "no_feedback")
    .slice(0, 8)
    .map((row) => ({
      segment: row.segment,
      niche: row.niche,
      platform: row.platform,
      status: row.status,
      trust_action: row.trust_action,
      evidence: `${row.winners} winners / ${row.posts} posts · orders ${row.orders} · revenue ${row.revenue}`,
    }));

  return {
    status: rows.length ? "live" : "ready_for_metrics",
    total_posts: rows.length,
    winners: winners.length,
    losers: losers.length,
    avg_views: avg(rows.map((row) => row.views)),
    avg_completion_rate: avg(rows.map((row) => row.completion_rate)),
    avg_ctr: avg(rows.map((row) => row.ctr_card)),
    total_orders: rows.reduce((sum, row) => sum + row.marketplace_orders, 0),
    total_revenue: Math.round(rows.reduce((sum, row) => sum + row.revenue, 0) * 100) / 100,
    by_platform: byPlatform,
    by_segment: bySegment,
    segment_outcome_memory: {
      ready: bySegment.length > 0,
      strongest_segments: bySegment.filter((row) => row.status === "proven").slice(0, 5),
      promising_segments: bySegment.filter((row) => row.status === "promising").slice(0, 5),
      weak_segments: bySegment.filter((row) => row.status === "weak").slice(0, 5),
      trust_update_queue: trustUpdateQueue,
    },
    outcome_schema: {
      schema_ready: true,
      required_fields: ["recipe_id", "platform", "views", "posted_at"],
      recommended_fields: ["hook_rate", "hold_rate", "completion_rate", "ctr_card", "saves", "marketplace_orders", "revenue", "publication_id", "external_post_id"],
      write_targets: ["post_metrics", "factory_publications", "reels_brain_feedback"],
      ingestion_endpoints: ["/api/factory/post-metrics", "/api/factory/reels-brain/feedback"],
    },
    next_step: rows.length
      ? "Писать winner/loser outcomes обратно в segment trust и Pattern Brain после каждого опубликованного ролика."
      : "Начать отправлять метрики через /api/factory/reels-brain/feedback или /api/factory/post-metrics.",
  };
}

export function buildReelsBrainAudioVisualSeed(patterns: PatternLike[], insights: InsightLike) {
  const visualRecipes = patterns.flatMap((pattern) => pattern.creative_brief?.visual_recipe || []);
  const firstFrames = visualRecipes.filter((row) => /крупн|перв|упаков|товар|лиц|рук|до\/после/i.test(row)).slice(0, 8);
  const retention = (insights.retention_mechanics || []).slice(0, 5).map((row) => row.label || "удержание");
  return {
    status: patterns.length ? "rule_based_live" : "spec_ready",
    extracted_now: ["visual_recipe", "second_by_second", "retention_label", "format_label"],
    next_extractors: ["speech_speed", "first_sound_event", "beat_map", "drop_timing", "cut_density", "first_frame_type"],
    first_frame_hypotheses: firstFrames.length ? firstFrames : ["крупный proof-кадр товара", "лицо/руки в первые 0.5с", "до/после без длинного вступления"],
    pacing_rules: [
      "voice starts immediately, no dead intro",
      "cuts every 0.4-0.8 sec for demo/UGC",
      "proof frame must appear before the first third of the reel",
    ],
    retention_inputs: retention,
  };
}

export function buildReelsBrainProductBrain(patterns: PatternLike[]) {
  const byType = new Map<string, { product_type: string; patterns: number; best_hooks: string[]; visual_proof: string[] }>();
  for (const pattern of patterns) {
    const text = [
      pattern.title,
      pattern.hook,
      pattern.format,
      ...(pattern.creative_brief?.product_fit || []),
      ...(pattern.niches || []),
    ].filter(Boolean).join(" ");
    const productType = productTypeFromText(text);
    const current = byType.get(productType) || { product_type: productType, patterns: 0, best_hooks: [], visual_proof: [] };
    current.patterns += 1;
    if (pattern.hook && current.best_hooks.length < 4) current.best_hooks.push(pattern.hook);
    for (const row of pattern.creative_brief?.visual_recipe || []) {
      if (current.visual_proof.length < 4) current.visual_proof.push(row);
    }
    byType.set(productType, current);
  }
  return {
    status: byType.size ? "seeded" : "needs_patterns",
    product_types: Array.from(byType.values()).sort((a, b) => b.patterns - a.patterns),
    routing_rule: "тип товара выбирает hook/form/visual proof до генерации сценария, а не после",
  };
}

export function buildReelsBrainAudienceBrain(patterns: PatternLike[]) {
  const byAudience = new Map<string, { audience: string; patterns: number; emotions: string[]; content_style: string }>();
  for (const pattern of patterns) {
    const text = [pattern.title, pattern.hook, pattern.format, pattern.retention, ...(pattern.niches || [])].filter(Boolean).join(" ");
    const audience = audienceFromText(text);
    const current = byAudience.get(audience) || {
      audience,
      patterns: 0,
      emotions: [],
      content_style: audience.includes("рациональные") ? "тест, сравнение, доказательство" : audience.includes("мамы") ? "забота, польза, подарок" : "быстрый visual proof",
    };
    current.patterns += 1;
    if (pattern.retention && current.emotions.length < 4) current.emotions.push(pattern.retention);
    byAudience.set(audience, current);
  }
  return {
    status: byAudience.size ? "seeded" : "rule_based_seed",
    segments: Array.from(byAudience.values()).sort((a, b) => b.patterns - a.patterns),
    next_step: "После feedback loop привязать аудиторию к фактическим saves/orders/retention.",
  };
}

export function buildReelsBrainExperimentMatrix(patterns: PatternLike[], insights: InsightLike) {
  const hooks = (insights.top_hooks || []).slice(0, 4);
  const formats = (insights.winning_formats || []).slice(0, 3);
  const retention = (insights.retention_mechanics || []).slice(0, 3);
  const variants = hooks.flatMap((hook, hookIndex) =>
    formats.slice(0, 2).map((format, formatIndex) => ({
      id: `exp_${hookIndex + 1}_${formatIndex + 1}`,
      variable: hookIndex === 0 ? "proof_frame" : "hook",
      hook: hook.hook_label || hook.hook_type || "hook",
      format: format.label || "demo",
      retention: retention[formatIndex % Math.max(1, retention.length)]?.label || "open loop",
      success_metric: hookIndex === 0 ? "completion_rate + saves" : "hook_rate + first_3s_hold",
    })),
  );
  return {
    status: variants.length ? "ready_to_plan" : "needs_hooks",
    principle: "меняем один axis за раз: hook, proof frame, CTA, pacing или first frame",
    variants: variants.length ? variants.slice(0, 8) : patterns.slice(0, 3).map((pattern, index) => ({
      id: `pattern_${index + 1}`,
      variable: "hook",
      hook: pattern.hook || pattern.title || "pattern hook",
      format: pattern.format || "demo",
      retention: pattern.retention || "open loop",
      success_metric: "hook_rate + completion_rate",
    })),
  };
}

export function buildReelsBrainPortfolioManager(feedback: ReturnType<typeof buildReelsBrainFeedbackLoop>, patterns: PatternLike[]) {
  const hasSalesSignal = feedback.total_orders > 0 || feedback.total_revenue > 0;
  const hasEnoughPatterns = patterns.length >= 8;
  return {
    status: hasEnoughPatterns ? "ready_for_weekly_mix" : "planned",
    weekly_mix: hasSalesSignal
      ? ["3 продажи", "1 proof/test", "1 UGC", "1 meme/native", "1 expert"]
      : ["2 продажи", "1 proof/test", "1 UGC", "1 meme/native", "2 discovery experiments"],
    guardrail: "портфель не должен состоять только из продажных роликов: мозг держит mix, чтобы не выжечь аудиторию",
    learning_input: feedback.status,
  };
}

export function buildReelsBrainOperatingSystem(input: {
  patterns: PatternLike[];
  insights: InsightLike;
  feedbackRows: ReelsBrainMetricRow[];
}) {
  const feedback = buildReelsBrainFeedbackLoop(input.feedbackRows);
  const audioVisual = buildReelsBrainAudioVisualSeed(input.patterns, input.insights);
  const product = buildReelsBrainProductBrain(input.patterns);
  const audience = buildReelsBrainAudienceBrain(input.patterns);
  const experiment = buildReelsBrainExperimentMatrix(input.patterns, input.insights);
  const portfolio = buildReelsBrainPortfolioManager(feedback, input.patterns);
  return {
    feedback_loop: feedback,
    audio_visual_intelligence: audioVisual,
    product_brain: product,
    audience_brain: audience,
    experiment_brain: experiment,
    portfolio_manager: portfolio,
  };
}
