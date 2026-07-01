// Product Twin derived views contract. Run: npx tsx lib/factory/productTwinViewsContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const store = readFileSync("lib/factory/productTwinStore.ts", "utf8");
const route = readFileSync("app/api/factory/product-twin/views/route.ts", "utf8");
const studio = readFileSync("app/inferno/product-twins/ProductTwinStudio.tsx", "utf8");
const broll = readFileSync("app/api/factory/product-broll-batch/route.ts", "utf8");

ok(/ProductTwinViewAsset/.test(store), "store defines derived view assets");
ok(/product_twin_view_asset/.test(store) && /getProductTwinViewAssets/.test(store), "store can list derived view assets from content_assets");
ok(/product-twin\/views crash/.test(route), "views route exists");
ok(/productTwinAssetPreviewUrl/.test(route), "views route returns preview URLs");
ok(/\/api\/factory\/product-twin\/views/.test(studio), "studio loads derived views");
ok(/Derived Views/.test(studio), "studio renders derived view gallery");
ok(/Asset Readiness/.test(studio) && /getTwinReadiness/.test(studio), "studio renders product twin readiness summary");
ok(/view_id/.test(broll) && /getProductTwinViewAssets/.test(broll), "b-roll route can use a derived Product Twin view as source");

console.log("productTwinViewsContract: passed");
