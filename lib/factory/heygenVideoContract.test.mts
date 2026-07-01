import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildHeyGenSmokeVideoPlan,
  detectAdStyle,
  softenAdStyle,
} from "./heygenVideo";

const identity = {
  name: "Yoyo",
  source: "existing_look" as const,
  avatarLookId: "f20cdc89e0ec4b61bbe453d73019a997",
  voiceId: "37832e32d4f7475ab7a1cb0db8e5dd66",
  persona: { speechStyle: "casual, slightly skeptical" },
};

{
  const plan = buildHeyGenSmokeVideoPlan({
    identity,
    script: "Я вообще не собиралась это брать, но мне стало интересно.",
    realismMode: "phone_selfie",
    emotionalBeat: "skeptical",
  });
  equal(plan.ok, true, "valid identity and natural script build a smoke plan");
  equal(plan.paidBlocked, true, "smoke plan is paid-blocked");
  equal(plan.dryRun?.endpoint, "/v3/videos", "smoke dry-run targets v3 video creation");
  equal(plan.dryRun?.body.avatar_id, identity.avatarLookId, "smoke uses selected look id");
  ok(JSON.stringify(plan.dryRun?.body).includes("do not over-smile"), "realism directives are attached to the script");
}

{
  const script = "Это инновационный продукт. Покупайте сейчас.";
  ok(detectAdStyle(script).length >= 2, "ad-style markers are detected");
  const softened = softenAdStyle(script);
  ok(!/инновационный продукт/i.test(softened), "hard ad wording is softened");
  ok(!/Покупайте сейчас/i.test(softened), "hard CTA is softened");
}

{
  const plan = buildHeyGenSmokeVideoPlan({
    identity: { name: "Draft", source: "existing_look", avatarLookId: "look-only" },
    script: "Short test.",
  });
  equal(plan.ok, false, "missing voice blocks smoke render");
  ok(plan.errors.some((error) => /voiceId/.test(error)), "missing voice error is explicit");
}

{
  const route = readFileSync("app/api/factory/heygen-smoke/route.ts", "utf8");
  ok(/manual-smoke-plan-only/.test(route), "smoke route is plan-only");
  ok(!/heygenCreateVideo/.test(route), "smoke route does not call paid create video");
  ok(!/confirmPaid/.test(route), "smoke route cannot bypass paid guard");
}

console.log("heygenVideoContract: passed");
