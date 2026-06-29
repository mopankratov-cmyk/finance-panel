import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const helper = readFileSync("lib/factory/publications.ts", "utf8");
const graphRun = readFileSync("lib/factory/graphRun.ts", "utf8");
const postMetrics = readFileSync("app/api/factory/post-metrics/route.ts", "utf8");

ok(/export async function recordFactoryPublication/.test(helper), "factory publication helper exists");
ok(/factory_publications/.test(helper), "publication helper writes factory_publications");
ok(/latest_publication_id/.test(helper) && /distribution_status/.test(helper), "publication helper updates recipe pointer fail-open");
ok(/catch \{\s*\/\/ node_recipes migration columns are optional/.test(helper), "recipe pointer update is fail-open");

ok(/import \{ recordFactoryPublication \} from "\.\/publications"/.test(graphRun), "graph-run imports publication helper");
ok(/recordFactoryPublication\(db, \{[\s\S]*sourceUrl: catalogUrl \|\| url \|\| null[\s\S]*status: "draft"/.test(graphRun), "graph-run records final artifacts as draft publications");
ok(/if \(publication\.warning\) addWarning\(publication\.warning\)/.test(graphRun), "graph-run surfaces publication warnings without blocking");

ok(/import \{ recordFactoryPublication \} from "@\/lib\/factory\/publications"/.test(postMetrics), "post-metrics imports publication helper");
ok(/let publicationId: string \| null/.test(postMetrics), "post-metrics tracks publication id");
ok(/status: "published"/.test(postMetrics), "post-metrics marks metrics-bearing publications as published");
ok(/publication_id: publicationId/.test(postMetrics), "post-metrics writes publication_id");
ok(/return NextResponse\.json\(\{ ok: true[\s\S]*publication_id: publicationId/.test(postMetrics), "post-metrics returns publication id");

console.log("publicationLoopContract: passed");
