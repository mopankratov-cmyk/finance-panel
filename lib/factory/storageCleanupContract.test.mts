import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const helper = readFileSync("lib/factory/storageCleanup.ts", "utf8");
const route = readFileSync("app/api/factory/storage-cleanup/dry-run/route.ts", "utf8");
const releaseRoute = readFileSync("app/api/factory/storage-cleanup/release/route.ts", "utf8");
const orphanRoute = readFileSync("app/api/factory/storage-cleanup/orphans/route.ts", "utf8");
const studio = readFileSync("public/inferno/studio.html", "utf8");

ok(/export async function buildFactoryStorageCleanupDryRun/.test(helper), "storage cleanup dry-run helper exists");
ok(/destructive: false/.test(helper), "storage cleanup reports destructive=false");
ok(/apply: false/.test(helper), "storage cleanup reports apply=false");
ok(/content_assets/.test(helper), "storage cleanup reads content_assets references");
ok(/generation_history/.test(helper), "storage cleanup reads generation history references");
ok(/node_recipes/.test(helper), "storage cleanup reads recipe/run-plan references");
ok(/factory_publications/.test(helper), "storage cleanup reads publication references");
ok(/factory_ugc_jobs/.test(helper), "storage cleanup reads UGC job references");
ok(/"renders"/.test(helper), "storage cleanup scans render outputs");
ok(/orphan_candidate/.test(helper), "storage cleanup classifies orphan candidates");
ok(/isFileLikeStorageItem/.test(helper), "storage cleanup ignores storage pseudo-directories");
ok(/files_scanned/.test(helper), "storage cleanup reports real scanned files separately");
ok(/protected/.test(helper), "storage cleanup classifies protected references");
ok(/yandex_archived_release/.test(helper), "storage cleanup reports Yandex-archived files that can later release Supabase storage");
ok(/ready_for_storage_release/.test(helper), "storage cleanup marks release candidates only after Yandex archive metadata exists");
ok(/releaseYandexArchivedFactoryStorage/.test(helper), "storage cleanup can release only Yandex-archived storage files");
ok(/dryRun\.yandex_archived_release\?\.candidates/.test(helper), "release source is the safe Yandex-archived dry-run block");
ok(/limit: 2000/.test(helper), "release scans a broad asset window before applying batch limit");
ok(/bucket\.remove/.test(helper), "release removes storage objects");
ok(/supabase_storage_released_at/.test(helper), "release records storage release metadata");
ok(/ready: !!archivedAt && !!archivePath && !releasedAt/.test(helper), "already released assets are not released again");
ok(/ready_for_storage_release: !!storagePath && !!item && archive\.ready/.test(helper), "release requires a live storage object");
ok(/archiveAndReleaseStorageOnlyOrphans/.test(helper), "storage cleanup can archive and release storage-only orphans");
ok(/archivePublicUrlToYandex\(yandexPath, sourceUrl, \{ wait: true \}\)/.test(helper), "storage-only cleanup waits for Yandex import before delete");
ok(/storageOnlyArchivePath/.test(helper), "storage-only cleanup puts orphans under a dedicated archive path");
ok(!/from\("content_assets"\)\.delete/.test(helper), "storage cleanup helper never deletes content asset rows");

ok(/export async function GET/.test(route), "storage cleanup route exposes GET");
ok(!/export async function POST/.test(route), "storage cleanup route has no POST apply path");
ok(/isAuthorizedReelsBrainJobRequest/.test(route), "storage cleanup route allows cron bearer and Studio session auth");
ok(/Cache-Control/.test(route) && /no-store/.test(route), "storage cleanup response is not cached");

ok(/confirm"\) === "release-yandex-archived"/.test(releaseRoute), "release route requires explicit GET confirmation");
ok(/body\.confirm !== "release-yandex-archived"/.test(releaseRoute), "release route requires explicit POST confirmation");
ok(/releaseYandexArchivedFactoryStorage/.test(releaseRoute), "release route uses the safe archived release helper");
ok(/confirm"\) === "archive-release-storage-orphans"/.test(orphanRoute), "orphan route requires explicit GET confirmation");
ok(/body\.confirm !== "archive-release-storage-orphans"/.test(orphanRoute), "orphan route requires explicit POST confirmation");
ok(/archiveAndReleaseStorageOnlyOrphans/.test(orphanRoute), "orphan route uses archive-before-delete helper");

ok(/storageCleanup:null/.test(studio), "Studio tracks storage cleanup dry-run");
ok(/function refreshStorageCleanup\(box\)/.test(studio), "Studio can refresh storage cleanup dry-run");
ok(/\/storage-cleanup\/dry-run\?limit=500&storage_limit=1000/.test(studio), "Studio calls storage cleanup dry-run");
ok(/Cleanup dry-run/.test(studio), "Studio surfaces cleanup dry-run button");
ok(!/DELETE_FACTORY_ORPHANS/.test(studio), "Studio does not expose destructive cleanup confirmation");

console.log("storageCleanupContract: passed");
