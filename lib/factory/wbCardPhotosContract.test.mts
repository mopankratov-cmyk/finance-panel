// Contract test for WB card photo resolver. Run: npx tsx lib/factory/wbCardPhotosContract.test.mts
import { readFileSync } from "node:fs";
import { ok, equal } from "node:assert/strict";
import { wbCardPhotoUrls, hasWbCardPhotos } from "./wbCardPhotos";
import { WB_SELLER_CATALOG } from "./wbSellerCatalog";

// Все 60 каталожных SKU имеют фото карточки.
for (const e of WB_SELLER_CATALOG) ok(hasWbCardPhotos(e.article), `WB photos exist for ${e.article}`);
equal(WB_SELLER_CATALOG.filter((e) => hasWbCardPhotos(e.article)).length, 60, "all 60 SKUs have WB card photos");

// URL валидны, привязаны к артикулу, обложка идёт первой.
const nv = wbCardPhotoUrls("NV-08-57", 8);
ok(nv.length >= 3 && nv.length <= 8, "returns bounded candidate list");
ok(nv[0].endsWith("/755338637/images/big/1.webp"), "cover (photo 1) comes first, article-exact wbId");
ok(nv.every((u) => u.startsWith("https://") && u.includes("/755338637/")), "all urls point at the same article");
ok(wbCardPhotoUrls("nv-08-57", 1).length === 1, "article lookup case-insensitive");
equal(wbCardPhotoUrls("NOPE-99", 8).length, 0, "unknown article yields no photos");

// Порядок: обложка → края → середина (слайды размерной сетки/гарантии в конце очереди).
const ht = wbCardPhotoUrls("HT-80-22", 8); // count 30
ok(ht[0].endsWith("/1.webp") && ht[1].endsWith("/2.webp") && ht[2].endsWith("/3.webp"), "head is 1,2,3");
ok(ht.some((u) => u.endsWith("/30.webp")) || ht.some((u) => u.endsWith("/28.webp")), "tail frames included before mid slides");

// Сборка: WB-ветка стоит между манифестом и съёмочной папкой, отдаёт article-exact источник.
const build = readFileSync("lib/factory/productTwinBuild.ts", "utf8");
ok(/wbCardPhotoUrls\(article/.test(build), "build consults WB card photos");
ok(/wb_card_photo/.test(build), "WB source is labeled in sourceKind");
ok(/sharp\(raw\)\.png\(\)/.test(build), "WB webp is converted to png for pipeline compatibility");
ok(/screenTwinSourceCandidate\(\{ buffer: png/.test(build), "WB candidates pass the vision screen");
// WB-ветка (1.5) должна идти раньше съёмочной папки (2).
ok(build.indexOf("wbCardPhotoUrls(article") < build.indexOf("contentFolderForSku(article)"), "WB branch precedes shoot-folder branch");

console.log("wbCardPhotosContract: passed");
