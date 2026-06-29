#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { archiveFactoryVideosToYandex } from "./yandexArchive.ts";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const raw = process.argv[i] || "";
  if (!raw.startsWith("--")) continue;
  const [k, inline] = raw.slice(2).split("=");
  const next = inline ?? (process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : "true");
  args.set(k, next);
}

function intArg(name, fallback, min, max) {
  const value = Number(args.get(name) || process.env[`FACTORY_YANDEX_${name.toUpperCase()}`] || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function boolArg(name, fallback = false) {
  const raw = String(args.get(name) ?? process.env[`FACTORY_YANDEX_${name.toUpperCase()}`] ?? fallback);
  return ["1", "true", "yes", "y"].includes(raw.toLowerCase());
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
    if ((ch === '"' || ch === "'") && value[i - 1] !== "\\") {
      quote = quote === ch ? "" : quote || ch;
    }
    if (ch === "#" && !quote && /\s/.test(value[i - 1] || "")) {
      return value.slice(0, i).trim();
    }
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
    process.env.FACTORY_YANDEX_ENV_FILE,
    ".env.local",
    ".env.production.local",
    ".env.vercel.local",
    ".env.vercel.production.local",
    ".env",
    "/Users/maksimpankratov/finance-panel/.env.local",
    "/Users/maksimpankratov/finance-panel/.env.production.local",
  ].filter(Boolean);
  const loaded = [];
  for (const file of candidates) {
    const resolved = path.resolve(String(file));
    if (loadEnvFile(resolved)) loaded.push(resolved);
  }
  return loaded;
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
    throw new Error(`${label} is required. Put it in .env.local or pass --env-file /path/to/env. Required keys: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, YANDEX_DISK_OAUTH_TOKEN.`);
  }
  return value;
}

function itemSummary(item) {
  return {
    id: item.id,
    kind: item.kind || null,
    status: item.status,
    yandex_path: item.yandex_path,
    error: item.error || null,
  };
}

function markdown(report) {
  const lines = [
    "# Factory Yandex Archive Report",
    "",
    `- generated_at: ${report.generated_at}`,
    `- apply: ${report.apply}`,
    `- target: ${report.target}`,
    `- batch_limit: ${report.batch_limit}`,
    `- max_batches: ${report.max_batches}`,
    `- uploaded: ${report.uploaded}`,
    `- failed: ${report.failed}`,
    `- remaining_candidates: ${report.remaining_candidates}`,
    "",
    "## Batches",
    "",
  ];
  for (const batch of report.batches) {
    lines.push(`### Batch ${batch.index}`);
    lines.push(`- status: ${batch.status}`);
    lines.push(`- candidates: ${batch.candidates}`);
    lines.push(`- uploaded: ${batch.uploaded || 0}`);
    lines.push(`- failed: ${batch.failed || 0}`);
    for (const item of (batch.items || []).slice(0, 10)) {
      lines.push(`- #${item.id} ${item.kind || "media"} ${item.status}${item.error ? `: ${item.error}` : ""}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const loadedEnvFiles = loadEnvFiles();
  const apply = boolArg("apply", false);
  const batchLimit = intArg("limit", 5, 1, 50);
  const maxBatches = intArg("batches", 1, 1, 500);
  const includeArchived = boolArg("include_archived", false);
  const outDir = String(args.get("out-dir") || process.env.FACTORY_YANDEX_REPORT_DIR || "docs").trim();

  const db = createClient(requiredEnv("Supabase URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const report = {
    generated_at: new Date().toISOString(),
    apply,
    target: process.env.YANDEX_DISK_FACTORY_ARCHIVE_PATH || "/content-factory/archive",
    batch_limit: batchLimit,
    max_batches: maxBatches,
    loaded_env_files: loadedEnvFiles,
    uploaded: 0,
    failed: 0,
    remaining_candidates: null,
    batches: [],
  };

  for (let index = 1; index <= maxBatches; index += 1) {
    const snapshot = await archiveFactoryVideosToYandex(db, { apply, limit: batchLimit, includeArchived });
    const batch = {
      index,
      ok: snapshot.ok,
      status: snapshot.status,
      candidates: snapshot.candidates || 0,
      uploaded: snapshot.uploaded || 0,
      failed: snapshot.failed || 0,
      items: (snapshot.items || []).map(itemSummary),
    };
    report.batches.push(batch);
    report.uploaded += batch.uploaded;
    report.failed += batch.failed;
    report.remaining_candidates = snapshot.candidates || 0;
    console.log(JSON.stringify(batch));
    if (!apply || !snapshot.candidates || snapshot.candidates < batchLimit) break;
    if (batch.uploaded === 0 && batch.failed > 0) {
      console.error("Stopping: current batch had failures and no uploads.");
      break;
    }
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "factory-yandex-archive-report.json"), JSON.stringify(report, null, 2));
  await writeFile(path.join(outDir, "factory-yandex-archive-report.md"), markdown(report));
  if (report.failed) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
