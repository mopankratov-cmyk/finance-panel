import { strict as assert } from "node:assert";
import {
  parseVoiceTelegramSelection,
  proposeNextVoiceBatch,
  rankVoiceCandidates,
  scoreVoiceRating,
  type VoiceCandidate,
  type VoiceRating,
} from "./voiceLearningLoop";

const candidates: VoiceCandidate[] = [
  { id: "alena_ssml_088", provider: "yandex", voice: "alena", speed: 0.88, emotion: "good", mode: "ssml" },
  { id: "jane_ssml_088", provider: "yandex", voice: "jane", speed: 0.88, emotion: "good", mode: "ssml" },
  { id: "seed_bad", provider: "seed_audio", voice: "default", mode: "plain" },
];

const ratings: VoiceRating[] = [
  { candidateId: "alena_ssml_088", naturalness: 9, pronunciation: 9, emotion: 8, ugcBelievability: 9, syntheticPenalty: 2 },
  { candidateId: "jane_ssml_088", naturalness: 7, pronunciation: 8, emotion: 7, ugcBelievability: 7, syntheticPenalty: 5 },
  { candidateId: "seed_bad", naturalness: 6, pronunciation: 4, emotion: 8, ugcBelievability: 5, syntheticPenalty: 7 },
];

assert.equal(scoreVoiceRating(ratings[0]) > scoreVoiceRating(ratings[2]), true);

const ranked = rankVoiceCandidates(candidates, ratings);
assert.equal(ranked[0].id, "alena_ssml_088");
assert.equal(ranked[0].verdict, "winner");
assert.equal(ranked.at(-1)?.verdict, "reject");

const next = proposeNextVoiceBatch(ranked);
assert.equal(next.anchor?.id, "alena_ssml_088");
assert.equal(next.candidates.length, 5);
assert.equal(next.candidates.some((candidate) => candidate.mode === "segments"), true);
assert.equal(next.candidates.some((candidate) => candidate.mode === "postprocessed"), true);

const allRejected = proposeNextVoiceBatch(ranked.filter((candidate) => candidate.verdict === "reject"));
assert.equal(allRejected.anchor, null);
assert.equal(allRejected.candidates.length, 0);

const selection = parseVoiceTelegramSelection("1, 3", "#voicebatch_yandex088\n1. alena_088_ssml_breath — score 7.8\n2. jane_088_ssml_breath\n3. marina_088_segments");
assert.deepEqual(selection.selectedIndexes, [1, 3]);
assert.deepEqual(selection.selectedCandidateIds, ["alena_088_ssml_breath", "marina_088_segments"]);
assert.equal(selection.batchId, "yandex088");

console.log("voiceLearningLoop contract ok");
