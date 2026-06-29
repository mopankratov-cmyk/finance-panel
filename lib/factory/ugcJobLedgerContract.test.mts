import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const helper = readFileSync("lib/factory/ugcJobs.ts", "utf8");
const graphRun = readFileSync("lib/factory/graphRun.ts", "utf8");
const submitRoute = readFileSync("app/api/factory/ugc-creatify/route.ts", "utf8");
const renderRoute = readFileSync("app/api/factory/ugc-creatify-render/[id]/route.ts", "utf8");
const statusRoute = readFileSync("app/api/factory/ugc-creatify-status/[id]/route.ts", "utf8");

ok(/export async function recordUgcJob/.test(helper), "UGC job helper exists");
ok(/factory_ugc_jobs/.test(helper), "UGC job helper writes factory_ugc_jobs");
ok(/onConflict: "idempotency_key"/.test(helper), "UGC job helper is idempotent");
ok(/export async function checkPersonaConsent/.test(helper), "persona consent helper exists");
ok(/consent_status"\)[\s\S]*revoked/.test(helper), "persona consent blocks revoked personas");
ok(/persona consent unknown; render allowed fail-open/.test(helper), "unknown persona consent is fail-open");

ok(/checkPersonaConsent\(db/.test(graphRun), "graph-run checks creatify persona consent before submit");
ok(/dlqCategory: "consent"/.test(graphRun), "graph-run records consent blocks in UGC DLQ");
ok(/recordUgcJob\(db, \{[\s\S]*source: "graph_run_submit"/.test(graphRun), "graph-run records creatify submits");
ok(/recordUgcJob\(db, \{[\s\S]*source: "graph_run_poll"/.test(graphRun), "graph-run records creatify poll outcomes");

ok(/checkPersonaConsent\(db, avatar/.test(submitRoute), "manual UGC submit checks persona consent");
ok(/ugc_job_id/.test(submitRoute), "manual UGC submit returns ugc_job_id");
ok(/recordUgcJob\(getSupabaseAdmin\(\)/.test(renderRoute), "render route records UGC render status");
ok(/recordUgcJob\(getSupabaseAdmin\(\)/.test(statusRoute), "status route records UGC provider status");
ok(/outputUrl: s\.videoUrl/.test(statusRoute), "status route stores done video URL");

console.log("ugcJobLedgerContract: passed");
