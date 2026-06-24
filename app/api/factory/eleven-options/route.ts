import { NextResponse } from "next/server";
import { speechReady, elevenListVoices } from "@/lib/factory/elevenlabs";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

// V22 · живой список голосов для пикера. Если настроен Yandex SpeechKit — отдаём SpeechKit-голоса;
// иначе пробуем ElevenLabs. Без ключей/доступа → пусто + note.
//   GET ?type=voices → { ok, type, options:[{id,name,meta,preview,labels}] }
export async function GET() {
  try {
    if (!speechReady()) return NextResponse.json({ ok: true, options: [], note: "SpeechKit/ElevenLabs не настроены — добавь ключи в Vercel" }, { headers: { "Cache-Control": "no-store" } });
    const voices = await elevenListVoices();
    const options = voices.map((v) => ({ id: v.id, name: v.name, meta: v.labels || v.meta || "", preview: v.preview || "", audio: true }));
    return NextResponse.json({ ok: true, type: "voices", options, note: options.length ? undefined : "голоса не пришли (SpeechKit/ElevenLabs недоступны)" }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: true, options: [], note: "voice adapter недоступен: " + String((e as Error)?.message || e).slice(0, 100) }, { headers: { "Cache-Control": "no-store" } });
  }
}
