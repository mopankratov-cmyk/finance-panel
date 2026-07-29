import assert from "node:assert/strict";
import test from "node:test";
import { confirmsUgcPublish, normalizeUgcCreativeInput, ugcPublishPhrase } from "../lib/ugc/validation";
import { pollUgcTask, signUgcTask, verifyUgcTask } from "../lib/ugc/task";

test("UGC input accepts only a known avatar and output kind", () => {
  assert.equal(normalizeUgcCreativeInput({ avatarId: "creator", kind: "video", brief: "  Домашняя сцена  " }).ok, true);
  assert.equal(normalizeUgcCreativeInput({ avatarId: "competitor", kind: "image" }).ok, false);
  assert.equal(normalizeUgcCreativeInput({ avatarId: "product", kind: "audio" }).ok, false);
});

test("live WB publication requires the exact article phrase", () => {
  assert.equal(ugcPublishPhrase("NORVIA-01"), "ОПУБЛИКОВАТЬ NORVIA-01");
  assert.equal(confirmsUgcPublish("NORVIA-01", "ОПУБЛИКОВАТЬ NORVIA-01"), true);
  assert.equal(confirmsUgcPublish("NORVIA-01", "опубликовать NORVIA-01"), false);
});

test("UGC task token binds a provider job to cabinet and SKU", async () => {
  const token = await signUgcTask({ provider: "higgsfield", jobId: "job-1", kind: "image", cabinetId: "cab-1", nmId: 1244157227, article: "NORVIA-01", avatarId: "creator" });
  const task = await verifyUgcTask(token);
  assert.equal(task?.cabinetId, "cab-1");
  assert.equal(task?.nmId, 1244157227);
  assert.equal(await verifyUgcTask(`${token}broken`), null);
});

test("temporary provider failures remain in the queue for an automatic retry", async () => {
  const originalFetch = globalThis.fetch;
  const originalCredentials = process.env.HF_CREDENTIALS;
  process.env.HF_CREDENTIALS = "test-credentials";
  globalThis.fetch = async () => new Response("temporarily unavailable", { status: 503 });
  try {
    const result = await pollUgcTask({ provider: "higgsfield", jobId: "job-1", kind: "image", cabinetId: "cab-1", nmId: 1244157227, article: "NORVIA-01", avatarId: "creator" });
    assert.equal(result.status, "generating");
    assert.match(result.error ?? "", /повторим автоматически/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCredentials === undefined) delete process.env.HF_CREDENTIALS;
    else process.env.HF_CREDENTIALS = originalCredentials;
  }
});
