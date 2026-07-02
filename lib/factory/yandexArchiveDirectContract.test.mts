// Contract test for direct Yandex archiving from generation result routes.
// Run: npx tsx lib/factory/yandexArchiveDirectContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const falImageEdit = readFileSync("lib/factory/falImageEdit.ts", "utf8");
const falStatusRoute = readFileSync("app/api/factory/video-fal-status/[id]/route.ts", "utf8");
const twinStore = readFileSync("lib/factory/productTwinStore.ts", "utf8");

ok(/archiveExternalMediaToYandex/.test(falImageEdit), "FAL image edit archives generated clean images");
ok(/await archiveExternalMediaToYandex/.test(falImageEdit), "FAL image archive is awaited before route returns");
ok(/yandex_archive/.test(falStatusRoute) && /archiveExternalMediaToYandex/.test(falStatusRoute), "FAL video status archives completed mp4");
ok(/subdir: "fal-video"/.test(falStatusRoute), "FAL video archive writes to fal-video subdir");
ok(/sp\.get\("article"\)/.test(falStatusRoute) && /sp\.get\("niche"\)/.test(falStatusRoute), "FAL video status accepts archive article/niche query metadata");
ok(/stableKey: id/.test(falStatusRoute), "FAL video archive is idempotent across status polls (stableKey=task id)");
ok(/subdir: "product-twin"/.test(twinStore), "Product Twin uploaded variants archive to product-twin subdir");

console.log("yandexArchiveDirectContract: passed");
