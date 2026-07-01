#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const API = "https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize";
const DEFAULT_OUT_DIR = "/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex";
const DEFAULT_TEXT = "Я сначала вообще не поняла, зачем это нужно. Но потом попробовала и залипла: звучит просто, без ощущения рекламы, как обычный совет подруге.";

const CASES = [
  { id: "marina_friendly_092", voice: "marina", emotion: "friendly", speed: "0.92" },
  { id: "alena_good_090", voice: "alena", emotion: "good", speed: "0.90" },
  { id: "jane_good_092", voice: "jane", emotion: "good", speed: "0.92" },
  { id: "jane_neutral_090", voice: "jane", emotion: "neutral", speed: "0.90" },
  { id: "omazh_neutral_090", voice: "omazh", emotion: "neutral", speed: "0.90" },
  { id: "ermil_good_092", voice: "ermil", emotion: "good", speed: "0.92" },
  { id: "zahar_good_092", voice: "zahar", emotion: "good", speed: "0.92" },
  { id: "filipp_neutral_090", voice: "filipp", emotion: "neutral", speed: "0.90" },
];

function readDotenv(file) {
  if (!file || !existsSync(file)) return {};
  const env = {};
  const text = readFileSync(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : fallback;
}

function buildEnv() {
  const envFile = argValue("dotenv", ".env.production.local");
  return { ...readDotenv(envFile), ...process.env };
}

async function synthesize({ env, text, outDir, entry, includeFolder }) {
  const apiKey = (env.YANDEX_SPEECHKIT_API_KEY || env.YANDEX_API_KEY || "").trim();
  const iam = (env.YANDEX_SPEECHKIT_IAM_TOKEN || env.YANDEX_IAM_TOKEN || "").trim();
  const folderId = (env.YANDEX_SPEECHKIT_FOLDER_ID || env.YANDEX_FOLDER_ID || "").trim();

  const body = new URLSearchParams();
  body.set("text", text);
  body.set("lang", "ru-RU");
  body.set("voice", entry.voice);
  body.set("emotion", entry.emotion);
  body.set("speed", entry.speed);
  body.set("format", "mp3");
  if (includeFolder && folderId) body.set("folderId", folderId);

  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (apiKey) headers.Authorization = `Api-Key ${apiKey}`;
  else if (iam) headers.Authorization = `Bearer ${iam}`;
  else throw new Error("YANDEX_SPEECHKIT_API_KEY or YANDEX_SPEECHKIT_IAM_TOKEN is required");

  const response = await fetch(API, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(45000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return {
      ...entry,
      ok: false,
      status: response.status,
      error: detail.slice(0, 220),
      includeFolder,
    };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const file = path.join(outDir, `${entry.id}.mp3`);
  writeFileSync(file, buffer);
  return { ...entry, ok: true, bytes: buffer.length, file };
}

async function main() {
  const env = buildEnv();
  const outDir = argValue("out-dir", DEFAULT_OUT_DIR);
  const text = argValue("text", DEFAULT_TEXT);
  mkdirSync(outDir, { recursive: true });

  const results = [];
  for (const entry of CASES) {
    let result = await synthesize({ env, text, outDir, entry, includeFolder: false });
    const folderId = (env.YANDEX_SPEECHKIT_FOLDER_ID || env.YANDEX_FOLDER_ID || "").trim();
    if (!result.ok && folderId && (result.status === 400 || result.status === 403)) {
      result = await synthesize({ env, text, outDir, entry, includeFolder: true });
    }
    results.push(result);
  }

  console.log(JSON.stringify({ outDir, text, results }, null, 2));
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
