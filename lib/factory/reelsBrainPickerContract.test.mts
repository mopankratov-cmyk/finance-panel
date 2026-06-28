import { readFileSync } from "node:fs";
import { deepEqual, ok } from "node:assert/strict";
import { applyReelsBrainPatternToPlan } from "./reelsBrainPicker";
import type { RunPlan } from "./graphTypes";

const picker = readFileSync("lib/factory/reelsBrainPicker.ts", "utf8");
const batch = readFileSync("app/api/factory/batch/route.ts", "utf8");
const improvement = readFileSync("lib/factory/improvementLoop.ts", "utf8");

ok(/from\("niche_playbooks"\)/.test(picker), "pattern picker reads persisted Reels Brain playbook");
ok(/reels_brain_patterns/.test(picker), "pattern picker reads playbook.reels_brain_patterns");
ok(/applyReelsBrainPatternToPlan/.test(batch), "batch enqueue applies Reels Brain pattern to run plan");
ok(/reelsBrainPatternFromPlan/.test(improvement), "improvement loop reads selected Reels Brain pattern");
ok(/reelsPatternId \|\| hookType/.test(improvement), "improvement pattern key prefers selected pattern id");

const plan: RunPlan = {
  step: "submit",
  nodes: [{
    ordinal: 0,
    slot: "hook",
    node_type: "text",
    tool: "seedance",
    prompt: "Make a hook",
    params: { role: "hook" },
    image_url: null,
    asset_url: null,
    duration_sec: null,
    onscreen_text: null,
    status: "pending",
  }],
};

const applied = applyReelsBrainPatternToPlan(plan, {
  pattern_id: "curiosity-question-review-open-loop",
  hook_type: "curiosity_question",
  structure_type: "review",
  retention_mechanism: "open_loop",
  emotion: "curiosity",
  viral_logic: "question -> review -> open_loop",
  example_hooks: ["Почему этот крем скрывают?"],
});

ok(applied, "pattern applies to a plan");
deepEqual(plan.reels_brain_pattern?.pattern_id, "curiosity-question-review-open-loop");
deepEqual(plan.nodes[0].params.hook_type, "curiosity_question");
ok(plan.nodes[0].prompt.includes("reels_brain_pattern=curiosity-question-review-open-loop"), "hook prompt receives pattern cue");

console.log("reelsBrainPickerContract: passed");
