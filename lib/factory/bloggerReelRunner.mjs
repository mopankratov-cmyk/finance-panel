// Конвейер «артикул → товарный сегмент блогера» одной командой:
// композит (Seedream v4.5) → анимация (OmniHuman 1.5) → анти-AI пост (ffmpeg)
// → кадровая полоса для ревью → (опц.) отправка в Telegram владельцу.
// Дефолт dry-run; деньги только за --confirm-paid true. Состояние в state.json (resume).
//
// npx tsx lib/factory/bloggerReelRunner.mjs \
//   --persona manya --look-name look__manya__02__kitchen_close \
//   --product-image /path/to/product.png --label-text "АКТИВ КРЕМ" \
//   --script-text "Вот этот крем.<#0.3#> Две недели пользуюсь." \
//   --ffmpeg /path/to/ffmpeg --confirm-paid true --send-tg false

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  PRODUCT_ANIMATE_MODEL,
  PRODUCT_COMPOSITE_MODEL,
  buildProductAnimatePrompt,
  buildProductCompositePrompt,
} from "./productComposite.ts";
import { buildAntiAiPassArgs } from "./antiAiPost.ts";

const GROUPS = {
  manya: "fc29c149d7994673b254dd121c1dc516",
  vika: "1b2482bea0a843fa83ae0e02619b5c61",
  olya: "3379c2f78ac145edb7fa67417e698013",
};

function argValue(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] || fallback;
}
const boolArg = (name) => argValue(name, "false") === "true";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readDotenv(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=["']?(.*?)["']?$/);
      if (m) out[m[1]] = m[2];
    }
  } catch {}
  return out;
}
const ENV = { ...readDotenv(".env.production.local"), ...readDotenv(".env.local"), ...process.env };

const rawFetch = globalThis.fetch;
async function fetchRetry(url, init = {}, tries = 5) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try { return await rawFetch(url, { ...init, signal: AbortSignal.timeout(30_000) }); }
    catch (e) { last = e; await sleep(1500 * i); }
  }
  throw last;
}

async function falQueue(model, body, state, stageKey, maxWaitMs = 720_000) {
  const key = ENV.FAL_KEY || ENV.FAL_BILLING_KEY;
  if (!key) throw new Error("FAL_KEY required");
  let responseUrl = state[`${stageKey}_response_url`];
  if (!responseUrl) {
    const sub = await fetchRetry(`https://queue.fal.run/${model}`, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!sub.ok) throw new Error(`${model} submit ${sub.status}: ${(await sub.text()).slice(0, 250)}`);
    responseUrl = (await sub.json()).response_url;
    state[`${stageKey}_response_url`] = responseUrl; // урок v4: сохранять для resume
  }
  const deadline = Date.now() + maxWaitMs;
  let completed = false;
  while (Date.now() < deadline) {
    await sleep(5000);
    try {
      const st = await fetchRetry(`${responseUrl}/status`, { headers: { Authorization: `Key ${key}` } }, 3);
      if (st.ok) {
        const s = await st.json();
        if (s.status === "COMPLETED") { completed = true; break; }
        if (s.status === "FAILED") throw new Error(`${model} FAILED`);
      }
    } catch (e) {
      if (String(e.message).includes("FAILED")) throw e;
    }
  }
  if (!completed) throw new Error(`${model} timeout; resume later, response_url is in state.json`);
  const res = await fetchRetry(responseUrl, { headers: { Authorization: `Key ${key}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${model} result ${res.status}: ${text.slice(0, 250)}`);
  return JSON.parse(text);
}

async function uploadToFal(localPath, contentType, fileName) {
  const key = ENV.FAL_KEY || ENV.FAL_BILLING_KEY;
  const init = await fetchRetry("https://rest.alpha.fal.ai/storage/upload/initiate", {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content_type: contentType, file_name: fileName }),
  });
  const ij = await init.json();
  await fetchRetry(ij.upload_url, { method: "PUT", headers: { "Content-Type": contentType }, body: readFileSync(localPath) });
  return ij.file_url;
}

async function download(url, dest) {
  writeFileSync(dest, Buffer.from(await (await fetchRetry(url)).arrayBuffer()));
}

