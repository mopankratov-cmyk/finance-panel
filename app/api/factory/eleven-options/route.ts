import { NextResponse } from "next/server";
import { elevenReady, elevenListVoices } from "@/lib/factory/elevenlabs";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

// V22 · живой список ElevenLabs-голосов для пикера (как creatify-options). Без ключа/гео-блок → пусто + note.
//   GET ?type=voices → { ok, type, options:[{id,name,meta,preview,labels}] }
export async function GET() {
  try {
    if (!elevenReady()) return NextResponse.json({ ok: true, options: [], note: "ELEVENLABS_API_KEY не задан — добавь в Vercel" }, { headers: { "Cache-Control": "no-store" } });
    const voices = await elevenListVoices();
    const options = voices.map((v) => ({ id: v.id, name: v.name, meta: v.labels || v.meta || "", preview: v.preview || "", audio: true }));
    return NextResponse.json({ ok: true, type: "voices", options, note: options.length ? undefined : "голоса не пришли (гео-блок ElevenLabs из РФ?)" }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: true, options: [], note: "ElevenLabs недоступен: " + String((e as Error)?.message || e).slice(0, 100) }, { headers: { "Cache-Control": "no-store" } });
  }
}
