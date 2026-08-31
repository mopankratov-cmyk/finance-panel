import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";
import { buildXlsx } from "@/lib/xlsx/write";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";

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
 * Все строки партии — постранично.
 *
 * Документ ЧЗ вмещает 30 000 кодов, а Supabase отдаёт за запрос максимум
 * тысячу — молча. Из-за этого захват помечал отправленными все 30 000, а в
 * файл попадала первая тысяча: остальные коды считались выгруженными и не
 * появлялись уже ни в одном документе. Повторное скачивание страдало тем же.
 */
async function loadBatchRows(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  batchId: string,
  entityId: string | null,
): Promise<ExportRow[]> {
  return loadAllSupabasePages<ExportRow>((from, to) => {
    let query = db
      .from("kiz_withdrawals")
      .select(COLUMNS)
      .eq("batch_id", batchId)
      .order("sold_at", { ascending: true })
      .order("code", { ascending: true })
      .range(from, to);
    if (entityId) query = query.eq("legal_entity_id", entityId);
    return query as unknown as PromiseLike<{ data: ExportRow[] | null; error: { message: string } | null }>;
  }, { label: "КИЗ: партия на вывод", maxPages: 40 });
}

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

/**
 * Документ не должен уезжать пустым — ни при каких обстоятельствах.
 *
 * Так уже было: файл собрался на девятнадцать кодов, весил девять килобайт, а
 * в Excel открывался пустым — разделитель GS внутри кода делал XML
 * недопустимым, и Excel «чинил» книгу, выбрасывая лист. Ошибки не было нигде:
 * ни в панели, ни в Excel. Поэтому проверяем не намерение, а результат: в
 * готовом файле должно лежать столько же строк с кодами, сколько мы собрали, и
 * ни одного управляющего символа.
 */
function assertSheetIsUsable(file: Buffer, expectedRows: number) {
  const xml = file.toString("utf8");
  const start = xml.indexOf("<sheetData>");
  const end = xml.indexOf("</sheetData>");
  const body = start >= 0 && end > start ? xml.slice(start, end) : "";
  const rowCount = (body.match(/<row\b/g) ?? []).length;
  if (rowCount < expectedRows + 1) {
    throw new Error(`В документе ${Math.max(0, rowCount - 1)} строк вместо ${expectedRows} — файл собрался неверно`);
  }
  // eslint-disable-next-line no-control-regex -- ровно эти символы и ломают книгу
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml)) {
    throw new Error("В документе остались управляющие символы — Excel откроет его пустым");
  }
}

function fileResponse(rows: ExportRow[], batchId: string | null, remaining: number) {
  const file = buildXlsx("КИЗ на вывод", sheetOf(rows));
  assertSheetIsUsable(file, rows.length);
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

  let rows: ExportRow[];
  try {
    rows = await loadBatchRows(db, batchId, scope.entity.id);
  } catch (cause) {
    // Постраничный читатель отдаёт только текст ошибки, код PostgreSQL в нём
    // теряется — ловим по сообщению, иначе подсказка про миграции никогда не
    // сработает.
    const message = cause instanceof Error ? cause.message : "Не удалось прочитать партию";
    const missingTable = /42P01|42703|PGRST20[245]|does not exist|schema cache/i.test(message);
    return fail(missingTable ? MIGRATION_HINT : message, missingTable ? 503 : 500);
  }
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
  const returned = (data ?? []) as ExportRow[];
  if (returned.length === 0) return fail(nothingToExport(scope.entity.name), 400);
  // Захват в базе пометил ВСЮ партию, но ответ RPC обрезан тысячей строк.
  // Перечитываем партию по её номеру: иначе помеченные, но не отданные коды
  // исчезли бы навсегда — «отправлены», а ни в одном файле их нет.
  let claimed: ExportRow[];
  try {
    claimed = await loadBatchRows(db, batchId, entityId);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Не удалось перечитать партию";
    // Коды уже помечены отправленными, а файла нет. Отдаём НОМЕР ПАРТИИ:
    // без него экран не покажет «Скачать заново», и человек решит, что коды
    // сгорели.
    return NextResponse.json(
      { data: null, error: `${message}. Партия захвачена — скачайте её заново по номеру.`, batch: batchId },
      { status: 500 },
    );
  }
  if (claimed.length === 0) return fail(nothingToExport(scope.entity.name), 400);

  const rest = await db
    .from("kiz_withdrawals")
    .select("code", { count: "exact", head: true })
    .eq("status", "sold")
    .eq("legal_entity_id", entityId);

  return fileResponse(claimed, batchId, rest.count ?? 0);
}
