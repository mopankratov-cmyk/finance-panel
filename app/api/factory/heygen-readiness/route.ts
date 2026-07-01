import { NextRequest, NextResponse } from "next/server";
import {
  heygenListAvatarGroups,
  heygenListAvatarLooks,
  heygenListVoices,
  heygenReady,
} from "@/lib/factory/heygen";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function limit(req: NextRequest): number {
  const n = Number(req.nextUrl.searchParams.get("limit") || 12);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 50) : 12;
}

export async function GET(req: NextRequest) {
  const live = req.nextUrl.searchParams.get("live") === "1" || req.nextUrl.searchParams.get("live") === "true";
  const configured = heygenReady();
  const endpoints = {
    avatar_groups: "GET /v3/avatars",
    avatar_looks: "GET /v3/avatars/looks",
    voices: "GET /v3/voices",
    create_video: "POST /v3/videos (blocked in readiness)",
    get_video: "GET /v3/videos/{video_id}",
  };

  if (!configured) {
    return NextResponse.json({
      ok: false,
      ready: false,
      live,
      endpoints,
      error: "HeyGen не подключён: добавь HEYGEN_API_KEY в env",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  if (!live) {
    return NextResponse.json({
      ok: true,
      ready: true,
      live: false,
      endpoints,
      note: "readiness dry mode; add ?live=1 for read-only catalog scan",
    }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const cap = limit(req);
    const [groups, looks, privateLooks, voices, russianVoices] = await Promise.all([
      heygenListAvatarGroups({ limit: cap }),
      heygenListAvatarLooks({ limit: cap, ownership: "public" }),
      heygenListAvatarLooks({ limit: cap, ownership: "private" }),
      heygenListVoices({ limit: cap, engine: "starfish" }),
      heygenListVoices({ limit: cap, language: "Russian" }),
    ]);

    return NextResponse.json({
      ok: groups.ok && looks.ok && privateLooks.ok && voices.ok && russianVoices.ok,
      ready: true,
      live: true,
      endpoints,
      catalog: {
        groups: { status: groups.status, count: groups.data?.length || 0, items: groups.data || [] },
        public_looks: { status: looks.status, count: looks.data?.length || 0, items: looks.data || [] },
        private_looks: { status: privateLooks.status, count: privateLooks.data?.length || 0, items: privateLooks.data || [] },
        starfish_voices: { status: voices.status, count: voices.data?.length || 0, items: voices.data || [] },
        russian_voices: { status: russianVoices.status, count: russianVoices.data?.length || 0, items: russianVoices.data || [] },
      },
      errors: [groups.error, looks.error, privateLooks.error, voices.error, russianVoices.error].filter(Boolean),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      ready: false,
      live: true,
      endpoints,
      error: "heygen-readiness crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
