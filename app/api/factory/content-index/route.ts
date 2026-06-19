import { NextRequest, NextResponse } from "next/server";
import { yaList } from "@/lib/yandex/disk";
import { CONTENT_DISKS, nicheForPath, articleForPath, norviaArticle, SKIP_FILE, SKIP_FOLDER } from "@/lib/factory/contentDisks";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchCabinetCards } from "@/lib/wb/cards";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface Row { disk: string; path: string; name: string; kind: "image" | "video"; niche: string | null; article: string | null; color: string | null; url: string | null }

// Рекурсивно собрать все файлы диска (фото+видео) с классификацией ниши/артикула/цвета по пути.
// Подпапки обходим ПАРАЛЛЕЛЬНО (иначе сотни последовательных запросов к Яндексу → таймаут функции).
async function walk(diskId: string, key: string, path: string, depth: number, acc: Row[]) {
  if (depth < 0) return;
  const items = await yaList(path, key);
  const dirs: string[] = [];
  for (const it of items) {
    if (it.type === "dir") { if (!SKIP_FOLDER.test(it.name)) dirs.push(it.path); continue; }
    if (SKIP_FILE.test(it.name)) continue;
    if (!it.isImage && !it.isVideo) continue;
    const cls = nicheForPath(diskId, it.path);
    acc.push({
      disk: diskId,
      path: it.path,
      name: it.name,
      kind: it.isVideo ? "video" : "image",
      niche: cls?.niche ?? null,
      article: articleForPath(diskId, it.path),
      color: cls?.color || null,
      url: it.isImage ? `/api/lab/yandex-img?path=${encodeURIComponent(it.path)}&key=${encodeURIComponent(key)}` : null,
    });
  }
  await Promise.all(dirs.map((d) => walk(diskId, key, d, depth - 1, acc)));
}

// Проиндексировать диски в content_assets (upsert по (disk,path)). POST { disk?: "norvia"|"design" }.
export async function POST(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const only: string | null = body.disk || null;
  const disks = CONTENT_DISKS.filter((d) => !only || d.id === only);

  const rows: Row[] = [];
  for (const d of disks) {
    const before = rows.length;
    await walk(d.id, d.key, "/", 4, rows);
    // диск с привязанным кабинетом (NORVIA) → проставляем точный артикул по цвету карточки
    if (d.cabinetId) {
      try {
        const cards = await fetchCabinetCards(d.cabinetId);
        if (cards.length) for (let i = before; i < rows.length; i++) {
          if (!rows[i].article) rows[i].article = norviaArticle(rows[i].path, cards);
        }
      } catch { /* без карточек — останется niche+цвет */ }
    }
  }
  if (!rows.length) return NextResponse.json({ ok: false, reason: "ничего не собрано (диск пуст/недоступен)", indexed: 0 });

  const { error } = await db.from("content_assets").upsert(rows, { onConflict: "disk,path", ignoreDuplicates: false });
  if (error) return NextResponse.json({ error: error.message, hint: "миграция 20260619_content_catalog.sql применена?" }, { status: 500 });

  // сводка по нишам + по артикулам
  const byNiche: Record<string, { images: number; videos: number }> = {};
  const byArticle: Record<string, number> = {};
  for (const r of rows) {
    const k = r.niche || "—";
    (byNiche[k] ||= { images: 0, videos: 0 })[r.kind === "video" ? "videos" : "images"]++;
    if (r.article) byArticle[r.article] = (byArticle[r.article] || 0) + 1;
  }
  return NextResponse.json({ ok: true, indexed: rows.length, by_niche: byNiche, by_article: byArticle });
}

// GET — текущее состояние каталога (агрегатные COUNT, не fetch строк: иначе лимит 1000).
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const cnt = async (build: (q: ReturnType<typeof db.from>) => unknown): Promise<number> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = (db.from("content_assets").select("*", { count: "exact", head: true }) as any);
    const { count, error } = await build(q);
    if (error) throw new Error(error.message);
    return count || 0;
  };
  try {
    const niches = ["jackets", "bags", "blasters", "cream"];
    const by: Record<string, { images: number; videos: number; analyzed: number }> = {};
    for (const n of niches) {
      const [images, videos, analyzed] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cnt((q: any) => q.eq("niche", n).eq("kind", "image")),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cnt((q: any) => q.eq("niche", n).eq("kind", "video")),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cnt((q: any) => q.eq("niche", n).eq("analyzed", true)),
      ]);
      by[n] = { images, videos, analyzed };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [total, wbPhotos] = await Promise.all([cnt((q: any) => q), cnt((q: any) => q.eq("disk", "wb"))]);
    return NextResponse.json({ total, wb_photos: wbPhotos, by_niche: by });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
