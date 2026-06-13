import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// Прокси любой картинки на наш origin — чтобы canvas-редактор мог экспортировать без CORS-taint.
export async function GET(req: NextRequest) {
  const url = new URL(req.url).searchParams.get("url");
  if (!url || !/^https?:\/\//.test(url)) return new Response("bad url", { status: 400 });
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return new Response("fetch failed", { status: 502 });
    const type = r.headers.get("content-type") || "image/jpeg";
    if (!/^image\//.test(type)) return new Response("not an image", { status: 415 });
    return new Response(r.body, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=3600" } });
  } catch {
    return new Response("error", { status: 502 });
  }
}
