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
import { rehostImageForFal } from "./rehostImage";

const QUEUE = "https://queue.fal.run/";
const NANO = "fal-ai/nano-banana/edit";
const SEEDREAM = "fal-ai/bytedance/seedream/v4/edit"; // фолбэк: мульти-референс, 4K, лучше мелкий текст/лого
const BUCKET = "factory-media";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const falKey = () => process.env.FAL_KEY || "";

// один edit-вызов (Nano → при провале Seedream) → URL результата на fal.media или null. Best-effort.
async function edit(imageUrls: string[], prompt: string, maxWaitMs = 110_000): Promise<string | null> {
  const k = falKey();
  if (!k || !imageUrls.length) return null;
  const auth = { Authorization: `Key ${k}`, "Content-Type": "application/json" };
  for (const model of [NANO, SEEDREAM]) {
    try {
      const sub = await fetch(`${QUEUE}${model}`, {
        method: "POST", headers: auth, cache: "no-store",
        body: JSON.stringify({ prompt, image_urls: imageUrls, num_images: 1, safety_tolerance: "6", output_format: "png" }),
        signal: AbortSignal.timeout(25_000),
      });
      if (!sub.ok) continue;
      const sj = (await sub.json()) as { response_url?: string };
      const responseUrl = sj.response_url;
      if (!responseUrl) continue;
      const deadline = Date.now() + maxWaitMs;
      let done = false;
      while (Date.now() < deadline) {
        await sleep(4000);
        const st = await fetch(`${responseUrl}/status`, { headers: { Authorization: `Key ${k}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) }).catch(() => null);
        if (st?.ok) { const s = (await st.json()) as { status?: string }; if (s.status === "COMPLETED") { done = true; break; } }
      }
      if (!done) continue;
      const res = await fetch(responseUrl, { headers: { Authorization: `Key ${k}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const rj = (await res.json()) as { images?: { url?: string }[] };
      const url = rj?.images?.[0]?.url;
      if (url) return url;                  // успех на этом движке
    } catch { /* следующий движок */ }
  }
  return null;
}

// промпты (валидированы на CLR01012). product — короткое описание («коричневая кожаная сумка-тоут»).
const cleanPrompt = (product: string) =>
  `Recreate this as a clean professional studio product photograph showing ONLY the ${product}, isolated on a seamless light-grey studio background. Keep the ${product} exactly as shown — same shape, color, materials, branding and embossing, hardware and proportions. Photorealistic e-commerce product photography, soft even lighting, no surrounding objects, no captions, no graphic design or text.`;
const stagePrompt = (product: string, scene: string) =>
  `Place THIS exact ${product} (do not alter the product, its shape, color, branding or hardware) into an aesthetic premium lifestyle scene: ${scene}. Soft natural light, realistic contact shadows and reflections, shallow depth of field, editorial mood. Photorealistic, vertical 9:16 composition with headroom around the product.`;

export interface PrepResult { ok: boolean; cleanUrl?: string; stagedUrl?: string; error?: string }

// Подготовить ОДИН товарный кадр: clean → stage → durable в бакет + строка content_assets(disk='prepared').
// srcUrl — сырое WB-фото (инфографика). Возвращает durable-URL стейджа (или чистого, если стейдж не вышел).
export async function prepareProductImage(
  srcUrl: string, opts: { article: string; niche?: string; product?: string; scene?: string },
): Promise<PrepResult> {
  if (!srcUrl) return { ok: false, error: "нет srcUrl" };
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "нет supabase-admin" };
  const product = (opts.product || "product").slice(0, 120);
  const scene = (opts.scene || "a tasteful minimal interior surface with complementary lifestyle props").slice(0, 240);

  // WB-CDN флапает на серверной загрузке fal → рехостим исходник в наш бакет (как в i2v). Best-effort.
  const src = await rehostImageForFal(srcUrl);
  const cleanFal = await edit([src], cleanPrompt(product));
  if (!cleanFal) return { ok: false, error: "clean-шаг не дал результата (контент-фильтр/доступ/сеть)" };
  // стейдж: clean + рехостнутый оригинал как identity-якорь (Nano иногда дрейфит лого при смене фона)
  const stagedFal = await edit([cleanFal, src], stagePrompt(product, scene)) || cleanFal; // фолбэк — чистый кадр

  // персист в наш бакет (fal.media эфемерна) + каталог
  const persist = async (falUrl: string, tag: "clean" | "staged"): Promise<string | null> => {
    try {
      const r = await fetch(falUrl, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length) return null;
      const path = `prepared/${opts.article}/${createHash("sha1").update(falUrl).digest("hex").slice(0, 12)}-${tag}.png`;
      const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: "image/png", upsert: true });
      if (error) return null;
      const pub = db.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl || null;
      if (pub) await db.from("content_assets").insert({ disk: "prepared", kind: "image", niche: opts.niche || null, article: opts.article || null, url: pub, analyzed: true, analysis: { source_url: srcUrl, stage: tag, scene, engine: "nano-banana", product } });
      return pub;
    } catch { return null; }
  };

  const stagedUrl = (await persist(stagedFal, "staged")) || undefined;
  const cleanUrl = (await persist(cleanFal, "clean")) || undefined;
  if (!stagedUrl && !cleanUrl) return { ok: false, error: "персист в бакет не удался" };
  return { ok: true, cleanUrl, stagedUrl };
}
