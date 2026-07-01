#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runNanoBananaEdit } from "./falImageEdit.ts";
import { pickBestTwinAsset } from "./productTwin.ts";
import { getLatestProductTwinByArticle, getProductTwinById } from "./productTwinStore.ts";
import { productTwinAssetPreviewUrl } from "./productTwinPreview.ts";
import { rehostImageForFal } from "./rehostImage.ts";
import { archiveExternalMediaToYandex } from "./yandexArchive.ts";

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
    process.env.FACTORY_TWIN_DERIVE_ENV_FILE,
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
  const envName = `FACTORY_TWIN_DERIVE_${name.toUpperCase().replace(/-/g, "_")}`;
  const raw = String(args.get(name) ?? process.env[envName] ?? fallback);
  return ["1", "true", "yes", "y"].includes(raw.toLowerCase());
}

function intArg(name, fallback, min, max) {
  const envName = `FACTORY_TWIN_DERIVE_${name.toUpperCase().replace(/-/g, "_")}`;
  const raw = Number(args.get(name) ?? process.env[envName] ?? fallback);
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
    throw new Error(`${label} is required. Use --env-file or production/Railway env. Required: NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FAL_KEY/FAL_BILLING_KEY, YANDEX_DISK_OAUTH_TOKEN.`);
  }
  return value;
}

function cleanText(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function cleanList(value, max = 100) {
  if (Array.isArray(value)) return value.map((item) => cleanText(item, 100)).filter(Boolean).slice(0, max);
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, max);
}

