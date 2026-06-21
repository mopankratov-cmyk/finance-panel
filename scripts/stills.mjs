// Fast multi-still QA: bundle once, render many frames.
// usage: node scripts/stills.mjs 22 85 145 200 262
import {bundle} from "@remotion/bundler";
import {renderStill, selectComposition} from "@remotion/renderer";
import path from "path";

const entry = path.resolve("remotion/index.ts");
const frames = process.argv.slice(2).map(Number);
if (!frames.length) frames.push(22, 85, 145, 200, 262);

const COMP = process.env.COMP || "ReelV3";
const serveUrl = await bundle({entryPoint: entry});
const composition = await selectComposition({serveUrl, id: COMP});
for (const frame of frames) {
  const output = `out/q-${frame}.png`;
  await renderStill({serveUrl, composition, output, frame, overwrite: true});
  console.log("still", frame, "->", output);
}
process.exit(0);
