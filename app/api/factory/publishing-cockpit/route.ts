import { NextRequest, NextResponse } from "next/server";
import { getSupabaseReadClient } from "@/lib/supabaseAdmin";
import { loadPublishingCockpit } from "@/lib/factory/publishingCockpit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function normalizeStream(value: string | null): "all" | "product" | "manya" {
  const stream = String(value || "all").trim().toLowerCase();
  if (stream === "product" || stream === "manya") return stream;
  return "all";
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseReadClient();
    const stream = normalizeStream(req.nextUrl.searchParams.get("stream"));
    const payload = await loadPublishingCockpit(db, stream);
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      configured: true,
      error: "publishing cockpit crash: " + String((error as Error)?.message || error).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