function parseTargets() {
  const itemsJson = cleanText(args.get("items") || process.env.FACTORY_TWIN_DERIVE_ITEMS, 100_000);
  if (itemsJson) {
    const parsed = JSON.parse(itemsJson);
    if (!Array.isArray(parsed)) throw new Error("--items must be a JSON array");
    return parsed.map((item) => ({
      article: cleanText(item.article, 80),
      twin_id: cleanText(item.twin_id || item.twinId, 140),
    })).filter((item) => item.article || item.twin_id);
  }
  const articles = cleanList(args.get("articles") || args.get("article") || process.env.FACTORY_TWIN_DERIVE_ARTICLES, 100);
  const twinIds = cleanList(args.get("twin-ids") || args.get("twin-id") || process.env.FACTORY_TWIN_DERIVE_TWIN_IDS, 100);
  return [
    ...articles.map((article) => ({ article, twin_id: "" })),
    ...twinIds.map((twin_id) => ({ article: "", twin_id })),
  ];
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function viewPrompt(twin, view) {
  return [
    view.prompt,
    twin.promptLibrary?.preserve_identity || "",
    twin.promptLibrary?.negative_identity ? `Avoid: ${twin.promptLibrary.negative_identity}.` : "",
    "No captions, no text overlays outside the real product, no extra products. Preserve product identity.",
  ].filter(Boolean).join(" ");
}

async function loadTwin(db, target) {
  if (target.twin_id) return getProductTwinById(db, target.twin_id);
  if (target.article) return getLatestProductTwinByArticle(db, target.article);
  return null;
}

async function insertViewAsset(db, twin, source, view, edit, archived) {
  const url = archived.yandex_url || edit.imageUrl;
  const pathValue = archived.yandex_path || null;
  const row = {
    disk: "product_twin",
    path: pathValue || `product-twins/${twin.article}/${twin.twinId}/views/${view.id}.png`,
    name: `${twin.article} · twin view · ${view.id}`.slice(0, 120),
    kind: "image",
    niche: twin.category,
    article: twin.article,
    color: null,
    url,
    analyzed: true,
    analysis: {
      product_twin: {
        twin_id: twin.twinId,
        article: twin.article,
        product_name: twin.productName,
        category: twin.category,
        source_kind: "derived_view",
        source_path: twin.sourcePath || null,
        status: "ready",
        canonical_asset_id: twin.canonicalAssetId,
        quality_score: twin.qualityScore,
        prompt_library: twin.promptLibrary,
        preparation_plan: twin.preparationPlan,
      },
      product_twin_view_asset: {
        view_id: view.id,
        label: view.label,
        purpose: view.purpose,
        truth: view.truth,
        source_asset_id: source.assetId,
        prompt_used: view.prompt,
        yandex_archive: archived,
      },
    },
  };
  const { error } = await db.from("content_assets").insert(row);
  return {
    view_id: view.id,
    ok: !error,
    url,
    preview_url: productTwinAssetPreviewUrl(url),
    path: pathValue,
    archive_status: archived.status,
    error: error?.message || archived.error || null,
  };
}

async function main() {
  const loadedEnvFiles = loadEnvFiles();
  const generate = boolArg("generate", false);
  const allowSynthetic = boolArg("allow-synthetic", false);
  const batchSize = intArg("batch-size", 1, 1, 3);
  const limit = intArg("limit", generate ? 5 : 30, 1, 30);
  const perTwinLimit = intArg("per-twin-limit", generate ? 5 : 30, 1, 30);
  const delayMs = intArg("delay-ms", 0, 0, 120_000);
  const outDir = cleanText(args.get("out-dir") || process.env.FACTORY_TWIN_DERIVE_REPORT_DIR || "docs", 1000);
  const viewIds = new Set(cleanList(args.get("view-ids") || args.get("view-id") || process.env.FACTORY_TWIN_DERIVE_VIEW_IDS, 50));
  const targets = parseTargets().slice(0, limit);
  if (!targets.length) throw new Error("Pass --article NV-08, --articles NV-08,NV-836, --twin-id <id>, or --items JSON. Use --generate true to spend FAL credits.");

  if (generate) {
    requiredEnv("FAL key", "FAL_KEY", "FAL_BILLING_KEY");
    requiredEnv("Yandex Disk token", "YANDEX_DISK_OAUTH_TOKEN", "YANDEX_OAUTH_TOKEN");
  }
  const db = createClient(
    requiredEnv("Supabase URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const report = {
    generated_at: new Date().toISOString(),
    generate,
    allow_synthetic: allowSynthetic,
    batch_size: batchSize,
    per_twin_limit: perTwinLimit,
    loaded_env_files: loadedEnvFiles,
    requested: targets,
    results: [],
    ok: true,
  };

  let batchIndex = 0;
  for (const batch of chunk(targets, batchSize)) {
    batchIndex += 1;
    console.log(JSON.stringify({ event: "batch_start", batch: batchIndex, targets: batch }));
    for (const target of batch) {
      const result = {
        article: target.article || null,
        twin_id: target.twin_id || null,
        batch: batchIndex,
        ok: false,
        mode: generate ? "generate_views" : "dry_run",
        source_asset_id: null,
        source_url: null,
        views: [],
        generated: [],
        error: null,
      };
      try {
        const twin = await loadTwin(db, target);
        if (!twin) {
          result.error = "twin not found";
          report.ok = false;
          report.results.push(result);
          console.log(JSON.stringify(result));
          continue;
        }
        result.article = twin.article;
        result.twin_id = twin.twinId;
        if (!twin.preparationPlan) {
          result.error = "twin has no preparation_plan; rebuild twin first";
          report.ok = false;
          report.results.push(result);
          console.log(JSON.stringify(result));
          continue;
        }
        const source = pickBestTwinAsset(twin.assets, "hero") || pickBestTwinAsset(twin.assets, "broll") || twin.assets[0];
        if (!source?.url) {
          result.error = "no source asset for derive";
          report.ok = false;
          report.results.push(result);
          console.log(JSON.stringify(result));
          continue;
        }
        const views = twin.preparationPlan.canonicalViews
          .filter((view) => view.purpose !== "clean")
          .filter((view) => allowSynthetic || view.truth !== "synthetic_candidate")
          .filter((view) => !viewIds.size || viewIds.has(view.id))
          .slice(0, perTwinLimit);
        result.source_asset_id = source.assetId;
        result.source_url = productTwinAssetPreviewUrl(source.url);
        result.views = views;
        if (!generate) {
          result.ok = true;
          report.results.push(result);
          console.log(JSON.stringify(result));
          continue;
        }
        const falSourceImage = await rehostImageForFal(source.url);
        for (const view of views) {
          const edit = await runNanoBananaEdit({ image: falSourceImage, prompt: viewPrompt(twin, view) });
          if (!edit.ok) {
            result.generated.push({ view_id: view.id, ok: false, error: edit.error, response_url: edit.responseUrl || null });
            report.ok = false;
            continue;
          }
          const archived = await archiveExternalMediaToYandex({
            sourceUrl: edit.imageUrl,
            kind: "image",
            article: twin.article,
            niche: twin.category,
            name: `${twin.twinId}-${view.id}`,
            subdir: "product-twin",
            folderSegments: [twin.article, twin.twinId, "views"],
          });
          const inserted = await insertViewAsset(db, twin, source, view, edit, archived);
          if (!inserted.ok) report.ok = false;
          result.generated.push(inserted);
          if (delayMs) await sleep(delayMs);
        }
        result.ok = result.generated.every((item) => item.ok);
        if (!result.ok) report.ok = false;
        report.results.push(result);
        console.log(JSON.stringify(result));
      } catch (error) {
        result.error = String(error?.message || error).slice(0, 500);
        report.ok = false;
        report.results.push(result);
        console.log(JSON.stringify(result));
      }
    }
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "factory-product-twin-derived-views-report.json"), JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
