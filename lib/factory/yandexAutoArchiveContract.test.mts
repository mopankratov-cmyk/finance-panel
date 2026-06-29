import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const helper = readFileSync("lib/factory/yandexArchive.ts", "utf8");
const genSave = readFileSync("app/api/factory/gen-save/route.ts", "utf8");
const graphRun = readFileSync("lib/factory/graphRun.ts", "utf8");

ok(/export async function archiveContentAssetToYandex/.test(helper), "Yandex archive exposes a reusable content-asset auto archive helper");
ok(/yandex_archive_auto_error/.test(helper), "auto archive errors are stored separately from manual archive failures");
const autoArchiveHelper = helper.slice(helper.indexOf("export async function archiveContentAssetToYandex"), helper.indexOf("async function loadCandidateRows"));
ok(!/yandex_archive_failed_at/.test(autoArchiveHelper), "auto archive does not poison manual retry eligibility");

ok(/import \{ archiveContentAssetToYandex \} from "@\/lib\/factory\/yandexArchive";/.test(genSave), "gen-save imports Yandex auto archive helper");
ok(/const autoArchiveAsset = async/.test(genSave), "gen-save wraps Yandex upload as fail-open metadata work");
ok(/factory_gen_save_auto_yandex_v1/.test(genSave), "gen-save auto archives final generated videos");
ok(/factory_gen_save_carousel_auto_yandex_v1/.test(genSave), "gen-save auto archives generated carousel images");
ok(/factory_gen_save_dedupe_auto_yandex_v1/.test(genSave), "gen-save also backfills dedupe hits to Yandex");
ok(/yandex_archive: yandexArchive\.status/.test(genSave), "gen-save surfaces non-blocking Yandex archive status");

ok(/import \{ archiveContentAssetToYandex \} from "\.\/yandexArchive";/.test(graphRun), "graph-run imports Yandex auto archive helper");
ok(/factory_clip_library_auto_yandex_v1/.test(graphRun), "intermediate generated clips are copied to Yandex");
ok(/factory_direct_catalog_auto_yandex_v1/.test(graphRun), "direct-catalog generated videos are copied to Yandex");

console.log("yandexAutoArchiveContract: passed");
