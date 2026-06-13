import { NextResponse } from "next/server";
import { driveList } from "@/lib/google/drive";

export const dynamic = "force-dynamic";

// Фото модели/персонажа: список изображений в папке модели (Drive). {count, photos:[{url}]}.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ count: 0, photos: [] });
  const files = await driveList(id, { imagesOnly: true });
  return NextResponse.json({
    count: files.length,
    photos: files.map((f) => ({ id: f.id, name: f.name, url: `/api/lab/drive-img/${f.id}` })),
  });
}
