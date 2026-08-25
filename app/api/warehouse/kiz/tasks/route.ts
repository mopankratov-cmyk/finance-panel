import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listAccessibleEntities } from "@/lib/warehouse/entityAccess";
import { parseKizCode } from "@/lib/wb/kizCodes";
import { attachKizEntities } from "@/lib/warehouse/kizEntity";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export interface KizTasksResult {
  /** Заданий с кодами в базе. */
  withCodes: number;
  /** Из них удалось связать с продажей. */
  linked: number;
  /** Из связанных — выкуплено покупателем: их и выводим. */
  bought: number;
  /** Вернулись — в оборот их возвращает WB. */
  returned: number;
  added: number;
  /** Код есть, но связать с продажей нечем: у задания не сохранён srid. */
  unlinked: number;
  /** Прежним строкам дописаны дата продажи и товар. */
  enriched: number;
  /** Строк, которым дописать нечего: продажа по их srid не нашлась. */
  stillBlank: number;
}

/** Что продажа знает про код: цену, дату выкупа и товар. */
interface Sale {
  price: number | null;
  soldAt: string | null;
  nmId: number | null;
  article: string | null;
}

/** Сколько прежних строк без даты чиним за один заход. Потолок нужен затем,
 *  чтобы разовый долг не превращал быстрый шаг в долгий. */
const BLANK_LIMIT = 1000;

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");

/**
 * Коды из сборочных заданий — самый быстрый источник.
 *
 * КИЗ проставляется в задание при сборке, то есть код известен в день отгрузки,
 * а не через неделю, когда продажа дойдёт до отчёта о реализации. Для трёхдневного
 * срока вывода из оборота это решающая разница.
 *
 * Выводить можно только выкупленное: пока товар едет, продажи ещё нет, а
 * отказ покупателя вернёт код в оборот. Факт выкупа даёт wb_sales — продажа с
 * номером на S, возврат на R.
 */
