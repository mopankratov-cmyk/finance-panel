import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const helper = readFileSync("lib/factory/dataFootprint.ts", "utf8");
const route = readFileSync("app/api/factory/data-footprint/route.ts", "utf8");
const doc = readFileSync("docs/factory-data-retention-map.md", "utf8");

ok(/export async function loadFactoryDataFootprint/.test(helper), "data footprint helper exists");
ok(/destructive: false/.test(helper), "data footprint is explicitly read-only");
ok(/FACTORY_DATA_TABLES/.test(helper), "data footprint declares table map");
ok(/content_assets/.test(helper) && /generation_history/.test(helper), "data footprint covers video bank and lineage");
ok(/viral_videos/.test(helper) && /viral_hooks/.test(helper), "data footprint covers Reels Brain memory");
ok(/factory_publications/.test(helper) && /post_metrics/.test(helper), "data footprint covers publication feedback loop");
ok(/factory-media/.test(helper), "data footprint samples factory-media storage");
ok(/never_delete_without_backup/.test(helper), "data footprint exposes protected data classes");
ok(/JSON\.stringify\(part\)/.test(helper), "data footprint serializes object-shaped Supabase error parts");
ok(!/String\(\(error as \{ message\?: unknown \} \| null\)\?\.message \|\| error/.test(helper), "data footprint avoids [object Object] warning strings");

ok(/isAuthorizedReelsBrainJobRequest/.test(route), "data-footprint endpoint allows cron bearer and Studio session auth");
ok(/loadFactoryDataFootprint\(db\)/.test(route), "data-footprint route calls the helper");
ok(/Cache-Control/.test(route) && /no-store/.test(route), "data-footprint response is not cached");

ok(/Read-only audit/.test(doc), "retention doc explains read-only audit");
ok(/Reference graph/.test(doc), "retention doc requires URL reference graph before cleanup");
ok(/Что нельзя удалять/.test(doc), "retention doc names protected data");
ok(/dry-run/.test(doc), "retention doc requires dry-run before deletion");

console.log("dataFootprintContract: passed");
