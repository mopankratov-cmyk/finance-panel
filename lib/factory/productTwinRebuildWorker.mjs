#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { apparelSourcePackRows, buildApparelSourcePack } from "./apparelSourcePack.ts";
import { bagSourcePackRows, buildBagSourcePack } from "./bagSourcePack.ts";
import { buildProductTwin } from "./productTwinBuild.ts";
import { inferProductName } from "./productTwinInventory.ts";
import { normalizeTwinCategory } from "./productTwin.ts";
import { withProductTwinPreviewUrls } from "./productTwinPreview.ts";

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
    process.env.FACTORY_TWIN_REBUILD_ENV_FILE,
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
  const envName = `FACTORY_TWIN_REBUILD_${name.toUpperCase().replace(/-/g, "_")}`;
  const raw = String(args.get(name) ?? process.env[envName] ?? fallback);
  return ["1", "true", "yes", "y"].includes(raw.toLowerCase());
}

function intArg(name, fallback, min, max) {
  const envName = `FACTORY_TWIN_REBUILD_${name.toUpperCase().replace(/-/g, "_")}`;
  const raw = Number(args.get(name) ?? process.env[envName] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function numberArg(name, fallback, min, max) {
  const envName = `FACTORY_TWIN_REBUILD_${name.toUpperCase().replace(/-/g, "_")}`;
  const raw = Number(args.get(name) ?? process.env[envName] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
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
    throw new Error(`${label} is required. Use --env-file or production/Railway env. Required: NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FAL_KEY/FAL_BILLING_KEY, YANDEX_DISK_OAUTH_TOKEN.`);
  }
  return value;
}

function cleanText(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function parseItems() {
  const itemsJson = cleanText(args.get("items") || process.env.FACTORY_TWIN_REBUILD_ITEMS, 100_000);
  if (itemsJson) {
    const parsed = JSON.parse(itemsJson);
    if (!Array.isArray(parsed)) throw new Error("--items must be a JSON array");
    return parsed.map((item) => {
      const article = cleanText(item.article, 80);
      const product = cleanText(item.product || item.name || inferProductName(article), 240);
      return { article, product };
    }).filter((item) => item.article);
  }
  const articles = cleanText(args.get("articles") || args.get("article") || process.env.FACTORY_TWIN_REBUILD_ARTICLES, 4000)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 100);
  const product = cleanText(args.get("product") || process.env.FACTORY_TWIN_REBUILD_PRODUCT, 240);
  return articles.map((article) => ({ article, product: product || inferProductName(article) }));
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function applySourcePack(db, item) {
  const category = normalizeTwinCategory(undefined, item.article, item.product);
  if (category !== "apparel" && category !== "bag") {
    return { ok: true, skipped: true, category, rows: 0 };
  }
  const built = category === "bag" ? await buildBagSourcePack(item) : await buildApparelSourcePack(item);
  if ("error" in built) return { ok: false, category, error: built.error, rows: 0 };
  const rows = category === "bag" ? bagSourcePackRows(built) : apparelSourcePackRows(built);
  const { error } = await db.from("content_assets").upsert(rows, { onConflict: "disk,path", ignoreDuplicates: false });
  if (error) return { ok: false, category, error: error.message, rows: 0 };
  return {
    ok: built.missingRoles.length === 0,
    category,
    rows: rows.length,
    missing_roles: built.missingRoles,
    primary_source_path: category === "bag" ? built.roles.front?.path || built.roles.three_quarter?.path : built.roles.clean_front?.path || built.roles.on_model_front?.path,
  };
}

function summarizeTwin(twin) {
  const previewTwin = withProductTwinPreviewUrls(twin);
  return {
    twin_id: twin.twinId,
    status: twin.status,
    quality: twin.qualityScore,
    source_path: twin.sourcePath || null,
    assets: previewTwin.assets.map((asset) => ({
      kind: asset.kind,
      path: asset.path || null,
      url: asset.url,
      preview_url: asset.preview_url,
      quality: asset.qualityScore,
      broll_ready: asset.brollReady,
      hero_ready: asset.heroReady,
      ugc_ready: asset.ugcReady,
    })),
  };
}

async function main() {
  const loadedEnvFiles = loadEnvFiles();
  const build = boolArg("build", false);
  const applySourcePacks = boolArg("apply-source-packs", false);
  const force = boolArg("force", true);
  const batchSize = intArg("batch-size", 2, 1, 5);
  const limit = intArg("limit", 20, 1, 100);
  const delayMs = intArg("delay-ms", 0, 0, 120_000);
  const minQuality = numberArg("min-quality", 0.68, 0, 1);
  const outDir = cleanText(args.get("out-dir") || process.env.FACTORY_TWIN_REBUILD_REPORT_DIR || "docs", 1000);
  const items = parseItems().slice(0, limit);
  if (!items.length) {
    throw new Error("Pass --article NV-08, --articles NV-08,NV-836, or --items JSON. Use --build true to spend FAL credits.");
  }

  if (build) {
    requiredEnv("FAL key", "FAL_KEY", "FAL_BILLING_KEY");
    requiredEnv("Yandex Disk token", "YANDEX_DISK_OAUTH_TOKEN", "YANDEX_OAUTH_TOKEN");
  }
  const db = build || applySourcePacks ? createClient(
    requiredEnv("Supabase URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  ) : null;

  const report = {
    generated_at: new Date().toISOString(),
    build,
    apply_source_packs: applySourcePacks,
    force,
    batch_size: batchSize,
    min_quality: minQuality,
    loaded_env_files: loadedEnvFiles,
    requested: items,
    results: [],
    ok: true,
  };

  let batchIndex = 0;
  for (const batch of chunk(items, batchSize)) {
    batchIndex += 1;
    console.log(JSON.stringify({ event: "batch_start", batch: batchIndex, articles: batch.map((item) => item.article) }));
    for (const item of batch) {
      const category = normalizeTwinCategory(undefined, item.article, item.product);
      const result = {
        article: item.article,
        product: item.product,
        category,
        batch: batchIndex,
        ok: false,
        source_pack: null,
        twin: null,
        error: null,
      };
      try {
        if (applySourcePacks) {
          result.source_pack = await applySourcePack(db, item);
          if (!result.source_pack.ok) report.ok = false;
        }
        if (!build) {
          result.ok = true;
          result.error = "dry_run: pass --build true to create Product Twins and upload assets to Yandex Disk";
          report.results.push(result);
          console.log(JSON.stringify(result));
          continue;
        }
        const built = await buildProductTwin({
          article: item.article,
          product: item.product,
          category,
          rebuild: force,
          force,
          minQuality,
        }, db);
        if (!built.ok) {
          result.error = built.error;
          report.ok = false;
          report.results.push(result);
          console.log(JSON.stringify(result));
          continue;
        }
        result.ok = true;
        result.twin = summarizeTwin(built.twin);
        report.results.push(result);
        console.log(JSON.stringify(result));
      } catch (error) {
        result.error = String(error?.message || error).slice(0, 500);
        report.ok = false;
        report.results.push(result);
        console.log(JSON.stringify(result));
      }
      if (delayMs) await sleep(delayMs);
    }
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "factory-product-twin-rebuild-report.json"), JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
