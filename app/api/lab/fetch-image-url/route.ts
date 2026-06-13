import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

// Достать картинки по ссылке (Pinterest pin / страница / прямой URL) — для референсов лабы.
export async function GET(req: NextRequest) {
  const url = new URL(req.url).searchParams.get("url");
  if (!url || !/^https?:\/\//.test(url)) return NextResponse.json({ error: "Нужна ссылка", images: [] }, { status: 400 });
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,image/*" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    const type = r.headers.get("content-type") || "";
    if (type.startsWith("image/")) {
      return NextResponse.json({ images: [{ src: r.url || url, w: 1000, h: 1000 }] });
    }
    const html = await r.text();
    const found = new Set<string>();
    const push = (u?: string | null) => { if (u && /^https?:\/\//.test(u) && /\.(png|jpe?g|webp)(\?|$)/i.test(u)) found.add(u); };
    // og:image / twitter:image (Pinterest кладёт полноразмер сюда)
    for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image|og:image:secure_url)["'][^>]+content=["']([^"']+)["']/gi)) push(m[1]);
    for (const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/gi)) push(m[1]);
    // pinimg прямые ссылки в теле
    for (const m of html.matchAll(/https?:\/\/i\.pinimg\.com\/[^"'\\\s]+\.(?:png|jpe?g|webp)/gi)) found.add(m[0].replace(/\/\d+x\//, "/originals/"));
    // обычные <img src>
    if (found.size < 3) for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) push(m[1]);
    const images = [...found].slice(0, 12).map((src) => ({ src, w: 1000, h: 1000 }));
    if (!images.length) return NextResponse.json({ images: [], error: "Картинок не нашлось на странице" });
    return NextResponse.json({ images });
  } catch (e) {
    return NextResponse.json({ images: [], error: String(e).slice(0, 120) }, { status: 502 });
  }
}
