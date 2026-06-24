import { NextResponse } from "next/server";
import { creatifyListVoices, creatifyReady } from "@/lib/factory/creatify";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

// Read-only список голосов Creatify для пикера/бренд-кита.
// Это тонкая обёртка над живым GET /voices/; ключей нет → мягкая деградация без падения.
export async function GET() {
  if (!creatifyReady()) {
    return NextResponse.json({ ok: true, voices: [], note: "CREATIFY_API_ID/KEY не настроены — добавь в Vercel" }, { headers: { "Cache-Control": "no-store" } });
  }
  const voices = await creatifyListVoices();
  return NextResponse.json({ ok: true, count: voices.length, voices }, { headers: { "Cache-Control": "no-store" } });
}
