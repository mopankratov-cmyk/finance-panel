import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wbCabinetsForScope } from "@/lib/warehouse/kizScope";
import { readWbSyncState, writeWbSyncState } from "@/lib/wb/syncState";
import { cabinetProductScope, getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { parseKizCode } from "@/lib/wb/kizCodes";
import { attachKizEntities } from "@/lib/warehouse/kizEntity";
import { allowsProduct } from "@/lib/wb/productScope";
import {
  fetchSalesDetailPage,
  RETURN_OPERATION,
  SALE_OPERATION,
  SalesDetailRateLimitError,
  type SalesDetailRow,
} from "@/lib/wb/salesDetail";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** «Склад продавца» в отчёте заказов WB — это и есть FBS. */
const FBS_WAREHOUSE_TYPE = "Склад продавца";
/** Отчёт помнит продажи примерно с февраля 2025 — глубже кодов в нём нет. */
const MAX_DAYS_BACK = 200;

/**
 * Пауза между запросами.
 *
 * WB держит лимит «один запрос в минуту на продавца». Кабинеты — разные
 * продавцы, но лимит срабатывает и на них: без паузы первый же кабинет
 * съедает окно, а остальные получают 429 мгновенно. Именно так и вышло на
 * первом боевом нажатии — четыре кабинета, четыре отказа подряд.
 */
const PAUSE_MS = 61_000;

/** Оставляем запас до конца лямбды: лучше вернуть частичный результат с
 *  честной пометкой, чем оборваться на середине без единой строки. */
const BUDGET_MS = 260_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface KizSalesCabinet {
  name: string;
  /** Строк с кодом маркировки в отчёте. */
  withCode: number;
  /** Из них наших по товарному контуру. */
  ours: number;
  /** Продажи по FBS — их и выводим. */
  fbs: number;
  /** Продажи по FBW — выводит маркетплейс. */
  fbw: number;
  /** Схему определить не удалось: заказ по srid не найден. */
  unknown: number;
  returns: number;
  added: number;
  pages: number;
  error: string | null;
}

export interface KizSalesResult {
  from: string;
  to: string;
  cabinets: KizSalesCabinet[];
  addedTotal: number;
  /** Кабинеты, до которых не дошла очередь: времени не хватило. */
  skipped: string[];
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграции 202608240023–202608240025";

/**
 * Собрать проданное с кодами маркировки — то, что ждёт вывода из оборота.
 *
 * Это тот самый список, который иначе пришлось бы выгружать руками из личного
 * кабинета каждые три дня. Детализация реализации отдаёт код прямо в строке
 * продажи, вместе с ценой, — и в отличие от отчёта по маркированным товарам
 * показывает то, что ещё НЕ выведено.
 *
 * Два фильтра обязательны. Товарный контур кабинета: агентский кабинет отдаёт
 * чужие продажи, а вывести чужой код нельзя. И схема продажи: при FBW из оборота
 * выводит сам маркетплейс, и попытка вывести повторно будет отказом.
 */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = (await request.json().catch(() => null)) as
    { from?: string; to?: string; entityId?: string | null } | null;
  const scope = await wbCabinetsForScope(body?.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);

  const today = new Date().toISOString().slice(0, 10);
  const earliest = new Date(Date.now() - MAX_DAYS_BACK * 86_400_000).toISOString().slice(0, 10);
  const from = body?.from && body.from >= earliest ? body.from : earliest;
  const to = body?.to && body.to <= today ? body.to : today;

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const cabinets = scope.cabinets;

  const stats: KizSalesCabinet[] = [];
  const skipped: string[] = [];
  let addedTotal = 0;
  const deadline = Date.now() + BUDGET_MS;
  let requested = false;

  for (const link of cabinets) {
    if (Date.now() > deadline) { skipped.push(link.cabinetName); continue; }
    // Пауза нужна только между запросами: перед первым ждать нечего.
    if (requested) await sleep(PAUSE_MS);

    const stat: KizSalesCabinet = {
      name: link.cabinetName, withCode: 0, ours: 0, fbs: 0, fbw: 0, unknown: 0,
      returns: 0, added: 0, pages: 0, error: null,
    };
    stats.push(stat);
    try {
      const cabinet = await getWbCabinet(link.cabinetId);
      if (!cabinet) { stat.error = "кабинет недоступен"; continue; }
      const scope = cabinetProductScope(cabinet);
      const token = resolveWbToken(cabinet, "statistics");

      // Страницы идут курсором. Лимит — один запрос в минуту на продавца, и
      // ждать минуту внутри пользовательского запроса нельзя: берём столько
      // страниц, сколько успеваем, остальное доберётся следующим прогоном.
      const rows: SalesDetailRow[] = [];
      // Курсор живёт в базе. Раньше он обнулялся каждым запуском: заход
      // начинал с самого начала периода, успевал снять две-три страницы до
      // лимита «один запрос в минуту» и добавлял ноль — до свежих продаж
      // обход не доходил никогда. Теперь каждый прогон продолжает с места,
      // где остановился прошлый, и история добирается прогон за прогоном.
      const savedCursor = await readWbSyncState<{ from?: string; to?: string; cursor?: number }>(
        db, link.cabinetId, "kiz-sales-cursor",
      );
      const sameWalk = savedCursor?.state.from === from;
      let cursor = sameWalk ? Number(savedCursor?.state.cursor ?? 0) : 0;
      let walkDone = false;
      for (let page = 0; page < 3; page += 1) {
        if (page > 0) {
          if (Date.now() + PAUSE_MS > deadline) break;
          await sleep(PAUSE_MS);
        }
        requested = true;
        let page_: { rows: SalesDetailRow[]; rawCount: number; lastRrdId: number | null };
        try {
          page_ = await fetchSalesDetailPage(token, from, to, cursor);
        } catch (error) {
          // Одна встреча с лимитом — не приговор: ждём окно и пробуем ещё раз.
          if (!(error instanceof SalesDetailRateLimitError) || Date.now() + PAUSE_MS > deadline) throw error;
          await sleep(PAUSE_MS);
          page_ = await fetchSalesDetailPage(token, from, to, cursor);
        }
        stat.pages += 1;
        rows.push(...page_.rows);
        // Конец отчёта — пустая СЫРАЯ страница. Страница без единого КИЗ
        // (немаркируемый товар) концом не является: курсор двигается дальше.
        if (page_.rawCount === 0 || page_.lastRrdId === null || page_.lastRrdId === cursor) {
          walkDone = true;
          break;
        }
        cursor = page_.lastRrdId;
      }
      // Дошли до конца отчёта — следующий прогон начнёт свежий обход с
      // перекрытием в неделю: поздние строки реализации доезжают задним
      // числом. Не дошли — сохраняем место, откуда продолжать.
      await writeWbSyncState(db, link.cabinetId, "kiz-sales-cursor", {
        status: walkDone ? "caught_up" : "pending",
        attempts: 0,
        lastError: null,
        state: walkDone ? { from: null, to: null, cursor: 0 } : { from, to, cursor },
      });
      stat.withCode = rows.length;

      const ours = rows.filter((row) => allowsProduct(scope, row.nmId));
      stat.ours = ours.length;
      const sales = ours.filter((row) => row.operation === SALE_OPERATION);
      const returns = ours.filter((row) => row.operation === RETURN_OPERATION);
      stat.returns = returns.length;
      if (sales.length === 0 && returns.length === 0) continue;

      // Схема продажи — по заказу: srid находит строку в wb_orders.
      const srids = [...new Set([...sales, ...returns].map((row) => row.srid).filter((value): value is string => !!value))];
      const schemeBySrid = new Map<string, string>();
      for (let offset = 0; offset < srids.length; offset += 200) {
        const { data } = await db.from("wb_orders").select("srid, warehouse_type").in("srid", srids.slice(offset, offset + 200));
        for (const row of data ?? []) {
          schemeBySrid.set(String(row.srid), String(row.warehouse_type ?? "") === FBS_WAREHOUSE_TYPE ? "fbs" : "fbw");
        }
      }

      const returnedCodes = new Set(
        returns.map((row) => parseKizCode(row.kiz).code).filter((value): value is string => !!value),
      );

      const fresh: Record<string, unknown>[] = [];
      const seen = new Set<string>();
      for (const row of sales) {
        const parsed = parseKizCode(row.kiz);
        if (!parsed.code || seen.has(parsed.code)) continue;
        seen.add(parsed.code);
        const scheme = row.srid ? schemeBySrid.get(row.srid) ?? null : null;
        if (scheme === "fbs") stat.fbs += 1;
        else if (scheme === "fbw") stat.fbw += 1;
        else stat.unknown += 1;

        fresh.push({
          code: parsed.code,
          // Полный код с криптохвостом сохраняем как есть: он пригодится, если
          // получателю понадобится исходная марка, а не код идентификации.
          raw_code: row.kiz,
          gtin: parsed.gtin,
          serial: parsed.serial,
          cabinet_id: link.cabinetId,
          srid: row.srid,
          scheme,
          nm_id: row.nmId,
          price: row.price,
          sold_at: row.saleAt,
          // Ждёт вывода только FBS. FBW выводит маркетплейс, а с неизвестной
          // схемой отправлять нельзя: вдруг это FBW и код уже выведен.
          status: returnedCodes.has(parsed.code)
            ? "returned"
            : scheme === "fbs" ? "sold" : scheme === "fbw" ? "fbw" : "unknown",
          source: `Детализация реализации ${from}…${to}`,
          updated_at: new Date().toISOString(),
        });
      }

      for (let offset = 0; offset < fresh.length; offset += 500) {
        const { data, error } = await db
          .from("kiz_withdrawals")
          .upsert(fresh.slice(offset, offset + 500), { onConflict: "code", ignoreDuplicates: true })
          .select("code");
        if (error) {
          if (missingMigration(error.code)) return fail(migrationHint, 503);
          throw new Error(error.message);
        }
        stat.added += (data ?? []).length;
      }
      addedTotal += stat.added;
    } catch (error) {
      stat.error = error instanceof SalesDetailRateLimitError
        ? error.message
        : error instanceof Error ? error.message.slice(0, 200) : "не удалось прочитать отчёт";
    }
  }

  await attachKizEntities(db);

  const result: KizSalesResult = { from, to, cabinets: stats, addedTotal, skipped };
  return NextResponse.json({ data: result, error: null });
}
