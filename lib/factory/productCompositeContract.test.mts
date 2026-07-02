import assert from "node:assert/strict";
import {
  ANTI_AI_DEFAULTS,
  buildAntiAiFilterComplex,
  buildAntiAiPassArgs,
  buildAntiAiVideoFilter,
} from "./antiAiPost";
import {
  COMPOSITE_QC_CHECKLIST,
  PRODUCT_ANIMATE_MODEL,
  PRODUCT_COMPOSITE_MODEL,
  buildGarmentTryonPayload,
  buildProductAnimatePrompt,
  buildProductCompositePrompt,
} from "./productComposite";

// composite prompt carries every reviewer-learned anchor
{
  const p = buildProductCompositePrompt({
    lookImageUrl: "https://x/look.png",
    productImageUrl: "https://x/prod.png",
    labelText: "АКТИВ КРЕМ",
    wardrobeHint: "a warm terracotta long-sleeve tee",
    productGeometryHint: "squat frosted-glass jar, tall brushed-silver lid about 40% of jar height",
  });
  assert.ok(p.includes("pixel-perfect"), "label fidelity clause");
  assert.ok(p.includes("«АКТИВ КРЕМ»"), "label text embedded");
  assert.ok(p.includes("no respelling"), "Seedream auto-fixes typos — must forbid");
  assert.ok(p.includes("25% of the frame width"), "product size anchor (v2 review)");
  assert.ok(p.includes("no glow or backlight"), "hero-light artifact guard (v3 review)");
  assert.ok(p.includes("frosted/matte/gloss) exactly as the reference"), "material finish guard (v3 review)");
  assert.ok(p.includes("IN FOCUS"), "no-bokeh phone camera anchor (v2 review)");
  assert.ok(p.includes("finger contact shadows"), "grip anatomy anchor");
  assert.ok(p.includes("No phone frame, no watermark"), "seedream/nano-banana add frames+watermarks");
  assert.ok(p.includes("terracotta"), "wardrobe hint threads through");
  assert.ok(p.includes("squat frosted-glass jar"), "geometry hint threads through");
}

// animate prompt: liveness levels + product discipline always present
{
  for (const level of ["restrained", "natural", "energetic"] as const) {
    const p = buildProductAnimatePrompt(level);
    assert.ok(p.includes("completely still and upright"), `${level}: v4 lesson — product must not move at all`);
    assert.ok(p.includes("label horizontal"), `${level}: v4 lesson — sideways jar melts the label`);
    assert.ok(p.includes("no tilt, no rotation"), `${level}: rotation guard`);
    assert.ok(!p.includes("tilts the product"), `${level}: product-motion liveness is forbidden (v4 regress)`);
  }
  const natural = buildProductAnimatePrompt("natural");
  assert.ok(natural.includes("head turns of 10-15 degrees"), "v3 review: frozen pose fix — liveness via head only");
  assert.ok(natural.includes("background parallax"), "handheld parallax anchor");
}

// QC checklist pins the known artifact families
{
  assert.ok(COMPOSITE_QC_CHECKLIST.length >= 6);
  const joined = COMPOSITE_QC_CHECKLIST.join(" ");
  for (const marker of ["OCR", "глоу", "хват", "геометрия", "вотермар"]) {
    assert.ok(joined.includes(marker), `checklist covers: ${marker}`);
  }
}

// model ids pinned (stack decision 2026-07-02)
{
  assert.equal(PRODUCT_COMPOSITE_MODEL, "fal-ai/bytedance/seedream/v4.5/edit");
  assert.equal(PRODUCT_ANIMATE_MODEL, "fal-ai/bytedance/omnihuman/v1.5");
  const tryon = buildGarmentTryonPayload("https://x/m.png", "https://x/g.png");
  assert.equal(tryon.category, "auto");
  assert.equal(tryon.model_image, "https://x/m.png");
}

// anti-AI post: both grain passes, warm global cast, phone crush
{
  const vf = buildAntiAiVideoFilter();
  assert.ok(vf.includes(`noise=alls=${ANTI_AI_DEFAULTS.grainPassA}`), "pass A grain");
  assert.ok(vf.includes("colortemperature"), "global warm cast (v3 review: split-tone tell)");
  assert.ok(vf.includes("sin(t*1.3)") && vf.includes("sin(t*7.9)"), "dual-frequency handheld shake");
  const fc = buildAntiAiFilterComplex();
  assert.ok(fc.includes("amix=inputs=2"), "room tone mixed under voice");
  assert.ok(fc.includes("highpass=f=120"), "phone mic band");
  const { passA, passB } = buildAntiAiPassArgs("/in.mp4", "/out.mp4");
  assert.ok(passA.includes("-tune") && passA.includes("grain"), "pass A must not crush grain");
  const b = passB("/graded.mp4");
  assert.ok(b.join(" ").includes(`noise=alls=${ANTI_AI_DEFAULTS.grainPassB}`), "pass B re-grain after crush (v3 review)");
  assert.ok(b.join(" ").includes(`${ANTI_AI_DEFAULTS.crushBitrateK}k`), "phone bitrate crush");
}

console.log("productCompositeContract: OK");
