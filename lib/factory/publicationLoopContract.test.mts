import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const helper = readFileSync("lib/factory/publications.ts", "utf8");
const graphRun = readFileSync("lib/factory/graphRun.ts", "utf8");
const postMetrics = readFileSync("app/api/factory/post-metrics/route.ts", "utf8");

ok(/export async function recordFactoryPublication/.test(helper), "factory publication helper exists");
ok(/factory_publications/.test(helper), "publication helper writes factory_publications");
ok(/latest_publication_id/.test(helper) && /distribution_status/.test(helper), "publication helper updates recipe pointer fail-open");
ok(/catch \{\s*\/\/ node_recipes migration columns are optional/.test(helper), "recipe pointer update is fail-open");
ok(/function isMissingOptionalPublicationTable/.test(helper), "publication helper detects missing optional publication table");
ok(/return \{ id: null, status, warning: null \}/.test(helper), "missing publication table is silent fail-open");

ok(/import \{ recordFactoryPublication \} from "\.\/publications"/.test(graphRun), "graph-run imports publication helper");
ok(/recordFactoryPublication\(db, \{[\s\S]*sourceUrl: catalogUrl \|\| url \|\| null[\s\S]*status: "draft"/.test(graphRun), "graph-run records final artifacts as draft publications");
ok(/if \(publication\.warning\) addWarning\(publication\.warning\)/.test(graphRun), "graph-run surfaces publication warnings without blocking");

ok(/import \{ recordFactoryPublication \} from "@\/lib\/factory\/publications"/.test(postMetrics), "post-metrics imports publication helper");
ok(/let publicationId: string \| null/.test(postMetrics), "post-metrics tracks publication id");
ok(/status: "published"/.test(postMetrics), "post-metrics marks metrics-bearing publications as published");
ok(/publication_id: publicationId/.test(postMetrics), "post-metrics writes publication_id");
ok(/const measurementId = String\(b\.measurement_id \|\| ""\)\.trim\(\)/.test(postMetrics), "post-metrics reads measurement id from payload");
ok(/const validationTaskId = String\(b\.validation_task_id \|\| b\.task_id \|\| ""\)\.trim\(\)/.test(postMetrics), "post-metrics reads validation task id from payload");
ok(/const proofScope = String\(b\.proof_scope \|\| ""\)\.trim\(\)/.test(postMetrics), "post-metrics reads proof scope from payload");
ok(/measurement_id: measurementId/.test(postMetrics), "post-metrics forwards measurement id into publication metadata");
ok(/validation_task_id: validationTaskId/.test(postMetrics), "post-metrics forwards validation task id into publication metadata");
ok(/proof_scope: proofScope/.test(postMetrics), "post-metrics forwards proof scope into publication metadata");
ok(/raw_metrics:\s*\{[\s\S]*measurement_id: measurementId[\s\S]*validation_task_id: validationTaskId[\s\S]*proof_scope: proofScope[\s\S]*\}/.test(postMetrics), "post-metrics stores validation traceability inside raw_metrics");
ok(/return NextResponse\.json\(\{ ok: true[\s\S]*publication_id: publicationId/.test(postMetrics), "post-metrics returns publication id");

console.log("publicationLoopContract: passed");
