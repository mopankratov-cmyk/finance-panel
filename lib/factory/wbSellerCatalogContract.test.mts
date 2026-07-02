// Contract test for WB seller catalog (NORVIA cabinet export 02.07.2026).
// Run: npx tsx lib/factory/wbSellerCatalogContract.test.mts
import { readFileSync } from "node:fs";
import { ok, equal } from "node:assert/strict";
import { WB_SELLER_CATALOG, catalogEntryForArticle, contentFolderForSku, legacyArticleForSku } from "./wbSellerCatalog";
import { twinSourceForArticle } from "./twinSourceManifest";

// Полнота каталога: 36 курток + 24 ветровки, у всех валидные wbId.
equal(WB_SELLER_CATALOG.length, 60, "catalog has all 60 SKUs");
equal(WB_SELLER_CATALOG.filter((e) => e.category === "Куртки").length, 36, "36 jackets");
equal(WB_SELLER_CATALOG.filter((e) => e.category === "Ветровки").length, 24, "24 windbreakers");
ok(WB_SELLER_CATALOG.every((e) => e.wbId > 100000 && /^(NV|HT)-/.test(e.article)), "all entries have wbId and NV/HT article");

// Легаси-алиасы: канонические цвета наследуют короткие артикулы существующих твинов.
equal(legacyArticleForSku("NV-08-57"), "NV-08", "NV-08-57 (тёмно-зел) is legacy NV-08");
equal(legacyArticleForSku("NV-816-02"), "NV-816", "NV-816-02 (св-беж) is legacy NV-816");
equal(legacyArticleForSku("NV-08-48"), null, "non-canonical colors have no legacy alias");

// Манифест наследуется полными SKU канонических цветов.
ok(twinSourceForArticle("NV-08-57")?.path.includes("/КУЛИСА/темно-зелен/"), "manifest resolves for full canonical SKU");
ok(!twinSourceForArticle("NV-08-48"), "non-canonical SKU has no manifest — goes through catalog folder + screen");

// SKU → съёмочная папка цвета (точные имена папок, включая ведущие пробелы).
const dz = contentFolderForSku("NV-08-57");
ok(dz && "prefix" in dz && dz.prefix === "/КУЛИСА/темно-зелен", "NV-08-57 maps to темно-зелен folder");
const cap = contentFolderForSku("NV-08-48");
ok(cap && "prefix" in cap && cap.prefix === "/КУЛИСА/ капучино", "NV-08-48 maps to ' капучино' folder with leading space");
const sb = contentFolderForSku("NV-816-02");
ok(sb && "prefix" in sb && sb.prefix === "/ПОЯС/ св беж", "NV-816-02 maps to ' св беж'");
const wind = contentFolderForSku("HT-42-01");
ok(wind && "pending" in wind, "windbreakers are pending (ZIP not unpacked)");
const bezh836 = contentFolderForSku("NV-836-11");
ok(bezh836 && "prefix" in bezh836 && bezh836.prefix === "/КОКЕТКА/бежевый", "NV-836-11 maps to бежевый");
ok(catalogEntryForArticle("nv-01-58")?.wbId === 755558106, "article lookup case-insensitive");

// Сборка: каталожная ветка стоит между манифестом и слепым пикером.
const build = readFileSync("lib/factory/productTwinBuild.ts", "utf8");
ok(/contentFolderForSku\(article\)/.test(build), "build consults catalog color folder for full SKUs");
ok(/catalog_color_folder/.test(build), "catalog source is labeled in sourceKind");
ok(/нет контента:/.test(build), "pending content fails the build with a clear reason");

console.log("wbSellerCatalogContract: passed");
