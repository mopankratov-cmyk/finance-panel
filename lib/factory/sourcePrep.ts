// Source-prep — ПРЕДПРОИЗВОДСТВО товара (upstream, до нод; симметрично анализу ниш). Из WB-инфографики
// (плашки/текст/watermark — весь контент fashion-категории) делает чистый студийный кадр + аэстетичный
// стейдж, пригодный для i2v. Движок — Nano Banana (Gemini Flash Image) через fal (лучший по identity-
// preservation товара + релайт; доступен из РФ через наш FAL_KEY, Google напрямую заблокирован). Фолбэк —
// Seedream v4 (пиксель-фиделити лого/текста). Результат durable в наш бакет (fal.media эфемерна) + строка
// content_assets(disk='prepared') → assetBind отдаёт его нодам ВМЕСТО сырого WB. Решение подтверждено вживую
// (CLR01012: инфографика → лайфстайл сумка в кафе). ⚠️ Nano ОТКЛОНЯЕТ «remove watermark/logo» → формулируем
// как «recreate clean product photo» + safety_tolerance=6.
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { rehostImageForFal } from "./rehostImage";
import { buildEditPrompt, categoryFor, defaultSceneFor } from "./editPrompts";
import { canonicalFrameMeta, normalizeToOutputRes, shouldMarkCanonical } from "./canonicalFrame";

const QUEUE = "https://queue.fal.run/";
const NANO = "fal-ai/nano-banana/edit";
const SEEDREAM = "fal-ai/bytedance/seedream/v4/edit"; // фолбэк: мульти-референс, 4K, лучше мелкий текст/лого
const BUCKET = "factory-media";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const falKey = () => process.env.FAL_KEY || "";

// Тело запроса ПО МОДЕЛИ (params различаются — общее тело слало Seedream безответные safety_tolerance/output_format
// → риск 422, фолбэк мог не работать; и без явного размера обе модели дают ~квадрат → рилс кадрируется).
// op='stage' → вертикаль 9:16 (это i2v-источник), op='clean' → 1:1 (изолированный товар, чёткость лого). По докам fal.
function editBody(model: string, imageUrls: string[], prompt: string, op: "clean" | "stage"): Record<string, unknown> {
  const base = { prompt, image_urls: imageUrls, num_images: 1 };
  if (model === SEEDREAM) {
    return { ...base, image_size: op === "stage" ? "portrait_16_9" : "square_hd", enable_safety_checker: false, enhance_prompt_mode: "standard" };
  }
  // Nano (Gemini Flash Image edit)
  return { ...base, aspect_ratio: op === "stage" ? "9:16" : "1:1", safety_tolerance: "6", output_format: "png" };
}

type EditResult = { ok: true; url: string; model: string } | { ok: false; error: string };

function shortError(value: unknown, max = 220): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function queueUrls(model: string, submitted: { request_id?: string; response_url?: string; status_url?: string }) {
  const base = `${QUEUE}${model}`;
  const responseUrl = submitted.response_url || (submitted.request_id ? `${base}/requests/${submitted.request_id}` : "");
  const statusUrl = submitted.status_url || (responseUrl ? `${responseUrl}/status` : "");
  return { responseUrl, statusUrl };
}

