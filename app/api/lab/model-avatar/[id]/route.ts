import { yaCollectImages, yaDownloadHref } from "@/lib/yandex/disk";
import { MODELS } from "@/lib/lab/skuFolders";

export const dynamic = "force-dynamic";

// Аватар модели = первое фото из её папки на Яндексе (прокси).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const model = MODELS.find((m) => m.id === id);
  if (!model) return new Response("no model", { status: 404 });
  const imgs = await yaCollectImages(model.path, 2);
  if (!imgs.length) return new Response("no photos", { status: 404 });
  const href = await yaDownloadHref(imgs[0].path);
  if (!href) return new Response("no href", { status: 404 });
  try {
    const r = await fetch(href, { signal: AbortSignal.timeout(30000) });
    return new Response(r.body, { headers: { "Content-Type": r.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "public, max-age=86400" } });
  } catch { return new Response("err", { status: 502 }); }
}
