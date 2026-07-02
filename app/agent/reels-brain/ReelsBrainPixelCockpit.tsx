"use client";

import { useEffect, useMemo, useState } from "react";

type JsonRecord = Record<string, any>;

const NICHES = ["ru_toys", "ru_clothing", "ru_cosmetics"];
const NICHE_LABELS: Record<string, string> = {
  ru_toys: "Игрушки",
  ru_clothing: "Одежда",
  ru_cosmetics: "Косметика",
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compact(value: unknown): string {
  const parsed = num(value);
  return new Intl.NumberFormat("ru-RU", { notation: parsed >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(parsed);
}

function usd(value: unknown): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "$0";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: parsed < 1 ? 3 : 2 }).format(parsed);
}

function firstPositive(...values: unknown[]): number {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

async function getJson(path: string): Promise<JsonRecord> {
  const response = await fetch(path, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || data?.warning || response.statusText);
  return data;
}

function statusTone(score: number) {
  if (score >= 72) return { label: "high", bg: "#dcfce7", bd: "#86efac", fg: "#166534", dot: "#22c55e" };
  if (score >= 42) return { label: "medium", bg: "#fef3c7", bd: "#facc15", fg: "#854d0e", dot: "#f59e0b" };
  return { label: "low", bg: "#fee2e2", bd: "#fca5a5", fg: "#991b1b", dot: "#ef4444" };
}

function levelCell(value: number) {
  if (value >= 70) return { label: "strong", bg: "#dcfce7", bd: "#86efac", fg: "#166534" };
  if (value >= 35) return { label: "watch", bg: "#fef3c7", bd: "#fde68a", fg: "#92400e" };
  if (value > 0) return { label: "weak", bg: "#fee2e2", bd: "#fecaca", fg: "#991b1b" };
  return { label: "empty", bg: "#f8fafc", bd: "#e2e8f0", fg: "#94a3b8" };
}

function vmCostLabel(delta: number | null) {
  if (delta == null) return "ждём сравнение";
  if (delta < -5) return "дешевеет";
  if (delta > 5) return "дорожает";
  return "стабильно";
}

function readinessTone(score: number) {
  if (score >= 80) return { label: "ready", bg: "#dcfce7", bd: "#86efac", fg: "#166534" };
  if (score >= 45) return { label: "warming up", bg: "#fef3c7", bd: "#fcd34d", fg: "#92400e" };
  return { label: "building", bg: "#e0f2fe", bd: "#7dd3fc", fg: "#0f766e" };
}

function SectionTitle({ k, title }: { k: string; title: string }) {
  return (
    <div className="rb-section-title">
      <div>{k}</div>
      <h2>{title}</h2>
    </div>
  );
}

function MiniIcon({ children }: { children: string }) {
  return <span className="rb-mini-icon">{children}</span>;
}

function Gauge({ score, tone }: { score: number; tone: ReturnType<typeof statusTone> }) {
  const radius = 120;
  const circumference = 2 * Math.PI * radius;
  const dash = `${Math.round(circumference * Math.max(3, Math.min(100, score)) / 100)} ${Math.round(circumference)}`;

  return (
    <div className="rb-gauge-wrap">
      <div className="rb-gauge-glow" />
      <svg width="300" height="300" viewBox="0 0 300 300" className="rb-gauge">
        <circle cx="150" cy="150" r={radius} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="16" />
        <circle cx="150" cy="150" r={radius} fill="none" stroke="url(#rbGaugeGrad)" strokeWidth="16" strokeLinecap="round" strokeDasharray={dash} />
        <defs>
          <linearGradient id="rbGaugeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#22d3ee" />
            <stop offset="1" stopColor="#34d399" />
          </linearGradient>
        </defs>
      </svg>
      <div className="rb-gauge-center">
        <div className="rb-overline rb-cyan">Понимание</div>
        <strong>{score}<span>%</span></strong>
        <div className="rb-live-pill" style={{ background: tone.bg, borderColor: tone.bd, color: tone.fg }}>
          <i style={{ background: tone.dot }} />
          уверенность · {tone.label}
        </div>
      </div>
    </div>
  );
}

export default function ReelsBrainPixelCockpit() {
  const [learning, setLearning] = useState<JsonRecord | null>(null);
  const [corpus, setCorpus] = useState<JsonRecord | null>(null);
  const [learningPlan, setLearningPlan] = useState<JsonRecord | null>(null);
  const [summaries, setSummaries] = useState<JsonRecord[]>([]);
  const [selectedPattern, setSelectedPattern] = useState<JsonRecord | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        setState("loading");
        const nicheParam = NICHES.join(",");
        const [learningData, corpusData, learningPlanData, ...summaryData] = await Promise.all([
          getJson(`/api/factory/reels-brain/learning-economics?niches=${encodeURIComponent(nicheParam)}&limit=80`),
          getJson("/api/factory/reels-brain/corpus?limit=200&min_score=0"),
          getJson(`/api/factory/reels-brain/learning-plan?niches=${encodeURIComponent(nicheParam)}&platforms=tiktok,instagram,youtube&target=10000&max_backlog_before_analyze=180`),
          ...NICHES.map((niche) => getJson(`/api/factory/reels-brain/summary?niche=${encodeURIComponent(niche)}`)),
        ]);
        if (!alive) return;
        setLearning(learningData);
        setCorpus(corpusData);
        setLearningPlan(learningPlanData);
        setSummaries(summaryData);
        setState("ready");
      } catch (e) {
        if (!alive) return;
        setError(String((e as Error)?.message || e));
        setState("error");
      }
    }
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const vm = useMemo(() => {
    const totals = learning?.totals || {};
    const insights = learning?.insights || {};
    const economics = learning?.daily_costs || learning?.economics || {};
    const audit = learning?.corpus_audit || {};
    const antiPattern = learning?.anti_pattern_brain || {};
    const discovery = learning?.discovery_brain || {};
    const taxonomy = learning?.taxonomy_brain || {};
    const audioBrain = learning?.audio_brain || {};
    const outcomeMemory = learning?.outcome_memory_brain || {};
    const dailyReport = learning?.daily_report || {};
    const qualityGate = learning?.quality_gate || {};
    const costGovernor = learning?.cost_governor || {};
    const autopilotActions = learning?.autopilot_actions || {};
    const mission = learningPlan?.learning_plan || {};
    const nextLayers = learning?.next_intelligence_layers || {};
    const audioVisualSummary = nextLayers?.audio_visual_intelligence
      ? `ready ${compact(nextLayers.audio_visual_intelligence.ready_for_worker)} · media ${compact(nextLayers.audio_visual_intelligence.with_media_locators)} · audio ${compact(nextLayers.audio_visual_intelligence.with_audio_features)} · transcripts ${compact(nextLayers.audio_visual_intelligence.with_transcript)}`
      : "";
    const patternDetails = (learning?.pattern_details || []) as JsonRecord[];
    const nicheComparison = (learning?.niche_comparison || []) as JsonRecord[];
    const niches = (learning?.niches || []) as JsonRecord[];
    const topHooks = (insights?.top_hooks || []) as JsonRecord[];
    const formats = (insights?.winning_formats || []) as JsonRecord[];
    const retentions = (insights?.retention_mechanics || []) as JsonRecord[];
    const recipes = (insights?.recipes || []) as JsonRecord[];
    const strongCombinations = (insights?.strong_combinations || []) as JsonRecord[];
    const refs = (insights?.source_references || []) as JsonRecord[];
    const sourceMap = (insights?.source_map || []) as JsonRecord[];
    const timeline = [...((learning?.timeline || []) as JsonRecord[])]
      .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
      .slice(-8)
      .reverse();
    const daily = (economics?.rows || economics?.daily || []) as JsonRecord[];
    const totalVideos = Math.max(num(totals.total_videos), num(corpus?.total));
    const analyzed = Math.max(num(totals.analyzed_videos), num(corpus?.summary?.analyzed));
    const patterns = num(totals.patterns);
    const readyPatterns = num(totals.generator_ready_patterns);
    const cross = num(totals.cross_platform_patterns);
    const baseScore = num(totals.avg_understanding_score);
    const fallbackScore = Math.round(
      Math.min(36, totalVideos / 80)
      + Math.min(28, analyzed / Math.max(1, totalVideos) * 28)
      + Math.min(18, readyPatterns * 2.2)
      + Math.min(12, patterns)
      + Math.min(6, cross * 2),
    );
    const score = Math.max(0, Math.min(100, Math.round(baseScore || fallbackScore)));
    const tone = statusTone(score);
    const analyzedPct = totalVideos ? Math.round(analyzed / totalVideos * 100) : 0;
    const today = daily[daily.length - 1] || null;
    const prev = daily.length > 1 ? daily[daily.length - 2] : null;
    const lastTimelineWithCost = [...timeline].reverse().find((row) => firstPositive(row.usd_per_relevant, row.usd_per_analyzed, row.usd_per_inserted, row.spend_usd));
    const bestSourceWithCost = sourceMap.find((row) => firstPositive(row.cost_per_analyzed, row.cost_per_inserted, row.estimated_spend_usd));
    const usefulCost = firstPositive(
      today?.usd_per_relevant,
      today?.usd_per_analyzed,
      today?.usd_per_inserted,
      totals.usd_per_relevant_recent,
      totals.usd_per_analyzed_recent,
      totals.usd_per_inserted_recent,
      bestSourceWithCost?.cost_per_analyzed,
      bestSourceWithCost?.cost_per_inserted,
      lastTimelineWithCost?.usd_per_relevant,
      lastTimelineWithCost?.usd_per_analyzed,
      lastTimelineWithCost?.usd_per_inserted,
      num(lastTimelineWithCost?.spend_usd) / Math.max(1, num(lastTimelineWithCost?.relevant) || num(lastTimelineWithCost?.analyzed) || num(lastTimelineWithCost?.inserted)),
    );
    const prevCost = firstPositive(prev?.usd_per_relevant, prev?.usd_per_analyzed, prev?.usd_per_inserted);
    const delta = usefulCost && prevCost ? Math.round((usefulCost - prevCost) / prevCost * 100) : null;
    const cheaper = delta != null && delta < -5;
    const expensive = delta != null && delta > 5;

    const coverage = NICHES.map((niche) => {
      const row = niches.find((item) => item.niche === niche) || {};
      const platforms = row.platform_brains || {};
      const summary = summaries.find((item) => item.niche === niche) || {};
      return {
        niche,
        score: num(row.understanding_score),
        cells: ["tiktok", "instagram", "youtube"].map((platform) => {
          const brain = platforms[platform] || {};
          const platformSummary = ((summary.platforms || []) as JsonRecord[]).find((item) => item.platform === platform) || {};
          return levelCell(Math.max(num(brain.analyzed_videos), num(platformSummary.analyzed), num(platformSummary.videos) * 0.35));
        }),
      };
    });

    const funnel = [
      { name: "Сырой корпус", count: totalVideos, note: "Видео, которые уже лежат в базе и могут стать насмотренностью.", pct: 100, status: "input" },
      { name: "Разобрано", count: analyzed, note: "Видео, где мозг вытащил хук, формат, удержание и признаки.", pct: analyzedPct, status: "memory" },
      { name: "Паттерны", count: patterns, note: "Сжатые повторяющиеся структуры, не отдельные ролики.", pct: Math.min(100, patterns * 5), status: "pattern brain" },
      { name: "Generator-ready", count: readyPatterns, note: "Паттерны, которые можно превращать в creative brief.", pct: Math.min(100, readyPatterns * 7), status: "ready" },
      { name: "Cross-platform", count: cross, note: "Механики, встречающиеся не только в одной платформе.", pct: Math.min(100, cross * 10), status: "transfer" },
    ];
    const platformTruth = Object.entries((audit.by_platform || {}) as Record<string, JsonRecord>)
      .map(([platform, row]) => ({ platform, ...row }) as JsonRecord)
      .sort((a, b) => num(b.analyzed) - num(a.analyzed));
    const nicheTruth = Object.entries((audit.by_niche || {}) as Record<string, JsonRecord>)
      .map(([niche, row]) => ({ niche, ...row }) as JsonRecord)
      .sort((a, b) => num(b.analyzed) - num(a.analyzed));
    const opHooks = topHooks.filter((hook) => hook.segment === "op_hooks" || num(hook.op_score) >= 85).slice(0, 4);
    const frequentHooks = topHooks.filter((hook) => hook.segment === "frequent_hooks" || (num(hook.frequency) >= 100 && num(hook.op_score) < 85)).slice(0, 4);
    const experimentalHooks = topHooks.filter((hook) => hook.segment === "experimental_hooks" || hook.confidence === "low").slice(0, 4);
    const decisionCards = [
      {
        title: "Сборщик",
        value: discovery.next_policy || "Держать RU-фокус и масштабировать только источники с доказанным yield.",
        meta: discovery.ru_focus === "increase_ru_weight" ? "нужно усилить RU" : "RU-фокус ок",
      },
      {
        title: "Генератор",
        value: readyPatterns >= 20 ? "Можно давать generator-ready рецепты в сценарии, но не копировать ассеты." : "Генератору пока давать только top hooks и форматы, без автоскейла.",
        meta: `${compact(readyPatterns)} ready`,
      },
      {
        title: "Бюджет",
        value: usefulCost > 0 ? `Ориентир ${usd(usefulCost)} за полезную единицу насмотренности.` : "Нужно ещё накопить cost-события, чтобы честно считать цену.",
        meta: vmCostLabel(delta),
      },
      {
        title: "Taxonomy",
        value: num(taxonomy.classified_videos) > 0
          ? `Слой v2 уже разобрал ${compact(taxonomy.classified_videos)} спорных видео и начинает выращивать свой словарь.`
          : "Ночной taxonomy-refresh ещё не прогрел корпус.",
        meta: `${compact((taxonomy.custom_hook_labels || []).length)} hook labels · ${compact((taxonomy.custom_structure_labels || []).length)} structure labels`,
      },
    ];
    const taxonomyLabels = ((taxonomy.top_new_labels || []) as JsonRecord[]).slice(0, 8);
    const taxonomyByNiche = NICHES.map((niche) => {
      const row = ((taxonomy.by_niche || {}) as Record<string, JsonRecord>)[niche] || {};
      return {
        niche,
        analyzed_videos: num(row.analyzed_videos),
        classified_videos: num(row.classified_videos),
        confident_videos: num(row.confident_videos),
        resolved_videos: num(row.resolved_videos),
        unresolved_any_videos: num(row.unresolved_any_videos),
        unresolved_hook_videos: num(row.unresolved_hook_videos),
        unresolved_structure_videos: num(row.unresolved_structure_videos),
        gray_zone_rate: num(row.gray_zone_rate),
        custom_hook_labels: num(row.custom_hook_labels),
        custom_structure_labels: num(row.custom_structure_labels),
      };
    });
    const gateCards = [
      ["high_confidence", "High", qualityGate.high_confidence || 0, "Можно использовать как основу сценария."],
      ["medium_confidence", "Medium", qualityGate.medium_confidence || 0, "Можно брать, но проверять на товаре."],
      ["experimental", "Experiment", qualityGate.experimental || 0, "Только A/B тест, без масштабирования."],
      ["noise", "Noise", qualityGate.noise || 0, "Не отдавать в генератор."],
    ];
    const targetVideos = num(mission.progress?.target || 10000);
    const backlogRemaining = num(mission.backlog?.total || Math.max(0, totalVideos - analyzed));
    const missionProgressPct = num(mission.progress?.progress_pct || pct(totalVideos, targetVideos || 10000));
    const learningDeltaVideos = Math.max(0, num(today?.analyzed) || num(lastTimelineWithCost?.analyzed));
    const learningDeltaPatterns = Math.max(0, num(totals.patterns_delta) || num(lastTimelineWithCost?.patterns_added));
    const topInsight = strongCombinations[0] || recipes[0] || {};
    const topFormat = formats[0] || {};
    const bestHook = opHooks[0] || topHooks[0] || {};
    const bestNiche = [...nicheTruth].sort((a, b) => num(b.avg_score || b.analyzed_rate) - num(a.avg_score || a.analyzed_rate))[0] || {};
    const readinessCards = [
      {
        key: "corpus",
        title: "Corpus",
        score: Math.min(100, Math.round((totalVideos / Math.max(1, targetVideos)) * 100)),
        value: `${compact(totalVideos)} / ${compact(targetVideos)}`,
        note: backlogRemaining > 180 ? `ещё ${compact(backlogRemaining)} в backlog` : "корпус уже достаточный",
      },
      {
        key: "patterns",
        title: "Pattern Brain",
        score: Math.min(100, readyPatterns * 4 + patterns),
        value: `${compact(readyPatterns)} ready`,
        note: readyPatterns >= 20 ? "можно опираться в brief" : "нужно ещё generator-ready паттерны",
      },
      {
        key: "audio",
        title: "Audio",
        score: Math.min(100, num(audioBrain.with_audio_rate || 0)),
        value: `${compact(audioBrain.with_audio)} audio-ready`,
        note: audioBrain.next_step || "audio слой ещё догревается",
      },
      {
        key: "feedback",
        title: "Feedback Loop",
        score: outcomeMemory.rows_live ? 100 : outcomeMemory.status === "schema_ready" ? 66 : 24,
        value: outcomeMemory.rows_live ? `${compact(outcomeMemory.rows_live)} posts live` : "schema ready",
        note: outcomeMemory.next_step || "ждём первые публикации",
      },
    ].map((item) => ({ ...item, tone: readinessTone(item.score) }));
    const executiveCards = [
      {
        title: "Изучено видео",
        value: compact(totalVideos),
        note: `${compact(analyzed)} уже разобрано`,
      },
      {
        title: "Понимание ниш",
        value: `${score}%`,
        note: bestNiche.niche ? `${NICHE_LABELS[bestNiche.niche] || bestNiche.niche} сейчас впереди` : "ждём плотнее данные по нишам",
      },
      {
        title: "Паттерны в памяти",
        value: compact(readyPatterns),
        note: `${compact(patterns)} total · ${compact(cross)} cross-platform`,
      },
      {
        title: "Цена обучения",
        value: usd(usefulCost),
        note: delta == null ? "ждём сравнение" : `${vmCostLabel(delta)} на ${Math.abs(delta)}%`,
      },
      {
        title: "Статус петли",
        value: autopilotActions.can_run_paid_collection ? "авторежим" : "анализ first",
        note: mission.next_tick?.label || "мозг сам решает bulk vs analyze",
      },
    ];
    const knowledgeCards = NICHES.map((niche) => {
      const summary = summaries.find((item) => item.niche === niche) || {};
      const row = nicheComparison.find((item) => item.niche === niche) || niches.find((item) => item.niche === niche) || {};
      const topHook = ((summary.insights?.top_hooks || row.top_hooks || []) as JsonRecord[])[0] || {};
      const topFormatForNiche = ((summary.insights?.winning_formats || []) as JsonRecord[])[0] || {};
      const nicheScore = num(row.understanding_score || row.avg_score || row.analyzed_rate);
      return {
        niche,
        score: nicheScore,
        tone: readinessTone(nicheScore),
        total: num(row.total_videos || row.total || summary.total_videos),
        analyzed: num(row.analyzed_videos || row.analyzed || summary.analyzed_videos),
        ready: num(row.generator_ready_patterns || summary.generator_ready_patterns),
        topHook: topHook.hook_label || topHook.hook_type || "нужен более сильный хук",
        topFormat: topFormatForNiche.label || "формат ещё кристаллизуется",
        note: row.transfer_note || `Платформ с уверенным покрытием: ${compact(((row.platform_brains && Object.keys(row.platform_brains)) || []).length)}`,
      };
    });
    const insightHighlights = [
      {
        title: "Главный winning hook",
        body: bestHook.hook_label || bestHook.hook_type || "Пока нет сильного OP-hook лидера",
        meta: `OP ${compact(bestHook.op_score)} · ${bestHook.confidence || "watch"}`,
      },
      {
        title: "Формат, который тащит чаще всего",
        body: topFormat.label || "Формат ещё не вышел в явный лидер",
        meta: `частота ${compact(topFormat.frequency)} · score ${compact(topFormat.avg_score)}`,
      },
      {
        title: "Лучшая комбинация",
        body: topInsight.hook_label ? `${topInsight.hook_label} + ${topInsight.structure_label}` : "Сильная связка дозревает",
        meta: topInsight.decision_label ? `${topInsight.decision_label} · OP ${compact(topInsight.op_score)}` : "ждём устойчивую комбинацию",
      },
      {
        title: "Как мозг растёт сегодня",
        body: learningDeltaVideos > 0 ? `За свежий цикл добрал ещё ${compact(learningDeltaVideos)} разобранных видео.` : "Сегодня основная работа идёт на backfill и quality layer.",
        meta: learningDeltaPatterns > 0 ? `+${compact(learningDeltaPatterns)} паттернов` : `backlog ${compact(backlogRemaining)}`,
      },
    ];
    const economicsCards = [
      {
        title: "Цена полезного видео",
        value: usd(usefulCost),
        note: delta == null ? "нет прошлого среза для сравнения" : `${vmCostLabel(delta)} · ${delta > 0 ? "+" : ""}${delta}%`,
      },
      {
        title: "Вчера vs сегодня",
        value: prevCost ? `${usd(prevCost)} → ${usd(usefulCost)}` : "ждём 2-й cost срез",
        note: today?.date ? `срез ${today.date}` : "по последнему timeline event",
      },
      {
        title: "Следующий лучший источник",
        value: sourceMap[0]?.provider || "источник ещё выбирается",
        note: sourceMap[0] ? `${usd(sourceMap[0].cost_per_analyzed)} за analyzed` : "нужно больше source economics",
      },
    ];
    const nextAction = {
      title: mission.next_tick?.label || "Продолжать анализ backlog",
      reason: mission.next_tick?.reason || (backlogRemaining > 0
        ? `В backlog ещё ${compact(backlogRemaining)} видео, и это быстрее усилит мозг, чем новый дорогой сбор.`
        : "Корпус уже вырос, значит следующая ценность — в quality, patterns и feedback loop."),
      command: mission.next_tick?.endpoint || (backlogRemaining > 0 ? "/api/factory/jobs/reels-brain-cron?task=analyze" : "/api/factory/jobs/reels-brain-cron"),
      status: autopilotActions.can_run_paid_collection ? "можно без ручного пинка" : "сначала добить backlog",
    };

    return {
      totals,
      insights,
      economics,
      audit,
      antiPattern,
      discovery,
      taxonomy,
      audioBrain,
      outcomeMemory,
      dailyReport,
      qualityGate,
      costGovernor,
      autopilotActions,
      mission,
      nextLayers,
      audioVisualSummary,
      patternDetails,
      nicheComparison,
      score,
      tone,
      totalVideos,
      analyzed,
      patterns,
      readyPatterns,
      cross,
      analyzedPct,
      topHooks,
      formats,
      retentions,
      recipes,
      strongCombinations,
      refs,
      sourceMap,
      timeline,
      coverage,
      funnel,
      platformTruth,
      nicheTruth,
      opHooks,
      frequentHooks,
      experimentalHooks,
      decisionCards,
      taxonomyLabels,
      taxonomyByNiche,
      gateCards,
      targetVideos,
      backlogRemaining,
      missionProgressPct,
      executiveCards,
      knowledgeCards,
      insightHighlights,
      economicsCards,
      readinessCards,
      nextAction,
      usefulCost,
      delta,
      costLabel: cheaper ? "дешевле" : expensive ? "дороже" : "ровно",
      costTone: cheaper ? "#22c55e" : expensive ? "#f59e0b" : "#38bdf8",
      blindSpots: [
        totalVideos < 6000 ? "Корпус ещё маловат для уверенного high-level вывода по всем нишам." : "Корпус уже достаточный, следующий риск: качество разметки.",
        cross < 3 ? "Мало cross-platform паттернов: пока нельзя смело переносить всё между TikTok/Reels/Shorts." : "Cross-platform слой появился, но его нужно проверять на новых источниках.",
        readyPatterns < 12 ? "Generator-ready рецептов мало: лучше не генерировать слишком однотипно." : "Рецептов уже хватает для первых стабильных креативных экспериментов.",
      ],
    };
  }, [learning, corpus, learningPlan, summaries]);

  return (
    <main className="rb-page">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        .rb-page{width:100%;min-height:100vh;background:#eef1f6;color:#0f172a;font-family:'Hanken Grotesk',system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
        .rb-page *{box-sizing:border-box}
        .rb-shell{max-width:1240px;margin:0 auto;padding:44px 40px 80px;display:flex;flex-direction:column;gap:52px}
        .rb-hero{position:relative;background:radial-gradient(1200px 600px at 78% -10%, #12324a 0%, #0b1b2e 42%, #081422 100%);color:#e8eef6;overflow:hidden}
        .rb-hero:before{content:"";position:absolute;top:-160px;right:-40px;width:520px;height:520px;border-radius:50%;background:radial-gradient(circle,#12d0c0 0%,rgba(18,208,192,0) 68%);filter:blur(20px);opacity:.5;animation:rbPulseGlow 6s ease-in-out infinite;pointer-events:none}
        .rb-hero:after{content:"";position:absolute;bottom:-220px;left:-80px;width:460px;height:460px;border-radius:50%;background:radial-gradient(circle,#0ea5e9 0%,rgba(14,165,233,0) 70%);filter:blur(30px);opacity:.32;animation:rbPulseGlow 8s ease-in-out infinite;pointer-events:none}
        .rb-topbar{position:relative;max-width:1240px;margin:0 auto;padding:26px 40px 8px;display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}
        .rb-brand{display:flex;align-items:center;gap:12px}
        .rb-brand-icon{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#22d3ee,#10b981);display:flex;align-items:center;justify-content:center;color:#04121c;box-shadow:0 0 24px rgba(34,211,238,.45)}
        .rb-hero-grid{position:relative;max-width:1240px;margin:0 auto;padding:30px 40px 46px;display:grid;grid-template-columns:1fr 360px;gap:48px;align-items:center}
        .rb-overline{font:600 11px/1 'JetBrains Mono';letter-spacing:.16em;text-transform:uppercase}
        .rb-cyan{color:#7dd3fc}.rb-teal{color:#5eead4}.rb-muted{color:#8aa2b8}
        .rb-stage{display:inline-flex;align-items:center;gap:9px;padding:6px 13px;border-radius:999px;background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.28);margin-bottom:22px}
        .rb-hero h1{font:600 46px/1.08 'Space Grotesk';letter-spacing:-.02em;margin:0 0 20px;color:#f1f6fb;text-wrap:balance}
        .rb-gradient-text{background:linear-gradient(90deg,#22d3ee,#34d399);-webkit-background-clip:text;background-clip:text;color:transparent}
        .rb-hero p{font:400 17px/1.6 'Hanken Grotesk';color:#a9bccf;max-width:590px;margin:0 0 30px;text-wrap:pretty}
        .rb-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;max-width:640px}
        .rb-stat{padding:15px 16px;border-radius:14px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.09);backdrop-filter:blur(4px)}
        .rb-stat strong{display:block;font:600 26px/1 'Space Grotesk'}
        .rb-stat span{display:block;font:500 10px/1.3 'JetBrains Mono';color:#7f97ad;text-transform:uppercase;letter-spacing:.05em;margin-top:8px}
        .rb-alert{display:flex;align-items:center;gap:11px;margin-top:24px;padding:13px 17px;border-radius:13px;background:rgba(245,158,11,.11);border:1px solid rgba(245,158,11,.32);max-width:640px;color:#fde9c4}
        .rb-live{display:flex;align-items:center;gap:9px;padding:8px 14px;border-radius:999px;background:rgba(16,185,129,.13);border:1px solid rgba(16,185,129,.35);font:600 12px/1 'JetBrains Mono';color:#6ee7b7}
        .rb-live i{width:8px;height:8px;border-radius:50%;background:#34d399;box-shadow:0 0 10px #34d399;animation:rbBlink 1.8s ease-in-out infinite}
        .rb-gauge-wrap{position:relative;width:300px;height:300px;display:flex;align-items:center;justify-content:center;animation:rbFloatOrb 7s ease-in-out infinite}
        .rb-gauge-glow{position:absolute;inset:38px;border-radius:50%;background:radial-gradient(circle,rgba(34,211,238,.35),rgba(16,185,129,.08) 60%,transparent 72%);filter:blur(12px);animation:rbPulseGlow 4.5s ease-in-out infinite}
        .rb-gauge{position:relative;transform:rotate(-90deg)}
        .rb-gauge-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
        .rb-gauge-center strong{font:600 62px/1 'Space Grotesk';color:#f1f6fb;margin-top:6px}.rb-gauge-center strong span{font-size:26px;color:#7f97ad}
        .rb-live-pill{display:inline-flex;align-items:center;gap:7px;margin-top:12px;padding:5px 12px;border-radius:999px;border:1px solid;font:600 11px/1 'JetBrains Mono';text-transform:uppercase;letter-spacing:.04em}.rb-live-pill i{width:7px;height:7px;border-radius:50%}
        .rb-section-title{margin-bottom:22px}.rb-section-title div{font:600 11px/1 'JetBrains Mono';letter-spacing:.16em;color:#0891b2;text-transform:uppercase}.rb-section-title h2{font:600 30px/1.15 'Space Grotesk';letter-spacing:-.01em;margin:9px 0 0}
        .rb-card{background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:22px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
        .rb-two{display:grid;grid-template-columns:1fr 1.15fr;gap:24px;align-items:start}.rb-three{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.rb-four{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.rb-cost{display:grid;grid-template-columns:1.1fr .9fr;gap:18px}
        .rb-funnel{display:flex;flex-direction:column;gap:10px}.rb-funnel-row{display:flex;align-items:center;gap:20px;padding:18px 22px;border-radius:16px;background:#fff;border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(15,23,42,.04)}.rb-funnel-num{flex:0 0 148px}.rb-funnel-num strong{font:600 32px/1 'Space Grotesk';color:#0f172a}.rb-funnel-num span{display:block;font:500 12px/1.2 'Hanken Grotesk';color:#94a3b8;margin-top:5px}.rb-bar{height:9px;border-radius:99px;background:#eef2f7;overflow:hidden}.rb-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#22d3ee,#34d399)}.rb-funnel-note{font:400 13px/1.45 'Hanken Grotesk';color:#64748b;margin-top:10px}.rb-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:999px;font:600 11px/1 'JetBrains Mono';white-space:nowrap;background:#f8fafc;color:#475569;border:1px solid #e2e8f0}
        .rb-kpi{padding:20px;border-radius:16px;background:#fff;border:1px solid #e2e8f0}.rb-kpi .label{font:600 11px/1 'JetBrains Mono';color:#94a3b8;text-transform:uppercase;letter-spacing:.06em}.rb-kpi strong{display:block;font:600 34px/1 'Space Grotesk';margin-top:9px}.rb-kpi p{font:400 13px/1.45 'Hanken Grotesk';color:#64748b;margin:8px 0 0}
        .rb-summary-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}.rb-summary-card{padding:20px;border-radius:18px;background:linear-gradient(180deg,#fff,#f8fafc);border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(15,23,42,.04)}.rb-summary-card strong{display:block;font:700 30px/1 'Space Grotesk';margin-top:12px;color:#0f172a}.rb-summary-card p{margin:10px 0 0;color:#64748b;font:400 13px/1.45 'Hanken Grotesk'}
        .rb-story-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:18px}.rb-story-card{padding:22px;border-radius:18px;border:1px solid #e2e8f0;background:#fff}.rb-story-card h3{font:700 24px/1.1 'Space Grotesk';margin:12px 0 8px;color:#0f172a}.rb-story-card p{margin:0;color:#64748b;font:400 14px/1.55 'Hanken Grotesk'}
        .rb-insight-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.rb-insight-card{padding:18px;border-radius:16px;border:1px solid #e2e8f0;background:#fff}.rb-insight-card h3{font:700 18px/1.2 'Space Grotesk';margin:12px 0 8px}.rb-insight-card p{margin:0;color:#475569;font:400 13px/1.5 'Hanken Grotesk'}
        .rb-readiness-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.rb-readiness-card{padding:18px;border-radius:18px;background:#fff;border:1px solid #e2e8f0}.rb-readiness-card strong{display:block;font:700 26px/1 'Space Grotesk';margin-top:12px}.rb-readiness-card p{margin:8px 0 0;color:#64748b;font-size:13px;line-height:1.45}
        .rb-next-action{display:grid;grid-template-columns:1.2fr .8fr;gap:18px;padding:24px;border-radius:22px;background:linear-gradient(135deg,#0f172a,#083344);color:#ecfeff;border:1px solid rgba(34,211,238,.18)}.rb-next-action h3{font:700 32px/1.05 'Space Grotesk';margin:14px 0 12px}.rb-next-action p{color:#bae6fd;font:400 14px/1.6 'Hanken Grotesk';margin:0}.rb-next-command{padding:14px 16px;border-radius:16px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);font:600 12px/1.5 'JetBrains Mono';color:#cffafe;word-break:break-word}
        .rb-tech-layer{border:1px solid #dbeafe;border-radius:22px;background:linear-gradient(180deg,#fff,#f8fafc);overflow:hidden}.rb-tech-layer summary{list-style:none;cursor:pointer;padding:22px 24px;font:700 18px/1.2 'Space Grotesk';color:#0f172a;display:flex;align-items:center;justify-content:space-between}.rb-tech-layer summary::-webkit-details-marker{display:none}.rb-tech-layer summary span{font:600 11px/1 'JetBrains Mono';text-transform:uppercase;letter-spacing:.08em;color:#0891b2}.rb-tech-body{padding:0 24px 24px;display:flex;flex-direction:column;gap:52px}
        .rb-coverage{display:grid;grid-template-columns:128px repeat(3,1fr);gap:10px;align-items:center}.rb-coverage-head{font:600 11px/1.1 'JetBrains Mono';color:#64748b;text-align:center;text-transform:uppercase;letter-spacing:.03em}.rb-cell{height:46px;border-radius:11px;display:flex;align-items:center;justify-content:center;border:1px solid}.rb-cell span{font:600 11px/1 'JetBrains Mono';text-transform:uppercase;letter-spacing:.02em}
        .rb-dark{background:linear-gradient(135deg,#0f172a,#0b1b2e 56%,#07313b);color:#fff;border-color:rgba(255,255,255,.1)}.rb-dark .rb-section-title h2,.rb-dark h3{color:#fff}.rb-dark p{color:#cbd5e1}.rb-dark-card{border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.08);border-radius:16px;padding:16px}
        .rb-pattern{border:1px solid #e2e8f0;background:#fff;border-radius:16px;padding:16px}.rb-pattern h3{font:700 17px/1.25 'Space Grotesk';margin:0;color:#0f172a}.rb-pattern p{font:400 13px/1.45 'Hanken Grotesk';color:#64748b;margin:9px 0 0}
        .rb-signal{display:flex;align-items:flex-start;gap:12px;padding:14px;border-radius:15px;border:1px solid #e2e8f0;background:#fff}.rb-signal strong{display:block;font:700 18px/1.2 'Space Grotesk';color:#0f172a}.rb-signal span{display:block;margin-top:4px;font:500 12px/1.35 'JetBrains Mono';color:#64748b;text-transform:uppercase;letter-spacing:.04em}.rb-signal p{margin:8px 0 0;color:#64748b;font:400 13px/1.45 'Hanken Grotesk'}
        .rb-matrix{display:grid;grid-template-columns:1fr repeat(4,auto);gap:10px;align-items:center}.rb-matrix-head{font:600 10px/1 'JetBrains Mono';color:#94a3b8;text-transform:uppercase;letter-spacing:.08em}.rb-matrix-row{display:contents}.rb-matrix-row>*{padding:12px 10px;border-top:1px solid #eef2f7;font:500 13px/1.25 'Hanken Grotesk';color:#334155}.rb-matrix-row strong{font:700 14px/1.2 'Space Grotesk';color:#0f172a}
        .rb-hook-board{display:grid;grid-template-columns:1.15fr .85fr;gap:16px}.rb-hook-hero{position:relative;overflow:hidden;border-radius:20px;padding:22px;background:linear-gradient(135deg,#0f172a,#0b3140);color:#fff;border:1px solid rgba(255,255,255,.1)}.rb-hook-hero:after{content:"";position:absolute;right:-80px;top:-80px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(34,211,238,.35),transparent 65%)}.rb-hook-hero h3{position:relative;font:700 32px/1.08 'Space Grotesk';margin:10px 0 0;color:#fff}.rb-hook-hero p{position:relative;color:#cbd5e1;max-width:560px}.rb-hook-list{display:flex;flex-direction:column;gap:10px}.rb-hook-list .rb-pattern{min-height:0}
        .rb-brief-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.rb-brief{display:flex;flex-direction:column;gap:12px}.rb-brief h3{font:700 22px/1.15 'Space Grotesk';margin:0}.rb-brief-block{padding:12px;border-radius:13px;background:#f8fafc;border:1px solid #e2e8f0}.rb-brief-block b{display:block;font:700 11px/1 'JetBrains Mono';letter-spacing:.08em;text-transform:uppercase;color:#0891b2;margin-bottom:7px}.rb-brief-block p{margin:0;color:#475569;font-size:13px;line-height:1.45}
        .rb-road{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.rb-road-card{padding:18px;border-radius:18px;border:1px solid #dbeafe;background:linear-gradient(180deg,#fff,#eff6ff)}.rb-road-card h3{font:700 18px/1.2 'Space Grotesk';margin:0}.rb-road-card p{color:#475569;font-size:13px;line-height:1.5;margin:10px 0 0}.rb-road-card span{display:inline-flex;margin-top:14px;border-radius:999px;padding:5px 10px;background:#dbeafe;color:#1e40af;font:700 11px/1 'JetBrains Mono';text-transform:uppercase}
        .rb-detail-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}.rb-detail{position:relative;overflow:hidden}.rb-detail:before{content:"";position:absolute;right:-60px;top:-70px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,rgba(14,165,233,.16),transparent 70%)}.rb-detail>*{position:relative}.rb-gate{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.rb-gate-card{padding:16px;border-radius:16px;background:#fff;border:1px solid #e2e8f0}.rb-gate-card strong{display:block;font:700 30px/1 'Space Grotesk';margin-top:8px}.rb-gate-card p{font-size:13px;line-height:1.45;color:#64748b;margin:8px 0 0}.rb-daily{background:linear-gradient(135deg,#f8fafc,#ecfeff);border-color:#bae6fd}
        .rb-click{cursor:pointer;text-align:left;width:100%;font:inherit;color:inherit;transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease}.rb-click:hover{transform:translateY(-2px);box-shadow:0 14px 34px rgba(15,23,42,.09);border-color:#67e8f9}.rb-drawer-backdrop{position:fixed;inset:0;z-index:80;background:rgba(2,6,23,.48);backdrop-filter:blur(5px);display:flex;justify-content:flex-end}.rb-drawer{width:min(620px,100%);height:100%;overflow:auto;background:#f8fafc;border-left:1px solid #cbd5e1;box-shadow:-24px 0 80px rgba(2,6,23,.28);padding:28px}.rb-drawer h2{font:700 34px/1.05 'Space Grotesk';margin:14px 0;color:#0f172a}.rb-drawer-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.rb-close{min-width:44px;min-height:44px;border-radius:999px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font:700 18px/1 'Space Grotesk';cursor:pointer}.rb-layer-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.rb-layer{padding:15px;border-radius:16px;background:#fff;border:1px solid #e2e8f0}.rb-layer h3{font:700 16px/1.2 'Space Grotesk';margin:8px 0 0}.rb-layer p{font-size:13px;line-height:1.45;color:#64748b;margin:8px 0 0}
        .rb-mini-icon{width:34px;height:34px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:#ecfeff;border:1px solid #bae6fd;color:#0891b2;font:700 16px/1 'Space Grotesk'}
        .rb-question{padding:18px;border-radius:16px;background:#fff;border:1px solid #e2e8f0}.rb-question div{font:600 11px/1 'JetBrains Mono';letter-spacing:.14em;color:#0891b2;text-transform:uppercase}.rb-question p{font:600 18px/1.35 'Space Grotesk';margin:10px 0 0;color:#0f172a}
        @keyframes rbPulseGlow{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:.9;transform:scale(1.06)}}@keyframes rbFloatOrb{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}@keyframes rbBlink{0%,100%{opacity:1}50%{opacity:.25}}
        @media(max-width:980px){.rb-hero-grid,.rb-two,.rb-cost,.rb-hook-board,.rb-story-grid,.rb-next-action{grid-template-columns:1fr}.rb-stats,.rb-four,.rb-detail-grid,.rb-gate,.rb-layer-grid,.rb-summary-grid,.rb-insight-grid,.rb-readiness-grid{grid-template-columns:repeat(2,1fr)}.rb-three,.rb-brief-grid,.rb-road{grid-template-columns:1fr}.rb-shell,.rb-topbar,.rb-hero-grid{padding-left:22px;padding-right:22px}.rb-hero h1{font-size:38px}.rb-gauge-wrap{margin:0 auto}.rb-funnel-row{align-items:flex-start;flex-direction:column}.rb-funnel-num{flex:auto}.rb-coverage{grid-template-columns:100px repeat(3,1fr)}} 
        @media(max-width:620px){.rb-stats,.rb-four,.rb-detail-grid,.rb-gate,.rb-layer-grid,.rb-drawer-grid,.rb-summary-grid,.rb-insight-grid,.rb-readiness-grid{grid-template-columns:1fr}.rb-coverage,.rb-matrix{grid-template-columns:1fr}.rb-coverage-head,.rb-matrix-head{display:none}.rb-cell{justify-content:flex-start;padding:0 14px}.rb-hero h1{font-size:32px}.rb-matrix-row{display:block;border-top:1px solid #eef2f7}.rb-matrix-row>*{display:block;border-top:0;padding:6px 0}.rb-drawer{padding:20px}.rb-tech-layer summary{padding:18px 18px}.rb-tech-body{padding:0 18px 18px}}
      `}</style>

      <section className="rb-hero">
        <div className="rb-topbar">
          <div className="rb-brand">
            <div className="rb-brand-icon">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5a3 3 0 1 0-5.997.142 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.142 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /></svg>
            </div>
            <div>
              <div className="rb-overline rb-teal">Reels Brain</div>
              <div style={{ font: "500 12px/1 'Hanken Grotesk'", color: "#8aa2b8", marginTop: 4 }}>Кокпит креативного интеллекта</div>
            </div>
          </div>
          <div className="rb-live"><i />мозг жив · учится</div>
        </div>

        <div className="rb-hero-grid">
          <div>
            <div className="rb-stage">
              <span className="rb-overline rb-cyan">СТАДИЯ</span>
              <span style={{ font: "600 12px/1 'Hanken Grotesk'", color: "#cffafe" }}>{state === "loading" ? "синхронизация" : "pattern memory"}</span>
            </div>
            <h1>Насколько умён Reels&nbsp;Brain <span className="rb-gradient-text">прямо сейчас?</span></h1>
            <p>Это витрина насмотренности: сколько роликов мозг переварил, насколько можно доверять выводам, какие хуки и механики уже доказаны, и дешевле ли становится обучение.</p>
            <div className="rb-stats">
              <div className="rb-stat"><strong style={{ color: "#67e8f9" }}>{compact(vm.totalVideos)}</strong><span>видео в корпусе</span></div>
              <div className="rb-stat"><strong style={{ color: "#6ee7b7" }}>{compact(vm.analyzed)}</strong><span>разобрано</span></div>
              <div className="rb-stat"><strong style={{ color: "#fbbf24" }}>{compact(vm.readyPatterns)}</strong><span>ready patterns</span></div>
              <div className="rb-stat"><strong style={{ color: "#c4b5fd" }}>{usd(vm.usefulCost)}</strong><span>цена полезного видео</span></div>
            </div>
            <div className="rb-alert">
              <MiniIcon>!</MiniIcon>
              <div>
                <div className="rb-overline" style={{ color: "#fbbf24" }}>Текущее узкое место</div>
                <div style={{ font: "500 14px/1.4 'Hanken Grotesk'", marginTop: 3 }}>{vm.blindSpots[0]}</div>
              </div>
            </div>
          </div>
          <Gauge score={vm.score} tone={vm.tone} />
        </div>
      </section>

      <div className="rb-shell">
        {state === "error" ? (
          <div className="rb-card" style={{ borderColor: "#fecaca", background: "#fff1f2", color: "#991b1b" }}>Backend не ответил: {error}</div>
        ) : null}

        <section>
          <SectionTitle k="01 · Executive Summary" title="Что происходит с мозгом прямо сейчас" />
          <div className="rb-summary-grid">
            {vm.executiveCards.map((card) => (
              <div className="rb-summary-card" key={card.title}>
                <div className="rb-overline" style={{ color: "#0891b2" }}>{card.title}</div>
                <strong>{card.value}</strong>
                <p>{card.note}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rb-story-grid">
          <div className="rb-story-card">
            <SectionTitle k="02 · Learning Progress" title="Растёт ли насмотренность" />
            <div className="rb-bar" style={{ marginTop: 18 }}>
              <i style={{ width: `${Math.max(4, Math.min(100, vm.missionProgressPct))}%` }} />
            </div>
            <h3>{compact(vm.totalVideos)} / {compact(vm.targetVideos)} видео до целевого корпуса</h3>
            <p>
              Уже разобрано {compact(vm.analyzed)} видео, в backlog осталось {compact(vm.backlogRemaining)}.
              {vm.missionProgressPct >= 100
                ? " Базовая цель по корпусу уже достигнута, теперь ценность растёт за счёт quality и pattern brain."
                : " Основной рост дальше даёт связка bulk + analyze, без ручного переключения режимов."}
            </p>
          </div>
          <div className="rb-story-card">
            <SectionTitle k="02.5 · Next Best Action" title="Что система считает следующим шагом" />
            <div className="rb-pill">{vm.nextAction.status}</div>
            <h3>{vm.nextAction.title}</h3>
            <p>{vm.nextAction.reason}</p>
            <div className="rb-next-command" style={{ marginTop: 16 }}>{vm.nextAction.command}</div>
          </div>
        </section>

        <section>
          <SectionTitle k="03 · What The Brain Knows" title="Что уже понято по нишам" />
          <div className="rb-three">
            {vm.knowledgeCards.map((card) => (
              <div className="rb-card" key={card.niche}>
                <div className="rb-two" style={{ gridTemplateColumns: "1fr auto", gap: 14 }}>
                  <div>
                    <div className="rb-overline" style={{ color: "#0891b2" }}>{NICHE_LABELS[card.niche] || card.niche}</div>
                    <h3 style={{ font: "700 28px/1 'Space Grotesk'", margin: "10px 0 0" }}>{compact(card.score)}%</h3>
                  </div>
                  <div className="rb-live-pill" style={{ background: card.tone.bg, borderColor: card.tone.bd, color: card.tone.fg }}>
                    <i style={{ background: card.tone.fg }} />
                    {card.tone.label}
                  </div>
                </div>
                <div className="rb-three" style={{ marginTop: 14 }}>
                  <div className="rb-brief-block"><b>Видео</b><p>{compact(card.total)} total · {compact(card.analyzed)} analyzed</p></div>
                  <div className="rb-brief-block"><b>Ready</b><p>{compact(card.ready)} generator-ready</p></div>
                  <div className="rb-brief-block"><b>Формат</b><p>{card.topFormat}</p></div>
                </div>
                <div className="rb-brief-block" style={{ marginTop: 12 }}>
                  <b>Главный хук</b>
                  <p>{card.topHook}</p>
                </div>
                <p style={{ marginTop: 12, color: "#64748b", lineHeight: 1.55 }}>{card.note}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle k="04 · Winning Insights" title="Какие инсайты уже можно использовать" />
          <div className="rb-insight-grid">
            {vm.insightHighlights.map((item) => (
              <div className="rb-insight-card" key={item.title}>
                <div className="rb-pill">{item.meta}</div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rb-two">
          <div>
            <SectionTitle k="05 · Learning Economics" title="Становится ли обучение дешевле" />
            <div className="rb-three">
              {vm.economicsCards.map((card) => (
                <div className="rb-kpi" key={card.title}>
                  <div className="label">{card.title}</div>
                  <strong>{card.value}</strong>
                  <p>{card.note}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <SectionTitle k="05.5 · Readiness" title="Что уже готово для следующего слоя" />
            <div className="rb-readiness-grid">
              {vm.readinessCards.map((card) => (
                <div className="rb-readiness-card" key={card.key}>
                  <div className="rb-live-pill" style={{ background: card.tone.bg, borderColor: card.tone.bd, color: card.tone.fg }}>
                    <i style={{ background: card.tone.fg }} />
                    {card.tone.label}
                  </div>
                  <strong>{card.title}</strong>
                  <p style={{ color: "#0f172a", fontWeight: 700, marginTop: 10 }}>{card.value}</p>
                  <p>{card.note}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <SectionTitle k="06 · Operational Call" title="Куда смотрим следующим экраном" />
          <div className="rb-next-action">
            <div>
              <div className="rb-overline rb-cyan">Next Best Action</div>
              <h3>{vm.nextAction.title}</h3>
              <p>{vm.nextAction.reason}</p>
            </div>
            <div>
              <div className="rb-overline rb-cyan" style={{ marginBottom: 12 }}>Команда / endpoint</div>
              <div className="rb-next-command">{vm.nextAction.command}</div>
              <div className="rb-dark-card" style={{ marginTop: 14 }}>
                <div className="rb-overline rb-cyan">Режим</div>
                <p style={{ marginTop: 8 }}>{vm.nextAction.status}</p>
              </div>
            </div>
          </div>
        </section>

        <details className="rb-tech-layer">
          <summary>
            <span>Hidden Technical Layer</span>
            Техническая кухня, логи, taxonomy, automation history
          </summary>
          <div className="rb-tech-body">
        <section>
          <SectionTitle k="01 · Прогресс обучения" title="От сырого видео к Creative DNA" />
          <div className="rb-funnel">
            {vm.funnel.map((row) => (
              <div className="rb-funnel-row" key={row.name}>
                <div className="rb-funnel-num"><strong>{compact(row.count)}</strong><span>{row.name}</span></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="rb-bar"><i style={{ width: `${Math.max(3, Math.min(100, row.pct))}%` }} /></div>
                  <div className="rb-funnel-note">{row.note}</div>
                </div>
                <span className="rb-pill">{row.status}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle k="01.2 · Daily intelligence" title={vm.dailyReport.title || "Что мозг понял за сутки"} />
          <div className="rb-card rb-daily">
            <div className="rb-three">
              {((vm.dailyReport.bullets || []) as string[]).slice(0, 5).map((line, index) => (
                <div className="rb-pattern" key={`${line}:${index}`}>
                  <div className="rb-pill">вывод {index + 1}</div>
                  <p style={{ fontWeight: 700, color: "#0f172a" }}>{line}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <SectionTitle k="01.5 · Честность данных" title="Можно ли верить этой насмотренности" />
          <div className="rb-three">
            {[
              ["Качество корпуса", `${compact(vm.audit.quality_score)}%`, `${vm.audit.verdict || "watch"} · sampled ${compact(vm.audit.sampled_rows)}`],
              ["Русский сегмент", `${compact(vm.audit.ru_likely_rate)}%`, `${compact(vm.audit.ru_likely)} видео с кириллицей в caption/hook`],
              ["Дубли / мусор", `${compact(vm.audit.duplicate_rate)}%`, `${compact(vm.audit.duplicate_urls)} дублей · ${compact(vm.audit.low_signal_rate)}% low-signal`],
            ].map(([label, value, text]) => (
              <div className="rb-signal" key={label}>
                <MiniIcon>{String(label).slice(0, 1)}</MiniIcon>
                <div>
                  <span>{label}</span>
                  <strong>{value}</strong>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="rb-card" style={{ marginTop: 16 }}>
            <div className="rb-matrix">
              <div className="rb-matrix-head">Платформа</div>
              <div className="rb-matrix-head">видео</div>
              <div className="rb-matrix-head">разобрано</div>
              <div className="rb-matrix-head">RU</div>
              <div className="rb-matrix-head">score</div>
              {(vm.platformTruth.length ? vm.platformTruth : [{ platform: "waiting", total: 0, analyzed_rate: 0, ru_likely_rate: 0, avg_score: 0 }]).map((row) => (
                <div className="rb-matrix-row" key={row.platform}>
                  <strong>{row.platform}</strong>
                  <span>{compact(row.total)}</span>
                  <span>{compact(row.analyzed_rate)}%</span>
                  <span>{compact(row.ru_likely_rate)}%</span>
                  <span>{compact(row.avg_score)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rb-two">
          <div>
            <SectionTitle k="02 · Уверенность мозга" title="Насколько можно доверять" />
            <div className="rb-card">
              <div className="rb-two" style={{ gridTemplateColumns: "1fr auto", gap: 16 }}>
                <div>
                  <div className="rb-overline" style={{ color: "#94a3b8" }}>Объём данных</div>
                  <div style={{ font: "600 34px/1 'Space Grotesk'", marginTop: 8 }}>{compact(vm.totalVideos)} <span style={{ font: "500 15px/1 'Hanken Grotesk'", color: "#94a3b8" }}>видео</span></div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="rb-overline" style={{ color: "#94a3b8" }}>Уверенность</div>
                  <div className="rb-live-pill" style={{ background: vm.tone.bg, borderColor: vm.tone.bd, color: vm.tone.fg }}>
                    <i style={{ background: vm.tone.dot }} />{vm.tone.label}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 5, margin: "20px 0 22px" }}>
                <div style={{ flex: 1, height: 7, borderRadius: 99, background: "#10b981" }} />
                <div style={{ flex: 1, height: 7, borderRadius: 99, background: vm.score >= 42 ? "#f59e0b" : "#e2e8f0" }} />
                <div style={{ flex: 1, height: 7, borderRadius: 99, background: vm.score >= 72 ? "#22c55e" : "#e2e8f0" }} />
              </div>
              {vm.blindSpots.map((spot) => (
                <div key={spot} style={{ display: "flex", gap: 11, marginTop: 10, color: "#475569", font: "400 14px/1.45 'Hanken Grotesk'" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b", marginTop: 7, flex: "0 0 auto" }} />
                  <span>{spot}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <SectionTitle k="03 · Карта покрытия" title="Где мозг силён" />
            <div className="rb-card">
              <div className="rb-coverage">
                <div />
                {["TikTok", "Instagram", "YouTube"].map((p) => <div className="rb-coverage-head" key={p}>{p}</div>)}
                {vm.coverage.map((row) => (
                  <div key={row.niche} style={{ display: "contents" }}>
                    <div style={{ font: "600 14px/1.1 'Hanken Grotesk'", color: "#334155" }}>{NICHE_LABELS[row.niche] || row.niche}</div>
                    {row.cells.map((cell, index) => (
                      <div className="rb-cell" key={`${row.niche}:${index}`} style={{ background: cell.bg, borderColor: cell.bd }}>
                        <span style={{ color: cell.fg }}>{cell.label}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section>
          <SectionTitle k="03.5 · Сравнение ниш" title="Что отличается между игрушками, одеждой и косметикой" />
          <div className="rb-three">
            {(vm.nicheComparison.length ? vm.nicheComparison : vm.nicheTruth).slice(0, 3).map((niche: JsonRecord) => (
              <div className="rb-card" key={niche.niche}>
                <div className="rb-pill">{NICHE_LABELS[niche.niche] || niche.niche}</div>
                <h3 style={{ font: "700 26px/1 'Space Grotesk'", margin: "14px 0 4px" }}>{compact(niche.understanding_score || niche.analyzed_rate)}%</h3>
                <p style={{ color: "#64748b", lineHeight: 1.5 }}>Видео {compact(niche.total_videos || niche.total)} · разобрано {compact(niche.analyzed_videos || niche.analyzed)} · ready {compact(niche.generator_ready_patterns)}</p>
                <div style={{ marginTop: 14 }}>
                  {(niche.top_hooks || []).slice(0, 2).map((hook: JsonRecord) => (
                    <div className="rb-pattern" key={hook.label} style={{ marginTop: 8 }}>
                      <h3>{hook.label}</h3>
                      <p>OP {compact(hook.op_score)} · {hook.confidence || "watch"}</p>
                    </div>
                  ))}
                </div>
                <p style={{ color: "#475569", lineHeight: 1.5, marginTop: 12 }}>{niche.transfer_note || "Сравнение появится после следующей пересборки."}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle k="04 · Стоимость обучения" title="Мозг должен становиться дешевле" />
          <div className="rb-cost">
            <div className="rb-card rb-dark">
              <div className="rb-four">
                <div className="rb-dark-card"><div className="rb-overline rb-cyan">Сегодня</div><h3 style={{ font: "600 34px/1 'Space Grotesk'", margin: "10px 0 0" }}>{usd(vm.usefulCost)}</h3><p>за полезное видео</p></div>
                <div className="rb-dark-card"><div className="rb-overline rb-cyan">Дельта</div><h3 style={{ color: vm.costTone, font: "600 34px/1 'Space Grotesk'", margin: "10px 0 0" }}>{vm.delta == null ? "—" : `${vm.delta > 0 ? "+" : ""}${vm.delta}%`}</h3><p>{vm.costLabel} к прошлому срезу</p></div>
                <div className="rb-dark-card"><div className="rb-overline rb-cyan">Источники</div><h3 style={{ font: "600 34px/1 'Space Grotesk'", margin: "10px 0 0" }}>{compact(vm.sourceMap.length)}</h3><p>провайдеры/карты</p></div>
                <div className="rb-dark-card"><div className="rb-overline rb-cyan">Прогоны</div><h3 style={{ font: "600 34px/1 'Space Grotesk'", margin: "10px 0 0" }}>{compact(vm.timeline.length)}</h3><p>последние точки</p></div>
              </div>
            </div>
            <div className="rb-card">
              <div className="rb-overline" style={{ color: "#0891b2" }}>Source map</div>
              <h3 style={{ font: "600 24px/1.15 'Space Grotesk'", margin: "9px 0 14px" }}>Что даёт насмотренность</h3>
              {(vm.sourceMap.length ? vm.sourceMap.slice(0, 4) : [{ provider: "Apify / smart discovery", analyzed: vm.analyzed, cost_per_analyzed: vm.usefulCost }]).map((source: JsonRecord) => (
                <div key={source.provider} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderTop: "1px solid #eef2f7", padding: "12px 0" }}>
                  <div><strong>{source.provider}</strong><p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>analyzed {compact(source.analyzed)} · errors {compact(source.errors)}</p></div>
                  <span className="rb-pill">{usd(source.cost_per_analyzed)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <SectionTitle k="04.5 · Taxonomy Layer" title="Как мозг доучивает свой словарь" />
          <div className="rb-two">
            <div className="rb-card">
              <div className="rb-three">
                <div className="rb-kpi">
                  <div className="label">v2-классы</div>
                  <strong>{compact(vm.taxonomy.classified_videos)}</strong>
                  <p>{compact(vm.taxonomy.classified_rate)}% от разобранных видео</p>
                </div>
                <div className="rb-kpi">
                  <div className="label">Уверенные</div>
                  <strong>{compact(vm.taxonomy.confident_videos)}</strong>
                  <p>{compact(vm.taxonomy.confident_rate)}% confidence 0.75+</p>
                </div>
                <div className="rb-kpi">
                  <div className="label">Цена слоя</div>
                  <strong>{usd(vm.taxonomy.estimated_usd_per_classified_video)}</strong>
                  <p>{usd(vm.taxonomy.estimated_total_spend_usd)} суммарно</p>
                </div>
              </div>
              <div className="rb-three" style={{ marginTop: 14 }}>
                <div className="rb-kpi">
                  <div className="label">Было серым</div>
                  <strong>{compact(vm.taxonomy.classified_videos)}</strong>
                  <p>это пул, который taxonomy прогнал через v2</p>
                </div>
                <div className="rb-kpi">
                  <div className="label">Стало ясным</div>
                  <strong>{compact(vm.taxonomy.resolved_videos)}</strong>
                  <p>{compact(vm.taxonomy.resolved_rate)}% уже вывели из серой зоны</p>
                </div>
                <div className="rb-kpi">
                  <div className="label">Осталось серым</div>
                  <strong>{compact(vm.taxonomy.unresolved_any_videos)}</strong>
                  <p>{compact(vm.taxonomy.unresolved_any_rate)}% ещё требуют доучивания</p>
                </div>
              </div>
              <div className="rb-three" style={{ marginTop: 14 }}>
                <div className="rb-kpi">
                  <div className="label">Generator-ready</div>
                  <strong>{compact(vm.taxonomy.pattern_lift?.generator_ready_patterns)}</strong>
                  <p>паттернов сейчас в выходном слое</p>
                </div>
                <div className="rb-kpi">
                  <div className="label">На taxonomy-evidence</div>
                  <strong>{compact(vm.taxonomy.pattern_lift?.patterns_with_taxonomy_backing)}</strong>
                  <p>{compact(vm.taxonomy.pattern_lift?.taxonomy_backed_rate)}% уже опираются на очищенные references</p>
                </div>
                <div className="rb-kpi">
                  <div className="label">Ещё без опоры</div>
                  <strong>{compact(vm.taxonomy.pattern_lift?.patterns_without_taxonomy_backing)}</strong>
                  <p>их ценность вырастет после снятия серой зоны</p>
                </div>
              </div>
              <div className="rb-pattern" style={{ marginTop: 14 }}>
                <div className="rb-pill">{vm.taxonomy.status || "planned"} · {vm.taxonomy.trend || "watch"}</div>
                <h3 style={{ marginTop: 10 }}>Taxonomy перестаёт жить на регэкспах</h3>
                <p>{vm.taxonomy.pattern_lift?.next_step || vm.taxonomy.next_step || "Сначала нужно накопить v2-классификации на analyzed корпусе."}</p>
              </div>
            </div>
            <div className="rb-card">
              <div className="rb-overline" style={{ color: "#0891b2" }}>Новые ярлыки</div>
              <h3 style={{ font: "600 24px/1.15 'Space Grotesk'", margin: "9px 0 14px" }}>Что словарь уже сам вытащил из корпуса</h3>
              {(vm.taxonomyLabels.length ? vm.taxonomyLabels : [{ kind: "hook", label: "labels_will_appear", niche: "mixed", count: 0 }]).map((item: JsonRecord, index: number) => (
                <div key={`${item.kind}:${item.label}:${index}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderTop: "1px solid #eef2f7", padding: "12px 0" }}>
                  <div>
                    <strong>{item.label}</strong>
                    <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>{item.kind} · {NICHE_LABELS[item.niche] || item.niche || "mixed"}</p>
                  </div>
                  <span className="rb-pill">{compact(item.count || 0)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rb-card" style={{ marginTop: 16 }}>
            <div className="rb-overline" style={{ color: "#0891b2" }}>Серая зона по нишам</div>
            <h3 style={{ font: "600 24px/1.15 'Space Grotesk'", margin: "9px 0 14px" }}>Где ещё слишком много direct_claim и unknown_structure</h3>
            <div className="rb-matrix">
              <div className="rb-matrix-head">Ниша</div>
              <div className="rb-matrix-head">v2</div>
              <div className="rb-matrix-head">resolved</div>
              <div className="rb-matrix-head">gray zone</div>
              <div className="rb-matrix-head">hook unknown</div>
              <div className="rb-matrix-head">structure unknown</div>
              {vm.taxonomyByNiche.map((row: JsonRecord) => (
                <div className="rb-matrix-row" key={`taxonomy:${row.niche}`}>
                  <strong>{NICHE_LABELS[row.niche] || row.niche}</strong>
                  <span>{compact(row.classified_videos)} / {compact(row.analyzed_videos)}</span>
                  <span>{compact(row.resolved_videos)}</span>
                  <span>{compact(row.gray_zone_rate)}%</span>
                  <span>{compact(row.unresolved_hook_videos)}</span>
                  <span>{compact(row.unresolved_structure_videos)}</span>
                </div>
              ))}
            </div>
            <p style={{ marginTop: 14, color: "#64748b", lineHeight: 1.55 }}>
              Цель этого слоя: чтобы `direct_claim` и `unknown_structure` стали редким исключением, а не основной массой разобранных роликов.
            </p>
          </div>
        </section>

        <section>
          <SectionTitle k="05 · Что мозг понимает сейчас" title="Хуки, форматы, удержание, Creative DNA" />
          <div className="rb-hook-board">
            <div className="rb-hook-hero">
              <div className="rb-overline rb-cyan">OP hooks</div>
              <h3>{vm.opHooks[0]?.hook_label || vm.topHooks[0]?.hook_label || "Пока ждём сильный хук"}</h3>
              <p>
                Лучший вход сейчас имеет OP {compact(vm.opHooks[0]?.op_score || vm.topHooks[0]?.op_score)} и confidence {vm.opHooks[0]?.confidence || vm.topHooks[0]?.confidence || "watch"}.
                Это не текст для копирования, а механика первого кадра и обещания.
              </p>
              <div className="rb-three" style={{ marginTop: 18 }}>
                {[
                  ["OP", vm.opHooks.length],
                  ["Frequent", vm.frequentHooks.length],
                  ["Experimental", vm.experimentalHooks.length],
                ].map(([label, value]) => (
                  <div className="rb-dark-card" key={label}><div className="rb-overline rb-cyan">{label}</div><h3 style={{ font: "600 28px/1 'Space Grotesk'", margin: "8px 0 0" }}>{compact(value)}</h3></div>
                ))}
              </div>
            </div>
            <div className="rb-hook-list">
              {(vm.topHooks.length ? vm.topHooks.slice(0, 5) : [{ hook_label: "Нужна пересборка Pattern Brain", op_score: 0, frequency: 0 }]).map((hook, index) => (
                <div className="rb-pattern" key={hook.hook_type || hook.hook_label}>
                  <div className="rb-pill">#{index + 1} · {hook.segment || "watch"}</div>
                  <h3 style={{ marginTop: 10 }}>{hook.hook_label || hook.hook_type}</h3>
                <p>OP {compact(hook.op_score)} · частота {compact(hook.frequency)} · уверенность {hook.confidence || "watch"} · ниши {(hook.niches || []).join(", ") || "все"}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rb-three" style={{ marginTop: 16 }}>
            <div className="rb-card">
              <MiniIcon>F</MiniIcon>
              <h3 style={{ font: "600 24px/1.15 'Space Grotesk'", margin: "14px 0 12px" }}>Winning formats</h3>
              {(vm.formats.length ? vm.formats.slice(0, 4) : [{ label: "Форматы появятся после анализа", avg_score: 0, frequency: 0 }]).map((format) => (
                <div className="rb-pattern" key={format.label}><h3>{format.label}</h3><p>оценка {compact(format.avg_score)} · частота {compact(format.frequency)} · ниши {(format.niches || []).join(", ")}</p></div>
              ))}
            </div>
            <div className="rb-card">
              <MiniIcon>R</MiniIcon>
              <h3 style={{ font: "600 24px/1.15 'Space Grotesk'", margin: "14px 0 12px" }}>Retention mechanics</h3>
              {(vm.retentions.length ? vm.retentions.slice(0, 4) : [{ label: "Механики появятся после анализа", avg_score: 0, frequency: 0 }]).map((retention) => (
                <div className="rb-pattern" key={retention.label}><h3>{retention.label}</h3><p>оценка {compact(retention.avg_score)} · хуки {(retention.hooks || []).slice(0, 2).join(" · ")}</p></div>
              ))}
            </div>
            <div className="rb-card">
              <MiniIcon>D</MiniIcon>
              <h3 style={{ font: "600 24px/1.15 'Space Grotesk'", margin: "14px 0 12px" }}>Creative DNA</h3>
              {(vm.recipes.length ? vm.recipes.slice(0, 4) : [{ title: "DNA появится после Pattern Brain", hook: "waiting", format: "waiting", retention: "waiting" }]).map((recipe) => (
                <div className="rb-pattern" key={recipe.id || recipe.title}><h3>{recipe.hook} + {recipe.format}</h3><p>{recipe.retention} · OP {compact(recipe.op_score)}</p></div>
              ))}
            </div>
          </div>
          <div className="rb-card" style={{ marginTop: 16 }}>
            <div className="rb-overline" style={{ color: "#0891b2" }}>Strong combinations</div>
            <h3 style={{ font: "600 24px/1.15 'Space Grotesk'", margin: "9px 0 14px" }}>Какие связки уже можно масштабировать</h3>
            <div className="rb-three">
              {(vm.strongCombinations.length ? vm.strongCombinations.slice(0, 3) : [{ hook_label: "Ждём сильную связку", structure_label: "Pattern Brain", retention: [], op_score: 0, decision_label: "Watch", next_action: "Нужно больше разобранных и generator-ready паттернов.", evidence: { niches: 0, platforms: 0, references: 0 } }]).map((combo: JsonRecord) => (
                <div className="rb-pattern" key={combo.id || `${combo.hook_label}:${combo.structure_label}`}>
                  <div className="rb-pill">{combo.decision_label || combo.decision || "Watch"} · OP {compact(combo.op_score)}</div>
                  <h3 style={{ marginTop: 10 }}>{combo.hook_label} + {combo.structure_label}</h3>
                  <p>{(combo.retention || []).join(" · ") || "retention появится после пересборки"} · confidence {combo.confidence || "watch"}</p>
                  {(combo.audio_logic || []).length ? <p>Audio logic: {(combo.audio_logic || []).join(" · ")}</p> : null}
                  <p style={{ color: "#0f172a", fontWeight: 600 }}>{combo.user_summary || combo.next_action}</p>
                  {combo.audio_summary ? <p style={{ margin: 0, color: "#334155" }}>{combo.audio_summary}</p> : null}
                  <p>ниши {compact(combo.evidence?.niches)} · платформы {compact(combo.evidence?.platforms)} · references {compact(combo.evidence?.references)}</p>
                  {((combo.why_it_wins || []) as string[]).length ? (
                    <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                      {((combo.why_it_wins || []) as string[]).slice(0, 3).map((reason, index) => (
                        <p key={`why:${index}`} style={{ margin: 0, color: "#334155" }}>Почему это сильно: {reason}</p>
                      ))}
                    </div>
                  ) : null}
                  {((combo.watchouts || []) as string[]).length ? (
                    <div style={{ marginTop: 10, padding: 10, borderRadius: 12, background: "#fff7ed", border: "1px solid #fed7aa" }}>
                      {((combo.watchouts || []) as string[]).slice(0, 2).map((risk, index) => (
                        <p key={`risk:${index}`} style={{ margin: 0, color: "#9a3412" }}>На что смотреть: {risk}</p>
                      ))}
                    </div>
                  ) : null}
                  <p style={{ color: "#0f172a", fontWeight: 600, marginTop: 10 }}>{combo.next_action}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rb-two" style={{ marginTop: 16 }}>
            <div className="rb-card">
              <div className="rb-overline" style={{ color: "#0891b2" }}>Audio Brain</div>
              <h3 style={{ font: "600 24px/1.15 'Space Grotesk'", margin: "9px 0 14px" }}>Как мозг начинает понимать звук</h3>
              <div className="rb-three">
                <div className="rb-kpi">
                  <div className="label">Audio-ready</div>
                  <strong>{compact(vm.audioBrain.with_audio)}</strong>
                  <p>{compact(vm.audioBrain.with_audio_rate)}% от sampled corpus</p>
                </div>
                <div className="rb-kpi">
                  <div className="label">Transcript-ready</div>
                  <strong>{compact(vm.audioBrain.with_transcript)}</strong>
                  <p>{compact(vm.audioBrain.with_transcript_rate)}% с voice logic</p>
                </div>
                <div className="rb-kpi">
                  <div className="label">Статус</div>
                  <strong>{vm.audioBrain.status || "planned"}</strong>
                  <p>audio layer</p>
                </div>
              </div>
              <div className="rb-pattern" style={{ marginTop: 14 }}>
                <div className="rb-pill">{vm.audioBrain.status || "planned"}</div>
                <h3 style={{ marginTop: 10 }}>Звук перестаёт быть слепым пятном</h3>
                <p>{vm.audioBrain.next_step || "Сначала нужно накопить audio-ready корпус."}</p>
              </div>
            </div>
            <div className="rb-card">
              <div className="rb-overline" style={{ color: "#0891b2" }}>Winning audio mechanics</div>
              <h3 style={{ font: "600 24px/1.15 'Space Grotesk'", margin: "9px 0 14px" }}>Какие звуковые правила уже выглядят сильными</h3>
              {((vm.audioBrain.top_mechanics || []) as JsonRecord[]).length ? ((vm.audioBrain.top_mechanics || []) as JsonRecord[]).slice(0, 3).map((item, index) => (
                <div className="rb-pattern" key={item.key || index} style={{ marginTop: index ? 10 : 0 }}>
                  <div className="rb-pill">{item.decision_label || item.decision || "Watch"} · score {compact(item.score)}</div>
                  <h3 style={{ marginTop: 10 }}>{item.label}</h3>
                  <p>count {compact(item.count)} · views {compact(item.avg_views)} · virality {compact(item.avg_virality)}</p>
                  {((item.why_it_wins || []) as string[]).slice(0, 2).map((reason, reasonIndex) => (
                    <p key={`audio-why:${reasonIndex}`} style={{ margin: 0, color: "#334155" }}>Почему это сильно: {reason}</p>
                  ))}
                  <p style={{ color: "#0f172a", fontWeight: 600, marginTop: 10 }}>{item.next_action}</p>
                </div>
              )) : (
                <div className="rb-pattern">
                  <h3>Audio patterns появятся после первых extraction циклов</h3>
                  <p>Сейчас уже есть pipeline, осталось накопить больше audio-ready корпуса.</p>
                </div>
              )}
            </div>
          </div>
          <div className="rb-card" style={{ marginTop: 16 }}>
            <div className="rb-overline" style={{ color: "#0891b2" }}>Audio feature depth</div>
            <h3 style={{ font: "600 24px/1.15 'Space Grotesk'", margin: "9px 0 14px" }}>Насколько глубоко уже разобран звук</h3>
            <div className="rb-three">
              <div className="rb-kpi">
                <div className="label">Pause map</div>
                <strong>{compact(vm.audioBrain.feature_depth?.pause_map_ready)}</strong>
                <p>видео с картой пауз</p>
              </div>
              <div className="rb-kpi">
                <div className="label">Pacing</div>
                <strong>{compact(vm.audioBrain.feature_depth?.pacing_ready)}</strong>
                <p>видео с pacing-tier</p>
              </div>
              <div className="rb-kpi">
                <div className="label">Beat hint</div>
                <strong>{compact(vm.audioBrain.feature_depth?.beat_hint_ready)}</strong>
                <p>видео с rhythm hint</p>
              </div>
            </div>
          </div>
        </section>

        <section>
          <SectionTitle k="06 · Доказательность и лучшие паттерны" title="Любой референс превращается в creative brief" />
          <div className="rb-gate" style={{ marginBottom: 16 }}>
            {vm.gateCards.map(([key, label, value, text]) => (
              <div className="rb-gate-card" key={key}>
                <div className="rb-overline" style={{ color: "#0891b2" }}>{label}</div>
                <strong>{compact(value)}</strong>
                <p>{text}</p>
              </div>
            ))}
          </div>
          <div className="rb-brief-grid">
              {(vm.recipes.length ? vm.recipes.slice(0, 3) : [{ id: "empty", title: "Creative briefs ждут Pattern Brain", creative_brief: { hook: "Сначала нужно разобрать корпус.", retention_mechanic: "ожидание доказательства", product_fit: ["любой товар с proof-кадром"], second_by_second: [] }, op_score: 0 }]).map((recipe) => (
              <div className="rb-card rb-brief" key={recipe.id}>
                <div className="rb-pill">OP {compact(recipe.op_score)}</div>
                <h3 style={{ font: "600 24px/1.15 'Space Grotesk'", margin: "14px 0 12px" }}>{recipe.title}</h3>
                <div className="rb-brief-block"><b>Хук</b><p>{recipe.creative_brief?.hook || recipe.hook}</p></div>
                <div className="rb-brief-block"><b>Удержание</b><p>{recipe.creative_brief?.retention_mechanic || recipe.retention}</p></div>
                <div className="rb-brief-block"><b>Структура по секундам</b><p>{(recipe.creative_brief?.second_by_second || []).slice(0, 3).join(" ") || "0-2с хук, 2-8с доказательство, 8-15с payoff."}</p></div>
                <div className="rb-brief-block"><b>Visual recipe</b><p>{(recipe.creative_brief?.visual_recipe || []).slice(0, 2).join(" ") || "Крупный план, proof-кадр, текст только для смысла."}</p></div>
                <div className="rb-brief-block"><b>Audio strategy</b><p>{(recipe.creative_brief?.audio_strategy || ["Быстрый голосовой вход, чистый мобильный микс, музыка только как подложка."]).slice(0, 2).join(" ")}</p></div>
                <div className="rb-brief-block"><b>Товар / тема</b><p>{(recipe.creative_brief?.product_fit || recipe.niches || []).slice(0, 3).join(" · ")}</p></div>
                <div className="rb-brief-block"><b>Копируем механику</b><p>{(recipe.creative_brief?.copy_as_mechanic || ["темп", "структуру", "тип доказательства"]).slice(0, 2).join(" · ")}</p></div>
                <div style={{ marginTop: 14, padding: 12, borderRadius: 12, background: "#fef2f2", color: "#991b1b", fontSize: 13, fontWeight: 600 }}>Копируем механику, не копируем текст, музыку, персонажей и чужой монтаж.</div>
              </div>
            ))}
          </div>
          <div className="rb-detail-grid" style={{ marginTop: 16 }}>
            {(vm.patternDetails.length ? vm.patternDetails.slice(0, 4) : vm.recipes.slice(0, 4)).map((pattern: JsonRecord) => (
              <button type="button" className="rb-card rb-detail rb-click" key={pattern.id || pattern.title} onClick={() => setSelectedPattern(pattern)}>
                <div className="rb-pill">{pattern.quality_gate || "pattern"} · OP {compact(pattern.op_score)}</div>
                <h3 style={{ font: "700 24px/1.15 'Space Grotesk'", margin: "14px 0 10px" }}>{pattern.title}</h3>
                <div className="rb-three">
                  <div className="rb-brief-block"><b>Хук</b><p>{pattern.hook}</p></div>
                  <div className="rb-brief-block"><b>Формат</b><p>{pattern.format}</p></div>
                  <div className="rb-brief-block"><b>Удержание</b><p>{pattern.retention}</p></div>
                </div>
                <p style={{ color: "#64748b", lineHeight: 1.5, marginTop: 12 }}>Ниши: {(pattern.niches || []).join(", ") || "all"} · references {compact(pattern.examples_count)}</p>
                {(pattern.warnings || []).length ? (
                  <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", fontSize: 13, fontWeight: 700 }}>
                    {(pattern.warnings || []).join(" · ")}
                  </div>
                ) : null}
              </button>
            ))}
          </div>
          <div className="rb-card" style={{ marginTop: 16 }}>
            <div className="rb-overline" style={{ color: "#0891b2" }}>Evidence references</div>
            <div className="rb-three" style={{ marginTop: 14 }}>
              {(vm.refs.length ? vm.refs.slice(0, 3) : [{ hook_label: "Референсы появятся после пересборки", op_score: 0, views: 0, confidence: "watch", why_selected: "Пока используем агрегированные паттерны." }]).map((ref) => (
                <div className="rb-pattern" key={ref.reference_id || ref.url || ref.hook_label}>
                  <h3>{ref.hook_label || ref.hook_type || "reference"}</h3>
                  <p>{ref.why_selected || "Референс выбран по score/views; используем только механику."}</p>
                  <p>OP {compact(ref.op_score)} · views {compact(ref.views)} · {ref.confidence || "watch"}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rb-two">
          <div>
            <SectionTitle k="07 · Anti-Pattern Brain" title="Что НЕ надо масштабировать" />
            <div className="rb-card">
              {((vm.antiPattern.items || []).length ? vm.antiPattern.items : vm.blindSpots.map((spot, index) => ({ code: `risk_${index}`, label: `Риск ${index + 1}`, evidence: spot, action: "Держать как watch-сигнал до следующего прогона.", severity: "medium" }))).slice(0, 5).map((item: JsonRecord, index: number) => (
                <div className="rb-pattern" key={item.code || item.label} style={{ marginTop: index ? 10 : 0, borderColor: item.severity === "high" ? "#fecaca" : "#e2e8f0", background: item.severity === "high" ? "#fff1f2" : "#fff" }}>
                  <div className="rb-pill">{item.severity || "watch"}</div>
                  <h3 style={{ marginTop: 10 }}>{item.label}</h3>
                  <p>{item.evidence}</p>
                  <p><strong>Что делать:</strong> {item.action}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <SectionTitle k="08 · Discovery Brain" title="Как сборщик будет дешеветь" />
            <div className="rb-card">
              <div className="rb-pattern">
                <div className="rb-pill">{vm.discovery.ru_focus || "ru_focus"}</div>
                <h3 style={{ marginTop: 10 }}>{vm.discovery.next_policy || "Держать RU-фокус и масштабировать только источники с доказанным yield."}</h3>
              </div>
              {((vm.discovery.providers || []).length ? vm.discovery.providers : vm.sourceMap).slice(0, 4).map((provider: JsonRecord, index: number) => (
                <div className="rb-pattern" key={provider.provider || index} style={{ marginTop: 10 }}>
                  <div className="rb-pill">{provider.decision || "watch"} · score {compact(provider.discovery_score)}</div>
                  <h3 style={{ marginTop: 10 }}>{provider.provider || "unknown source"}</h3>
                  <p>{provider.reason || `analyzed ${compact(provider.analyzed)} · cost ${usd(provider.cost_per_analyzed)}`}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <SectionTitle k="08.5 · Слой решений" title="Что он уже может подсказать человеку" />
          <div className="rb-road">
            {vm.decisionCards.map((card) => (
              <div className="rb-road-card" key={card.title}>
                <h3>{card.title}</h3>
                <p>{card.value}</p>
                <span>{card.meta}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle k="08.7 · Автопилот и бюджет" title="Когда можно продолжать платный сбор" />
          <div className="rb-two">
            <div className="rb-card">
              <div className="rb-pill">{vm.autopilotActions.mode || "autopilot_waiting"} · paid {vm.autopilotActions.can_run_paid_collection ? "yes" : "no"}</div>
              <h3 style={{ font: "700 26px/1.1 'Space Grotesk'", margin: "14px 0" }}>Следующие действия сборщика</h3>
              {((vm.autopilotActions.actions || []) as JsonRecord[]).length ? ((vm.autopilotActions.actions || []) as JsonRecord[]).slice(0, 6).map((action, index) => (
                <div className="rb-pattern" key={`${action.type}:${action.provider || action.niche || index}`} style={{ marginTop: index ? 10 : 0 }}>
                  <div className="rb-pill">{action.priority || "medium"} · {action.type || "action"}</div>
                  <h3 style={{ marginTop: 10 }}>{action.action}</h3>
                  <p>{action.reason}</p>
                </div>
              )) : (
                <div className="rb-pattern">
                  <h3>Автопилот ждёт свежий economics-срез</h3>
                  <p>Как только появятся cost/yield события, он скажет: масштабировать, ограничить или остановить источник.</p>
                </div>
              )}
            </div>
            <div className="rb-card rb-dark">
              <div className="rb-overline rb-cyan">Cost governor</div>
              <h3 style={{ font: "700 30px/1.08 'Space Grotesk'", margin: "12px 0" }}>{vm.costGovernor.status || "waiting"}</h3>
              <p>Лимиты нужны, чтобы мозг не сжигал Apify просто ради объёма. Сбор идёт только если цена и качество сигнала проходят guard.</p>
              <div className="rb-three" style={{ marginTop: 16 }}>
                <div className="rb-dark-card"><div className="rb-overline rb-cyan">День</div><h3>{usd(vm.costGovernor.today_spend_usd)}</h3><p>из {usd(vm.costGovernor.max_daily_spend_usd)}</p></div>
                <div className="rb-dark-card"><div className="rb-overline rb-cyan">Полезное</div><h3>{usd(vm.costGovernor.current_useful_video_usd)}</h3><p>лимит {usd(vm.costGovernor.max_useful_video_usd)}</p></div>
                <div className="rb-dark-card"><div className="rb-overline rb-cyan">Источники</div><h3>{compact((vm.costGovernor.provider_limits || []).length)}</h3><p>с лимитами</p></div>
              </div>
              <div style={{ marginTop: 16 }}>
                {((vm.costGovernor.provider_limits || []) as JsonRecord[]).slice(0, 4).map((provider) => (
                  <div className="rb-dark-card" key={provider.provider} style={{ marginTop: 8 }}>
                    <div className="rb-pill">{provider.decision || "watch"} · max {compact(provider.max_next_runs)}</div>
                    <p style={{ marginTop: 8 }}>{provider.provider}: {provider.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section>
          <SectionTitle k="08.8 · Outcome Memory" title="Готовность учиться на наших публикациях" />
          <div className="rb-two">
            <div className="rb-card">
              <div className="rb-pill">{vm.outcomeMemory.status || "planned"} · live {compact(vm.outcomeMemory.rows_live)}</div>
              <h3 style={{ font: "700 26px/1.1 'Space Grotesk'", margin: "14px 0" }}>Схема market feedback уже готова</h3>
              <p>{vm.outcomeMemory.next_step || "Как только пойдут публикации, outcomes можно писать без перестройки мозга."}</p>
              <div className="rb-three" style={{ marginTop: 16 }}>
                <div className="rb-kpi">
                  <div className="label">High confidence</div>
                  <strong>{compact(vm.outcomeMemory.attach_targets?.high_confidence_patterns)}</strong>
                  <p>паттернов готовы принять outcome</p>
                </div>
                <div className="rb-kpi">
                  <div className="label">Medium confidence</div>
                  <strong>{compact(vm.outcomeMemory.attach_targets?.medium_confidence_patterns)}</strong>
                  <p>паттернов на следующую очередь</p>
                </div>
                <div className="rb-kpi">
                  <div className="label">Memory write</div>
                  <strong>{vm.outcomeMemory.attach_targets?.winner_memory_write || "waiting"}</strong>
                  <p>победители/проигравшие</p>
                </div>
              </div>
            </div>
            <div className="rb-card">
              <div className="rb-overline" style={{ color: "#0891b2" }}>Outcome schema</div>
              <h3 style={{ font: "600 24px/1.15 'Space Grotesk'", margin: "9px 0 14px" }}>Что именно надо писать в память</h3>
              <div className="rb-pattern">
                <p><strong>Required:</strong> {((vm.outcomeMemory.schema?.required_fields || []) as string[]).join(" · ") || "recipe_id · platform · views · posted_at"}</p>
                <p><strong>Recommended:</strong> {((vm.outcomeMemory.schema?.recommended_fields || []) as string[]).slice(0, 6).join(" · ") || "hook_rate · hold_rate · completion_rate · ctr_card · saves · revenue"}</p>
                <p><strong>Endpoints:</strong> {((vm.outcomeMemory.schema?.ingestion_endpoints || []) as string[]).join(" · ") || "/api/factory/post-metrics · /api/factory/reels-brain/feedback"}</p>
              </div>
            </div>
          </div>
        </section>

        <section>
          <SectionTitle k="08.9 · Learning Mission" title="Как добираем насмотренность до 10k" />
          <div className="rb-two">
            <div className="rb-card">
              <div className="rb-two" style={{ gridTemplateColumns: "1fr auto", gap: 16 }}>
                <div>
                  <div className="rb-overline" style={{ color: "#0891b2" }}>Standalone обучение</div>
                  <h3 style={{ font: "700 30px/1.08 'Space Grotesk'", margin: "10px 0" }}>
                    {compact(vm.mission.progress?.current || vm.totalVideos)} / {compact(vm.mission.progress?.target || 10000)} видео
                  </h3>
                  <p style={{ color: "#64748b", lineHeight: 1.5 }}>
                    Завод пока не трогаем: мозг учится отдельно, копит русскоязычную насмотренность и сам решает, когда анализировать backlog, а когда покупать новый сбор.
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="rb-pill">{vm.mission.stage?.stage_label || "learning corpus"}</div>
                  <div style={{ font: "700 36px/1 'Space Grotesk'", marginTop: 12 }}>{compact(vm.mission.progress?.progress_pct || 0)}%</div>
                </div>
              </div>
              <div className="rb-bar" style={{ marginTop: 18 }}>
                <i style={{ width: `${Math.max(3, Math.min(100, num(vm.mission.progress?.progress_pct)))}%` }} />
              </div>
              <div className="rb-three" style={{ marginTop: 16 }}>
                <div className="rb-kpi">
                  <div className="label">Backlog</div>
                  <strong>{compact(vm.mission.backlog?.total || Math.max(0, vm.totalVideos - vm.analyzed))}</strong>
                  <p>{vm.mission.backlog?.status === "analyze_first" ? "сначала анализируем" : "здоровый уровень"}</p>
                </div>
                <div className="rb-kpi">
                  <div className="label">ETA до 10k</div>
                  <strong>{compact(vm.mission.eta?.ticks_to_target || 0)}</strong>
                  <p>тиков при текущей скорости</p>
                </div>
                <div className="rb-kpi">
                  <div className="label">Guard</div>
                  <strong>{vm.mission.guard?.can_run_paid_collection ? "ON" : "WAIT"}</strong>
                  <p>{vm.mission.guard?.status || "watch"} · платный сбор {vm.mission.guard?.can_run_paid_collection ? "можно" : "пауза"}</p>
                </div>
              </div>
            </div>
            <div className="rb-card rb-dark">
              <div className="rb-overline rb-cyan">Следующий безопасный тик</div>
              <h3 style={{ font: "700 30px/1.08 'Space Grotesk'", margin: "12px 0" }}>{vm.mission.next_tick?.label || "Ждём свежий learning-plan"}</h3>
              <p>{vm.mission.next_tick?.reason || "Как только экономика и backlog обновятся, мозг выберет: analyze, smart bulk или rebuild patterns."}</p>
              <div className="rb-dark-card" style={{ marginTop: 16 }}>
                <div className="rb-pill">{vm.mission.next_tick?.task || "watch"} · paid {vm.mission.next_tick?.paid_collection ? "yes" : "no"}</div>
                <p style={{ marginTop: 10 }}>
                  Endpoint: {vm.mission.next_tick?.endpoint || "/api/factory/reels-brain/learning-plan"}
                </p>
              </div>
              <div className="rb-three" style={{ marginTop: 16 }}>
                <div className="rb-dark-card"><div className="rb-overline rb-cyan">Сбор / тик</div><h3>{compact(vm.mission.eta?.inserted_per_tick || 0)}</h3><p>новых видео</p></div>
                <div className="rb-dark-card"><div className="rb-overline rb-cyan">Анализ / тик</div><h3>{compact(vm.mission.eta?.analyzed_per_tick || 0)}</h3><p>в память</p></div>
                <div className="rb-dark-card"><div className="rb-overline rb-cyan">До чистого backlog</div><h3>{compact(vm.mission.eta?.ticks_to_clear_backlog || 0)}</h3><p>тиков</p></div>
              </div>
            </div>
          </div>
          <div className="rb-card" style={{ marginTop: 16 }}>
            <div className="rb-matrix">
              <div className="rb-matrix-head">Срез</div>
              <div className="rb-matrix-head">текущее</div>
              <div className="rb-matrix-head">цель</div>
              <div className="rb-matrix-head">осталось</div>
              <div className="rb-matrix-head">день</div>
              {((vm.mission.execution_plan?.by_platform || []) as JsonRecord[]).slice(0, 3).map((row) => (
                <div className="rb-matrix-row" key={`mission:${row.platform}`}>
                  <strong>{row.platform}</strong>
                  <span>{compact(row.current)}</span>
                  <span>{compact(row.target)}</span>
                  <span>{compact(row.gap)}</span>
                  <span>{compact(row.daily_required)}</span>
                </div>
              ))}
              {((vm.mission.execution_plan?.by_niche || []) as JsonRecord[]).slice(0, 3).map((row) => (
                <div className="rb-matrix-row" key={`mission:${row.niche}`}>
                  <strong>{NICHE_LABELS[row.niche] || row.niche}</strong>
                  <span>{compact(row.current)}</span>
                  <span>{compact(row.target)}</span>
                  <span>{compact(row.gap)}</span>
                  <span>{compact(row.daily_required)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <SectionTitle k="09 · Текущий цикл обучения" title="Что происходит от прогона к прогону" />
          <div className="rb-card">
            <div className="rb-three">
              {vm.timeline.length ? vm.timeline.slice(0, 6).map((run) => (
                <div className="rb-pattern" key={`${run.id || run.created_at}:${run.mode}`}>
                  <h3>{run.mode || "run"} · {new Date(run.created_at).toLocaleString("ru-RU")}</h3>
                  <p>+{compact(run.inserted)} видео · +{compact(run.analyzed)} память · {usd(run.usd_per_analyzed || run.usd_per_inserted)} / video</p>
                </div>
              )) : <div className="rb-pattern"><h3>История прогонов пока пустая</h3><p>После следующего worker tick здесь появится динамика.</p></div>}
            </div>
          </div>
        </section>

        <section>
          <SectionTitle k="10 · Следующие слои интеллекта" title="Куда растёт мозг дальше" />
          <div className="rb-layer-grid">
            {[
              ["Feedback Loop", vm.nextLayers.feedback_loop?.status, vm.nextLayers.feedback_loop?.next_step],
              ["Outcome Memory", vm.nextLayers.outcome_memory?.status, vm.nextLayers.outcome_memory?.next_step],
              ["Audio / Visual", vm.nextLayers.audio_visual_intelligence?.status, [vm.nextLayers.audio_visual_intelligence?.next_step, vm.audioVisualSummary].filter(Boolean).join(" ")],
              ["Audio Brain", vm.audioBrain.status, vm.audioBrain.next_step],
              ["Product Brain", vm.nextLayers.product_brain?.status, vm.nextLayers.product_brain?.next_step],
              ["Audience Brain", vm.nextLayers.audience_brain?.status, vm.nextLayers.audience_brain?.next_step],
              ["Experiment Brain", vm.nextLayers.experiment_brain?.status, vm.nextLayers.experiment_brain?.next_step],
              ["Portfolio Manager", vm.nextLayers.portfolio_manager?.status, vm.nextLayers.portfolio_manager?.next_step],
              ["Data Quality", vm.nextLayers.data_quality?.status, vm.nextLayers.data_quality?.next_step],
              ["Editing Brain", "planned", "Размечать zoom, cut density, pop text, freeze frame и speed ramp."],
            ].map(([item, status, text]) => (
              <div className="rb-layer" key={item}>
                <div className="rb-pill">{status || "planned"}</div>
                <h3>{item}</h3>
                <p>{text || "Слой будет усиливаться на текущей базе паттернов без показа лишних настроек пользователю."}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rb-three">
          {[
            ["Что он знает?", `${compact(vm.readyPatterns)} generator-ready паттернов и ${compact(vm.patterns)} общих структур.`],
            ["Можно ли доверять?", `Сейчас уверенность ${vm.tone.label}, score ${vm.score}%.`],
            ["Сколько стоит?", `${usd(vm.usefulCost)} за полезное видео в последнем срезе.`],
          ].map(([label, text]) => (
            <div className="rb-question" key={label}>
              <div>{label}</div>
              <p>{text}</p>
            </div>
          ))}
        </section>
          </div>
        </details>
      </div>

      {selectedPattern ? (
        <div className="rb-drawer-backdrop" role="dialog" aria-modal="true" onClick={() => setSelectedPattern(null)}>
          <aside className="rb-drawer" onClick={(event) => event.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start" }}>
              <div>
                <div className="rb-pill">{selectedPattern.quality_gate || "pattern"} · OP {compact(selectedPattern.op_score)}</div>
                <h2>{selectedPattern.title || "Паттерн Reels Brain"}</h2>
                <p style={{ color: "#64748b", lineHeight: 1.5, marginTop: -4 }}>Это creative brief из памяти: механику можно использовать, чужой текст/музыку/монтаж копировать нельзя.</p>
              </div>
              <button type="button" className="rb-close" onClick={() => setSelectedPattern(null)} aria-label="Закрыть">×</button>
            </div>

            <div className="rb-drawer-grid" style={{ marginTop: 20 }}>
              <div className="rb-brief-block"><b>Хук</b><p>{selectedPattern.creative_brief?.hook || selectedPattern.hook || "нет данных"}</p></div>
              <div className="rb-brief-block"><b>Механика удержания</b><p>{selectedPattern.creative_brief?.retention_mechanic || selectedPattern.retention || "нет данных"}</p></div>
              <div className="rb-brief-block"><b>Формат</b><p>{selectedPattern.format || "нет данных"}</p></div>
              <div className="rb-brief-block"><b>Подходит для</b><p>{(selectedPattern.creative_brief?.product_fit || selectedPattern.niches || []).slice(0, 5).join(" · ") || "нужна доразметка"}</p></div>
            </div>

            <div className="rb-brief-block" style={{ marginTop: 12 }}>
              <b>Структура по секундам</b>
              <p>{(selectedPattern.creative_brief?.second_by_second || []).join(" ") || "0-2с хук, 2-8с доказательство, 8-15с payoff/CTA."}</p>
            </div>
            <div className="rb-brief-block" style={{ marginTop: 12 }}>
              <b>Visual recipe</b>
              <p>{(selectedPattern.creative_brief?.visual_recipe || []).join(" ") || "Крупный план, proof-кадр, быстрые смены смысла, текст только как усилитель."}</p>
            </div>
            <div className="rb-brief-block" style={{ marginTop: 12 }}>
              <b>Audio strategy</b>
              <p>{(selectedPattern.creative_brief?.audio_strategy || ["Голос должен начинаться быстро, музыка только поддерживает смысл, без мёртвого интро."]).join(" ")}</p>
            </div>
            {(selectedPattern.audio_logic || []).length ? (
              <div className="rb-brief-block" style={{ marginTop: 12 }}>
                <b>Audio logic</b>
                <p>{(selectedPattern.audio_logic || []).join(" · ")}</p>
              </div>
            ) : null}
            <div className="rb-drawer-grid" style={{ marginTop: 12 }}>
              <div className="rb-brief-block"><b>Копируем как механику</b><p>{(selectedPattern.creative_brief?.copy_as_mechanic || ["темп", "структуру", "тип доказательства"]).join(" · ")}</p></div>
              <div className="rb-brief-block"><b>Запрещено копировать</b><p>{(selectedPattern.creative_brief?.do_not_copy || ["текст", "музыку", "персонажа", "монтаж один в один"]).join(" · ")}</p></div>
            </div>
            {(selectedPattern.warnings || []).length ? (
              <div style={{ marginTop: 12, padding: 14, borderRadius: 14, background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", fontWeight: 700 }}>
                {(selectedPattern.warnings || []).join(" · ")}
              </div>
            ) : null}
            <div className="rb-brief-block" style={{ marginTop: 12 }}>
              <b>Доказательства</b>
              <p>references {compact(selectedPattern.examples_count)} · платформы {(selectedPattern.platforms || []).join(" · ") || "mixed"} · ниши {(selectedPattern.niches || []).join(" · ") || "all"}</p>
            </div>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
