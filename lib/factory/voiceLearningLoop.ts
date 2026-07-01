export type VoiceProvider = "yandex" | "minimax" | "seed_audio" | "heygen" | "elevenlabs" | "cartesia" | "lmnt";

export type VoiceCandidate = {
  id: string;
  provider: VoiceProvider;
  voice: string;
  speed?: number;
  emotion?: string;
  mode?: "plain" | "ssml" | "segments" | "postprocessed";
  textVariant?: string;
  file?: string;
};

export type VoiceRating = {
  candidateId: string;
  naturalness: number;
  pronunciation: number;
  emotion: number;
  ugcBelievability: number;
  syntheticPenalty: number;
  notes?: string;
};

export type VoiceScoredCandidate = VoiceCandidate & {
  rating: VoiceRating;
  score: number;
  verdict: "winner" | "iterate" | "reject";
};

export type VoiceNextBatchPlan = {
  anchor: VoiceScoredCandidate | null;
  candidates: VoiceCandidate[];
  rules: string[];
};

export type VoiceTelegramSelection = {
  batchId: string | null;
  selectedIndexes: number[];
  selectedCandidateIds: string[];
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10, value));
}

export function scoreVoiceRating(rating: VoiceRating): number {
  const naturalness = clampScore(rating.naturalness);
  const pronunciation = clampScore(rating.pronunciation);
  const emotion = clampScore(rating.emotion);
  const ugc = clampScore(rating.ugcBelievability);
  const penalty = clampScore(rating.syntheticPenalty);

  return Number((
    naturalness * 0.32 +
    pronunciation * 0.2 +
    emotion * 0.18 +
    ugc * 0.3 -
    penalty * 0.28
  ).toFixed(2));
}

export function rankVoiceCandidates(
  candidates: VoiceCandidate[],
  ratings: VoiceRating[],
): VoiceScoredCandidate[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return ratings
    .map((rating) => {
      const candidate = byId.get(rating.candidateId);
      if (!candidate) return null;
      const score = scoreVoiceRating(rating);
      const verdict = score >= 7.6 && rating.syntheticPenalty <= 3
        ? "winner"
        : score >= 5.8 && rating.syntheticPenalty <= 5
          ? "iterate"
          : "reject";
      return { ...candidate, rating, score, verdict } satisfies VoiceScoredCandidate;
    })
    .filter((candidate): candidate is VoiceScoredCandidate => !!candidate)
    .sort((a, b) => b.score - a.score);
}

export function proposeNextVoiceBatch(scored: VoiceScoredCandidate[]): VoiceNextBatchPlan {
  const anchor = scored.find((candidate) => candidate.verdict !== "reject") || null;
  if (!anchor) {
    return {
      anchor: null,
      candidates: [],
      rules: [
        "No usable anchor: switch provider or voice family before spending more generations.",
        "Keep script short and remove product/brand words that caused pronunciation issues.",
      ],
    };
  }

  const baseSpeed = anchor.speed || 0.88;
  const speeds = [
    Math.max(0.82, Number((baseSpeed - 0.02).toFixed(2))),
    baseSpeed,
    Math.min(0.96, Number((baseSpeed + 0.02).toFixed(2))),
  ];

  const candidates: VoiceCandidate[] = [
    ...speeds.map((speed) => ({
      id: `${anchor.provider}_${anchor.voice}_${String(speed).replace(".", "")}_segments`,
      provider: anchor.provider,
      voice: anchor.voice,
      speed,
      emotion: anchor.emotion,
      mode: "segments" as const,
      textVariant: "short_spoken_phrases",
    })),
    {
      id: `${anchor.provider}_${anchor.voice}_${String(baseSpeed).replace(".", "")}_ssml_breath`,
      provider: anchor.provider,
      voice: anchor.voice,
      speed: baseSpeed,
      emotion: anchor.emotion,
      mode: "ssml",
      textVariant: "breath_pauses",
    },
    {
      id: `${anchor.provider}_${anchor.voice}_${String(baseSpeed).replace(".", "")}_postprocessed`,
      provider: anchor.provider,
      voice: anchor.voice,
      speed: baseSpeed,
      emotion: anchor.emotion,
      mode: "postprocessed",
      textVariant: anchor.textVariant || "winner_text",
    },
  ];

  return {
    anchor,
    candidates,
    rules: [
      "Only vary one major axis per batch: speed, pauses, text rewrite, or post-processing.",
      "Prefer segmented synthesis when syntheticPenalty is the main problem.",
      "Reject any candidate with pronunciation below 7 even if it sounds emotional.",
      "Promote a voice only after it survives one HeyGen lip-sync smoke.",
    ],
  };
}

export function parseVoiceTelegramSelection(text: string, context = ""): VoiceTelegramSelection {
  const raw = String(text || "").trim();
  const ctx = String(context || "");
  const batchId = (ctx.match(/#voicebatch_([A-Za-z0-9_-]+)/) || raw.match(/#voicebatch_([A-Za-z0-9_-]+)/))?.[1] || null;

  const selectedIndexes = Array.from(new Set(
    Array.from(raw.matchAll(/(?:^|[\s,;])#?v?(\d{1,2})(?=$|[\s,;])/gi))
      .map((match) => Number(match[1]))
      .filter((value) => Number.isInteger(value) && value > 0 && value <= 20),
  ));

  const selectedCandidateIds = selectedIndexes
    .map((index) => {
      const byIndex = new RegExp(`(?:^|\\n)\\s*(?:${index}[.)]|#v${index})\\s+([^\\n]+)`, "i");
      const match = ctx.match(byIndex);
      if (!match) return "";
      return match[1]
        .replace(/—.*$/, "")
        .replace(/\s+#.*$/, "")
        .trim();
    })
    .filter(Boolean);

  return { batchId, selectedIndexes, selectedCandidateIds };
}
