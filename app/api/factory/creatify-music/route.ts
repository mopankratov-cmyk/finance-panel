import { NextResponse } from "next/server";
import { creatifyListMusic, creatifyReady } from "@/lib/factory/creatify";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

// Read-only список музыки Creatify для picker'а.
export async function GET() {
  if (!creatifyReady()) {
    return NextResponse.json({ ok: true, musics: [], note: "CREATIFY_API_ID/KEY не настроены — добавь в Vercel" }, { headers: { "Cache-Control": "no-store" } });
  }
  const musics = await creatifyListMusic();
  return NextResponse.json({ ok: true, count: musics.length, musics }, { headers: { "Cache-Control": "no-store" } });
}
