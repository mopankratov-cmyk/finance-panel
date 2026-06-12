import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getWbCardImage } from "@/lib/wb/cardImage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LABELS = ["A", "B", "C", "D", "E", "F"];

export async function POST(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = await request.json().catch(() => ({}));
  const testId: number | null = typeof b.test_id === "number" ? b.test_id : null;
  const source: string = typeof b.source === "string" ? b.source : "generated";
  const nmId: number | null = typeof b.nmId === "number" ? b.nmId : null;
  if (!testId) return NextResponse.json({ error: "Нужен test_id" }, { status: 400 });

  let imageUrl = typeof b.image_url === "string" ? b.image_url : "";
  let prompt: string | null = null;

  try {
    if (source === "card") {
      if (!nmId) return NextResponse.json({ error: "Нужен nmId для фото карточки" }, { status: 400 });
      imageUrl = (await getWbCardImage(nmId)) ?? "";
      if (!imageUrl) return NextResponse.json({ error: "Фото карточки не найдено" }, { status: 404 });
    } else if (source === "generated") {
      // переиспользуем генерацию фото
      const base = new URL(request.url).origin;
      const res = await fetch(`${base}/api/content/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ article: b.article, name: b.name, nmId, aspectRatio: "3:4", fromCard: !!nmId }),
      });
      const json = await res.json();
      if (json.error || !json.imageUrl) {
        return NextResponse.json({ error: json.error ?? "Не удалось сгенерировать" }, { status: 502 });
      }
      imageUrl = json.imageUrl;
      prompt = json.prompt ?? null;
    }
    if (!imageUrl) return NextResponse.json({ error: "Нет изображения" }, { status: 400 });

    // авто-метка по числу существующих вариантов
    const { count } = await db.from("ctr_variants").select("id", { count: "exact", head: true }).eq("test_id", testId);
    const label = LABELS[count ?? 0] ?? String((count ?? 0) + 1);

    const { data, error } = await db
      .from("ctr_variants")
      .insert({ test_id: testId, label, image_url: imageUrl, source, prompt })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = await request.json().catch(() => ({}));
  if (!b.id || !b.test_id) return NextResponse.json({ error: "Нужны id и test_id" }, { status: 400 });
  // победитель один на тест
  await db.from("ctr_variants").update({ is_winner: false }).eq("test_id", b.test_id);
  const { error } = await db.from("ctr_variants").update({ is_winner: true }).eq("id", b.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Нужен id" }, { status: 400 });
  const { error } = await db.from("ctr_variants").delete().eq("id", Number(id));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
