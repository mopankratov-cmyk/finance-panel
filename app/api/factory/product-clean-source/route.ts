import { NextRequest, NextResponse } from "next/server";
import { diskById } from "@/lib/factory/contentDisks";
import { buildProductCleanPrompt, imageBufferToDataUrl } from "@/lib/factory/productCleanSource";
import { fetchWithRetry, runNanoBananaEdit } from "@/lib/factory/falImageEdit";
import { yaDownloadHref } from "@/lib/yandex/disk";
import { type ProductCategory } from "@/lib/factory/editPrompts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function cleanText(value: unknown, max = 1200): string {
  return String(value || "").trim().slice(0, max);
}

async function resolveInputImage(body: Record<string, unknown>): Promise<{ image: string; sourceKind: string; sourcePath?: string } | { error: string }> {
  const directData = cleanText(body.image_data_url, 20_000_000);
  if (directData.startsWith("data:image/")) return { image: directData, sourceKind: "data_url" };

  const directUrl = cleanText(body.image_url, 4000);
  if (/^https?:\/\//i.test(directUrl)) return { image: directUrl, sourceKind: "image_url" };

  const diskPath = cleanText(body.disk_path, 1200);
  if (!diskPath) return { error: "нужен image_url, image_data_url или disk_path" };
  const disk = diskById(cleanText(body.disk || "design", 80));
  if (!disk) return { error: "неизвестный disk" };
  const href = await yaDownloadHref(diskPath, disk.key);
  if (!href) return { error: `не удалось получить download href для ${diskPath}` };
  const img = await fetchWithRetry(href, { cache: "no-store" }, 5);
  if (!img.ok) return { error: `download ${img.status}` };
  const contentType = img.headers.get("content-type") || "image/png";
  const buf = Buffer.from(await img.arrayBuffer());
  if (!buf.length) return { error: "пустой image buffer" };
  return { image: imageBufferToDataUrl(buf, contentType), sourceKind: "disk_path", sourcePath: diskPath };
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.FAL_KEY) return NextResponse.json({ ok: false, error: "FAL_KEY не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const article = cleanText(body.article || body.sku_art, 80);
    if (!article) return NextResponse.json({ ok: false, error: "нужен article" }, { status: 400 });
    const product = cleanText(body.product || body.product_name || article, 120);
    const category = (cleanText(body.category, 40) || undefined) as ProductCategory | undefined;
    const prompt = cleanText(body.prompt, 8000) || buildProductCleanPrompt({ article, product, category });
    const resolved = await resolveInputImage(body);
    if ("error" in resolved) return NextResponse.json({ ok: false, error: resolved.error }, { status: 400 });

    const clean = await runNanoBananaEdit({ image: resolved.image, prompt });
    if (!clean.ok) return NextResponse.json({ ok: false, error: clean.error, response_url: clean.responseUrl }, { status: clean.responseUrl ? 504 : 502 });
    return NextResponse.json({
      ok: true,
      article,
      product,
      source_kind: resolved.sourceKind,
      source_path: resolved.sourcePath || null,
      prompt_used: prompt,
      clean_url: clean.imageUrl,
      response_url: clean.responseUrl,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "product-clean-source crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
