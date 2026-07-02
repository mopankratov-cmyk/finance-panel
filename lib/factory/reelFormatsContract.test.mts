import assert from "node:assert/strict";
import {
  REEL_PLATFORM_RULES,
  describeReelFormats,
  getReelFormat,
  listReelFormats,
  pickReelFormatsForNiche,
  validateReelFormat,
} from "./reelFormats";

// registry shape
{
  const formats = listReelFormats();
  assert.ok(formats.length >= 6, "registry carries at least 6 mined formats");
  const ids = new Set(formats.map((f) => f.format_id));
  assert.equal(ids.size, formats.length, "format_id must be unique");
  for (const f of formats) {
    assert.ok(f.name_ru.length > 5);
    assert.ok(f.hook_examples.length >= 3, `${f.format_id}: needs real hook examples from corpus/market`);
    assert.ok(f.evidence.length > 20, `${f.format_id}: evidence required — форматы добываются, не выдумываются`);
    assert.ok(f.beats.length >= 4, `${f.format_id}: needs beat structure`);
    assert.ok(["shotstack", "fal_timeline", "remotion"].includes(f.assembly_lane));
  }
}

// every format passes its own validation
{
  for (const f of listReelFormats()) {
    const v = validateReelFormat(f);
    assert.deepEqual(v.errors, [], `${f.format_id}: ${v.errors.join("; ")}`);
    assert.equal(v.ok, true);
  }
}

// hard invariants across the registry
{
  for (const f of listReelFormats()) {
    // артикул обязателен для WB-трафика
    assert.ok(
      f.beats.some((b) => b.slot === "endcard" && (b.text_overlay || "").includes("{article}")),
      `${f.format_id}: article endcard is mandatory`,
    );
    // хук начинается на 0
    const positional = f.beats.filter((b) => b.start_sec >= 0).sort((a, b) => a.start_sec - b.start_sec);
    assert.equal(positional[0].start_sec, 0, `${f.format_id}: hook must start at 0s`);
    // лицо ≤4с суммарно
    const face = positional.filter((b) => b.slot === "face").reduce((s, b) => s + b.end_sec - b.start_sec, 0);
    assert.ok(face <= 4, `${f.format_id}: face total ${face}s > 4s cap`);
  }
  // хотя бы один формат вообще без блогера и без звука — самый дешёвый конвейер (чистые твины)
  assert.ok(
    listReelFormats().some((f) => !f.requires_blogger && f.works_without_sound),
    "need a blogger-free sound-free format for the cheapest lane",
  );
  // хотя бы 4 формата пригодны для Wibes (основная площадка 2026)
  assert.ok(listReelFormats().filter((f) => f.platform_fit.wibes >= 4).length >= 4);
}

// niche pickers
{
  const cosmetics = pickReelFormatsForNiche("cosmetics");
  assert.ok(cosmetics.length >= 3);
  assert.equal(cosmetics[0].niche_fit.cosmetics, 5, "top pick for cosmetics must be a 5-fit format");
  const toys = pickReelFormatsForNiche("toys");
  assert.ok(toys[0].niche_fit.toys === 5);
  const clothing = pickReelFormatsForNiche("clothing");
  assert.ok(clothing[0].niche_fit.clothing === 5);
}

// platform rules sanity
{
  assert.equal(REEL_PLATFORM_RULES.wibes.must_read_without_sound, true);
  assert.equal(REEL_PLATFORM_RULES.wibes.hook_deadline_sec, 2);
}

// validation catches violations
{
  const broken = { ...listReelFormats()[0] };
  broken.beats = broken.beats.map((b) => ({ ...b }));
  broken.beats.find((b) => b.slot === "endcard")!.text_overlay = "без артикула";
  const v = validateReelFormat(broken);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("артикул")));

  const longFace = { ...listReelFormats()[0] };
  longFace.beats = longFace.beats.map((b) => (b.slot === "face" ? { ...b, end_sec: b.start_sec + 5 } : { ...b }));
  assert.equal(validateReelFormat(longFace).ok, false, "5s face beats must fail the 4s cap");
}

// lookups
{
  assert.equal(getReelFormat("skeptic_proof")?.name_ru.includes("Скептик"), true);
  assert.equal(getReelFormat("nope"), null);
  assert.ok(describeReelFormats().every((d) => d.format_id && d.name_ru));
}

console.log("reelFormatsContract: OK");
