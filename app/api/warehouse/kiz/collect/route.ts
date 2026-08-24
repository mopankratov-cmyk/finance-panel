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

export interface KizCollectCabinet {
  name: string;
  /** Строк отдал отчёт всего. */
  rows: number;
  /** Из них наших — после фильтра по товарному контуру кабинета. */
  ours: number;
  added: number;
  returned: number;
  skipped: number;
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
 * Собрать коды проданного из отчёта WB по маркированным товарам.
 *
 * Это и есть ответ на «за всё время по всем кабинетам»: отчёт помнит около
 * полугода, а длинное окно проглатывает одним запросом. Ручные выгрузки за
 * каждые три дня остаются запасным путём — для периодов старше горизонта отчёта.
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
    const stat: KizCollectCabinet = { name: link.cabinetName, rows: 0, ours: 0, added: 0, returned: 0, skipped: 0, error: null };
    stats.push(stat);
    try {
      const cabinet = await getWbCabinet(link.cabinetId);
      if (!cabinet) { stat.error = "кабинет недоступен"; continue; }
      const scope = cabinetProductScope(cabinet);
      const rows = await fetchExciseReport(resolveWbToken(cabinet, "analytics"), from, to);
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

      const known = new Map<string, string>();
      const codes = [...new Set([...sold.keys(), ...back])];
      for (let offset = 0; offset < codes.length; offset += 400) {
        const chunk = codes.slice(offset, offset + 400);
        const { data, error } = await db.from("kiz_withdrawals").select("code, status").in("code", chunk);
        if (error) {
          if (missingMigration(error.code)) return fail(migrationHint, 503);
          throw new Error(error.message);
        }
        for (const row of data ?? []) known.set(String(row.code), String(row.status));
      }

      const fresh = [...sold.values()]
        .filter((row) => !known.has(row.code))
        .map((row) => ({
          code: row.code,
          raw_code: row.code,
          gtin: row.code.slice(2, 16),
          serial: row.code.slice(18, 31),
          cabinet_id: link.cabinetId,
          nm_id: row.nmId,
          barcode: row.barcode,
          price: row.price,
          sold_at: row.fiscalAt,
          // Код, по которому в этом же окне пришёл возврат, продавать обратно
          // нельзя: он снова в обороте.
          status: back.has(row.code) ? "returned" : "sold",
          source: `Отчёт WB по маркировке ${from}…${to}`,
          updated_at: new Date().toISOString(),
        }));

      for (let offset = 0; offset < fresh.length; offset += 500) {
        const { error } = await db.from("kiz_withdrawals").insert(fresh.slice(offset, offset + 500));
        if (!error) stat.added += Math.min(500, fresh.length - offset);
      }
      stat.skipped = sold.size - fresh.length;

      // Возвраты по кодам, уже лежащим в реестре: проданное переводим, а
      // отправленное помечаем отдельно — это сигнал человеку, а не тихая правка.
      const backCodes = [...back].filter((code) => known.has(code));
      for (let offset = 0; offset < backCodes.length; offset += 300) {
        const chunk = backCodes.slice(offset, offset + 300);
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
