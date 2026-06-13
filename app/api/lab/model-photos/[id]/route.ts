import { NextResponse } from "next/server";
import { yaCollectImages } from "@/lib/yandex/disk";
import { MODELS } from "@/lib/lab/skuFolders";

export const dynamic = "force-dynamic";

// Фото модели/персонажа (Яндекс.Диск). id = id модели (см. MODELS) или base64url пути.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ count: 0, photos: [] });
  const model = MODELS.find((m) => m.id === id);
  let path = model?.path;
  if (!path) { try { path = Buffer.from(id, "base64url").toString(); } catch { return NextResponse.json({ count: 0, photos: [] }); } }
  const imgs = await yaCollectImages(path, 2);
  return NextResponse.json({
    count: imgs.length,
    photos: imgs.map((f) => ({ name: f.name, url: `/api/lab/yandex-img?path=${encodeURIComponent(f.path)}` })),
  });
}
