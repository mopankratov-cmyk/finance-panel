import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * Перенос кадра между «главными фото» и «фотоворонкой».
 *
 * Половину экрана кадр получает по номеру: первый — главный, второй и дальше —
 * воронка, а съёмка без номера считается кандидатом в обложку. Правило дешёвое
 * и ошибается в обе стороны: инфографика и таблица размеров приезжают съёмкой
 * без номера и садятся в главные, а удачный кадр карточки со второго места в
 * главные не попадает, хотя обложкой стать вполне может.
 *
 * Поэтому пометку можно поставить руками, и она сильнее вычисленной. Хранится
 * она в `content_assets.role` — по АДРЕСУ файла, а не по строке: кадр галереи
 * карточки и строка каталога это один и тот же файл, пришедший двумя путями, и
 * пометка обязана действовать на оба. Иначе один кадр оказался бы одновременно
 * в обеих половинах экрана.
 *
 * Действие обратимое и ничего не удаляет: `null` возвращает кадр к тому, что
 * посчитано по номеру.
 */
const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

const GROUPS = new Set(["main", "funnel"]);

export async function PATCH(request: NextRequest) {
  const gate = await requireApiSession(["director", "fin_director", "financier", "wb_manager", "ozon_manager", "seller"]);
  if (gate) return gate;

  const body = await request.json().catch(() => null) as { url?: string; cabinet?: string; group?: string | null } | null;
  const target = String(body?.url ?? "").trim();
  const cabinetId = String(body?.cabinet ?? "").trim();
  const raw = body?.group == null ? null : String(body.group).trim();

  if (!target) return fail("Не указан файл", 400);
  if (!cabinetId) return fail("Не указан кабинет", 400);
  if (raw !== null && !GROUPS.has(raw)) return fail("Группа бывает «main» или «funnel»", 400);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  /**
   * Право пометить — это право на ТОВАР, а не на файл: каталог общий на всю
   * базу и кабинета у него нет. Артикул строки должен встречаться среди
   * карточек этого кабинета, иначе сосед по прямой ссылке перекладывал бы
   * чужие кадры.
   */
  const asset = await db.from("content_assets").select("id, article").eq("url", target).limit(1).maybeSingle();
  const article = String(asset.data?.article ?? "").trim();
  if (!asset.data) return fail("Файла нет в каталоге — помечать нечего", 404);
  if (!article) return fail("У файла не заполнен артикул — подтвердить, что он ваш, нечем", 403);

  const card = await db.from("wb_cards").select("nm_id").eq("cabinet_id", cabinetId).eq("article", article).limit(1).maybeSingle();
  if (!card.data) return fail("Товар этого файла не заведён в выбранном кабинете", 403);

  // Обновляем ВСЕ строки с этим адресом: один файл каталог иногда хранит
  // несколькими записями, и пометка на одной из них дала бы кадр в двух
  // половинах сразу.
  const updated = await db.from("content_assets").update({ role: raw }).eq("url", target);
  if (updated.error) return fail(`Каталог не принял пометку: ${updated.error.message}`, 502);

  return NextResponse.json({ ok: true, group: raw });
}
