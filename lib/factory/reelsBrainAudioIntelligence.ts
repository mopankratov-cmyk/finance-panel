import type { ReelsPatternMemoryBundle, ReelsPatternMemoryItem } from "./reelsBrainPatterns";
import { reelsPatternBrain } from "./reelsBrainCreativeBriefs";

export type AudioPattern = {
  id: string;
  niche: string;
  source_pattern_id: string;
  score: number;
  confidence: "high" | "medium" | "low";
  strategy: "voice_first" | "trend_sound_bed" | "tactile_unboxing" | "dramatic_reveal" | "proof_explainer";
  speech: {
    starts_immediately: boolean;
    suggested_speed: "calm" | "medium" | "fast";
    first_phrase_rule: string;
    pause_rules: string[];
  };
  music: {
    role: "low_bed" | "trend_driver" | "texture" | "impact";
    bpm_range: string;
    energy: "low" | "medium" | "high";
    sound_examples: string[];
  };
  edit_sync: {
    first_sound_event: string;
    cut_rhythm: string;
    beat_map_hint: string[];
  };
  best_for: string[];
  avoid: string[];
};

export type AudioIntelligence = {
  generated_at: string;
  total_patterns: number;
  patterns: AudioPattern[];
  top_sound_titles: {
    title: string;
    evidence_count: number;
    niches: string[];
    source_pattern_ids: string[];
  }[];
  strategy_mix: {
    strategy: AudioPattern["strategy"];
    count: number;
    avg_score: number;
  }[];
  editor_rules: string[];
  next_pipeline: {
    stage: string;
    status: "ready_now" | "needs_worker" | "planned";
    tool: string;
    output: string;
  }[];
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
}

function confidence(score: number): AudioPattern["confidence"] {
  if (score >= 78) return "high";
  if (score >= 58) return "medium";
  return "low";
}

function patternList(brain: ReelsPatternMemoryBundle | null): ReelsPatternMemoryItem[] {
  const meta = brain?.meta_brain;
  if (!meta) return [];
  const ready = Array.isArray(meta.generator_ready_patterns) ? meta.generator_ready_patterns : [];
  const all = Array.isArray(meta.patterns) ? meta.patterns : [];
  return (ready.length ? ready : all).filter(Boolean);
}

function audioScore(pattern: ReelsPatternMemoryItem): number {
  return Math.round(Math.min(100,
    num(pattern.strength_score) * 0.42
    + num(pattern.quality_score) * 0.24
    + num(pattern.relevance_score) * 0.18
    + Math.min(10, Math.log(num(pattern.frequency) + 1) * 5)
    + Math.min(6, (pattern.sounds || []).length * 2)
  ));
}

function strategyFor(pattern: ReelsPatternMemoryItem): AudioPattern["strategy"] {
  if (pattern.hook_type === "warning_pattern_break") return "voice_first";
  if (pattern.structure_type === "unboxing") return "tactile_unboxing";
  if (pattern.structure_type === "before_after" || pattern.retention_mechanism === "delayed_payoff") return "dramatic_reveal";
  if (pattern.hook_type === "direct_claim" || pattern.retention_mechanism === "proof_wait") return "proof_explainer";
  return "trend_sound_bed";
}

function speedFor(pattern: ReelsPatternMemoryItem): AudioPattern["speech"]["suggested_speed"] {
  if (pattern.retention_mechanism === "surprise_hold" || pattern.hook_type === "warning_pattern_break") return "fast";
  if (pattern.structure_type === "before_after") return "medium";
  return "medium";
}

function musicRole(strategy: AudioPattern["strategy"]): AudioPattern["music"]["role"] {
  if (strategy === "voice_first" || strategy === "proof_explainer") return "low_bed";
  if (strategy === "tactile_unboxing") return "texture";
  if (strategy === "dramatic_reveal") return "impact";
  return "trend_driver";
}

function bpmRange(strategy: AudioPattern["strategy"]): string {
  if (strategy === "voice_first" || strategy === "proof_explainer") return "90-120";
  if (strategy === "tactile_unboxing") return "100-130";
  if (strategy === "dramatic_reveal") return "115-145";
  return "120-150";
}

function energy(strategy: AudioPattern["strategy"]): AudioPattern["music"]["energy"] {
  if (strategy === "voice_first" || strategy === "proof_explainer") return "medium";
  if (strategy === "dramatic_reveal" || strategy === "trend_sound_bed") return "high";
  return "medium";
}

function firstPhraseRule(pattern: ReelsPatternMemoryItem): string {
  if (pattern.hook_type === "warning_pattern_break") return "Начать голосом в 0.0с: короткое предупреждение без музыкального интро.";
  if (pattern.hook_type === "curiosity_question") return "Начать с вопроса в первые 0.3с, без паузы перед речью.";
  if (pattern.hook_type === "list_promise") return "Сразу озвучить число/обещание списка, затем быстрый первый proof.";
  return "Голос или первый заметный звук должны появиться до 0.5с.";
}

function cutRhythm(pattern: ReelsPatternMemoryItem): string {
  if (pattern.retention_mechanism === "surprise_hold") return "cuts every 0.35-0.7 sec";
  if (pattern.structure_type === "before_after") return "hold proof frames 0.8-1.4 sec, reveal on beat/drop";
  if (pattern.structure_type === "unboxing") return "micro-cuts on tactile sounds every 0.5-0.9 sec";
  return "cuts every 0.5-1.0 sec";
}

