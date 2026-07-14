import { NextRequest } from "next/server";
import { proxyAuthorized } from "@/lib/auth/proxyAuth";

export const dynamic = "force-dynamic";

// Прокси картинки на наш origin — чтобы canvas-редактор мог экспортировать без CORS-taint.
// Доступ: подпись (внешний рендер) ИЛИ сессия (браузер-редакторы) ИЛИ cron — см. proxyAuthorized.
// SSRF-замок: апстрим — ТОЛЬКО WB-баскеты (единственный источник, который сюда подаётся).
const HOST_OK = (host: string) =>
  /(^|\.)wbbasket\.ru$/i.test(host) || /(^|\.)wbstatic\.net$/i.test(host) || /(^|\.)wb\.ru$/i.test(host);

export async function GET(req: NextRequest) {
  if (!(await proxyAuthorized(req))) return new Response("unauthorized", { status: 401 });

  const url = new URL(req.url).searchParams.get("url");
  if (!url || !/^https?:\/\//.test(url)) return new Response("bad url", { status: 400 });
  let host: string;
  try { host = new URL(url).hostname; } catch { return new Response("bad url", { status: 400 }); }
  if (!HOST_OK(host)) return new Response("forbidden host", { status: 403 });

  const tryFetch = async (u: string): Promise<Response | null> => {
    try { const r = await fetch(u, { signal: AbortSignal.timeout(15000) }); return r.ok && /^image\//.test(r.headers.get("content-type") || "") ? r : null; } catch { return null; }
  };

  try {
    let r = await tryFetch(url);
    // WB: баскет в URL угадан неверно → перебираем соседние basket-NN.
    // 14.07.2026 видели реальный сдвиг basket-50 → basket-44, поэтому ±4 мало.
    if (!r) {
      const m = url.match(/^(https:\/\/basket-)(\d{2})(\.wbbasket\.ru\/.*)$/);
      if (m) {
        const base = parseInt(m[2], 10);
        const offsets = Array.from({ length: 18 }, (_, i) => i + 1).flatMap((d) => [d, -d]);
        for (const d of offsets) {
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
