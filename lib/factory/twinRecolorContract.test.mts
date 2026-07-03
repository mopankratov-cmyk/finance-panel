// Contract test for twin recolor. Run: npx tsx lib/factory/twinRecolorContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";
import { buildRecolorPrompt } from "./twinRecolor";

const mod = readFileSync("lib/factory/twinRecolor.ts", "utf8");
const route = readFileSync("app/api/factory/product-twin/recolor/route.ts", "utf8");

// Промпт перекраски: меняет ТОЛЬКО цвет, жёстко держит геометрию.
const p = buildRecolorPrompt("куртка NORVIA", "бордовый");
ok(/Change ONLY the fabric colour/i.test(p), "recolor changes only colour");
ok(/Keep EVERYTHING else pixel-identical/i.test(p) && /garment length/i.test(p), "recolor locks length/geometry");
ok(/do NOT change the shape, length or construction/i.test(p), "recolor forbids structural change");
ok(/hex around #6d2733/i.test(p), "recolor injects hex anchor for known colour");
ok(!/hex around/i.test(buildRecolorPrompt("куртка", "неизвестныйцвет")), "unknown colour falls back to name only");

// Модуль: наследует геометрию проверенной базы, помечает провенанс recolor.
ok(/allowFailedIdentity: true/.test(mod), "recolor can use a warn base (geometry already verified)");
ok(/recolored_from: base\.twin\.twinId/.test(mod), "recolored assets carry recolor provenance");
ok(/sourceKind: `recolor_from:/.test(mod), "twin sourceKind marks recolor origin");
ok(/useCase: "hero"/.test(mod), "recolor pulls the full-bleed hero asset as base");

// Роут: защищён, одиночный + батч по всем цветам модели.
ok(/isAuthorizedReelsBrainJobRequest/.test(route), "recolor route is auth-gated");
ok(/all_colors_of_model === true/.test(route), "route supports batch recolor across model colours");
ok(/e\.model === baseEntry\.model && e\.article !== baseArticle/.test(route), "batch targets sibling colours of the same model");

// Ретушь: убирает вшитый артефакт, сохраняет как твин того же артикула.
import { buildRetouchPrompt, RETOUCH_PRESETS } from "./twinRecolor";
const rt = buildRetouchPrompt("куртка NORVIA чёрная", [RETOUCH_PRESETS.sleeve_patch]);
ok(/remove the small rectangular badge/i.test(rt), "retouch removes sleeve patch");
ok(/Keep EVERYTHING else pixel-identical/i.test(rt) && /do not restyle, recolor, resize/i.test(rt), "retouch keeps geometry/color, only removes artifact");
ok(RETOUCH_PRESETS.sleeve_toggle && RETOUCH_PRESETS.hood, "presets cover sleeve toggle and invented hood");
const rmod = readFileSync("lib/factory/twinRecolor.ts", "utf8");
ok(/sourceKind: "retouch"/.test(rmod) && /retouched_from: base\.twin\.twinId/.test(rmod), "retouch twin carries provenance");
const rroute = readFileSync("app/api/factory/product-twin/recolor/route.ts", "utf8");
ok(/body\.retouch === true/.test(rroute) && /retouchTwin\(db/.test(rroute), "recolor route has retouch branch");

console.log("twinRecolorContract: passed");
