import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const helper = readFileSync("lib/factory/storageCleanup.ts", "utf8");
const route = readFileSync("app/api/factory/storage-cleanup/dry-run/route.ts", "utf8");
const studio = readFileSync("public/inferno/studio.html", "utf8");

ok(/export async function buildFactoryStorageCleanupDryRun/.test(helper), "storage cleanup dry-run helper exists");
ok(/destructive: false/.test(helper), "storage cleanup reports destructive=false");
ok(/apply: false/.test(helper), "storage cleanup reports apply=false");
ok(/content_assets/.test(helper), "storage cleanup reads content_assets references");
ok(/generation_history/.test(helper), "storage cleanup reads generation history references");
ok(/node_recipes/.test(helper), "storage cleanup reads recipe/run-plan references");
ok(/factory_publications/.test(helper), "storage cleanup reads publication references");
ok(/factory_ugc_jobs/.test(helper), "storage cleanup reads UGC job references");
ok(/orphan_candidate/.test(helper), "storage cleanup classifies orphan candidates");
ok(/protected/.test(helper), "storage cleanup classifies protected references");
ok(/yandex_archived_release/.test(helper), "storage cleanup reports Yandex-archived files that can later release Supabase storage");
ok(/ready_for_storage_release/.test(helper), "storage cleanup marks release candidates only after Yandex archive metadata exists");
ok(!/\.delete\(/.test(helper), "storage cleanup helper never deletes DB rows");
ok(!/\.remove\(/.test(helper), "storage cleanup helper never removes storage files");

ok(/export async function GET/.test(route), "storage cleanup route exposes GET");
ok(!/export async function POST/.test(route), "storage cleanup route has no POST apply path");
ok(/isAuthorizedReelsBrainJobRequest/.test(route), "storage cleanup route allows cron bearer and Studio session auth");
ok(/Cache-Control/.test(route) && /no-store/.test(route), "storage cleanup response is not cached");

ok(/storageCleanup:null/.test(studio), "Studio tracks storage cleanup dry-run");
ok(/function refreshStorageCleanup\(box\)/.test(studio), "Studio can refresh storage cleanup dry-run");
ok(/\/storage-cleanup\/dry-run\?limit=500&storage_limit=1000/.test(studio), "Studio calls storage cleanup dry-run");
ok(/Cleanup dry-run/.test(studio), "Studio surfaces cleanup dry-run button");
ok(!/DELETE_FACTORY_ORPHANS/.test(studio), "Studio does not expose destructive cleanup confirmation");

console.log("storageCleanupContract: passed");
