import { NextRequest } from "next/server";
import { yaDownloadHref } from "@/lib/yandex/disk";

export const dynamic = "force-dynamic";

// Прокси изображения с Яндекс.Диска по пути (?path=/МАША/.../img.png).
export async function GET(req: NextRequest) {
  const path = new URL(req.url).searchParams.get("path");
  if (!path) return new Response("no path", { status: 400 });
  const href = await yaDownloadHref(path);
  if (!href) return new Response("not found", { status: 404 });
  try {
    const r = await fetch(href, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return new Response("fetch failed", { status: 502 });
    return new Response(r.body, {
      headers: {
        "Content-Type": r.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response("error", { status: 502 });
  }
}
