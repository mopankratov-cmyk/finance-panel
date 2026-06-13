import { NextResponse } from "next/server";
import { driveList } from "@/lib/google/drive";

export const dynamic = "force-dynamic";

// Содержимое папки SKU (Drive): файлы с флагом is_image для фильтра в лабе.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ files: [] });
  const files = await driveList(id);
  return NextResponse.json({
    files: files.map((f) => ({
      id: f.id, name: f.name,
      is_image: f.mimeType.startsWith("image/"),
      is_folder: f.mimeType === "application/vnd.google-apps.folder",
      url: f.mimeType.startsWith("image/") ? `/api/lab/drive-img/${f.id}` : null,
    })),
  });
}
