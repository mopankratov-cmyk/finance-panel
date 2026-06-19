import { NextRequest, NextResponse } from "next/server";
import { yaList } from "@/lib/yandex/disk";
import { CONTENT_DISKS, diskById } from "@/lib/factory/contentDisks";

export const dynamic = "force-dynamic";

// Браузер по дискам контент-завода.
//  GET без параметров → список зарегистрированных дисков.
//  GET ?disk=<id>&path=/... → содержимое папки (папки + файлы), с готовым прокси-URL для картинок.
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const diskId = sp.get("disk");
  const key = sp.get("key") || (diskId ? diskById(diskId)?.key : undefined);
  if (!diskId && !key) {
    return NextResponse.json({ disks: CONTENT_DISKS.map((d) => ({ id: d.id, label: d.label })) });
  }
  if (!key) return NextResponse.json({ error: "неизвестный диск" }, { status: 404 });
  const path = sp.get("path") || "/";
  const items = await yaList(path, key);
  const enc = (p: string) => `/api/lab/yandex-img?path=${encodeURIComponent(p)}${diskId ? `&disk_=${diskId}` : ""}&key=${encodeURIComponent(key)}`;
  return NextResponse.json({
    path,
    items: items.map((i) => ({
      name: i.name,
      path: i.path,
      type: i.type,
      isImage: i.isImage,
      isVideo: i.isVideo,
      preview: i.preview,
      img: i.isImage ? enc(i.path) : undefined,
    })),
  });
}
