import { NextRequest, NextResponse } from "next/server";
import { proxyAuthorized } from "@/lib/auth/proxyAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Прокси видео/аудио с CORS-заголовками, чтобы canvas не «тейнтился» при записи оверлея.
// Только для коротких клипов генераторов (HeyGen/Higgsfield ~ единицы МБ).
// Доступ: подпись (внешний рендер) ИЛИ сессия (браузер-редакторы) ИЛИ cron — см. proxyAuthorized.
// Host-allowlist здесь нет: апстримы — разнородные видео-CDN; контроль = подпись/сессия.
export async function GET(req: NextRequest) {
  if (!(await proxyAuthorized(req))) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  const url = req.nextUrl.searchParams.get("url");
  if (!url || !/^https?:\/\//.test(url)) return NextResponse.json({ error: "url обязателен" }, { status: 400 });
  try {
    const range = req.headers.get("range") || undefined;
    const upstream = await fetch(url, { headers: range ? { Range: range } : {}, cache: "no-store", signal: AbortSignal.timeout(50000) });
    if (!upstream.ok && upstream.status !== 206) return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 });
    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") || "video/mp4");
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "no-store");
    const cl = upstream.headers.get("content-length"); if (cl) headers.set("Content-Length", cl);
    const cr = upstream.headers.get("content-range"); if (cr) headers.set("Content-Range", cr);
    headers.set("Accept-Ranges", "bytes");
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 120) }, { status: 502 });
  }
}
