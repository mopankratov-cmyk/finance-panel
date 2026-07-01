import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateBloggerSample } from "./bloggerEvaluation";
import { applyEvaluationToRegistry, listBloggerVariants, registrySummary } from "./bloggerRegistry";
import { RUSSIAN_HEYGEN_BLOGGERS } from "./ugcStoryboard";

const registrySource = readFileSync("lib/factory/bloggerRegistry.ts", "utf8");
const evaluationSource = readFileSync("lib/factory/bloggerEvaluation.ts", "utf8");
const registryRoute = readFileSync("app/api/factory/blogger-registry/route.ts", "utf8");
const evaluationRoute = readFileSync("app/api/factory/blogger-evaluation/route.ts", "utf8");

ok(/DEFAULT_BLOGGER_VARIANTS/.test(registrySource), "registry defines default blogger variants");
ok(/RUSSIAN_HEYGEN_BLOGGERS/.test(registrySource), "registry is grounded in current Russian bloggers");
ok(/living_blogger_v1/.test(evaluationSource), "evaluation has a stable scorecard version");
ok(/face_realism/.test(evaluationSource) && /repeatability_penalty/.test(evaluationSource), "evaluation rubric covers realism and repeatability");
ok(/listBloggerVariants/.test(registryRoute), "registry route exposes list helper");
ok(/evaluateBloggerSample/.test(evaluationRoute), "evaluation route uses the pure evaluator");
ok(!/getSupabaseAdmin|\.from\("/.test(registryRoute + evaluationRoute), "new endpoints stay detached from DB for now");

{
  const registry = listBloggerVariants();
  equal(registry.length, 3, "registry starts with 3 blogger variants");
  equal(registry[0].blogger_id, RUSSIAN_HEYGEN_BLOGGERS.katya.id, "Katya is present");
  equal(registrySummary(registry).active, 1, "one active variant by default");
}

{
  const evaluation = evaluateBloggerSample({
    blogger_id: RUSSIAN_HEYGEN_BLOGGERS.katya.id,
    variant_id: `${RUSSIAN_HEYGEN_BLOGGERS.katya.id}::base`,
    run_id: "run_katya_001",
    hook_type: "skeptic-stop",
    frame_type: "upper_body_room",
    motion_preset: "calm_direct",
    delivery_type: "confessional",
    face_duration_sec: 3,
    scores: {
      face_realism: 9,
      motion_realism: 9,
      lip_sync: 8,
      voice_naturalness: 8,
      room_authenticity: 9,
      anti_ai_first_2s: 9,
      repeatability_penalty: 2,
    },
  });
  equal(evaluation.summary_label, "promote", "strong scores promote the variant");
  ok(evaluation.weighted_score_100 >= 75, "weighted score is strong");
  ok(evaluation.anti_ai_score_100 >= 75, "anti-AI score is strong");

  const registry = applyEvaluationToRegistry(listBloggerVariants(), evaluation);
  const katya = registry.find((item) => item.blogger_id === RUSSIAN_HEYGEN_BLOGGERS.katya.id)!;
  equal(katya.status, "active", "registry keeps promoted Katya active");
  equal(katya.source_runs[0], "run_katya_001", "registry records source runs");
}

{
  const evaluation = evaluateBloggerSample({
    blogger_id: RUSSIAN_HEYGEN_BLOGGERS.alina.id,
    variant_id: `${RUSSIAN_HEYGEN_BLOGGERS.alina.id}::base`,
    run_id: "run_alina_001",
    face_duration_sec: 6,
    fail_reasons: ["same head turn every time", "too clean skin"],
    scores: {
      face_realism: 5,
      motion_realism: 4,
      lip_sync: 7,
      voice_naturalness: 6,
      room_authenticity: 7,
      anti_ai_first_2s: 5,
      repeatability_penalty: 9,
    },
  });
  equal(evaluation.summary_label, "rework", "weak and repetitive run goes to rework");
  ok(evaluation.warnings.some((item) => /preferred 2-4 second window/.test(item)), "long face duration produces a warning");
  ok(evaluation.recommendations.some((item) => /motion-only batch|variant family|Clamp talking-head/i.test(item)), "evaluation returns actionable recommendations");
}

console.log("bloggerRegistryContract: passed");
