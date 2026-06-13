import { NextResponse } from "next/server";
import { yaList } from "@/lib/yandex/disk";

export const dynamic = "force-dynamic";

// Содержимое папки SKU (Яндекс.Диск). id = base64url пути. {files:[{is_image,url,name}]}.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ files: [] });
  let path: string;
  try { path = Buffer.from(id, "base64url").toString(); } catch { return NextResponse.json({ files: [] }); }
  const items = await yaList(path);
  return NextResponse.json({
    files: items.map((f) => ({
      id: Buffer.from(f.path).toString("base64url"),
      name: f.name,
      is_image: f.isImage,
      is_folder: f.type === "dir",
      url: f.isImage ? `/api/lab/yandex-img?path=${encodeURIComponent(f.path)}` : null,
      sub: f.type === "dir" ? Buffer.from(f.path).toString("base64url") : null,
    })),
  });
}
