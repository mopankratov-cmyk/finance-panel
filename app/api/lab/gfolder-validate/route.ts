import { NextRequest, NextResponse } from "next/server";
import { driveList } from "@/lib/google/drive";
import { parseFolderId } from "@/lib/google/folderId";

export const dynamic = "force-dynamic";

// Валидация папки Drive с референсами (без генерации). Возвращает картинки → проксируем через drive-img.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const url: string = typeof body.folder_url === "string" ? body.folder_url : "";
  if (!url.trim()) return NextResponse.json({ error: "Нужна ссылка на папку" }, { status: 400 });
  const folderId = parseFolderId(url);
  const files = await driveList(folderId, { imagesOnly: true });
  if (!files.length) return NextResponse.json({ images: [], total: 0, error: "Папка пуста или не расшарена на сервис-аккаунт" }, { status: 200 });
  const images = files.map((f) => ({ ok: true, id: f.id, name: f.name, url: `/api/lab/drive-img/${f.id}` }));
  return NextResponse.json({ images, total: files.length });
}
