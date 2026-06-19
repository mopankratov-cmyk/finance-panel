import { NextRequest, NextResponse } from "next/server";
import { yaCollectImages, yaCollectVideos } from "@/lib/yandex/disk";
import { sourceFor, SKIP_FILE } from "@/lib/factory/contentDisks";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Подбор РЕАЛЬНОГО контента со съёмки под товар.
// Завод вызывает это перед рендером: если есть фото модели с товаром — берём его (фотореал),
// а не кроп с карточки WB. Возвращает стабильные прокси-URL (FAL может фетчить напрямую).
//  POST { product, article } → { found, note, source, images:[url...], videos:[{name,path}] }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const product: string = (body.product || body.name || "").toString().trim();
  const article: string = (body.article || body.art || "").toString().trim();
  if (!product && !article) return NextResponse.json({ error: "нужен product или article" }, { status: 400 });

  const src = sourceFor(product, article);

  // 1) если каталог проиндексирован — берём кадры ТОЧНО по артикулу (приоритет точности)
  if (article) {
    try {
      const { getSupabaseAdmin } = await import("@/lib/supabaseAdmin");
      const db = getSupabaseAdmin();
      if (db) {
        const { data } = await db.from("content_assets")
          .select("name,path,url,kind").eq("article", article).neq("disk", "wb").not("url", "is", null).limit(24);
        const imgsExact = (data || []).filter((r) => r.kind === "image");
        if (imgsExact.length) {
          let learnedX = false;
          if (src) { const { data: pf } = await db.from("niche_visual_profiles").select("niche").eq("niche", src.niche).maybeSingle(); learnedX = !!pf; }
          return NextResponse.json({
            found: true, exact: true, note: `Реальная съёмка артикула ${article}`,
            niche: src?.niche ?? null, learned: learnedX,
            source: { disk: "catalog", label: "каталог (точно по артикулу)" },
            images: imgsExact.map((r) => ({ name: r.name, path: r.path, url: r.url })),
            videos: (data || []).filter((r) => r.kind === "video").map((r) => ({ name: r.name, path: r.path })),
          });
        }
      }
    } catch { /* каталога ещё нет — идём на живой обход */ }
  }

  if (!src) return NextResponse.json({ found: false, reason: "нет реальной съёмки под эту группу — рендер пойдёт с карточки" });

  const proxy = (p: string) => `/api/lab/yandex-img?path=${encodeURIComponent(p)}&key=${encodeURIComponent(src.disk.key)}`;
  // собираем со всех папок группы параллельно
  const collected = await Promise.all(src.paths.flatMap((p) => [yaCollectImages(p, 2, src.disk.key), yaCollectVideos(p, 2, src.disk.key)]));
  const imgs = collected.filter((_, idx) => idx % 2 === 0).flat().filter((i) => !SKIP_FILE.test(i.name));
  const vids = collected.filter((_, idx) => idx % 2 === 1).flat().filter((v) => !SKIP_FILE.test(v.name));
  // дедуп по path
  const seen = new Set<string>();
  const uniqImgs = imgs.filter((i) => (seen.has(i.path) ? false : (seen.add(i.path), true)));
  // слайд «1.*» в наборах карточек — обычно текстовый хедер; отодвигаем в конец, чтобы авто-подбор брал реальное фото
  const isHeader = (n: string) => /^1\.(png|jpe?g|webp)$/i.test(n);
  uniqImgs.sort((a, b) => Number(isHeader(a.name)) - Number(isHeader(b.name)));
  const images = uniqImgs.slice(0, 24).map((i) => ({ name: i.name, path: i.path, url: proxy(i.path) }));
  const videos = vids.slice(0, 12).map((v) => ({ name: v.name, path: v.path }));

  // обучены ли агенты на этой нише (есть визуальный профиль)?
  let learned = false;
  try {
    const { getSupabaseAdmin } = await import("@/lib/supabaseAdmin");
    const db = getSupabaseAdmin();
    if (db) {
      const { data } = await db.from("niche_visual_profiles").select("niche").eq("niche", src.niche).maybeSingle();
      learned = !!data;
    }
  } catch { /* профиля/таблицы ещё нет */ }

  return NextResponse.json({
    found: images.length > 0 || videos.length > 0,
    note: src.note,
    niche: src.niche,
    learned,
    source: { disk: src.disk.id, label: src.disk.label, paths: src.paths },
    images,
    videos,
  });
}
