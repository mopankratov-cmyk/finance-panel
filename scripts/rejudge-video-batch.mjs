#!/usr/bin/env node
// Ops-safe helper for post-deploy video rejudge.
// Example:
//   BASE_URL=https://your-domain CRON_SECRET=... node scripts/rejudge-video-batch.mjs \
//     --ids=39,38,14 --max-items=3 --apply

const args = process.argv.slice(2);
const opts = {};
for (const arg of args) {
  if (!arg.startsWith("--")) continue;
  const eq = arg.indexOf("=");
  if (eq > 0) opts[arg.slice(2, eq)] = arg.slice(eq + 1);
  else opts[arg.slice(2)] = true;
}

const baseUrl = String(opts.base || process.env.BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const secret = String(opts.secret || process.env.CRON_SECRET || "");
if (!baseUrl) {
  console.error("BASE_URL is required");
  process.exit(1);
}
if (!secret) {
  console.error("CRON_SECRET is required");
  process.exit(1);
}

const recipeIds = String(opts.ids || "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
const maxItems = Math.max(1, Math.min(10, Number(opts["max-items"] || opts.maxItems || (opts.apply ? 3 : 10)) || (opts.apply ? 3 : 10)));
const sinceHours = Math.max(1, Math.min(168, Number(opts["since-hours"] || opts.sinceHours || 72) || 72));
const apply = opts.apply === true || opts.apply === "true" || opts.apply === "1";

const body = {
  apply,
  max_items: maxItems,
  since_hours: sinceHours,
  ...(recipeIds.length ? { recipe_ids: recipeIds } : {}),
};

const res = await fetch(`${baseUrl}/api/factory/graph-run/rejudge`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${secret}`,
  },
  body: JSON.stringify(body),
});
const text = await res.text();
let json = null;
try { json = JSON.parse(text); } catch { /* keep raw text */ }

if (!res.ok) {
  console.error(JSON.stringify({ ok: false, status: res.status, body: json ?? text.slice(0, 500) }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(json ?? text, null, 2));
