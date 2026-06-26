import { sanitizeWinnerPresetNodes } from "./winnerPreset";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("FAIL", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

const nodes = sanitizeWinnerPresetNodes([
  {
    ordinal: 3,
    slot: "hook",
    node_type: "clip",
    tool: "fal",
    prompt: "exact production prompt",
    onscreen_text: "first second",
    duration_sec: 4,
    params: {
      role: "hook",
      preview_url: "https://old.example/clip.mp4",
      preview_hash: "abc",
      voice: "ru_voice",
      subtitle_style: "bold",
      emotion: "curious",
      visual_desc: "real hands, product close-up",
    },
  },
  { status: "skip", node_type: "clip", tool: "fal", prompt: "skip me" },
]);

eq(nodes.length, 1, "skip nodes are excluded");
eq(nodes[0].ordinal, 3, "ordinal is preserved");
eq(nodes[0].role, "hook", "role is preserved");
eq(nodes[0].prompt, "exact production prompt", "winner preset keeps production prompt");
eq(nodes[0].duration_sec, 4, "duration is preserved");
eq(nodes[0].params.voice, "ru_voice", "production params are preserved");
eq(nodes[0].params.subtitle_style, "bold", "style params are preserved");
ok(!("preview_url" in nodes[0].params), "preview_url is stripped");
ok(!("preview_hash" in nodes[0].params), "preview_hash is stripped");

console.log(`winnerPreset: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
