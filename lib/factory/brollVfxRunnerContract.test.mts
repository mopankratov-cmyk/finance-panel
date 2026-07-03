// Contract for VFX b-roll runner route. Run: npx tsx lib/factory/brollVfxRunnerContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";
const route = readFileSync("app/api/factory/product-broll-vfx/route.ts", "utf8");
const fal = readFileSync("lib/factory/falVideo.ts", "utf8");

// Track A submit реально существует и бьёт в effects-endpoint без промпта.
ok(/export async function falKlingEffectSubmit/.test(fal), "falKlingEffectSubmit exists");
ok(/effect_scene: effectScene/.test(fal) && /kling-video\/v1\.6\/standard\/effects/.test(fal), "Track A submit posts to effects endpoint");
ok(/input_image_urls: \[imageUrl\]/.test(fal) && !/prompt:/.test(fal.slice(fal.indexOf("falKlingEffectSubmit"), fal.indexOf("falKlingEffectSubmit") + 900)), "effects submit sends no prompt");

// Роут защищён, дефолт submit=false (не жжёт FAL), GET никогда не сабмитит.
ok(/isAuthorizedReelsBrainJobRequest/.test(route), "vfx route is auth-gated");
ok(/const submit = body\.submit === true/.test(route), "submit is opt-in, default dry-run");
ok(/submit: false, \/\/ GET никогда не сабмитит/.test(route), "operator GET never submits (no paid gen)");

// Реально сабмитит оба трека и встаёт в общий пайплайн.
ok(/falKlingEffectSubmit\(image, job\.effect_scene/.test(route), "Track A jobs use effect submit");
ok(/falVideoSubmitDetailed\("kling", image, job\.prompt/.test(route), "Track B jobs use i2v submit with prompt");
ok(/task_id: res\.token \? `fv\.\$\{res\.token\}`/.test(route), "task_id fv.<token> plugs into video-fal-status");
ok(/getBestProductTwinAsset\(db, \{ article, useCase: "broll" \}\)/.test(route), "source resolved from article-exact twin");
ok(/rehostImageForFal/.test(route), "source rehosted to public URL for FAL");

// Волна 1 и одиночный, blocked-предохранитель, judge-роут.
ok(/body\.wave1 === true/.test(route) && /planWave1\(\)/.test(route), "wave1 mode uses planWave1");
ok(/desc\?\.blocked/.test(route) && /status: 409/.test(route), "blocked article (TT04102) refused before spend");
ok(/judge_route/.test(route) && /action=judge/.test(route), "response hints OTK judge route");

console.log("brollVfxRunnerContract: passed");
