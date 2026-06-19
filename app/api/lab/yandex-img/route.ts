import { NextRequest } from "next/server";
import { yaDownloadHref } from "@/lib/yandex/disk";

export const dynamic = "force-dynamic";

// Прокси файла с Яндекс.Диска по пути (?path=/МАША/.../img.jpg&key=<публ.ссылка>).
// key опционален — без него берётся env YANDEX_PUBLIC_KEY. Отдаёт стабильный публичный URL,
// который FAL/Seedance может фетчить напрямую (в отличие от 302-редиректа Яндекса).
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const path = sp.get("path");
  const key = sp.get("key") || undefined;
  if (!path) return new Response("no path", { status: 400 });
  const href = await yaDownloadHref(path, key);
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
