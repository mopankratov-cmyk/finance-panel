import assert from "node:assert/strict";
import {
  HEYGEN_ENDPOINTS,
  buildAvatarGroupLooks,
  buildAvatarGroupPlan,
  buildGroupAddPayload,
  buildGroupCreatePayload,
  buildLookGeneratePayload,
  buildTrainPayload,
} from "./heygenAvatarGroup";

const ANGLES = Array.from({ length: 6 }, (_, i) => ({
  spec_id: `face_angle__0${i + 1}__test`,
  local_path: `/tmp/a${i + 1}.png`,
}));

// plan happy path
{
  const plan = buildAvatarGroupPlan("manya", "Маня", ANGLES);
  assert.equal(plan.ok, true);
  assert.equal(plan.group_name, "ugc_manya_v1");
  assert.equal(plan.angles.length, 6);
  assert.deepEqual(plan.steps.map((s) => s.id), ["upload", "group", "train", "looks"], "stage order is fixed");
  assert.equal(plan.steps.filter((s) => s.paid).length, 1, "only looks are paid");
  assert.equal(plan.steps.find((s) => s.id === "looks")?.paid, true);
  assert.equal(plan.looks.length, 14);
  assert.ok(plan.warnings.some((w) => w.includes("--confirm-paid")));
  assert.ok(plan.warnings.some((w) => w.includes("identity drift")));
}

// plan rejects too few angles
{
  const plan = buildAvatarGroupPlan("vika", "Вика", ANGLES.slice(0, 2));
  assert.equal(plan.ok, false);
  assert.equal(plan.steps.length, 0);
  assert.ok(plan.warnings[0].includes("at least 3"));
}

// plan warns on too many angles
{
  const many = Array.from({ length: 9 }, (_, i) => ({ spec_id: `a${i}`, local_path: `/tmp/${i}.png` }));
  const plan = buildAvatarGroupPlan("olya", "Оля", many);
  assert.equal(plan.ok, true);
  assert.ok(plan.warnings.some((w) => w.includes("5-8")));
}

// looks: per persona, guards, unique ids, framing/wardrobe variety, count clamp
{
  for (const persona of ["manya", "vika", "olya"] as const) {
    const looks = buildAvatarGroupLooks(persona);
    assert.equal(looks.length, 14);
    const ids = new Set(looks.map((l) => l.look_id));
    assert.equal(ids.size, looks.length);
    for (const look of looks) {
      assert.match(look.look_id, new RegExp(`^look__${persona}__\\d{2}__[a-z_]+$`));
      assert.ok(["close_up", "half_body", "full_body"].includes(look.framing), "framing must be a valid HeyGen pose");
      assert.ok(look.prompt.includes("same woman"), "look prompt must carry identity guard");
      assert.ok(look.prompt.includes("preserve exact face identity"));
      assert.ok(look.prompt.includes("no product"), "product must never appear in blogger looks");
      assert.ok(look.prompt.includes("no glossy ad styling"), "anti-gloss guard required");
      assert.ok(look.prompt.includes("not poor or run-down"), "interiors must stay well-kept per owner feedback");
      assert.ok(look.prompt.includes("candid unposed moment"), "looks must be candid, not catalog poses — owner feedback");
      assert.ok(look.prompt.includes("no stiff catalog pose"));
    }
    // every look carries a micro-action (prompt part 3 between scene and wardrobe)
    const actions = new Set(looks.map((l) => l.prompt.split("; ")[2]));
    assert.equal(actions.size, looks.length, "each look must have a distinct micro-action");
    assert.ok(looks.some((l) => /mid-(laugh|sip|step|stride|talk|motion|yawn|thought|smile|explanation)/.test(l.prompt)), "mid-motion language required");
    assert.ok(looks.filter((l) => l.framing === "full_body").length >= 2, "library needs full-body looks");
    assert.ok(looks.filter((l) => l.framing === "close_up").length >= 3, "library needs close selfie looks");
    assert.ok(looks.some((l) => l.scene_id === "mirror_full"), "full-length mirror selfie is a core UGC artifact");
    assert.ok(looks.some((l) => l.scene_id === "car_close"), "car selfie is a core UGC artifact");
    assert.ok(looks.some((l) => l.scene_id === "street_entrance"), "outdoor look required");
    const wardrobes = new Set(looks.map((l) => l.prompt.split("; ")[3]));
    assert.ok(wardrobes.size >= 4, "looks must vary wardrobe, not only scene");
  }
  assert.equal(buildAvatarGroupLooks("manya", 3).length, 3);
  assert.equal(buildAvatarGroupLooks("manya", 0).length, 1);
  assert.equal(buildAvatarGroupLooks("manya", 99).length, 14);
}

// payload builders
{
  assert.deepEqual(buildGroupCreatePayload("ugc_manya_v1", "image/abc/original"), {
    name: "ugc_manya_v1",
    image_key: "image/abc/original",
  });
  assert.deepEqual(buildGroupAddPayload("g1", ["k1", "k2"]), { group_id: "g1", image_keys: ["k1", "k2"], name: "training_photos" });
  assert.deepEqual(buildTrainPayload("g1"), { group_id: "g1" });
  const looks = buildAvatarGroupLooks("vika");
  const halfLook = looks.find((l) => l.framing === "half_body");
  const fullLook = looks.find((l) => l.framing === "full_body");
  const payload = buildLookGeneratePayload("g1", halfLook!);
  assert.equal(payload.group_id, "g1");
  assert.equal(payload.orientation, "vertical");
  assert.equal(payload.pose, "half_body");
  assert.equal(payload.style, "Realistic");
  assert.equal(payload.prompt, halfLook!.prompt);
  assert.equal(buildLookGeneratePayload("g1", fullLook!).pose, "full_body", "pose must follow the look framing");
}

// endpoints shape
{
  assert.ok(HEYGEN_ENDPOINTS.uploadAsset.startsWith("https://upload.heygen.com/"));
  assert.ok(HEYGEN_ENDPOINTS.groupCreate.startsWith("/v2/photo_avatar/"));
  assert.equal(HEYGEN_ENDPOINTS.trainStatus("g 1"), "/v2/photo_avatar/train/status/g%201");
  assert.equal(HEYGEN_ENDPOINTS.generationStatus("id/1"), "/v2/photo_avatar/generation/id%2F1");
}

console.log("heygenAvatarGroupContract: OK");
