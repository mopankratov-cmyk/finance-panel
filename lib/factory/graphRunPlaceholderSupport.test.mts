import { equal, ok } from "node:assert/strict";
import { buildReelProps, type RunPlan, type RunNode } from "./graphRun";

const visualNode: RunNode = {
  ordinal: 1,
  slot: "scene",
  node_type: "b_roll",
  tool: "disk_real",
  status: "done",
  url: "https://example.com/clip.mp4",
  duration_sec: 3,
  params: { role: "proof", visual_desc: "Куртка в руках, фактура и посадка" },
  prompt: "Черновик сцены proof",
  onscreen_text: "Как это выглядит вживую",
};

const plan: RunPlan = {
  step: "assemble",
  mode: "audience",
  nodes: [visualNode],
};

const built = buildReelProps(plan, [visualNode], "HT-42-01");
const props = built.inputProps as Record<string, unknown>;
const captions = props.captions as Array<{ text: string }>;

ok(Array.isArray(captions) && captions.length > 0, "single-clip recipes get synthetic captions");
ok(captions.some((row) => /Как это выглядит вживую|Что видно вживую/.test(String(row.text))), "captions include synthetic hook");
ok(captions.some((row) => /Сохрани/.test(String(row.text))) && captions.some((row) => /не потерять/.test(String(row.text))), "captions include audience CTA fallback");
equal(String(props.ctaTitle), "Как это выглядит вживую");
ok(Number(props.actorEnd) >= 180, "single-clip recipes get a longer actor section");

console.log("graphRunPlaceholderSupport: ok");
