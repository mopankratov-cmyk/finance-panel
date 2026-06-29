import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const html = readFileSync("public/inferno/studio.html", "utf8");

ok(/dataFootprint:null/.test(html), "Studio keeps archive diagnostics state for operator helpers");
ok(/yandexArchive:null/.test(html), "Studio keeps Yandex archive diagnostics state for operator helpers");
ok(/function refreshDataFootprint\(box\)/.test(html), "Studio still has a data footprint helper");
ok(/function refreshYandexArchive\(box\)/.test(html), "Studio still has a Yandex dry-run helper");
ok(/function runYandexArchive\(box\)/.test(html), "Studio still has an operator archive helper");
ok(/\/data-footprint/.test(html), "Studio helper can call data-footprint endpoint");
ok(/\/yandex-archive\?limit=10/.test(html), "Studio helper can call Yandex archive dry-run endpoint");
ok(/JSON\.stringify\(\{apply:true,limit:5\}\)/.test(html), "Studio archive helper remains capped to five media assets");
ok(/YANDEX_FACTORY_ARCHIVE_URL/.test(html) && /Яндекс\.Диск/.test(html), "Library screen links to the Yandex Disk archive");
ok(!/id:"data-archive-panel"/.test(html), "Library screen does not mount the storage/archive panel");
ok(!/aside\.appendChild\(archiveBox\)/.test(html), "Archive controls are not visible in the factory UI");

console.log("studioDataArchiveUiContract: passed");
