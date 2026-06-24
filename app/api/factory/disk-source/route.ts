import { NextRequest, NextResponse } from "next/server";
import { yaCollectImages, yaCollectVideos, yaDownloadHref } from "@/lib/yandex/disk";
import { sourceFor, nicheFor, SKIP_FILE } from "@/lib/factory/contentDisks";
import { signProxyUrl } from "@/lib/auth/proxySign";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Подбор контента под КОНКРЕТНЫЙ товар (по артикулу) — строго этого артикула, без чужих цветов/моделей.
// Приоритет: реальная съёмка этого артикула → WB-фото этой карточки (верный цвет) → иначе «нет».
//  POST { product, article } → { found, exact, note, source, images:[{name,path,url}], videos:[{name,path,url}] }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const product: string = (body.product || body.name || "").toString().trim();
  const article: string = (body.article || body.art || "").toString().trim();
  if (!product && !article) return NextResponse.json({ error: "нужен product или article" }, { status: 400 });

  const origin = new URL(req.url).origin;
  // Прокси-урлы (/api/lab/*) подписываем HMAC — их фетчит FAL/Seedance cookie-less; WB-урлы уже абсолютные.
  const signRel = (u: string) => (u.startsWith("/api/lab/") ? signProxyUrl(u) : u);
  const abs = (u: string) => (u && u.startsWith("http") ? u : origin + signRel(u));
  const niche = nicheFor(product, article);

  const { getSupabaseAdmin } = await import("@/lib/supabaseAdmin");
  const db = getSupabaseAdmin();
  let learned = false;
  if (db && niche) { try { const { data } = await db.from("niche_visual_profiles").select("niche").eq("niche", niche).maybeSingle(); learned = !!data; } catch { /* нет таблицы */ } }

  // ── ТОЧНО ПО АРТИКУЛУ (каталог) ──
  if (article && db) {
    try {
      // 1) реальная съёмка модели именно этого артикула
      const { data: real } = await db.from("content_assets")
        .select("name,path,url,kind").eq("article", article).neq("disk", "wb").neq("disk", "gen").not("url", "is", null).limit(24);
      const realImgs = (real || []).filter((r) => r.kind === "image");
      if (realImgs.length) {
        return NextResponse.json({
          found: true, exact: true, niche, learned,
          note: `Реальная съёмка артикула ${article}`,
          source: { disk: "catalog", label: "съёмка (точно по артикулу)" },
          images: realImgs.map((r) => ({ name: r.name, path: r.path, url: abs(r.url as string) })),
          videos: (real || []).filter((r) => r.kind === "video").map((r) => ({ name: r.name, path: r.path, url: abs(r.url as string) })),
        });
      }
      // 2) фото карточки WB именно этого артикула (верный цвет, хоть и студийный кроп)
      const { data: wb } = await db.from("content_assets")
        .select("name,path,url,kind").eq("article", article).eq("disk", "wb").not("url", "is", null).limit(24);
      const wbImgs = (wb || []).filter((r) => r.kind === "image");
      if (wbImgs.length) {
        return NextResponse.json({
          found: true, exact: true, niche, learned,
          note: `Фото карточки WB ${article} (реальной съёмки этого цвета нет)`,
          source: { disk: "wb", label: "WB-карточка (точно по артикулу)" },
          images: wbImgs.map((r) => ({ name: r.name, path: r.path, url: abs(r.url as string) })),
          videos: [],
        });
      }
      // точного контента нет → НЕ показываем чужой цвет/модель
      return NextResponse.json({ found: false, niche, reason: `нет контента под артикул ${article} — рендер пойдёт с карточки` });
    } catch { /* каталог недоступен — групповой фолбэк ниже */ }
  }

  // ── без артикула: групповой обход папок (легаси, только когда конкретный товар не задан) ──
  const src = sourceFor(product, article);
  if (!src) return NextResponse.json({ found: false, niche, reason: "нет реальной съёмки под эту группу — рендер пойдёт с карточки" });
  const proxy = (p: string) => abs(`/api/lab/yandex-img?path=${encodeURIComponent(p)}&key=${encodeURIComponent(src.disk.key)}`);
  const videoProxy = async (p: string) => {
    const href = await yaDownloadHref(p, src.disk.key);
    return href ? abs(`/api/lab/media-proxy?url=${encodeURIComponent(href)}`) : "";
  };
  const collected = await Promise.all(src.paths.flatMap((p) => [yaCollectImages(p, 2, src.disk.key), yaCollectVideos(p, 2, src.disk.key)]));
  const imgs = collected.filter((_, idx) => idx % 2 === 0).flat().filter((i) => !SKIP_FILE.test(i.name));
  const vids = collected.filter((_, idx) => idx % 2 === 1).flat().filter((v) => !SKIP_FILE.test(v.name));
  const seen = new Set<string>();
  const uniqImgs = imgs.filter((i) => (seen.has(i.path) ? false : (seen.add(i.path), true)));
  const isHeader = (n: string) => /^1\.(png|jpe?g|webp)$/i.test(n);
  uniqImgs.sort((a, b) => Number(isHeader(a.name)) - Number(isHeader(b.name)));
  const uniqVids: typeof vids = [];
  const seenVids = new Set<string>();
  for (const v of vids) {
    if (seenVids.has(v.path)) continue;
    seenVids.add(v.path);
    uniqVids.push(v);
  }
  const videoUrls = await Promise.all(uniqVids.slice(0, 12).map(async (v) => ({ name: v.name, path: v.path, url: await videoProxy(v.path) })));
  return NextResponse.json({
    found: uniqImgs.length > 0 || uniqVids.length > 0, exact: false, niche: src.niche, learned,
    note: src.note,
    source: { disk: src.disk.id, label: src.disk.label, paths: src.paths },
    images: uniqImgs.slice(0, 24).map((i) => ({ name: i.name, path: i.path, url: proxy(i.path) })),
    videos: videoUrls,
  });
}