// один edit-вызов (Nano → при провале Seedream) → URL результата на fal.media. Best-effort, но с диагностикой.
async function edit(imageUrls: string[], prompt: string, op: "clean" | "stage", maxWaitMs = 110_000): Promise<EditResult> {
  const k = falKey();
  if (!k || !imageUrls.length) return { ok: false, error: !k ? "FAL_KEY missing" : "empty image_urls" };
  const auth = { Authorization: `Key ${k}`, "Content-Type": "application/json" };
  const failures: string[] = [];
  for (const model of [NANO, SEEDREAM]) {
    try {
      const sub = await fetch(`${QUEUE}${model}`, {
        method: "POST", headers: auth, cache: "no-store",
        body: JSON.stringify(editBody(model, imageUrls, prompt, op)),
        signal: AbortSignal.timeout(25_000),
      });
      const sj = (await sub.json().catch(async () => ({ raw: await sub.text().catch(() => "") }))) as { request_id?: string; response_url?: string; status_url?: string; detail?: unknown; error?: unknown; raw?: unknown };
      if (!sub.ok) {
        failures.push(`${model} submit ${sub.status}: ${shortError(sj.detail || sj.error || sj.raw)}`);
        continue;
      }
      const { responseUrl, statusUrl } = queueUrls(model, sj);
      if (!responseUrl || !statusUrl) {
        failures.push(`${model} submit: no request url`);
        continue;
      }
      const deadline = Date.now() + maxWaitMs;
      let done = false;
      while (Date.now() < deadline) {
        await sleep(4000);
        const st = await fetch(statusUrl, { headers: { Authorization: `Key ${k}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) }).catch(() => null);
        if (!st?.ok) continue;
        const s = (await st.json().catch(() => ({}))) as { status?: string; error?: unknown; detail?: unknown };
        const status = String(s.status || "").toUpperCase();
        if (status === "COMPLETED") { done = true; break; }
        if (status === "FAILED" || status === "ERROR") {
          failures.push(`${model} ${status.toLowerCase()}: ${shortError(s.error || s.detail)}`);
          break;
        }
      }
      if (!done) {
        failures.push(`${model} timeout`);
        continue;
      }
      const res = await fetch(responseUrl, { headers: { Authorization: `Key ${k}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const rj = (await res.json().catch(async () => ({ raw: await res.text().catch(() => "") }))) as { images?: { url?: string }[]; error?: unknown; detail?: unknown; raw?: unknown };
      if (!res.ok) {
        failures.push(`${model} result ${res.status}: ${shortError(rj.error || rj.detail || rj.raw)}`);
        continue;
      }
      const url = rj?.images?.[0]?.url;
      if (url) return { ok: true, url, model }; // успех на этом движке
      failures.push(`${model} result: no image url`);
    } catch (e) {
      failures.push(`${model} crash: ${shortError((e as Error)?.message || e)}`);
    }
  }
  return { ok: false, error: failures.join(" | ").slice(0, 500) || "all edit engines failed" };
}

// промпты — детерминированный сборщик по категории (Lock/Change/Amount/Constraints), см. lib/factory/editPrompts.ts
// и docs/factory-prompting-canon.md. Раньше тут было 2 хардкода без вариаций по нише — главная дыра качества.

export interface PrepResult { ok: boolean; cleanUrl?: string; stagedUrl?: string; error?: string }

async function uploadPreparedImage(buf: Buffer, path: string): Promise<string | null> {
  const db = getSupabaseAdmin();
  if (!db || !buf.length) return null;
  const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: "image/png", upsert: true, cacheControl: "31536000" });
  if (error) return null;
  return db.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl || null;
}

export async function prepareProductImageFallback(
  srcUrl: string,
  opts: { article: string; niche?: string; product?: string; scene?: string },
): Promise<PrepResult> {
  if (!srcUrl) return { ok: false, error: "нет srcUrl" };
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "нет supabase-admin" };
  try {
    const source = await rehostImageForFal(srcUrl);
    const r = await fetch(source, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return { ok: false, error: `fallback download ${r.status}` };
    const input = Buffer.from(await r.arrayBuffer());
    if (!input.length) return { ok: false, error: "fallback empty image" };

    const bg = await sharp(input)
      .resize(1080, 1920, { fit: "cover" })
      .blur(24)
      .modulate({ brightness: 0.82, saturation: 0.88 })
      .png()
      .toBuffer();
    const fg = await sharp(input)
      .resize(920, 1280, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    const stagedRaw = await sharp(bg)
      .composite([{ input: fg, gravity: "center" }])
      .png()
      .toBuffer();
    const staged = await normalizeToOutputRes(stagedRaw);
    const path = `prepared/${opts.article}/${createHash("sha1").update(`${srcUrl}:fallback:v1`).digest("hex").slice(0, 12)}-fallback-staged.png`;
    const stagedUrl = await uploadPreparedImage(staged, path);
    if (!stagedUrl) return { ok: false, error: "fallback persist failed" };
    const category = categoryFor(opts.article || "", opts.product || "");
    const scene = (opts.scene || defaultSceneFor(category)).slice(0, 240);
    const markCanonical = await shouldMarkCanonical(db, opts.article);
    await db.from("content_assets").insert({
      disk: "prepared",
      path,
      name: `${opts.article} · prepared fallback`.slice(0, 120),
      kind: "image",
      niche: opts.niche || null,
      article: opts.article || null,
      color: null,
      url: stagedUrl,
      analyzed: true,
      analysis: markCanonical ? canonicalFrameMeta({
        source_url: srcUrl,
        stage: "fallback_staged",
        scene,
        category,
        engine: "source-copy-fallback",
        product: (opts.product || "product").slice(0, 120),
        prompt_used: "No-FAL deterministic source prep: vertical blurred product background with centered product frame.",
      }) : {
        source_url: srcUrl,
        stage: "fallback_staged",
        scene,
        category,
        engine: "source-copy-fallback",
        product: (opts.product || "product").slice(0, 120),
        prompt_used: "No-FAL deterministic source prep: vertical blurred product background with centered product frame.",
        output_w: 720,
        output_h: 1280,
        aspect: "9:16",
        letterboxed: true,
      },
    });
    return { ok: true, stagedUrl };
  } catch (e) {
    return { ok: false, error: "fallback prepare failed: " + String((e as Error)?.message || e).slice(0, 140) };
  }
}

// Подготовить ОДИН товарный кадр: clean → stage → durable в бакет + строка content_assets(disk='prepared').
// srcUrl — сырое WB-фото (инфографика). Возвращает durable-URL стейджа (или чистого, если стейдж не вышел).
export async function prepareProductImage(
  srcUrl: string, opts: { article: string; niche?: string; product?: string; scene?: string },
): Promise<PrepResult> {
  if (!srcUrl) return { ok: false, error: "нет srcUrl" };
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "нет supabase-admin" };
  const product = (opts.product || "product").slice(0, 120);
  // категория (через тот же detectBrand, что и копирайтер) → шаблон под нишу; сцена оператора или дефолт ниши
  const category = categoryFor(opts.article || "", opts.product || "");
  const scene = (opts.scene || defaultSceneFor(category)).slice(0, 240);
  const cleanP = buildEditPrompt({ category, op: "clean", product });
  const stageP = buildEditPrompt({ category, op: "stage", product, scene });

  // WB-CDN флапает на серверной загрузке fal → рехостим исходник в наш бакет (как в i2v). Best-effort.
  const src = await rehostImageForFal(srcUrl);
  const cleanFal = await edit([src], cleanP, "clean");
  if (!cleanFal.ok) return { ok: false, error: `clean-шаг не дал результата: ${cleanFal.error}` };
  // стейдж: clean + рехостнутый оригинал как identity-якорь (Nano иногда дрейфит лого при смене фона).
  // null = стейдж не вышел → НЕ персистим staged (иначе prompt_used врал бы про несостоявшийся стейдж); останется чистый кадр.
  const stagedFal = await edit([cleanFal.url, src], stageP, "stage");

  // персист в наш бакет (fal.media эфемерна) + каталог
  const persist = async (falUrl: string, tag: "clean" | "staged", promptUsed: string, markCanonical: boolean): Promise<string | null> => {
    try {
      const r = await fetch(falUrl, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!r.ok) return null;
      const raw = Buffer.from(await r.arrayBuffer());
      if (!raw.length) return null;
      const buf = await normalizeToOutputRes(raw);
      const path = `prepared/${opts.article}/${createHash("sha1").update(falUrl).digest("hex").slice(0, 12)}-${tag}.png`;
      const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: "image/png", upsert: true, cacheControl: "31536000" });
      if (error) return null;
      const pub = db.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl || null;
      // analysis.category + prompt_used → winners-петля: выигравшие prepared-кадры возвращают «золотые» промпты в шаблон
      if (pub) {
        const baseAnalysis = {
          source_url: srcUrl,
          stage: tag,
          scene,
          category,
          engine: tag === "clean" ? cleanFal.model : stagedFal.ok ? stagedFal.model : cleanFal.model,
          product,
          prompt_used: promptUsed,
          output_w: 720,
          output_h: 1280,
          aspect: "9:16",
          letterboxed: true,
        };
        await db.from("content_assets").insert({
          disk: "prepared",
          path,
          name: `${opts.article} · prepared ${tag}`.slice(0, 120),
          kind: "image",
          niche: opts.niche || null,
          article: opts.article || null,
          color: null,
          url: pub,
          analyzed: true,
          analysis: markCanonical ? canonicalFrameMeta(baseAnalysis) : baseAnalysis,
        });
      }
      return pub;
    } catch { return null; }
  };

  const mayMarkCanonical = await shouldMarkCanonical(db, opts.article);
  const stagedUrl = stagedFal.ok ? (await persist(stagedFal.url, "staged", stageP, mayMarkCanonical)) || undefined : undefined;
  const cleanUrl = (await persist(cleanFal.url, "clean", cleanP, mayMarkCanonical && !stagedUrl)) || undefined;
  if (!stagedUrl && !cleanUrl) return { ok: false, error: "персист в бакет не удался" };
  return { ok: true, cleanUrl, stagedUrl };
}
