// Product Twin preview URL contract. Run: npx tsx lib/factory/productTwinPreviewContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const helper = readFileSync("lib/factory/productTwinPreview.ts", "utf8");
const previewRoute = readFileSync("app/api/factory/product-twin/asset-preview/route.ts", "utf8");
const byArticle = readFileSync("app/api/factory/product-twin/by-article/[article]/route.ts", "utf8");
const byId = readFileSync("app/api/factory/product-twin/[twin_id]/route.ts", "utf8");
const studio = readFileSync("app/inferno/product-twins/ProductTwinStudio.tsx", "utf8");

ok(/productTwinAssetPreviewUrl/.test(helper), "preview helper is exported");
ok(/startsWith\("yandex-disk:"\)/.test(helper), "preview helper handles yandex-disk asset URLs");
ok(/asset-preview\?url=/.test(helper), "preview helper routes yandex-disk URLs through proxy");
ok(/getYandexDiskDownloadHref/.test(previewRoute), "asset preview route resolves private Yandex paths");
ok(/isAuthorizedReelsBrainJobRequest/.test(previewRoute), "asset preview route is protected");
ok(/withProductTwinPreviewUrls/.test(byArticle), "by-article API returns preview URLs");
ok(/withProductTwinPreviewUrls/.test(byId), "by-id API returns preview URLs");
ok(/assetPreviewUrl/.test(studio) && /preview_url/.test(studio), "studio renders preview URLs instead of raw yandex-disk hints");

console.log("productTwinPreviewContract: passed");
