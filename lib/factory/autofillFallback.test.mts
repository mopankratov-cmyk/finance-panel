import { equal, match } from "node:assert/strict";
import { buildAutofillFallbackAssignment } from "./autofillFallback";

const proof = buildAutofillFallbackAssignment({
  ordinal: 1,
  slot: "scene",
  node_type: "b_roll",
  tool: "disk_real",
  params: { role: "proof", duration_sec: 3 },
}, { available: ["disk_real", "shotstack"], article: "HT-42-01", niche: "clothing", mode: "audience" });

equal(proof.tool, "disk_real");
equal(proof.params.onscreen_text, "Как это выглядит вживую");
match(String(proof.prompt), /Черновик сцены proof/);

const cta = buildAutofillFallbackAssignment({
  ordinal: 2,
  slot: "payoff",
  node_type: "b_roll",
  params: { role: "cta" },
}, { available: ["disk_real"], article: "HT-42-01", niche: "clothing", mode: "sell" });

equal(cta.params.onscreen_text, "Арт. HT-42-01");

const hook = buildAutofillFallbackAssignment({
  ordinal: 3,
  slot: "hook",
  node_type: "b_roll",
  params: { role: "hook" },
}, { available: ["disk_real"], article: "", niche: "toys", mode: "audience" });

equal(hook.params.onscreen_text, "Что видно сразу");
console.log("autofillFallback: ok");
