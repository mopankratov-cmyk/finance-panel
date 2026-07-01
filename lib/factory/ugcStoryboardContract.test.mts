import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDetachedUgcStoryboard, RUSSIAN_HEYGEN_BLOGGERS } from "./ugcStoryboard";

const moduleSource = readFileSync("lib/factory/ugcStoryboard.ts", "utf8");
const routeSource = readFileSync("app/api/factory/ugc-storyboard/route.ts", "utf8");

ok(/hook_talking_head/.test(moduleSource), "storyboard has a hook_talking_head clip kind");
ok(/proof_broll/.test(moduleSource), "storyboard has a proof_broll clip kind");
ok(/buildBRollSpec/.test(moduleSource), "storyboard reuses canonical broll spec builder");
ok(/RUSSIAN_HEYGEN_BLOGGERS/.test(moduleSource), "storyboard records current Russian HeyGen blogger ids");
ok(/buildDetachedUgcStoryboard/.test(routeSource), "route builds storyboard through pure helper");
ok(/Dry-run only/.test(routeSource), "route documents dry-run mode");
ok(!/heygenCreateVideo|falVideoSubmit|confirmPaid|confirmCreate/.test(routeSource), "route cannot launch paid providers");

{
  const storyboard = buildDetachedUgcStoryboard({
    blogger: RUSSIAN_HEYGEN_BLOGGERS.katya,
    hook: "Я сначала подумала: ну нет, опять какая-то штука из рекламы.",
    product: "детский набор",
    faceDurationSec: 9,
    proofCues: [{
      claim: "не выглядит как рекламная постановка",
      shot: "показать руки, упаковку и обычный стол без студийного света",
      evidence: "hands",
    }],
    cta: "смотри реальные кадры",
  });

  ok(storyboard.ok, "valid storyboard builds");
  equal(storyboard.mode, "detached-storyboard-dry-run", "storyboard is dry-run only");
  equal(storyboard.clips[0].kind, "hook_talking_head", "first clip is talking-head hook");
  equal(storyboard.clips[0].avatarLookId, RUSSIAN_HEYGEN_BLOGGERS.katya.avatarLookId, "talking-head uses selected HeyGen look");
  ok(storyboard.clips[0].durationSec <= 4, "talking-head is clamped to <=4s");
  ok(storyboard.warnings.some((warning) => /clamped/.test(warning)), "long face request creates a clamp warning");
  ok(storyboard.clips.some((clip) => clip.kind === "proof_broll" && clip.shot?.includes("руки")), "proof b-roll maps the visual evidence");
  ok(!storyboard.clips[0].shot && !storyboard.clips[0].evidence, "face segment carries no product proof shot");
  ok(storyboard.clips[0].notes.some((note) => /do not show product/.test(note)), "face segment explicitly avoids product proof");
}

{
  const storyboard = buildDetachedUgcStoryboard({
    blogger: RUSSIAN_HEYGEN_BLOGGERS.alina,
    hook: "Вот честно, я люблю вещи, где не надо разбираться полчаса.",
    product: "товар",
  });

  ok(storyboard.ok, "fallback proof cue builds");
  ok(storyboard.proofCues.length >= 1, "fallback proof cue is inferred from hook");
  ok(storyboard.clips.some((clip) => clip.kind === "proof_broll" && clip.brollSpec), "proof b-roll gets overlay spec");
}

{
  const storyboard = buildDetachedUgcStoryboard({
    blogger: { id: "broken", name: "Broken", role: "primary_creator", avatarLookId: "" },
    hook: "",
  });
  ok(!storyboard.ok, "missing avatar and hook fail");
  ok(storyboard.errors.some((error) => error.includes("avatarLookId")), "avatar error is explicit");
  ok(storyboard.errors.some((error) => error.includes("hook")), "hook error is explicit");
}

console.log("ugcStoryboardContract: passed");
