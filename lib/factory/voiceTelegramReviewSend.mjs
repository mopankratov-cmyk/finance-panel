#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

function readDotenv(file) {
  if (!file || !existsSync(file)) return {};
  const env = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
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

const env = { ...readDotenv(argValue("dotenv", ".env.production.local")), ...process.env };
const token = env.FACTORY_TG_BOT_TOKEN || "";
const chatId = env.FACTORY_TG_CHAT_ID || "";
const batchId = argValue("batch", "yandex088");
const title = argValue("title", "Yandex 0.88 shortlist");

const items = [
  {
    candidateId: "alena_ssml_088",
    caption: "Yandex · alena · good · ssml pauses · speed 0.88",
    filePath: "/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex-naturalize/alena_ssml_088.mp3",
  },
  {
    candidateId: "jane_ssml_088",
    caption: "Yandex · jane · good · ssml pauses · speed 0.88",
    filePath: "/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex-naturalize/jane_ssml_088.mp3",
  },
  {
    candidateId: "alena_088_ssml_breath",
    caption: "Yandex · alena · longer breath pauses · speed 0.88",
    filePath: "/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex-088-segments/alena_088_ssml_breath.mp3",
  },
  {
    candidateId: "jane_088_ssml_breath",
    caption: "Yandex · jane · longer breath pauses · speed 0.88",
    filePath: "/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex-088-segments/jane_088_ssml_breath.mp3",
  },
].filter((item) => existsSync(item.filePath));

function api(method) {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function postJson(method, body) {
  const response = await fetch(api(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  return response.json().catch(() => ({ ok: false, error: `telegram ${response.status}: not json` }));
}

async function sendAudio(item, index) {
  const form = new FormData();
  const caption = [
    `№${index} · ${item.candidateId}`,
    `#voicebatch_${batchId} #v${index}`,
    item.caption,
    "Ответь цифрой на список или нажми кнопку.",
  ].join("\n").slice(0, 1024);

  form.set("chat_id", chatId);
  form.set("caption", caption);
  form.set("reply_markup", JSON.stringify({ inline_keyboard: [[
    { text: `✓ №${index} лучший`, callback_data: `vwin:${batchId}:${index}:${item.candidateId}` },
  ]] }));
  form.set("audio", new Blob([await readFile(item.filePath)], { type: "audio/mpeg" }), path.basename(item.filePath));

  const response = await fetch(api("sendAudio"), { method: "POST", body: form, signal: AbortSignal.timeout(45000) });
  return response.json().catch(() => ({ ok: false, error: `telegram ${response.status}: not json` }));
}

async function main() {
  if (!token) throw new Error("FACTORY_TG_BOT_TOKEN is required");
  if (!chatId) throw new Error("FACTORY_TG_CHAT_ID is required");
  if (!items.length) throw new Error("No local mp3 files found for the shortlist");

  const list = items.map((item, index) => `${index + 1}. ${item.candidateId} — ${item.caption}`).join("\n");
  const intro = [
    `Голосовой shortlist: ${title}`,
    `#voicebatch_${batchId}`,
    "",
    list,
    "",
    "Ответь на это сообщение номером лучшего: например 1 или 1,3.",
  ].join("\n");

  const introResult = await postJson("sendMessage", { chat_id: chatId, text: intro.slice(0, 4000) });
  const sent = [];
  for (let i = 0; i < items.length; i++) sent.push(await sendAudio(items[i], i + 1));
  console.log(JSON.stringify({ ok: sent.every((result) => result?.ok), intro: introResult?.ok, sent: sent.map((result) => ({ ok: result?.ok, error: result?.description || result?.error || null })) }, null, 2));
  if (!sent.every((result) => result?.ok)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
