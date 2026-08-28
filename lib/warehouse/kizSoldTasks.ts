import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchFbsOrderStatuses, fetchFbsOrdersMetaBatch } from "@/lib/wb/fbsMarketplace";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { parseKizCode } from "@/lib/wb/kizCodes";

/**
 * Ежедневное наполнение реестра вывода из оборота — из сборочных заданий.
 *
 * Алгоритм повторяет проверенный руками порядок (28.08.2026, NV-01):
 * задания кабинета → живой статус WB → только подтверждённый выкуп
 * (wbStatus = sold) → код из собранной меты (недостающие доспрашиваются
 * пакетно) → фактическая цена этого заказа по srid из статистики. Отчёт
 * реализации для этого не годится: он запаздывает на неделю и дальше, а
 * менеджеру выводить надо по мере выкупов.
 *
 * Уже известные коды не трогаются (upsert по code с ignoreDuplicates):
 * отправленные остаются отправленными, повторный прогон ничего не дублирует.
 */

const TASKS_WINDOW_DAYS = 60;

export interface KizSoldTasksResult {
  /** Заданий проверено по статусам. */
  checked: number;
  /** Из них выкуплено (wbStatus = sold). */
  sold: number;
  /** Выкуплено, но кода нет ни в базе, ни в мете — видно менеджеру в заметке. */
  soldWithoutCode: number;
  /** Строк добавлено в реестр (новых кодов). */
  added: number;
  notes: string[];
}

