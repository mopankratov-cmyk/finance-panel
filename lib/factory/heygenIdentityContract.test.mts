import { equal, notEqual, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildHeyGenIdentityPlan,
  canUseHeyGenIdentityForVideo,
  heygenIdentityHash,
} from "./heygenIdentity";

{
  const plan = buildHeyGenIdentityPlan({
    name: "Yoyo",
    source: "existing_look",
    avatarLookId: "f20cdc89e0ec4b61bbe453d73019a997",
    voiceId: "37832e32d4f7475ab7a1cb0db8e5dd66",
    persona: {
      speechStyle: "casual, slightly skeptical, short phrases",
      backstory: "Young creator testing products in a normal apartment.",
    },
  });
  equal(plan.ok, true, "existing look identity is valid with look and voice");
  equal(plan.stableCard.defaultAspectRatio, "9:16", "vertical short-form is default");
  ok(plan.steps.some((step) => step.id === "ready-for-smoke-video"), "valid identity can proceed to manual smoke render");
  equal(canUseHeyGenIdentityForVideo(plan.stableCard).ok, true, "stable identity can be used for video");
}

{
  const plan = buildHeyGenIdentityPlan({
    name: "Alina",
    source: "upload_own_face",
    faceImageUrls: ["https://example.com/face.jpg"],
    consentConfirmed: false,
  });
  equal(plan.ok, false, "uploaded face requires consent");
  ok(plan.errors.some((error) => /consentConfirmed/.test(error)), "consent error is explicit");
}

{
  const plan = buildHeyGenIdentityPlan({
    name: "Prompt Draft",
    source: "prompt_design_ai",
    prompt: "Natural phone selfie creator with imperfect bathroom lighting.",
  });
  equal(plan.ok, true, "prompt identity can be planned before paid creation");
  ok(plan.steps.some((step) => step.endpoint === "POST /v3/avatars" && step.blocked), "paid avatar creation is blocked in plan");
  equal(canUseHeyGenIdentityForVideo(plan.stableCard).ok, false, "prompt identity is not video-ready before look and voice are selected");
}

{
  const a = heygenIdentityHash({
    name: "Yoyo",
    source: "existing_look",
    avatarLookId: "look-a",
    voiceId: "voice-a",
  });
  const b = heygenIdentityHash({
    voiceId: "voice-a",
    avatarLookId: "look-a",
    source: "existing_look",
    name: "Yoyo",
  });
  const c = heygenIdentityHash({
    name: "Yoyo",
    source: "existing_look",
    avatarLookId: "look-b",
    voiceId: "voice-a",
  });
  equal(a, b, "identity hash is stable regardless of object key order");
  notEqual(a, c, "identity hash changes when the selected look changes");
}

{
  const route = readFileSync("app/api/factory/heygen-identity/route.ts", "utf8");
  ok(/identity-plan-only/.test(route), "identity route is planning-only");
  ok(!/heygenCreateAvatar/.test(route), "identity route does not call paid avatar creation");
  ok(!/confirmPaid/.test(route), "identity route does not trigger paid video render");
}

console.log("heygenIdentityContract: passed");
