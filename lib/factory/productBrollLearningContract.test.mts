// Contract test for Product Twin b-roll learning loop. Run: npx tsx lib/factory/productBrollLearningContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const helper = readFileSync("lib/factory/productBrollLearning.ts", "utf8");
const batchRoute = readFileSync("app/api/factory/product-broll-batch/route.ts", "utf8");
const feedbackRoute = readFileSync("app/api/factory/product-broll-feedback/route.ts", "utf8");
const studio = readFileSync("app/inferno/product-twins/ProductTwinStudio.tsx", "utf8");

ok(/assessProductBrollSource/.test(helper), "learning helper exposes source gate");
ok(/PACKSHOT_KINDS/.test(helper) && /shadow_bg/.test(helper), "packshot backgrounds are treated separately from b-roll source views");
ok(/risk === "high"/.test(helper) && /quality < 0\.6/.test(helper), "risk and quality can block paid generation");
ok(/buildProductBrollExperimentPlan/.test(helper), "helper returns an experiment plan for the operator loop");

ok(/assessProductBrollSource/.test(batchRoute), "b-roll batch route evaluates source gate");
ok(/source_gate/.test(batchRoute) && /experiment_plan/.test(batchRoute), "batch responses expose gate and experiment plan");
ok(/status: 409/.test(batchRoute) && /product b-roll source is not ready for paid submit/.test(batchRoute), "paid submit is blocked before FAL when source is unsafe");
ok(/allow_packshot/.test(batchRoute), "operator smoke override is explicit");

ok(/isAuthorizedReelsBrainJobRequest/.test(feedbackRoute), "feedback route uses existing operator/session auth");
ok(/product_broll_feedback/.test(feedbackRoute) && /product_broll_learning/.test(feedbackRoute), "feedback route writes learning state into asset analysis");
ok(/cf_signals/.test(feedbackRoute) && /product_broll_feedback/.test(feedbackRoute), "feedback route emits best-effort learning signal");

ok(/\/api\/factory\/product-broll-feedback/.test(studio), "Studio can send human b-roll QA feedback");
ok(/ThumbsUp/.test(studio) && /ThumbsDown/.test(studio) && /XCircle/.test(studio), "Studio exposes compact QA controls");

console.log("productBrollLearningContract: passed");
