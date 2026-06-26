"use client";

import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  Database,
  ExternalLink,
  Loader2,
  Play,
  Radar,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
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
  structure_type: string;
  retention_mechanism: string;
  strength_score: number;
  frequency: number;
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
  log?: string[];
  analyze?: AnalyzeResponse;
  patterns?: PatternBuildResponse;
  error?: string;
};

const DEFAULT_NICHE = "toys";
const DEFAULT_QUERIES = [
  "водяной пистолет обзор",
  "детская игрушка распаковка",
  "бластер тест",
];

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

function percent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Math.round(Number(value) * 100)}%`;
}

function queriesFromText(value: string) {
  return Array.from(new Set(value.split("\n").map((x) => x.trim()).filter(Boolean))).slice(0, 12);
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

function formatMs(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const ms = Math.max(0, Math.round(Number(value)));
  if (ms < 1_000) return `${ms} ms`;
  return `${(ms / 1_000).toFixed(1)} s`;
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

  const availableProviders = Array.isArray(health?.available) ? health.available : [];
  const configuredCount = health?.providers?.filter((provider) => provider.configured).length || 0;
  const queries = queriesFromText(queriesText);
  const bakeOffSummary = bakeOff?.summary_by_provider || [];
  const corpusVideos = corpus?.videos || [];
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
        }),
      }));
      setBakeOff(data);
      if (persist) await loadCorpus(niche.trim() || DEFAULT_NICHE);
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
      });
      setSourceRunResult(data);
      await loadCorpus(activeNiche());
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
      });
      setAnalyzeResult(data);
      if (!analyzeDryRun) await loadCorpus(activeNiche());
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
      });
      setLoopResult(data);
      await loadCorpus(activeNiche());
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
          </div>
          <div className="grid min-w-72 grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur">
            <Metric label="Доступно" value={availableProviders.length} />
            <Metric label="Настроено" value={configuredCount} />
            <Metric label="В корпусе" value={corpus?.total || 0} />
          </div>
        </div>
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
                  max={1000}
                  value={patternLimit}
                  onChange={(e) => setPatternLimit(Math.min(1000, Math.max(10, Number(e.target.value) || 10)))}
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
                <div className="grid gap-2 sm:grid-cols-3">
                  <MetricCard label="Videos" value={patternResult.memory?.total_videos || patternResult.source_videos || 0} />
                  <MetricCard label="Analyzed" value={patternResult.memory?.analyzed_videos || 0} />
                  <MetricCard label="Patterns" value={patternResult.memory?.patterns?.length || 0} />
                </div>
                {(patternResult.memory?.patterns || []).slice(0, 4).map((pattern) => (
                  <div key={pattern.pattern_id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800">{`${pattern.hook_type} -> ${pattern.structure_type}`}</span>
                      <span className={`rounded-full border px-2 py-1 font-mono text-xs ${scoreTone(pattern.strength_score)}`}>
                        {compactNumber(pattern.strength_score)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      freq {compactNumber(pattern.frequency)} · {pattern.retention_mechanism}
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
