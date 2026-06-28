import { normalizeScenarioQualityInput } from "./scenarioQuality";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

{
  const normalized = normalizeScenarioQualityInput({
    article: "123",
    niche: "toys",
    target_platform: "Instagram",
    scenario: "Покажи, как игрушка спасает поездку",
    hooks: ["Не покупай это в дорогу, пока не проверишь"],
  });

  eq(normalized.target_platform, "instagram", "normalize: target platform propagated");
  eq(normalized.candidates[0]?.hook, "Не покупай это в дорогу, пока не проверишь", "normalize: single hook preserved");
}

console.log(`\nscenarioQuality: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
