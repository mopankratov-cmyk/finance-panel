import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const HG_BASE = "https://api.heygen.com";

// Помощник выбора ID: список аватаров (V2) + русские голоса (V2) для HEYGEN_AVATAR_ID/HEYGEN_VOICE_ID.
export async function GET() {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) return NextResponse.json({ detail: "HEYGEN_API_KEY не настроен" }, { status: 500 });
  const h = { headers: { "X-Api-Key": apiKey }, cache: "no-store" as const, signal: AbortSignal.timeout(20000) };
  try {
    const [av, vc] = await Promise.all([
      fetch(`${HG_BASE}/v2/avatars`, h).then((r) => r.json()).catch(() => null),
      fetch(`${HG_BASE}/v2/voices`, h).then((r) => r.json()).catch(() => null),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const avatars = (av?.data?.avatars || []).slice(0, 40).map((a: any) => ({ avatar_id: a.avatar_id, name: a.avatar_name, gender: a.gender, preview: a.preview_image_url }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const voicesAll = (vc?.data?.voices || []) as any[];
    const ru = voicesAll.filter((v) => /ru|russ/i.test(`${v.language}${v.locale || ""}`)).slice(0, 30)
      .map((v) => ({ voice_id: v.voice_id, name: v.name, gender: v.gender, language: v.language }));
    return NextResponse.json({ avatars, voices_ru: ru, voices_total: voicesAll.length, hint: "Скопируй avatar_id и voice_id в env: HEYGEN_AVATAR_ID, HEYGEN_VOICE_ID" });
  } catch (e) {
    return NextResponse.json({ detail: String(e).slice(0, 150) }, { status: 502 });
  }
}
