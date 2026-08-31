import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { saveCardMediaOrder } from "@/lib/wb/media";
import { fetchCardForWrite } from "@/lib/wb/cards";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";

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

async function windowStats(cabinetId: string, nmId: number, from: Date, to: Date) {
  const db = getSupabaseAdmin();
  if (!db) return { opensPerDay: 0, cartConvPct: null as number | null, days: 0 };
  const { data } = await db.from("wb_funnel_daily").select("open_card, add_to_cart")
    .eq("cabinet_id", cabinetId).eq("nm_id", nmId).gte("date", from.toISOString().slice(0, 10)).lt("date", to.toISOString().slice(0, 10));
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
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const cabinetId = new URL(request.url).searchParams.get("cabinet");
  if (!cabinetId || cabinetId === "all" || cabinetId.startsWith("group:")) return NextResponse.json({ ok: false, error: "Выберите один реальный WB-кабинет" }, { status: 400 });
  if (!(await hasCabinetAccess(cabinetId))) return NextResponse.json({ ok: false, error: "Нет доступа к кабинету" }, { status: 403 });
  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
  let query = db.from("cover_tests").select("id, nm_id, article, switched_at").eq("cabinet_id", cabinetId).order("switched_at", { ascending: false }).limit(30);
  if (allowedNmIds !== null) query = query.in("nm_id", allowedNmIds.size ? [...allowedNmIds] : [-1]);
  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows: CoverTestRow[] = await Promise.all((data ?? []).map(async (t) => {
    const switchedAt = new Date(t.switched_at as string);
    const before = await windowStats(cabinetId, t.nm_id as number, new Date(switchedAt.getTime() - WINDOW_DAYS * 86_400_000), switchedAt);
    const to = new Date(Math.min(Date.now(), switchedAt.getTime() + WINDOW_DAYS * 86_400_000));
    const after = await windowStats(cabinetId, t.nm_id as number, switchedAt, to);
    return { id: t.id as number, nmId: t.nm_id as number, article: t.article as string, switchedAt: t.switched_at as string, before, after };
  }));

  return NextResponse.json({ ok: true, rows });
}

// POST — реальная запись на WB (переупорядочивает уже загруженные фото карточки).
//
// Публичный контент, видимый покупателям, и запись НЕОБРАТИМА: media/save
// заменяет набор медиафайлов карточки целиком, а оригиналы из WB потом не
// достать. Поэтому здесь три границы, и ни одна не держится на клиенте.
//
// 1. Роль. Раньше хватало любой живой сессии — то есть обложку мог переписать
//    финансист или менеджер. Соседний write того же эндпоинта (ugc/publish)
//    требует директора, и здесь причин быть мягче нет.
// 2. Что писать решает СЕРВЕР. Клиент присылает только номер фотографии,
//    которую надо поднять главной. Набор URL берётся свежим запросом к WB —
//    в максимальном размере, который WB отдаёт. Раньше писался массив,
//    пришедший с экрана, а он собран из витринных миниатюр 246×328: такая
//    запись подменила бы всю галерею почтовыми марками.
// 3. Видео. Не проверено, переживает ли видео замену набора, — карточки с
//    видео к записи не допускаются вовсе.
export async function POST(req: NextRequest) {
  const gate = await requireApiSession(["director"]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as {
    cabinetId?: string; nmId?: number; article?: string; photoIndex?: number; photoName?: string;
  };
  const { cabinetId, nmId, article, photoIndex, photoName } = body;
  if (!cabinetId || !nmId || !Number.isInteger(photoIndex) || (photoIndex as number) < 0 || !photoName) {
    return NextResponse.json({ ok: false, error: "Не хватает данных: cabinetId, nmId, photoIndex, photoName" }, { status: 400 });
  }
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ ok: false, error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  if (allowedNmIds !== null && !allowedNmIds.has(nmId)) {
    return NextResponse.json({ ok: false, error: "SKU не входит в разрешённый товарный контур кабинета" }, { status: 403 });
  }

  const cab = await getWbCabinet(cabinetId);
  if (!cab) return NextResponse.json({ ok: false, error: "Кабинет не найден" }, { status: 404 });
  const token = resolveWbToken(cab, "content");

  const card = await fetchCardForWrite(token, nmId);
  if (!card.found) {
    return NextResponse.json({ ok: false, error: "WB не подтвердил карточку — запись отменена. Повторите позже." }, { status: 409 });
  }
  if (card.hasVideo) {
    return NextResponse.json({ ok: false, error: "У карточки есть видео — автосмена обложки временно отключена для таких карточек: не проверено, сохраняет ли WB видео после этого запроса. Смените фото вручную через личный кабинет WB." }, { status: 409 });
  }
  if (card.photos.length < 2) {
    return NextResponse.json({ ok: false, error: "У карточки меньше двух фотографий — менять местами нечего." }, { status: 409 });
  }
  const index = photoIndex as number;
  if (index >= card.photos.length) {
    return NextResponse.json({ ok: false, error: `У карточки ${card.photos.length} фото, а выбрано ${index + 1}-е. Обновите страницу — набор изменился.` }, { status: 409 });
  }
  if (index === 0) {
    return NextResponse.json({ ok: false, error: "Это фото и так главное." }, { status: 409 });
  }
  // Номер — ссылка в тот набор, который человек видел на экране. Если порядок
  // на WB успел измениться (прошлый тест обложки, правка в кабинете), тот же
  // номер укажет на ЧУЖОЕ фото, и главным станет не то, на что нажали.
  // Поэтому вместе с номером приходит имя файла: у всех размеров одного фото
  // оно одинаковое (…/c246x328/3.webp и …/hq/3.webp).
  const chosenName = String(photoName).split("/").pop() ?? "";
  if (!chosenName || !card.photos[index].endsWith(`/${chosenName}`)) {
    return NextResponse.json({
      ok: false,
      error: "Порядок фото на WB изменился с момента, когда вы открыли карточку. Обновите страницу и выберите фото заново.",
    }, { status: 409 });
  }

  const photosBefore = card.photos;
  const photosAfter = [photosBefore[index], ...photosBefore.filter((_, i) => i !== index)];

  const write = await saveCardMediaOrder(token, nmId, photosAfter);
  if (!write.ok) return NextResponse.json({ ok: false, error: write.error }, { status: 502 });

  const session = await getServerSession();
  const { error } = await db.from("cover_tests").insert({
    cabinet_id: cabinetId, nm_id: nmId, article: article || String(nmId),
    photos_before: photosBefore, photos_after: photosAfter,
    created_by: session?.email ?? null,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
