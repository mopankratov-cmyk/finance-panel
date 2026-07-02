import assert from "node:assert/strict";
import { buildFaceAnglePlan, buildFaceHeroPlan, listFacePersonas } from "./faceFoundry";

// persona registry
{
  const personas = listFacePersonas();
  assert.equal(personas.length, 3);
  assert.deepEqual(personas.map((p) => p.persona_id), ["manya", "vika", "olya"]);
  assert.deepEqual(personas.map((p) => p.niche), ["cosmetics", "clothing", "toys"], "one persona per factory niche");
  for (const persona of personas) {
    assert.ok(persona.display_name.length > 1);
    assert.ok(persona.role.length > 10);
    assert.ok(persona.base_persona.includes("Russian"), "persona base must anchor locale");
  }
}

// hero plan: all personas
{
  const plan = buildFaceHeroPlan();
  assert.equal(plan.ok, true);
  assert.equal(plan.mode, "face-foundry-hero");
  assert.equal(plan.personas.length, 3);
  assert.equal(plan.planned_specs.length, 12, "3 personas x 4 candidates");
  const ids = new Set(plan.planned_specs.map((s) => s.spec_id));
  assert.equal(ids.size, plan.planned_specs.length, "hero spec_id must be unique");
  for (const spec of plan.planned_specs) {
    assert.match(spec.spec_id, /^face_hero__(manya|vika|olya)__\d{2}__[a-z_]+$/);
    assert.ok(spec.prompt.includes("does not exist"), "hero prompt must state the face is synthetic");
    assert.ok(spec.prompt.includes("not a celebrity"), "hero prompt must forbid lookalikes");
    assert.ok(spec.prompt.includes("no beauty retouch"), "hero prompt must keep anti-gloss guard");
    assert.ok(spec.prompt.includes("no text"), "hero prompt must forbid text/watermarks");
    assert.ok(!/\bproduct\b/i.test(spec.prompt), "hero prompt must not mention product");
    assert.ok(spec.hypothesis.length > 10, "every hero spec carries a hypothesis");
    assert.ok(!("hero_image_url" in spec), "hero specs must not carry hero_image_url — the runner uses it to pick the edit model");
  }
  assert.ok(plan.warnings.some((w) => w.includes("human eyeball")));
  assert.ok(plan.warnings.some((w) => w.includes("must not share a face")));
}

// hero plan: single persona + clamps + unknown persona
{
  const manya = buildFaceHeroPlan("manya");
  assert.equal(manya.ok, true);
  assert.equal(manya.personas.length, 1);
  assert.equal(manya.planned_specs.length, 4);
  assert.ok(manya.planned_specs.every((s) => s.persona_id === "manya"));
  assert.ok(manya.planned_specs.some((s) => s.vibe_id === "tired_honest"), "manya must carry the winning tired_honest vibe");

  assert.equal(buildFaceHeroPlan("all", 2).planned_specs.length, 6);
  assert.equal(buildFaceHeroPlan("vika", 0).planned_specs.length, 1);
  assert.equal(buildFaceHeroPlan("olya", 99).planned_specs.length, 4);
  assert.equal(buildFaceHeroPlan("all", Number.NaN).planned_specs.length, 12);

  const unknown = buildFaceHeroPlan("boris" as never);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.planned_specs.length, 0);
  assert.ok(unknown.warnings[0].includes("unknown persona"));
}

// angle plan happy path
{
  const hero = "https://fal.media/files/example/hero.png";
  const plan = buildFaceAnglePlan(hero);
  assert.equal(plan.ok, true);
  assert.equal(plan.mode, "face-foundry-angles");
  assert.equal(plan.hero_image_url, hero);
  assert.equal(plan.planned_specs.length, 24, "training set must cover ~24 shots (HeyGen Personal Model wants 30+ with hero)");
  const angleIds = plan.planned_specs.map((s) => s.angle_id);
  assert.ok(angleIds.includes("three_quarter_left"), "must cover the winning Katya angle family");
  assert.ok(angleIds.includes("front_neutral"), "must include the frontal anchor photo");
  assert.ok(angleIds.includes("mid_speech"), "open-mouth frame required for lip-sync fidelity");
  assert.ok(angleIds.includes("soft_smile"), "smile expression variant required");
  assert.ok(angleIds.filter((id) => id.startsWith("full_body")).length >= 2, "need full-body training frames");
  assert.ok(angleIds.includes("car_seat_day") && angleIds.includes("park_daylight"), "varied backgrounds fight background bleed");
  const midSpeech = plan.planned_specs.find((s) => s.angle_id === "mid_speech");
  assert.ok(midSpeech!.prompt.includes("mouth slightly open"), "expression override must reach the prompt");
  assert.ok(!midSpeech!.prompt.includes("mouth closed"), "expression override must replace the default");
  const ids = new Set(plan.planned_specs.map((s) => s.spec_id));
  assert.equal(ids.size, plan.planned_specs.length, "angle spec_id must be unique");
  for (const spec of plan.planned_specs) {
    assert.match(spec.spec_id, /^face_angle__\d{2}__[a-z_]+$/);
    assert.equal(spec.hero_image_url, hero);
    assert.match(spec.hero_image_url, /^https?:\/\//, "angle specs must carry a truthy http(s) hero_image_url — the runner keys the edit model off it");
    assert.ok(spec.prompt.includes("same woman"), "angle prompt must carry the identity guard");
    assert.ok(spec.prompt.includes("preserve exact face identity"), "angle prompt must preserve identity");
    assert.ok(spec.prompt.includes("no beauty retouch"), "angle prompt must keep anti-gloss guard");
  }
  assert.ok(plan.warnings.some((w) => w.includes("identity drift")));
}

// angle plan rejects non-http hero
{
  for (const bad of ["", "   ", "/tmp/hero.png", "yandex-disk:/content-factory/hero.png"]) {
    const plan = buildFaceAnglePlan(bad);
    assert.equal(plan.ok, false, `hero url "${bad}" must be rejected`);
    assert.equal(plan.planned_specs.length, 0);
    assert.ok(plan.warnings.length > 0);
  }
}

// angle plan count clamp
{
  const hero = "https://fal.media/files/example/hero.png";
  assert.equal(buildFaceAnglePlan(hero, 5).planned_specs.length, 5);
  assert.equal(buildFaceAnglePlan(hero, 0).planned_specs.length, 1);
  assert.equal(buildFaceAnglePlan(hero, 99).planned_specs.length, 24);
  // first 8 must stay byte-stable so already-paid renders stay cache-hittable by spec_id
  const first8 = buildFaceAnglePlan(hero, 8).planned_specs.map((s) => s.spec_id);
  assert.deepEqual(first8, buildFaceAnglePlan(hero, 24).planned_specs.slice(0, 8).map((s) => s.spec_id));
}

console.log("faceFoundryContract: OK");