function runFfmpeg(ffmpeg, args) {
  const r = spawnSync(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${String(r.stderr).slice(-300)}`);
}

async function main() {
  const persona = argValue("--persona");
  const lookName = argValue("--look-name");
  const productImage = argValue("--product-image");
  const labelText = argValue("--label-text");
  const scriptText = argValue("--script-text");
  const ffmpeg = argValue("--ffmpeg");
  const runId = argValue("--run-id", `${persona}-${(lookName || "").split("__").pop()}`);
  const outDir = join(argValue("--out-dir", "/tmp/ugc-factory-reels"), runId);
  if (!persona || !GROUPS[persona]) throw new Error("--persona manya|vika|olya required");
  if (!lookName || !productImage || !labelText || !scriptText) {
    throw new Error("--look-name, --product-image, --label-text, --script-text required");
  }
  mkdirSync(outDir, { recursive: true });
  const statePath = join(outDir, "state.json");
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
  const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));

  const plan = {
    persona, lookName, labelText,
    composite_prompt: buildProductCompositePrompt({
      lookImageUrl: "<look>", productImageUrl: "<product>", labelText,
      wardrobeHint: argValue("--wardrobe"), productGeometryHint: argValue("--geometry"),
    }),
    animate_prompt: buildProductAnimatePrompt(argValue("--liveness", "natural")),
  };
  writeFileSync(join(outDir, "plan.json"), JSON.stringify(plan, null, 2));
  if (!boolArg("--confirm-paid")) {
    console.log(JSON.stringify({ ok: true, mode: "dry-run", plan_path: join(outDir, "plan.json") }, null, 2));
    return;
  }

  try {
    // look image из HeyGen-группы
    if (!state.look_url) {
      const hgKey = ENV.HEYGEN_API_KEY;
      if (!hgKey) throw new Error("HEYGEN_API_KEY required");
      const avatars = (await (await fetchRetry(`https://api.heygen.com/v2/avatar_group/${GROUPS[persona]}/avatars`, { headers: { "x-api-key": hgKey } })).json())?.data?.avatar_list || [];
      const look = avatars.find((a) => a.name === lookName);
      if (!look?.image_url) throw new Error(`look ${lookName} not found`);
      state.look_url = look.image_url;
      save();
    }
    if (!state.product_url) {
      state.product_url = /^https?:/.test(productImage) ? productImage : await uploadToFal(productImage, "image/png", "product.png");
      save();
    }

    if (!state.composite_url) {
      console.log("STAGE composite");
      const comp = await falQueue(PRODUCT_COMPOSITE_MODEL, {
        prompt: buildProductCompositePrompt({
          lookImageUrl: state.look_url, productImageUrl: state.product_url, labelText,
          wardrobeHint: argValue("--wardrobe"), productGeometryHint: argValue("--geometry"),
        }),
        image_urls: [state.look_url, state.product_url],
        num_images: 2,
        image_size: { width: 1152, height: 2048 },
      }, state, "composite");
      const urls = (comp.images || []).map((i) => i.url);
      for (let i = 0; i < urls.length; i++) await download(urls[i], join(outDir, `composite-${i + 1}.png`));
      state.composite_url = urls[0];
      state.composite_urls = urls;
      save();
    }

    if (!state.tts_url) {
      console.log("STAGE tts");
      const tts = await falQueue("fal-ai/minimax/speech-02-hd", {
        text: scriptText, output_format: "url", language_boost: "Russian",
        voice_setting: { voice_id: argValue("--voice", "Calm_Woman"), speed: 0.92, pitch: -1, emotion: argValue("--emotion", "happy") },
        audio_setting: { sample_rate: 24000, bitrate: 128000, format: "mp3", channel: 1 },
      }, state, "tts");
      state.tts_url = tts?.audio?.url;
      save();
    }

    if (!state.video_url) {
      console.log("STAGE animate");
      const vid = await falQueue(PRODUCT_ANIMATE_MODEL, {
        image_url: argValue("--composite-pick") ? state.composite_urls[Number(argValue("--composite-pick")) - 1] : state.composite_url,
        audio_url: state.tts_url,
        prompt: buildProductAnimatePrompt(argValue("--liveness", "natural")),
      }, state, "animate");
      state.video_url = vid?.video?.url || vid?.video_url;
      await download(state.video_url, join(outDir, "raw.mp4"));
      save();
    }

    if (ffmpeg && !state.post_done) {
      console.log("STAGE post");
      const graded = join(outDir, "graded.mp4");
      const final = join(outDir, "final.mp4");
      const { passA, passB } = buildAntiAiPassArgs(join(outDir, "raw.mp4"), final);
      runFfmpeg(ffmpeg, [...passA, graded]);
      runFfmpeg(ffmpeg, passB(graded));
      runFfmpeg(ffmpeg, ["-y", "-i", final, "-vf", "fps=1/1.2,scale=380:-1,tile=5x1", "-frames:v", "1", join(outDir, "strip.jpg")]);
      state.post_done = true;
      save();
    }

    if (boolArg("--send-tg")) {
      console.log("STAGE telegram");
      const token = ENV.FACTORY_TG_BOT_TOKEN;
      const chat = ENV.FACTORY_TG_CHAT_ID;
      if (!token || !chat) throw new Error("FACTORY_TG_BOT_TOKEN/CHAT_ID required");
      const form = new FormData();
      form.append("chat_id", chat);
      form.append("video", new Blob([readFileSync(join(outDir, state.post_done ? "final.mp4" : "raw.mp4"))], { type: "video/mp4" }), "reel.mp4");
      form.append("caption", argValue("--caption", `${persona} · ${lookName} · ${labelText}`));
      const res = await rawFetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: "POST", body: form });
      const d = await res.json();
      if (!d.ok) throw new Error(`tg send failed: ${JSON.stringify(d).slice(0, 200)}`);
      state.tg_sent = true;
      save();
    }
  } finally {
    save();
  }
  console.log(JSON.stringify({ ok: true, out_dir: outDir, video: state.video_url ? "done" : "pending", post: !!state.post_done, tg: !!state.tg_sent }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(String(e?.stack || e)); process.exit(1); });
}
