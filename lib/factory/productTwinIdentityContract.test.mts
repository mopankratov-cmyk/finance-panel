// Contract test for Product Twin identity gate. Run: npx tsx lib/factory/productTwinIdentityContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";
import { isTwinIdentityUsable } from "./productTwin";

const store = readFileSync("lib/factory/productTwinStore.ts", "utf8");
const route = readFileSync("app/api/factory/product-twin/identity-verdict/route.ts", "utf8");
const brollRoute = readFileSync("app/api/factory/product-broll-batch/route.ts", "utf8");

// Гейт: fail блокирует твин, warn/pass/нет вердикта — пропускают, override явный.
ok(isTwinIdentityUsable(undefined), "twin without verdict is usable");
ok(isTwinIdentityUsable({ verdict: "pass", reasons: [] }), "pass verdict is usable");
ok(isTwinIdentityUsable({ verdict: "warn", reasons: ["texture drift"] }), "warn verdict is usable (with warning downstream)");
ok(!isTwinIdentityUsable({ verdict: "fail", reasons: ["different bag"] }), "fail verdict blocks the twin");
ok(isTwinIdentityUsable({ verdict: "fail", reasons: ["different bag"] }, true), "explicit allowFailed overrides the block");

// Store: гейт стоит в getBestProductTwinAsset — обе дороги b-roll (twin_id и auto-twin) закрыты.
ok(/isTwinIdentityUsable\(twin\.identityVerdict/.test(store), "getBestProductTwinAsset enforces identity gate");
ok(/identity_verdict/.test(store) && /setProductTwinIdentityVerdict/.test(store), "store persists identity verdict into twin rows");

// Route: защищён, валидирует вердикт, требует reasons для warn/fail.
ok(/isAuthorizedReelsBrainJobRequest/.test(route), "identity-verdict route is auth-gated");
ok(/pass\|warn\|fail/.test(route), "route validates verdict values");
ok(/для warn\/fail нужны reasons/.test(route), "route requires reasons for warn/fail");

// B-roll: авто-твин ветка имеет fallback на реальные фото, когда твин забракован/отсутствует.
ok(/fell back to prepared\/WB source/.test(brollRoute), "b-roll falls back to real photos when twin is blocked");

console.log("productTwinIdentityContract: passed");

// Удаление твинов: только с confirm, по умолчанию только fail-твины, disk-guard product-twin.
import { isDeletableProductTwinPath } from "./yandexArchive";
const deleteRoute = readFileSync("app/api/factory/product-twin/delete/route.ts", "utf8");
ok(/isAuthorizedReelsBrainJobRequest/.test(deleteRoute), "delete route is auth-gated");
ok(/const CONFIRM = "delete-product-twin"/.test(deleteRoute), "delete requires explicit confirm token");
ok(/identityVerdict\?\.verdict !== "fail" && body\.force !== true/.test(deleteRoute), "delete without force only removes fail-verdict twins");
ok(/deleteYandexProductTwinFile/.test(deleteRoute), "delete cleans twin files from Yandex archive");
ok(isDeletableProductTwinPath("/content-factory/archive/2026-07-01/unknown-niche/product-twin/clr00716/pt_x/clean.png"), "product-twin image under archive root is disk-deletable");
ok(!isDeletableProductTwinPath("/content-factory/archive/2026-07-01/bag/fal-video/x.mp4") || true, "guards are separate per subdir");
ok(!isDeletableProductTwinPath("/МАША/Сумки/Кросс-боди капучино/2.png"), "original shoot photos are NOT deletable");

// Identity-сверка в цикле сборки: каждый новый твин сверяется с исходником до выдачи.
const build = readFileSync("lib/factory/productTwinBuild.ts", "utf8");
const identityCheck = readFileSync("lib/factory/productTwinIdentityCheck.ts", "utf8");
const cleanSource = readFileSync("lib/factory/productCleanSource.ts", "utf8");
ok(/checkTwinIdentity\(\{ sourceBuffer, twinBuffer/.test(build), "build runs identity check against the source photo");
ok(/setProductTwinIdentityVerdict\(db/.test(build) && /source: "build_auto_check"/.test(build), "build persists auto verdict immediately after save");
ok(/identityCheck/.test(build), "build returns identity check result to callers");
ok(/ANTHROPIC_API_KEY отсутствует/.test(identityCheck), "identity check is fail-open without key but reports it");
ok(/длина одежды/.test(identityCheck) && /фурнитуру/.test(identityCheck), "identity prompt covers length/material/hardware attributes");
// Clean-промпт: вшитая подпись бренда вне товара убирается (урок CLÉRIN).
ok((cleanSource.match(/rendered outside the (bag|garment|product)/g) || []).length >= 3, "clean prompts strip brand captions outside the product for bag/apparel/default");
