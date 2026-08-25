import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listAccessibleEntities, resolveEntity } from "@/lib/warehouse/entityAccess";
import { buildXlsx } from "@/lib/xlsx/write";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });

/**
 * Файл на вывод из оборота.
 *
 * Формат задан получателем: первым столбцом КИЗ, рядом цена реализации.
 * Остальные колонки — справочные, чтобы спорную строку можно было найти в
 * кабинете WB, не поднимая исходные выгрузки.
 *
 * Отправка помечает коды партией. Это не косметика: без отметки следующая
 * выгрузка отправит их второй раз, а вывести один код дважды нельзя.
 */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const body = (await request.json().catch(() => null)) as
    { markSent?: boolean; limit?: number; entityId?: string | null } | null;

  // Сбор файла — необратимое действие: отправленные коды помечаются и второй
  // раз не собираются. Поэтому сузить его юрлицом важнее, чем сузить экран:
  // собрать чужие коды в свой документ вывода — ошибка, которую не откатить.
  const wanted = body?.entityId ?? null;
  const scope = await resolveEntity(wanted);
  if (wanted && !scope.ok) return fail(scope.error, scope.status);
  if (!wanted) {
    const list = await listAccessibleEntities();
    if (!list.ok) return fail(list.error, list.status);
  }
  const entityId = scope.ok ? scope.entity.id : null;

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();

  // Честный Знак принимает не больше 30 000 кодов в одном документе вывода.
  // Отдать больше значит отдать файл, который получатель не сможет загрузить.
  const CHZ_DOC_LIMIT = 30_000;
  const limit = Math.min(CHZ_DOC_LIMIT, Math.max(1, Number(body?.limit) || CHZ_DOC_LIMIT));
  let query = db
    .from("kiz_withdrawals")
    .select("code, raw_code, price, article, task_id, sold_at, nm_id")
    .eq("status", "sold");
  if (entityId) query = query.eq("legal_entity_id", entityId);
  const { data, error } = await query
    // Сортировка для человека, который будет сверять файл глазами: сначала по
    // товару, внутри товара по дате продажи.
    .order("article", { ascending: true })
    .order("sold_at", { ascending: true })
    .order("code", { ascending: true })
    .limit(limit);
  if (error) {
    const missing = ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "");
    return fail(missing ? "Примените миграции 202608250030 и 202608250031" : error.message, missing ? 503 : 500);
  }
  const rows = data ?? [];
  if (rows.length === 0) {
    return fail(entityId
      ? `У юрлица «${scope.ok ? scope.entity.name : ""}» нечего выгружать: коды уже отправлены, вернулись в оборот или принадлежат другому юрлицу`
      : "Нечего выгружать: все проданные коды уже отправлены или вернулись в оборот", 400);
  }

  const sheet: (string | number | null)[][] = [
    ["КИЗ", "Цена реализации, ₽", "Артикул", "Номер задания", "Дата продажи", "Артикул WB"],
    ...rows.map((row) => [
      // Отправляем код так, как он лежал в выгрузке WB: получатель сверяет с тем
      // же файлом, из которого мы его взяли.
      String(row.raw_code ?? row.code),
      row.price === null || row.price === undefined ? "" : Number(row.price),
      String(row.article ?? ""),
      String(row.task_id ?? ""),
      row.sold_at ? String(row.sold_at) : "",
      row.nm_id === null || row.nm_id === undefined ? "" : Number(row.nm_id),
    ]),
  ];

  const file = buildXlsx("КИЗ на вывод", sheet);

  if (body?.markSent !== false) {
    const batchId = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const codes = rows.map((row) => String(row.code));
    for (let offset = 0; offset < codes.length; offset += 300) {
      // Пометка идёт по тем же кодам, что попали в файл, и только по ним:
      // отметить отправленным то, чего в документе нет, — потерять код навсегда.
      await db
        .from("kiz_withdrawals")
        .update({ status: "sent", batch_id: batchId, sent_at: stamp, updated_at: stamp })
        .in("code", codes.slice(offset, offset + 300))
        .eq("status", "sold");
    }
    void session;
  }

  const name = `kiz-na-vyvod-${new Date().toISOString().slice(0, 10)}-${rows.length}.xlsx`;
  // Сколько осталось после этой партии: если кодов больше лимита документа,
  // человек должен знать, что файл не последний.
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "X-Kiz-Count": String(rows.length),
      "X-Kiz-Limit": String(CHZ_DOC_LIMIT),
    },
  });
}
