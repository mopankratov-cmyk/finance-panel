#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { apparelSourcePackRows, buildApparelSourcePack } from "./apparelSourcePack.ts";
import { bagSourcePackRows, buildBagSourcePack } from "./bagSourcePack.ts";
import { normalizeTwinCategory } from "./productTwin.ts";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const raw = process.argv[i] || "";
  if (!raw.startsWith("--")) continue;
  const [key, inline] = raw.slice(2).split("=");
  const next = inline ?? (process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : "true");
  args.set(key, next);
}

function unquoteEnv(value) {
  const raw = String(value || "").trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) return raw.slice(1, -1);
  return raw;
}

function stripInlineComment(value) {
  let quote = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if ((ch === '"' || ch === "'") && value[i - 1] !== "\\") quote = quote === ch ? "" : quote || ch;
    if (ch === "#" && !quote && /\s/.test(value[i - 1] || "")) return value.slice(0, i).trim();
  }
  return value.trim();
}

function loadEnvFile(file) {
  if (!file || !existsSync(file)) return false;
  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = unquoteEnv(stripInlineComment(rawValue));
  }
  return true;
}

function loadEnvFiles() {
  const candidates = [
    args.get("env-file"),
    process.env.FACTORY_SOURCE_PACK_ENV_FILE,
    ".env.local",
    ".env.production.local",
    ".env.vercel.local",
    ".env.vercel.production.local",
    ".env",
  ].filter(Boolean);
  const loaded = [];
  for (const file of candidates) {
    const resolved = path.resolve(String(file));
    if (loadEnvFile(resolved)) loaded.push(resolved);
  }
  return loaded;
}

function boolArg(name, fallback = false) {
  const raw = String(args.get(name) ?? process.env[`FACTORY_SOURCE_PACK_${name.toUpperCase()}`] ?? fallback);
  return ["1", "true", "yes", "y"].includes(raw.toLowerCase());
}

function intArg(name, fallback, min, max) {
  const raw = Number(args.get(name) ?? process.env[`FACTORY_SOURCE_PACK_${name.toUpperCase()}`] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function envValue(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function requiredEnv(label, ...names) {
  const value = envValue(...names);
  if (!value) {
    throw new Error(`${label} is required. Use --env-file or production env. Required: NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`);
  }
  return value;
}

function cleanText(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function parseArticles() {
  const itemsJson = cleanText(args.get("items") || process.env.FACTORY_SOURCE_PACK_ITEMS, 100_000);
  if (itemsJson) {
    const parsed = JSON.parse(itemsJson);
    if (!Array.isArray(parsed)) throw new Error("--items must be a JSON array");
    return parsed.map((item) => ({
      article: cleanText(item.article, 80),
      product: cleanText(item.product || item.name || item.article, 240),
    })).filter((item) => item.article);
  }
  const articles = cleanText(args.get("articles") || args.get("article") || process.env.FACTORY_SOURCE_PACK_ARTICLES, 4000)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 100);
  const product = cleanText(args.get("product") || process.env.FACTORY_SOURCE_PACK_PRODUCT, 240);
  return articles.map((article) => ({ article, product: product || article }));
}

function summarizePack(pack, rows, applyResult) {
  return {
    article: pack.article,
    product: pack.product,
    category: pack.category,
    ok: !pack.missingRoles.length,
    inserted: applyResult?.inserted || 0,
    error: applyResult?.error || null,
    missing_roles: pack.missingRoles,
    rows: rows.length,
    roles: Object.fromEntries(Object.entries(pack.roles).map(([role, asset]) => [role, asset ? {
      path: asset.path,
      score: asset.score,
      reasons: asset.reasons,
    } : null])),
  };
}

async function buildSourcePack(item) {
  const category = normalizeTwinCategory(undefined, item.article, item.product);
  if (category === "bag") {
    const pack = await buildBagSourcePack(item);
    if ("error" in pack) return { error: pack.error };
    return { pack, rows: bagSourcePackRows(pack) };
  }
  const pack = await buildApparelSourcePack(item);
  if ("error" in pack) return { error: pack.error };
  return { pack, rows: apparelSourcePackRows(pack) };
}

async function main() {
  const loadedEnvFiles = loadEnvFiles();
  const apply = boolArg("apply", false);
  const limit = intArg("limit", 20, 1, 100);
  const outDir = cleanText(args.get("out-dir") || process.env.FACTORY_SOURCE_PACK_REPORT_DIR || "docs", 1000);
  const items = parseArticles().slice(0, limit);
  if (!items.length) throw new Error("Pass --article NV-08, --articles NV-08,NV-836, or --items JSON.");

  const db = apply ? createClient(
    requiredEnv("Supabase URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  ) : null;

  const report = {
    generated_at: new Date().toISOString(),
    apply,
    loaded_env_files: loadedEnvFiles,
    requested: items,
    results: [],
    ok: true,
  };

  for (const item of items) {
    const built = await buildSourcePack(item);
    if ("error" in built) {
      report.ok = false;
      report.results.push({ article: item.article, product: item.product, ok: false, error: built.error });
      console.log(JSON.stringify(report.results.at(-1)));
      continue;
    }
    const { pack, rows } = built;
    let applyResult = null;
    if (apply) {
      const { error } = await db.from("content_assets").upsert(rows, { onConflict: "disk,path", ignoreDuplicates: false });
      applyResult = error ? { error: error.message, inserted: 0 } : { inserted: rows.length };
      if (error) report.ok = false;
    }
    const summary = summarizePack(pack, rows, applyResult);
    if (!summary.ok) report.ok = false;
    report.results.push(summary);
    console.log(JSON.stringify(summary));
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "factory-apparel-source-pack-report.json"), JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
