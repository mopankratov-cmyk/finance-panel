import { NextRequest, NextResponse } from "next/server";
import { creatifyReady, creatifyListVoices, creatifyListMusic, creatifyListTemplates } from "@/lib/factory/creatify";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

// Живые списки опций Creatify для пикеров инспектора — точные значения из API, без хардкода.
//   GET ?type=voices|musics|templates  → { ok, type, options:[{id,name,meta,preview}] }
//   GET (без type)                     → { ok, voices, musics, templates }
// Без ключей CREATIFY → { ok:true, options:[], note } (мягкая деградация, не падаем).
export async function GET(req: NextRequest) {
  try {
    if (!creatifyReady()) return NextResponse.json({ ok: true, options: [], voices: [], musics: [], templates: [], note: "CREATIFY_API_ID/KEY не настроены — добавь в Vercel" }, { headers: { "Cache-Control": "no-store" } });
    const type = (req.nextUrl.searchParams.get("type") || "").trim();
    if (type === "voices") return NextResponse.json({ ok: true, type, options: await creatifyListVoices() }, { headers: { "Cache-Control": "no-store" } });
    if (type === "musics") return NextResponse.json({ ok: true, type, options: await creatifyListMusic() }, { headers: { "Cache-Control": "no-store" } });
    if (type === "templates") return NextResponse.json({ ok: true, type, options: await creatifyListTemplates() }, { headers: { "Cache-Control": "no-store" } });
    const [voices, musics, templates] = await Promise.all([creatifyListVoices(), creatifyListMusic(), creatifyListTemplates()]);
    return NextResponse.json({ ok: true, voices, musics, templates }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "список Creatify упал: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
