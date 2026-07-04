#!/usr/bin/env node

import { spawn } from "node:child_process";

const BASE_URL = String(process.env.BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://finance-panel-two.vercel.app").replace(/\/$/, "");
const CRON_SECRET = String(process.env.CRON_SECRET || "").trim();
const SERVICE = String(process.env.REELS_BRAIN_RAILWAY_SERVICE || "reels-brain-media-2").trim();
const SKIP_DEPLOYS = String(process.env.REELS_BRAIN_RAILWAY_SKIP_DEPLOYS || "1").trim() !== "0";
const KEYS = [
  "APIFY_TOKEN",
  "APIFY_TIKTOK_ACTOR",
  "APIFY_INSTAGRAM_REELS_ACTOR",
  "APIFY_YOUTUBE_ACTOR",
];

function runRailwaySet(key, value) {
  return new Promise((resolve, reject) => {
    const args = ["variable", "set", key, "--stdin", "--service", SERVICE];
    if (SKIP_DEPLOYS) args.push("--skip-deploys");
    const child = spawn("railway", args, {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(stderr || stdout || `railway variable set ${key} failed with code ${code}`));
    });
    child.stdin.write(value);
    child.stdin.end();
  });
}

async function main() {
  if (!CRON_SECRET) {
    throw new Error("CRON_SECRET is required");
  }

  const response = await fetch(`${BASE_URL}/api/factory/jobs/reels-brain-env-bridge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CRON_SECRET}`,
    },
    body: JSON.stringify({ keys: KEYS }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`env bridge ${response.status}: ${text.slice(0, 400)}`);
  }

  const payload = await response.json();
  const values = payload?.values && typeof payload.values === "object" ? payload.values : {};
  const updated = [];

  for (const key of KEYS) {
    const value = String(values[key] || "");
    if (!value) continue;
    await runRailwaySet(key, value);
    updated.push(key);
  }

  console.log(JSON.stringify({
    ok: true,
    service: SERVICE,
    updated,
    skipped: KEYS.filter((key) => !updated.includes(key)),
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: String(error?.message || error).slice(0, 500),
  }));
  process.exit(1);
});