export async function POST(_request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const list = await listAccessibleEntities();
  if (!list.ok) return fail(list.error, list.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const cabinetIds = [...new Set(list.rows.flatMap((entity) =>
    entity.cabinets.filter((link) => link.marketplace === "wb").map((link) => link.cabinetId)))];
  if (cabinetIds.length === 0) return fail("Нет кабинетов Wildberries, связанных с юрлицами", 400);

  let codeRows: { cabinet_id: string; order_id: number; codes: string[]; srid: string | null }[];
  try {
    codeRows = await loadAllSupabasePages((from, to) => db
      .from("wb_fbs_order_kiz")
      .select("cabinet_id, order_id, codes, srid")
      .in("cabinet_id", cabinetIds)
      .not("codes", "eq", "{}")
      .order("order_id")
      .range(from, to), { maxPages: 200, label: "Коды сборочных заданий" });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    return fail(missingMigration(code) ? "Примените миграцию 202608240026_kiz_srid.sql" : String(error), missingMigration(code) ? 503 : 500);
  }

  const withCodes = codeRows.filter((row) => (row.codes ?? []).length > 0);
  // srid берём из самой записи, а если его там нет — из таблицы заданий.
  // Второй путь работает не всегда: колонку order_id там заполняли не с начала.
  const missingSrid = withCodes.filter((row) => !row.srid).map((row) => Number(row.order_id));
  const sridByOrder = new Map<number, string>();
  for (let offset = 0; offset < missingSrid.length; offset += 200) {
    const { data } = await db
      .from("wb_fbs_orders")
      .select("order_id, srid")
      .in("order_id", missingSrid.slice(offset, offset + 200));
    for (const row of data ?? []) if (row.srid) sridByOrder.set(Number(row.order_id), String(row.srid));
  }

  // Найденный srid дописываем обратно к коду: искать одну и ту же связь при
  // каждом заходе — лишняя работа, а таблица заданий заполняется неравномерно.
  const backfill: { cabinet_id: string; order_id: number; srid: string }[] = [];

  const bySrid = new Map<string, { cabinetId: string; codes: string[] }>();
  for (const row of withCodes) {
    const srid = row.srid ?? sridByOrder.get(Number(row.order_id)) ?? null;
    if (!srid) continue;
    if (!row.srid) backfill.push({ cabinet_id: String(row.cabinet_id), order_id: Number(row.order_id), srid: String(srid) });
    bySrid.set(String(srid), { cabinetId: String(row.cabinet_id), codes: (row.codes ?? []).map(String) });
  }

  for (const row of backfill) {
    await db.from("wb_fbs_order_kiz").update({ srid: row.srid })
      .eq("cabinet_id", row.cabinet_id).eq("order_id", row.order_id);
  }

  // Выкуп и возврат: номер продажи начинается с S, возврата — с R.
  //
  // Из продажи берём не только цену. Дата выкупа — это начало трёхсуточного
  // срока вывода из оборота: без неё код лежит в реестре вечно свежим, и
  // «просрочено» никогда не загорится по самому быстрому источнику. Товар нужен
  // затем, чтобы код в реестре можно было опознать глазами и привязать к юрлицу.
  const srids = [...bySrid.keys()];
  const bought = new Map<string, Sale>();
  const returned = new Set<string>();
  for (let offset = 0; offset < srids.length; offset += 100) {
    const { data } = await db
      .from("wb_sales")
      .select("srid, sale_id, price_with_disc, for_pay, date, nm_id")
      .in("srid", srids.slice(offset, offset + 100));
    for (const row of data ?? []) {
      const id = String(row.sale_id ?? "");
      if (id.startsWith("R")) returned.add(String(row.srid));
      else if (id.startsWith("S")) {
        bought.set(String(row.srid), {
          price: Number(row.price_with_disc ?? row.for_pay) || null,
          soldAt: row.date ? String(row.date).slice(0, 10) : null,
          nmId: row.nm_id === null || row.nm_id === undefined ? null : Number(row.nm_id),
          article: null,
        });
      }
    }
  }

  // Артикул лежит в заказе, а не в продаже. Спрашиваем только за то, что уже
  // признано выкупленным: тянуть заказы под все задания было бы впустую.
  const boughtSrids = [...bought.keys()];
  for (let offset = 0; offset < boughtSrids.length; offset += 100) {
    const { data } = await db
      .from("wb_orders")
      .select("srid, supplier_article, nm_id")
      .in("srid", boughtSrids.slice(offset, offset + 100));
    for (const row of data ?? []) {
      const sale = bought.get(String(row.srid));
      if (!sale) continue;
      sale.article = row.supplier_article ? String(row.supplier_article) : null;
      if (sale.nmId === null && row.nm_id !== null && row.nm_id !== undefined) sale.nmId = Number(row.nm_id);
    }
  }

  const stamp = new Date().toISOString();
  const fresh: Record<string, unknown>[] = [];
  for (const [srid, task] of bySrid) {
    if (!bought.has(srid)) continue;
    const sale = bought.get(srid)!;
    for (const raw of task.codes) {
      const parsed = parseKizCode(raw);
      if (!parsed.code) continue;
      fresh.push({
        code: parsed.code,
        raw_code: raw,
        gtin: parsed.gtin,
        serial: parsed.serial,
        cabinet_id: task.cabinetId,
        srid,
        // Код из сборочного задания — это по определению FBS: заданий у других
        // схем не бывает.
        scheme: "fbs",
        price: sale.price,
        sold_at: sale.soldAt,
        nm_id: sale.nmId,
        article: sale.article,
        status: returned.has(srid) ? "returned" : "sold",
        source: "Сборочные задания FBS",
        updated_at: stamp,
      });
    }
  }

  let added = 0;
  for (let offset = 0; offset < fresh.length; offset += 500) {
    const { data, error } = await db
      .from("kiz_withdrawals")
      .upsert(fresh.slice(offset, offset + 500), { onConflict: "code", ignoreDuplicates: true })
      .select("code");
    if (error) return fail(error.message, 500);
    added += (data ?? []).length;
  }

  // Строки, записанные до того, как источник научился сохранять дату и товар,
  // сами по себе не исправятся: запись в реестр идёт через upsert с
  // ignoreDuplicates, и существующую строку он не трогает никогда. Дописываем
  // адресно и только пустое — чужую дату продажи затирать нельзя.
  let enriched = 0;
  const blanks = await db
    .from("kiz_withdrawals")
    .select("code, srid")
    .is("sold_at", null)
    .not("srid", "is", null)
    .limit(BLANK_LIMIT);
  const blankBySrid = new Map<string, string[]>();
  for (const row of blanks.data ?? []) {
    const key = String(row.srid);
    blankBySrid.set(key, [...(blankBySrid.get(key) ?? []), String(row.code)]);
  }
  let stillBlank = 0;
  for (const [srid, codes] of blankBySrid) {
    const sale = bought.get(srid);
    if (!sale?.soldAt) { stillBlank += codes.length; continue; }
    const { data } = await db
      .from("kiz_withdrawals")
      .update({ sold_at: sale.soldAt, nm_id: sale.nmId, article: sale.article, price: sale.price, updated_at: stamp })
      .in("code", codes)
      .is("sold_at", null)
      .select("code");
    enriched += (data ?? []).length;
  }

  // Свежим кодам сразу проставляем владельца: иначе они повиснут «ничьими»
  // до следующего захода и не попадут ни в одно юрлицо на экране.
  await attachKizEntities(db);

  const result: KizTasksResult = {
    withCodes: withCodes.length,
    linked: bySrid.size,
    bought: bought.size,
    returned: returned.size,
    added,
    unlinked: withCodes.length - bySrid.size,
    enriched,
    stillBlank,
  };
  return NextResponse.json({ data: result, error: null });
}
