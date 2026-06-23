import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// POST — создать CTR-тест (черновик, enabled=false). Тело: { nmId, article?, name?, cabinet?,
// variants:[{label,imageUrl,source}], intervalMin?, minImpr? }. Запуск/вкл — отдельно (после миграции + валидации swap).
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const b = (await request.json().catch(() => ({}))) as {
    nmId?: number; article?: string; name?: string;
    variants?: { label?: string; imageUrl?: string; source?: string }[];
    intervalMin?: number; minImpr?: number;
  };
  if (!b.nmId) return NextResponse.json({ error: "Укажите nmId" }, { status: 400 });
  const variants = (b.variants ?? []).filter((v) => v.imageUrl);
  if (variants.length < 2) return NextResponse.json({ error: "Нужно ≥2 вариантов с imageUrl" }, { status: 400 });

  const { data: test, error } = await db
    .from("ctr_tests")
    .insert({
      nm_id: b.nmId, article: b.article ?? null, name: b.name ?? null,
      status: "draft", enabled: false,
      interval_min: b.intervalMin ?? 60, min_impr: b.minImpr ?? 2000,
    })
    .select("id")
    .maybeSingle();
  if (error || !test) return NextResponse.json({ error: error?.message || "insert failed" }, { status: 500 });

  const rows = variants.map((v, i) => ({
    test_id: test.id,
    label: v.label ?? String.fromCharCode(65 + i),
    image_url: v.imageUrl,
    source: v.source ?? "upload",
  }));
  const { error: ve } = await db.from("ctr_variants").insert(rows);
  if (ve) return NextResponse.json({ error: ve.message }, { status: 500 });

  return NextResponse.json({ ok: true, testId: test.id, variants: rows.length });
}
