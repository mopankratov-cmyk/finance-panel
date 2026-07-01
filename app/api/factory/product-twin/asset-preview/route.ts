import { NextRequest } from "next/server";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { getYandexDiskDownloadHref } from "@/lib/factory/yandexArchive";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return new Response("unauthorized", { status: 401 });
  const url = String(req.nextUrl.searchParams.get("url") || "").trim();
  if (!url.startsWith("yandex-disk:")) return new Response("unsupported url", { status: 400 });
  const href = await getYandexDiskDownloadHref(url).catch(() => null);
  if (!href) return new Response("not found", { status: 404 });
  try {
    const res = await fetch(href, { cache: "no-store", signal: AbortSignal.timeout(30000) });
    if (!res.ok) return new Response("fetch failed", { status: 502 });
    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("content-type") || "image/png",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return new Response("preview failed", { status: 502 });
  }
}