export async function collectWithdrawalsFromSoldTasks(
  db: SupabaseClient,
  cabinetIds: string[],
): Promise<KizSoldTasksResult> {
  const result: KizSoldTasksResult = { checked: 0, sold: 0, soldWithoutCode: 0, added: 0, notes: [] };
  const since = new Date(Date.now() - TASKS_WINDOW_DAYS * 86_400_000).toISOString();

  for (const cabinetId of cabinetIds) {
    const cabinet = await getWbCabinet(cabinetId);
    if (!cabinet) continue;
    let token: string;
    try {
      token = resolveWbToken(cabinet, "marketplace");
    } catch {
      continue; // кабинет без marketplace-токена — заданий у него нам не видно
    }

    // Страницами и свежие вперёд. Первый боевой прогон упёрся в молчаливый
    // потолок Supabase (1 000 строк) и взял самые СТАРЫЕ задания — собранные
    // до начала сканирования кодов; свежие выкупы в выборку не попали вовсе.
    type TaskRow = { order_id: unknown; srid: string | null; nm_id: number | null; article: string | null };
    const tasks: TaskRow[] = [];
    let tasksError: string | null = null;
    for (let page = 0; page < 10; page++) {
      const { data: taskRows, error } = await db
        .from("wb_fbs_orders")
        .select("order_id, srid, nm_id, article")
        .eq("cabinet_id", cabinetId)
        .gte("created_at_wb", since)
        .not("order_id", "is", null)
        .order("created_at_wb", { ascending: false })
        .range(page * 1000, page * 1000 + 999);
      if (error) { tasksError = error.message; break; }
      const batch = (taskRows ?? []) as TaskRow[];
      tasks.push(...batch);
      if (batch.length < 1000) break;
    }
    if (tasksError) {
      result.notes.push(`${cabinet.name}: задания не прочитаны — ${tasksError}`);
      continue;
    }
    const valid = tasks.filter((row) => Number(row.order_id) > 0);
    if (!valid.length) continue;

    const orderIds = valid.map((row) => Number(row.order_id));
    // Лимит WB на этот API общий у всех наших сборщиков (kiz-codes каждые
    // 15 минут, почасовые синки). Отказ по одному кабинету — заметка, а не
    // смерть прогона: остальные кабинеты и следующий запуск своё доберут.
    let statuses: Awaited<ReturnType<typeof fetchFbsOrderStatuses>>["statuses"];
    try {
      ({ statuses } = await fetchFbsOrderStatuses(token, orderIds));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.notes.push(`${cabinet.name}: статусы не получены — ${message.slice(0, 80)}`);
      continue;
    }
    result.checked += statuses.size;

    const soldTasks = valid.filter((row) => statuses.get(Number(row.order_id))?.wbStatus === "sold");
    result.sold += soldTasks.length;
    if (!soldTasks.length) {
      result.notes.push(`${cabinet.name}: заданий ${valid.length}, выкупленных нет`);
      continue;
    }

    // Коды: сперва то, что уже собрано, — мета опрашивается только по дырам.
    const soldIds = soldTasks.map((row) => Number(row.order_id));
    const codeByOrder = new Map<number, string>();
    for (let offset = 0; offset < soldIds.length; offset += 200) {
      const { data: kizRows } = await db
        .from("wb_fbs_order_kiz")
        .select("order_id, codes")
        .eq("cabinet_id", cabinetId)
        .in("order_id", soldIds.slice(offset, offset + 200));
      for (const row of kizRows ?? []) {
        const first = (row.codes ?? [])[0];
        if (first) codeByOrder.set(Number(row.order_id), String(first));
      }
    }
    const fromDb = codeByOrder.size;
    const missing = soldIds.filter((id) => !codeByOrder.has(id));
    let metaError: string | null = null;
    if (missing.length) {
      try {
        const meta = await fetchFbsOrdersMetaBatch(token, missing);
        for (const id of missing) {
          const first = (meta.codes.get(id) ?? [])[0];
          if (first) codeByOrder.set(id, first);
        }
      } catch (error) {
        // Ошибка меты не должна ронять весь прогон: коды из базы уже есть,
        // а причина отказа обязана попасть в заметку — молчаливый ноль
        // сегодня уже стоил ложного вывода «коды не сканируются».
        metaError = error instanceof Error ? error.message : String(error);
      }
    }
    result.notes.push(
      `${cabinet.name}: заданий ${valid.length}, выкуплено ${soldTasks.length}, `
      + `кодов из базы ${fromDb}, из меты ${codeByOrder.size - fromDb}`
      + (metaError ? `, мета: ${metaError.slice(0, 80)}` : ""),
    );

    // Фактическая цена и дата продажи этого заказа — по srid из статистики.
    const priceBySrid = new Map<string, { price: number | null; date: string | null }>();
    {
      const srids = [...new Set(soldTasks.map((row) => row.srid).filter((v): v is string => Boolean(v)))];
      for (let offset = 0; offset < srids.length; offset += 200) {
        const { data: orderRows } = await db
          .from("wb_orders")
          .select("srid, finished_price, date")
          .in("srid", srids.slice(offset, offset + 200));
        for (const row of orderRows ?? []) {
          priceBySrid.set(String(row.srid), {
            price: row.finished_price != null ? Number(row.finished_price) : null,
            date: row.date ? String(row.date).slice(0, 10) : null,
          });
        }
      }
    }

    const fresh: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const task of soldTasks) {
      const raw = codeByOrder.get(Number(task.order_id));
      if (!raw) {
        result.soldWithoutCode += 1;
        continue;
      }
      const parsed = parseKizCode(raw);
      if (!parsed.code || seen.has(parsed.code)) continue;
      seen.add(parsed.code);
      const order = task.srid ? priceBySrid.get(String(task.srid)) : undefined;
      fresh.push({
        code: parsed.code,
        raw_code: raw,
        gtin: parsed.gtin,
        serial: parsed.serial,
        cabinet_id: cabinetId,
        srid: task.srid ?? null,
        scheme: "fbs",
        nm_id: task.nm_id ?? null,
        price: order?.price ?? null,
        sold_at: order?.date ?? null,
        status: "sold",
        source: "Сборочные задания (ежедневный сбор)",
        updated_at: new Date().toISOString(),
      });
    }

    for (let offset = 0; offset < fresh.length; offset += 500) {
      const { error, count } = await db
        .from("kiz_withdrawals")
        .upsert(fresh.slice(offset, offset + 500), { onConflict: "code", ignoreDuplicates: true, count: "exact" });
      if (error) {
        result.notes.push(`${cabinet.name}: реестр не пополнен — ${error.message}`);
        break;
      }
      result.added += count ?? 0;
    }
  }

  // Самовыправление цен: строки, записанные до решения «цена — фактическая
  // покупателя», лежат с ценой продавца. Пока строка не отправлена, цену
  // можно и нужно поправить по статистике заказа.
  {
    const { data: pendingRows } = await db
      .from("kiz_withdrawals")
      .select("code, srid, price")
      .eq("status", "sold")
      .in("cabinet_id", cabinetIds)
      .not("srid", "is", null)
      .limit(1000);
    const rows = pendingRows ?? [];
    const srids = [...new Set(rows.map((row) => String(row.srid)))];
    const factual = new Map<string, number>();
    for (let offset = 0; offset < srids.length; offset += 200) {
      const { data: orderRows } = await db
        .from("wb_orders")
        .select("srid, finished_price")
        .in("srid", srids.slice(offset, offset + 200));
      for (const row of orderRows ?? []) {
        if (row.finished_price != null) factual.set(String(row.srid), Number(row.finished_price));
      }
    }
    let repriced = 0;
    for (const row of rows) {
      const price = factual.get(String(row.srid));
      if (price == null || Number(row.price) === price) continue;
      const { error } = await db
        .from("kiz_withdrawals")
        .update({ price, updated_at: new Date().toISOString() })
        .eq("code", row.code)
        .eq("status", "sold");
      if (!error) repriced += 1;
    }
    if (repriced) result.notes.push(`цены выправлены на фактические: ${repriced}`);
  }

  if (result.soldWithoutCode > 0) {
    result.notes.push(`выкуплено без кода в мете: ${result.soldWithoutCode} — код смотреть в архиве заданий WB`);
  }
  return result;
}
