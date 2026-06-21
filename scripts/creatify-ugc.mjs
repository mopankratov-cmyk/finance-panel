// Creatify UGC actor video for TT04101 (link_to_videos: actor + product b-roll).
// Keys from env: CREATIFY_API_ID + CREATIFY_API_KEY (set them in your shell, do NOT commit).
// Run:  CREATIFY_API_ID=… CREATIFY_API_KEY=… node scripts/creatify-ugc.mjs
// Output: out/creatify-ugc.mp4
import fs from "fs";

// load keys from local env files if not already in env (values never printed)
for (const file of [".env.local", ".env.vercel.pull"]) {
  try {
    const env = fs.readFileSync(file, "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*(CREATIFY_API_ID|CREATIFY_API_KEY)\s*=\s*(.+?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

const ID = process.env.CREATIFY_API_ID;
const KEY = process.env.CREATIFY_API_KEY;
if (!ID || !KEY) {
  console.error("НЕТ ключей: задай CREATIFY_API_ID и CREATIFY_API_KEY в env.");
  process.exit(1);
}
const BASE = "https://api.creatify.ai/api";
const H = {"X-API-ID": ID, "X-API-KEY": KEY, "Content-Type": "application/json"};

// Публичные фото товара (UGC покажет их как b-roll). Замени на рабочие URL карточки TT04101.
const IMAGES = (process.env.UGC_IMAGES || "").split(",").map((s) => s.trim()).filter(Boolean);

// Сценарий — проверенный «взрослый угол» (из Virlo-данных).
const SCRIPT =
  "Не показывай это детям. Это не игрушка — это водяной Узи. " +
  "Лупит очередями на восемь метров, светится, да ещё со звуком. " +
  "Купил, типа, детям — а теперь сам бегаю с ним по даче. " +
  "Восемьсот рублей, ищи «водяной Узи» на Вайлдберриз.";

async function jpost(path, body) {
  const r = await fetch(BASE + path, {method: "POST", headers: H, body: JSON.stringify(body)});
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return {ok: r.ok, status: r.status, json: j, text: t.slice(0, 300)};
}

// 0) баланс
{
  const r = await fetch(BASE + "/remaining_credits/", {headers: H});
  console.log("credits:", r.status, (await r.text()).slice(0, 120));
}
// 1) подобрать молодого мужского аватара (presenter/selfie)
let avatar = process.env.UGC_AVATAR || "";
if (!avatar) {
  const r = await fetch(BASE + "/personas/?gender=m&age_range=adult", {headers: H});
  const j = await r.json().catch(() => null);
  const arr = Array.isArray(j) ? j : j?.results || j?.data || [];
  avatar = arr[0]?.id || "";
  console.log("avatar picked:", avatar, arr[0]?.creator_name || "");
}
// 2) link c фото
let linkId = "";
if (IMAGES.length) {
  const lp = await jpost("/links/link_with_params/", {
    title: "Водяной пистолет УЗИ", description: "Электрический водяной бластер, 8 м, автоочередь, звук, 800 ₽", image_urls: IMAGES.slice(0, 8), video_urls: [],
  });
  console.log("link_with_params:", lp.status, JSON.stringify(lp.json || lp.text).slice(0, 160));
  linkId = lp.json?.id || "";
}
if (!linkId) { console.error("нет linkId — задай UGC_IMAGES (публичные URL фото товара)"); process.exit(1); }
// 3) создать видео
const created = await jpost("/link_to_videos/", {
  link: linkId, aspect_ratio: "9x16", video_length: 30, target_platform: "Tiktok", language: "ru",
  no_cta: true, override_script: SCRIPT, override_avatar: avatar, visual_style: "VlogTemplate", model_version: "aurora_v1_fast",
  no_stock_broll: true, no_background_music: true,
});
console.log("create:", created.status, JSON.stringify(created.json || created.text).slice(0, 200));
const vid = created.json?.id;
if (!vid) process.exit(1);
// 4) превью → render → poll
await jpost(`/link_to_videos/${vid}/generate_preview/`, {});
let url = "";
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 8000));
  const r = await fetch(`${BASE}/link_to_videos/${vid}/`, {headers: H});
  const j = await r.json().catch(() => ({}));
  if (j.status === "done" && (j.video_output || j.output)) { url = j.video_output || j.output; break; }
  if (j.status === "failed") { console.error("failed:", j.failed_reason); process.exit(1); }
  const hasPrev = !!j.preview || (Array.isArray(j.previews) && j.previews.length);
  if (hasPrev && (j.status === "pending" || j.status === "draft" || !j.status)) {
    await jpost(`/link_to_videos/${vid}/render/`, {});
  }
  console.log(`[${i}] status=${j.status}`);
}
if (!url) { console.error("таймаут рендера"); process.exit(1); }
// 5) скачать
const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
fs.mkdirSync("out", {recursive: true});
const outPath = process.env.UGC_OUT || "out/creatify-ugc.mp4";
fs.writeFileSync(outPath, buf);
console.log("OK →", outPath, buf.length, "bytes");
