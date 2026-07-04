import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED_KEYS = [
  "APIFY_TOKEN",
  "APIFY_TIKTOK_ACTOR",
  "APIFY_INSTAGRAM_REELS_ACTOR",
  "APIFY_YOUTUBE_ACTOR",
] as const;

function cleanList(value: unknown): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const requested = cleanList(body.keys).filter((key) => (ALLOWED_KEYS as readonly string[]).includes(key));
  const keys = requested.length ? requested : [...ALLOWED_KEYS];
  const values = Object.fromEntries(
    keys.map((key) => [key, String(process.env[key] || "")]),
  );

  return NextResponse.json({
    ok: true,
    keys,
    values,
  }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
