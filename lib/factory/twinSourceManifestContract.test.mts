// Contract test for twin source manifest + vision screen. Run: npx tsx lib/factory/twinSourceManifestContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";
import { TWIN_SOURCE_MANIFEST, isBannedTwinSourceName, twinSourceForArticle } from "./twinSourceManifest";

const build = readFileSync("lib/factory/productTwinBuild.ts", "utf8");
const screen = readFileSync("lib/factory/twinSourceScreen.ts", "utf8");

// Манифест покрывает все артикулы визуального аудита 2026-07-02.
const AUDITED = ["CLR00716", "CLR00715", "CLR001101", "CLR001102", "TT04101", "TT04102", "TT05101", "TT05102", "YYS0101", "NV-08", "NV-836", "NV-816", "NV-01"];
for (const article of AUDITED) ok(twinSourceForArticle(article), `manifest covers ${article}`);
ok(TWIN_SOURCE_MANIFEST.every((e) => e.blocked || e.path.startsWith("/")), "every non-blocked entry has an absolute source path");
ok(twinSourceForArticle("CLR00716")?.path.endsWith("/12.png"), "CLR00716 uses the audited clean front 12.png");
ok(twinSourceForArticle("TT04102")?.blocked === true, "TT04102 is blocked: no clean frame in the shoot");
ok(twinSourceForArticle("nv-01")?.article === "NV-01", "article lookup is case-insensitive");

// Запрещённые исходники: AI-рендеры чужого силуэта (из них твин выдумал длину/патч).
ok(isBannedTwinSourceName("NV-01", "/ОЛЬГА МАНЖЕТ/бежевый/IMG_1718.jpeg"), "NV-01 AI render IMG_1718 is banned");
ok(isBannedTwinSourceName("NV-01", "img_1720.JPEG".toLowerCase()) || isBannedTwinSourceName("NV-01", "IMG_1720.jpeg"), "ban match is name-based");
ok(!isBannedTwinSourceName("NV-01", "/ОЛЬГА МАНЖЕТ/бежевый/IMG_7165.JPG"), "manifest source itself is not banned");
ok(!isBannedTwinSourceName("CLR00716", "12.png"), "articles without ban list pass");

// Сборка: манифест в приоритете, пикер — fallback со скрином, blocked валит сборку с понятной ошибкой.
ok(/twinSourceForArticle\(article\)/.test(build), "build consults the manifest first");
ok(/manifest_source/.test(build), "manifest source is labeled in sourceKind");
ok(/нет чистого исходника для твина/.test(build), "blocked article fails the build with a clear error");
ok(/screenTwinSourceCandidate/.test(build) && /isBannedTwinSourceName/.test(build), "picker fallback candidates are screened and ban-checked");
ok(/все кандидаты пикера отклонены vision-скрином/.test(build), "build reports why all candidates were rejected");

// Скрин: fail-open без ключа, ловит вшитый текст и подозрение на рендер.
ok(/ANTHROPIC_API_KEY отсутствует/.test(screen), "screen is fail-open without key");
ok(/render_suspect/.test(screen) && /baked_text/.test(screen), "screen detects baked text and AI-render suspicion");

console.log("twinSourceManifestContract: passed");