function bestFor(niche: string, pattern: ReelsPatternMemoryItem): string[] {
  const base = [niche, pattern.structure_label || pattern.structure_type, pattern.hook_label || pattern.hook_type].filter(Boolean);
  if (pattern.structure_type === "unboxing") return [...base, "товары с упаковкой/текстурой/первым использованием"];
  if (pattern.structure_type === "before_after") return [...base, "товары с видимым результатом"];
  return [...base, "короткие UGC-демо и proof-ролики"];
}

function avoidFor(pattern: ReelsPatternMemoryItem): string[] {
  const out = new Set<string>();
  out.add("Не ставить длинное музыкальное интро до хука.");
  if (pattern.hook_type === "warning_pattern_break") out.add("Не перекрывать предупреждение громкой музыкой.");
  if (pattern.structure_type === "before_after") out.add("Не делать reveal без звукового акцента или заметной паузы перед ним.");
  if (pattern.quality_label !== "generator_ready") out.add("Не масштабировать аудио-рецепт без проверки на свежих референсах.");
  return Array.from(out);
}

function audioPattern(niche: string, pattern: ReelsPatternMemoryItem): AudioPattern {
  const strategy = strategyFor(pattern);
  const score = audioScore(pattern);
  return {
    id: `${niche}:${pattern.pattern_id}:audio`,
    niche,
    source_pattern_id: pattern.pattern_id,
    score,
    confidence: confidence(score),
    strategy,
    speech: {
      starts_immediately: true,
      suggested_speed: speedFor(pattern),
      first_phrase_rule: firstPhraseRule(pattern),
      pause_rules: [
        "0.0-0.5с: не оставлять тишину.",
        pattern.retention_mechanism === "delayed_payoff" ? "Перед payoff оставить микропаузу 0.2-0.4с." : "Паузы короче 0.3с до первого proof.",
      ],
    },
    music: {
      role: musicRole(strategy),
      bpm_range: bpmRange(strategy),
      energy: energy(strategy),
      sound_examples: (pattern.sounds || []).slice(0, 5),
    },
    edit_sync: {
      first_sound_event: strategy === "tactile_unboxing" ? "tactile pop / package sound" : "voice or impact sound before 0.5s",
      cut_rhythm: cutRhythm(pattern),
      beat_map_hint: [
        "0.00: hook voice/text starts",
        "0.30-0.70: first cut or proof frame",
        pattern.retention_mechanism === "delayed_payoff" ? "2.0-4.0: delayed reveal on beat/drop" : "1.0-2.0: second proof beat",
      ],
    },
    best_for: bestFor(niche, pattern),
    avoid: avoidFor(pattern),
  };
}

export function buildAudioIntelligenceFromPlaybooks(rows: { niche?: string; playbook?: unknown }[], limit = 80): AudioIntelligence {
  const patterns = rows.flatMap((row) => {
    const niche = row.niche || "default";
    const brain = reelsPatternBrain(row.playbook);
    return patternList(brain).map((pattern) => audioPattern(niche, pattern));
  }).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(200, limit)));

  const soundMap = new Map<string, AudioIntelligence["top_sound_titles"][number]>();
  for (const pattern of patterns) {
    for (const sound of pattern.music.sound_examples) {
      const id = slug(sound);
      const current = soundMap.get(id) || { title: sound, evidence_count: 0, niches: [], source_pattern_ids: [] };
      current.evidence_count += 1;
      if (!current.niches.includes(pattern.niche)) current.niches.push(pattern.niche);
      if (!current.source_pattern_ids.includes(pattern.source_pattern_id)) current.source_pattern_ids.push(pattern.source_pattern_id);
      soundMap.set(id, current);
    }
  }

  const strategyMap = new Map<AudioPattern["strategy"], { count: number; sum: number }>();
  for (const pattern of patterns) {
    const current = strategyMap.get(pattern.strategy) || { count: 0, sum: 0 };
    current.count += 1;
    current.sum += pattern.score;
    strategyMap.set(pattern.strategy, current);
  }

  return {
    generated_at: new Date().toISOString(),
    total_patterns: patterns.length,
    patterns,
    top_sound_titles: Array.from(soundMap.values()).sort((a, b) => b.evidence_count - a.evidence_count).slice(0, 30),
    strategy_mix: Array.from(strategyMap.entries()).map(([strategy, value]) => ({
      strategy,
      count: value.count,
      avg_score: Math.round(value.sum / Math.max(1, value.count)),
    })).sort((a, b) => b.avg_score - a.avg_score),
    editor_rules: [
      "В первых 0.5с должен быть голос, impact sound или читаемый hook-text без тишины.",
      "Музыка не должна перебивать смысл первого hook.",
      "Cut rhythm синхронизировать с proof-кадрами, а не резать ради резки.",
      "Для unboxing важны tactile pops; для before/after важен reveal beat.",
    ],
    next_pipeline: [
      { stage: "metadata_audio_memory", status: "ready_now", tool: "Pattern Brain + sound_title", output: "audio strategy, speech rules, edit sync hints" },
      { stage: "audio_extract", status: "needs_worker", tool: "FFmpeg", output: "audio.wav per reference" },
      { stage: "speech_to_text", status: "needs_worker", tool: "WhisperX", output: "word timings, pauses, speech speed" },
      { stage: "beat_features", status: "needs_worker", tool: "Librosa / Essentia", output: "BPM, beats, drops, energy, loudness" },
      { stage: "stem_separation", status: "planned", tool: "Demucs", output: "voice/music/drums/bass/effects layers" },
    ],
  };
}
