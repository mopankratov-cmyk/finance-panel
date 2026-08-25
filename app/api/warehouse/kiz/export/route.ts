import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";
import { buildXlsx } from "@/lib/xlsx/write";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Честный Знак принимает не больше 30 000 кодов в одном документе вывода. */
const CHZ_DOC_LIMIT = 30_000;

interface ExportRow {
  code: string;
  raw_code: string | null;
  price: number | null;
  article: string | null;
  task_id: string | null;
  sold_at: string | null;
  nm_id: number | null;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missing = (code?: string) => ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(code ?? "");
const MIGRATION_HINT = "Примените миграции 202608250030–033";
const nothingToExport = (name: string) =>
  `У юрлица «${name}» нечего выгружать: коды уже отправлены, вернулись в оборот или принадлежат другому юрлицу`;
const COLUMNS = "code, raw_code, price, article, task_id, sold_at, nm_id";

/**
 * Файл на вывод из оборота.
 *
 * Формат задан получателем: первым столбцом КИЗ, рядом цена реализации.
 * Остальные колонки — справочные, чтобы спорную строку можно было найти в
 * кабинете WB, не поднимая исходные выгрузки.
 */
function sheetOf(rows: ExportRow[]): (string | number | null)[][] {
  return [
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
}

function fileResponse(rows: ExportRow[], batchId: string | null, remaining: number) {
  const file = buildXlsx("КИЗ на вывод", sheetOf(rows));
  const name = `kiz-na-vyvod-${new Date().toISOString().slice(0, 10)}-${rows.length}.xlsx`;
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "X-Kiz-Count": String(rows.length),
      "X-Kiz-Limit": String(CHZ_DOC_LIMIT),
      "X-Kiz-Remaining": String(remaining),
      ...(batchId ? { "X-Kiz-Batch": batchId } : {}),
    },
  });
}

/**
 * Скачать уже собранную партию заново.
 *
 * Отметка «отправлено» ставится до того, как файл доедет до диска: браузер мог
 * закрыться, сеть оборваться, человек — промахнуться мимо «Сохранить». Без
 * повторного скачивания такая партия была бы потеряна навсегда, потому что
 * второй раз эти коды уже не соберутся.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const url = new URL(request.url);
  const batchId = url.searchParams.get("batch");
  if (!batchId) return fail("Не указана партия", 400);

  const scope = await resolveEntity(url.searchParams.get("entity"));
  if (!scope.ok) return fail(scope.error, scope.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const { data, error } = await db
    .from("kiz_withdrawals")
    .select(COLUMNS)
    .eq("batch_id", batchId)
    .eq("legal_entity_id", scope.entity.id)
    .order("sold_at", { ascending: true })
    .order("code", { ascending: true })
    .limit(CHZ_DOC_LIMIT);
  if (error) return fail(missing(error.code) ? MIGRATION_HINT : error.message, missing(error.code) ? 503 : 500);
  const rows = (data ?? []) as ExportRow[];
  if (rows.length === 0) return fail("Партия не найдена — возможно, она собрана под другим юрлицом", 404);

  return fileResponse(rows, batchId, 0);
}

/**
 * Собрать файл и занять коды.
 *
 * Порядок именно такой: сначала пометить, потом отдать. Обратный порядок —
 * «прочитали, отдали файл, потом пометили» — даёт две беды сразу. Два человека,
 * нажавшие кнопку одновременно, получают ОДИН И ТОТ ЖЕ набор кодов в двух
 * документах; а если пометка не прошла, файл уже уехал, и те же коды соберутся
 * повторно. Пометка через `.eq("status", "sold")` с возвратом строк — это
 * атомарный захват: в файл попадает ровно то, что удалось занять.
 *
 * Если занять удалось не всё, занятое возвращается обратно по номеру партии, и
 * человек видит ошибку вместо половины документа.
 */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const body = (await request.json().catch(() => null)) as
    { markSent?: boolean; limit?: number; entityId?: string | null } | null;

  // Юрлицо обязательно, а не «если передали»: запасной путь без него означал бы,
  // что устаревшая вкладка одним запросом пометит отправленными коды всех
  // юрлиц сразу, а откатить эту отметку штатно нечем.
  const scope = await resolveEntity(body?.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);
  const entityId = scope.entity.id;

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const limit = Math.min(CHZ_DOC_LIMIT, Math.max(1, Number(body?.limit) || CHZ_DOC_LIMIT));

  // Предпросмотр без отметки: коды остаются свободными. Читаем ровно столько же
  // и в том же порядке, что заняла бы настоящая сборка.
  if (body?.markSent === false) {
    const preview = await db
      .from("kiz_withdrawals")
      .select(COLUMNS)
      .eq("status", "sold")
      .eq("legal_entity_id", entityId)
      .order("sold_at", { ascending: true, nullsFirst: false })
      .order("code", { ascending: true })
      .limit(limit);
    if (preview.error) {
      const code = preview.error.code;
      return fail(missing(code) ? MIGRATION_HINT : preview.error.message, missing(code) ? 503 : 500);
    }
    const rows = (preview.data ?? []) as ExportRow[];
    if (rows.length === 0) return fail(nothingToExport(scope.entity.name), 400);
    return fileResponse(rows, null, 0);
  }

  // Отбор и пометка — один оператор в базе. Здесь не может случиться ни
  // «пометилось наполовину», ни «двое собрали одно и то же».
  const batchId = crypto.randomUUID();
  const { data, error } = await db.rpc("kiz_claim_batch", {
    p_entity: entityId,
    p_limit: limit,
    p_batch: batchId,
  });
  if (error) {
    const code = error.code;
    return fail(missing(code) ? MIGRATION_HINT : error.message, missing(code) ? 503 : 500);
  }
  const claimed = (data ?? []) as ExportRow[];
  if (claimed.length === 0) return fail(nothingToExport(scope.entity.name), 400);

  const rest = await db
    .from("kiz_withdrawals")
    .select("code", { count: "exact", head: true })
    .eq("status", "sold")
    .eq("legal_entity_id", entityId);

  return fileResponse(claimed, batchId, rest.count ?? 0);
}
