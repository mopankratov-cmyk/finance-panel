import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listAccessibleEntities } from "@/lib/warehouse/entityAccess";
import { cabinetProductScope, getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { ExciseRateLimitError, fetchExciseReport, type ExciseRow } from "@/lib/wb/exciseReport";
import { allowsProduct } from "@/lib/wb/productScope";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Отчёт помнит примерно полгода — дальше он пуст, и просить глубже бессмысленно. */
const MAX_DAYS_BACK = 200;

/**
 * Ширина одного окна запроса.
 *
 * Полугодовым окном отчёт давится: у кабинета с большим оборотом WB отвечает
 * «504 stream timeout» — на нашей Оптиме это 90 тысяч строк за один август.
 * Месяц проглатывается уверенно, а семь окон на полгода укладываются в лимит
 * метода: 10 запросов за 5 часов на продавца.
 */
const WINDOW_DAYS = 30;

function windows(from: string, to: string): { from: string; to: string }[] {
  const result: { from: string; to: string }[] = [];
  let cursor = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  while (cursor <= end) {
    const next = Math.min(cursor + (WINDOW_DAYS - 1) * 86_400_000, end);
    result.push({
      from: new Date(cursor).toISOString().slice(0, 10),
      to: new Date(next).toISOString().slice(0, 10),
    });
    cursor = next + 86_400_000;
  }
  // Свежие окна первыми: если лимит запросов кончится на середине, важнее
  // собрать недавнее — по нему срок вывода ещё не вышел.
  return result.reverse();
}

/** «Склад продавца» в отчёте заказов WB — это и есть FBS. */
const FBS_WAREHOUSE_TYPE = "Склад продавца";

export interface KizCollectCabinet {
  name: string;
  /** Строк отдал отчёт всего. */
  rows: number;
  /** Из них наших — после фильтра по товарному контуру кабинета. */
  ours: number;
  /** Из наших — проданные по FBS: только их выводим мы. */
  fbs: number;
  /** Продано по FBW — из оборота их вывел сам маркетплейс. */
  fbw: number;
  /** Заказ по srid не найден: схему определить нечем, отправлять нельзя. */
  unknown: number;
  added: number;
  returned: number;
  skipped: number;
  /** Сколько окон периода удалось прочитать. */
  windows: number;
  /** Окна, которые WB не отдал: их стоит повторить. */
  failedWindows: string[];
  error: string | null;
}

export interface KizCollectResult {
  from: string;
  to: string;
  cabinets: KizCollectCabinet[];
  addedTotal: number;
  returnedTotal: number;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграцию 202608240023_kiz_withdrawal.sql";

/**
 * Собрать из отчёта WB то, что УЖЕ выведено из оборота.
 *
 * Важно не перепутать назначение. Отчёт показывает совершённые операции с кодом:
 * вывод из оборота и возврат в оборот. Для FBW там всё, потому что маркетплейс
 * выводит сам. Для FBS там пусто ровно потому, что никто ещё не вывел — а это и
 * есть то, что нам нужно найти. Значит отчёт даёт не список к выводу, а список
 * «этого делать не надо», который вычитается из списка к отправке.
 *
 * Список к выводу собирается загрузкой завершённых заказов ФБС: в них КИЗ
 * проставлены при сборке, и они ещё не выведены.
 *
 * Фильтр по товарному контуру кабинета обязателен и не является перестраховкой.
 * Агентский кабинет отдаёт коды ВСЕГО продавца: у «Оптимы» за один август
 * отчёт вернул 90 470 строк, и наших там меньшинство. Вывести из оборота чужой
 * код нельзя — владелец кода определяется по ИНН в Честном Знаке, и попытка
 * вывести чужой будет отказом в лучшем случае.
 */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const list = await listAccessibleEntities();
  if (!list.ok) return fail(list.error, list.status);

  const body = (await request.json().catch(() => null)) as { from?: string; to?: string } | null;
  const today = new Date().toISOString().slice(0, 10);
  const earliest = new Date(Date.now() - MAX_DAYS_BACK * 86_400_000).toISOString().slice(0, 10);
  const from = body?.from && body.from >= earliest ? body.from : earliest;
  const to = body?.to && body.to <= today ? body.to : today;

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  // Только кабинеты, связанные с нашими юрлицами: чужой кабинет в реестр не идёт.
  const cabinets = [...new Map(
    list.rows.flatMap((entity) => entity.cabinets.filter((link) => link.marketplace === "wb").map((link) => [link.cabinetId, link])),
  ).values()];
  if (cabinets.length === 0) return fail("Нет кабинетов Wildberries, связанных с юрлицами", 400);

  const stats: KizCollectCabinet[] = [];
  let addedTotal = 0;
  let returnedTotal = 0;

  for (const link of cabinets) {
    const stat: KizCollectCabinet = {
      name: link.cabinetName, rows: 0, ours: 0, fbs: 0, fbw: 0, unknown: 0,
      added: 0, returned: 0, skipped: 0, windows: 0, failedWindows: [], error: null,
    };
    stats.push(stat);
    try {
      const cabinet = await getWbCabinet(link.cabinetId);
      if (!cabinet) { stat.error = "кабинет недоступен"; continue; }
      const scope = cabinetProductScope(cabinet);
      // Окна идут по одному: каждое — отдельный запрос к WB, и упереться в
      // лимит на середине нормально. Что собрали, то собрали, остальное
      // доберётся следующим прогоном — дедупликация на первичном ключе это
      // позволяет без опаски.
      const token = resolveWbToken(cabinet, "analytics");
      const rows: ExciseRow[] = [];
      for (const window of windows(from, to)) {
        try {
          rows.push(...await fetchExciseReport(token, window.from, window.to));
          stat.windows += 1;
        } catch (error) {
          if (error instanceof ExciseRateLimitError) { stat.error = error.message; break; }
          // Одно окно не отдалось — не повод терять остальные.
          stat.failedWindows.push(`${window.from}…${window.to}`);
        }
      }
      stat.rows = rows.length;

      const ours = rows.filter((row) => allowsProduct(scope, row.nmId));
      stat.ours = ours.length;
      if (ours.length === 0) continue;

      // Дедуп внутри ответа: окно отчёта перехлёстывается само с собой,
      // и один код может прийти дважды.
      const sold = new Map<string, ExciseRow>();
      const back = new Set<string>();
      for (const row of ours) {
        if (row.operation === 2) back.add(row.code);
        else if (!sold.has(row.code)) sold.set(row.code, row);
      }

      // Схема продажи решает, наше это дело или нет. При FBW код из оборота
      // выводит сам маркетплейс — он владеет товаром в момент продажи; при FBS
      // товар до последнего момента наш, и выводим мы.
      //
      // Отчёт схему не сообщает, зато сообщает srid — по нему заказ находится в
      // wb_orders, где warehouse_type и есть схема. Заказа нет — схемы не знаем,
      // и такой код в файл не пойдёт: если он окажется FBW, мы попробуем вывести
      // уже выведенное.
      const srids = [...new Set([...sold.values()].map((row) => row.srid).filter((value): value is string => !!value))];
      const schemeBySrid = new Map<string, string>();
      for (let offset = 0; offset < srids.length; offset += 200) {
        const chunk = srids.slice(offset, offset + 200);
        const { data } = await db.from("wb_orders").select("srid, warehouse_type").in("srid", chunk);
        for (const row of data ?? []) {
          schemeBySrid.set(String(row.srid), String(row.warehouse_type ?? "") === FBS_WAREHOUSE_TYPE ? "fbs" : "fbw");
        }
      }

      const fresh = [...sold.values()].map((row) => {
        const scheme = row.srid ? schemeBySrid.get(row.srid) ?? null : null;
        if (scheme === "fbs") stat.fbs += 1;
        else if (scheme === "fbw") stat.fbw += 1;
        else stat.unknown += 1;
        return {
          code: row.code,
          raw_code: row.code,
          gtin: row.code.slice(2, 16),
          serial: row.code.slice(18, 31),
          cabinet_id: link.cabinetId,
          srid: row.srid,
          scheme,
          nm_id: row.nmId,
          barcode: row.barcode,
          price: row.price,
          sold_at: row.fiscalAt,
          // Отчёт показывает СОВЕРШЁННЫЕ операции, а не список к выводу. Строка
          // с операцией «вывод из оборота» означает, что код уже выведен: при
          // FBW это сделал маркетплейс, при FBS — значит, мы это уже сделали
          // раньше. Ни то, ни другое не ждёт отправки.
          status: back.has(row.code)
            ? "returned"
            : scheme === "fbw" ? "fbw" : scheme === "fbs" ? "withdrawn" : "unknown",
          source: `Отчёт WB по маркировке ${from}…${to}`,
          updated_at: new Date().toISOString(),
        };
      });

      for (let offset = 0; offset < fresh.length; offset += 500) {
        const chunk = fresh.slice(offset, offset + 500);
        const { data, error } = await db
          .from("kiz_withdrawals")
          .upsert(chunk, { onConflict: "code", ignoreDuplicates: true })
          .select("code");
        if (error) throw new Error(error.message);
        stat.added += (data ?? []).length;
      }
      stat.skipped = sold.size - stat.added;

      // Возвраты по кодам, уже лежащим в реестре: проданное переводим, а
      // отправленное помечаем отдельно — это сигнал человеку, а не тихая правка.
      // Пачки короткие: код длинный, и фильтр по сотне кодов уже не влезает в URL.
      const backCodes = [...back];
      for (let offset = 0; offset < backCodes.length; offset += 40) {
        const chunk = backCodes.slice(offset, offset + 40);
        const stamp = new Date().toISOString();
        const { data } = await db.from("kiz_withdrawals")
          .update({ status: "returned", updated_at: stamp }).in("code", chunk).eq("status", "sold").select("code");
        stat.returned += (data ?? []).length;
        await db.from("kiz_withdrawals")
          .update({ status: "returned_after_sent", updated_at: stamp }).in("code", chunk).eq("status", "sent");
      }

      addedTotal += stat.added;
      returnedTotal += stat.returned;
    } catch (error) {
      stat.error = error instanceof ExciseRateLimitError
        ? error.message
        : error instanceof Error ? error.message.slice(0, 200) : "не удалось прочитать отчёт";
    }
  }

  const result: KizCollectResult = { from, to, cabinets: stats, addedTotal, returnedTotal };
  return NextResponse.json({ data: result, error: null });
}
