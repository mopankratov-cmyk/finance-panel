import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const helper = readFileSync("lib/factory/yandexArchive.ts", "utf8");
const route = readFileSync("app/api/factory/yandex-archive/route.ts", "utf8");
const doc = readFileSync("docs/factory-data-retention-map.md", "utf8");

ok(/YANDEX_DISK_OAUTH_TOKEN/.test(helper), "Yandex archive uses a dedicated disk OAuth env");
ok(/YANDEX_DISK_FACTORY_ARCHIVE_PATH/.test(helper), "Yandex archive supports configurable archive root");
ok(/function yandexClientUrl/.test(helper), "Yandex archive exposes a browser-openable Disk client URL");
ok(/client_url: yandexClientUrl\(\)/.test(helper), "Yandex archive reports the target folder client URL");
ok(/content_assets/.test(helper) && /\.eq\("disk", "gen"\)/.test(helper), "Yandex archive reads generated assets");
ok(/ARCHIVE_KINDS = \["video", "clip", "image"\]/.test(helper), "Yandex archive targets final videos, intermediate clips, and generated images");
ok(/\.in\("kind", ARCHIVE_KINDS\)/.test(helper), "Yandex archive scans all generated media kinds");
ok(/kind: row\.kind \|\| null/.test(helper), "Yandex archive reports each item kind");
ok(/apply = input\?\.apply === true/.test(helper), "Yandex archive requires explicit apply");
ok(/missing_token/.test(helper), "Yandex archive is fail-open when token is missing");
ok(/importUrlToYandex/.test(helper) && /url=/.test(helper), "Yandex archive asks Yandex Disk to import from Supabase URL");
ok(/AbortSignal\.timeout\(30000\)/.test(helper), "Yandex archive fails fast on broken source downloads");
ok(/JSON\.stringify\(part\)/.test(helper), "Yandex archive serializes object-shaped errors");
ok(/yandex_archive_url/.test(helper) && /yandex_archived_at/.test(helper), "Yandex archive records result in content_assets analysis");
ok(/yandex_archive_failed_at/.test(helper), "Yandex archive marks failed source rows");
ok(/archivedUrl\(row\) \|\| archiveFailed\(row\)/.test(helper), "Yandex archive skips archived and failed rows by default");
ok(!/delete\(\)/.test(helper), "Yandex archive never deletes Supabase rows");
ok(!/remove\(/.test(helper), "Yandex archive never removes Supabase storage");

ok(/isAuthorizedReelsBrainJobRequest/.test(route), "Yandex archive endpoint allows cron bearer and Studio session auth");
ok(/GET/.test(route) && /apply: false/.test(route), "Yandex archive GET is dry-run");
ok(/confirm"\) === "copy-to-yandex"/.test(route), "Yandex archive GET copy mode requires explicit confirmation token");
ok(/POST/.test(route) && /body\.apply === true/.test(route), "Yandex archive POST requires apply=true");
ok(/maxDuration = 300/.test(route), "Yandex archive gives video copies a larger server window");

ok(/Яндекс/.test(doc), "retention doc mentions Yandex archive handoff");

console.log("yandexArchiveContract: passed");
