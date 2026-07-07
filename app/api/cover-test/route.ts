import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { saveCardMediaOrder } from "@/lib/wb/media";
import { checkCardHasVideo } from "@/lib/wb/cards";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export interface CoverTestRow {
  id: number;
  nmId: number;
  article: string;
  switchedAt: string;
  before: { opensPerDay: number; cartConvPct: number | null; days: number };
  after: { opensPerDay: number; cartConvPct: number | null; days: number };
}

const WINDOW_DAYS = 14;

async function windowStats(nmId: number, from: Date, to: Date) {
  const db = getSupabaseAdmin();
  if (!db) return { opensPerDay: 0, cartConvPct: null as number | null, days: 0 };
  const { data } = await db.from("wb_funnel_daily").select("open_card, add_to_cart")
    .eq("nm_id", nmId).gte("date", from.toISOString().slice(0, 10)).lt("date", to.toISOString().slice(0, 10));
  const rows = data ?? [];
  const days = rows.length;
  const opens = rows.reduce((s, r) => s + Number(r.open_card ?? 0), 0);
  const carts = rows.reduce((s, r) => s + Number(r.add_to_cart ?? 0), 0);
  return {
    opensPerDay: days ? Math.round((opens / days) * 10) / 10 : 0,
    cartConvPct: opens > 0 ? Math.round((carts / opens) * 1000) / 10 : null,
    days,
  };
}

// GET — история тестов + сравнение конверсии открытие→корзина до/после переключения.
// Не «CTR показа в поиске» — этого официальный API не даёт (см. docs/отложено.md п.1),
// это честный, измеримый proxy: как обложка влияет на решение добавить в корзину.
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
  const { data, error } = await db.from("cover_tests").select("id, nm_id, article, switched_at").order("switched_at", { ascending: false }).limit(30);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows: CoverTestRow[] = await Promise.all((data ?? []).map(async (t) => {
    const switchedAt = new Date(t.switched_at as string);
    const before = await windowStats(t.nm_id as number, new Date(switchedAt.getTime() - WINDOW_DAYS * 86_400_000), switchedAt);
    const to = new Date(Math.min(Date.now(), switchedAt.getTime() + WINDOW_DAYS * 86_400_000));
    const after = await windowStats(t.nm_id as number, switchedAt, to);
    return { id: t.id as number, nmId: t.nm_id as number, article: t.article as string, switchedAt: t.switched_at as string, before, after };
  }));

  return NextResponse.json({ ok: true, rows });
}

// POST — реальная запись на WB (переупорядочивает уже загруженные фото карточки).
// Публичный контент, видимый покупателям — владелец подтверждает это явно в UI
// (модалка с предупреждением) перед вызовом; сам эндпоинт ничего не делает по расписанию.
export async function POST(req: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as {
    cabinetId?: string; nmId?: number; article?: string; photosBefore?: string[]; photosAfter?: string[];
  };
  const { cabinetId, nmId, article, photosBefore, photosAfter } = body;
  if (!cabinetId || !nmId || !photosAfter?.length) {
    return NextResponse.json({ ok: false, error: "Не хватает данных: cabinetId, nmId, photosAfter" }, { status: 400 });
  }

  const cab = await getWbCabinet(cabinetId);
  if (!cab) return NextResponse.json({ ok: false, error: "Кабинет не найден" }, { status: 404 });
  const token = resolveWbToken(cab, "content");

  // WB документирует, что media/save полностью заменяет прежний набор медиафайлов
  // карточки; неясно, живёт ли видео в том же наборе — не проверено эмпирически,
  // поэтому не рискуем и блокируем запись для карточек с видео (см. lib/wb/cards.ts).
  const hasVideo = await checkCardHasVideo(token, nmId);
  if (hasVideo) {
    return NextResponse.json({ ok: false, error: "У карточки есть видео — автосмена обложки временно отключена для таких карточек: не проверено, сохраняет ли WB видео после этого запроса. Смените фото вручную через личный кабинет WB." }, { status: 409 });
  }

  const write = await saveCardMediaOrder(token, nmId, photosAfter);
  if (!write.ok) return NextResponse.json({ ok: false, error: write.error }, { status: 502 });

  const session = await getServerSession();
  const { error } = await db.from("cover_tests").insert({
    cabinet_id: cabinetId, nm_id: nmId, article: article || String(nmId),
    photos_before: photosBefore ?? [], photos_after: photosAfter,
    created_by: session?.email ?? null,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
