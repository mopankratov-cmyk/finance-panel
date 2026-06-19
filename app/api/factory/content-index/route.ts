import { NextRequest, NextResponse } from "next/server";
import { yaList } from "@/lib/yandex/disk";
import { CONTENT_DISKS, nicheForPath, SKIP_FILE } from "@/lib/factory/contentDisks";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface Row { disk: string; path: string; name: string; kind: "image" | "video"; niche: string | null; color: string | null; url: string | null }

// Рекурсивно собрать все файлы диска (фото+видео) с классификацией ниши/цвета по пути.
async function walk(diskId: string, key: string, path: string, depth: number, acc: Row[]) {
  if (depth < 0) return;
  const items = await yaList(path, key);
  for (const it of items) {
    if (it.type === "dir") { await walk(diskId, key, it.path, depth - 1, acc); continue; }
    if (SKIP_FILE.test(it.name)) continue;
    if (!it.isImage && !it.isVideo) continue;
    const cls = nicheForPath(diskId, it.path);
    acc.push({
      disk: diskId,
      path: it.path,
      name: it.name,
      kind: it.isVideo ? "video" : "image",
      niche: cls?.niche ?? null,
      color: cls?.color || null,
      url: it.isImage ? `/api/lab/yandex-img?path=${encodeURIComponent(it.path)}&key=${encodeURIComponent(key)}` : null,
    });
  }
}

// Проиндексировать диски в content_assets (upsert по (disk,path)). POST { disk?: "norvia"|"design" }.
export async function POST(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const only: string | null = body.disk || null;
  const disks = CONTENT_DISKS.filter((d) => !only || d.id === only);

  const rows: Row[] = [];
  for (const d of disks) await walk(d.id, d.key, "/", 4, rows);
  if (!rows.length) return NextResponse.json({ ok: false, reason: "ничего не собрано (диск пуст/недоступен)", indexed: 0 });

  const { error } = await db.from("content_assets").upsert(rows, { onConflict: "disk,path", ignoreDuplicates: false });
  if (error) return NextResponse.json({ error: error.message, hint: "миграция 20260619_content_catalog.sql применена?" }, { status: 500 });

  // сводка по нишам
  const byNiche: Record<string, { images: number; videos: number }> = {};
  for (const r of rows) {
    const k = r.niche || "—";
    (byNiche[k] ||= { images: 0, videos: 0 })[r.kind === "video" ? "videos" : "images"]++;
  }
  return NextResponse.json({ ok: true, indexed: rows.length, by_niche: byNiche });
}

// GET — текущее состояние каталога (по нишам).
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const { data, error } = await db.from("content_assets").select("niche,kind,analyzed");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const by: Record<string, { images: number; videos: number; analyzed: number }> = {};
  for (const r of data || []) {
    const k = (r.niche as string) || "—";
    const b = (by[k] ||= { images: 0, videos: 0, analyzed: 0 });
    if (r.kind === "video") b.videos++; else b.images++;
    if (r.analyzed) b.analyzed++;
  }
  return NextResponse.json({ total: (data || []).length, by_niche: by });
}
