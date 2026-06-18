import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// Прокси любой картинки на наш origin — чтобы canvas-редактор мог экспортировать без CORS-taint.
export async function GET(req: NextRequest) {
  const url = new URL(req.url).searchParams.get("url");
  if (!url || !/^https?:\/\//.test(url)) return new Response("bad url", { status: 400 });

  const tryFetch = async (u: string): Promise<Response | null> => {
    try { const r = await fetch(u, { signal: AbortSignal.timeout(15000) }); return r.ok && /^image\//.test(r.headers.get("content-type") || "") ? r : null; } catch { return null; }
  };

  try {
    let r = await tryFetch(url);
    // WB: баскет в URL угадан неверно → перебираем соседние basket-NN
    if (!r) {
      const m = url.match(/^(https:\/\/basket-)(\d{2})(\.wbbasket\.ru\/.*)$/);
      if (m) {
        const base = parseInt(m[2], 10);
        for (const d of [1, -1, 2, -2, 3, -3, 4, -4]) {
          const b = base + d;
          if (b < 1 || b > 99) continue;
          r = await tryFetch(`${m[1]}${String(b).padStart(2, "0")}${m[3]}`);
          if (r) break;
        }
      }
    }
    if (!r) return new Response("fetch failed", { status: 502 });
    return new Response(r.body, { headers: { "Content-Type": r.headers.get("content-type") || "image/jpeg", "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } });
  } catch {
    return new Response("error", { status: 502 });
  }
}
