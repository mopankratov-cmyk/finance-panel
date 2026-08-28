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

    const { data: taskRows, error: tasksError } = await db
      .from("wb_fbs_orders")
      .select("order_id, srid, nm_id, article")
      .eq("cabinet_id", cabinetId)
      .gte("created_at_wb", since)
      .not("order_id", "is", null);
    if (tasksError) {
      result.notes.push(`${cabinet.name}: задания не прочитаны — ${tasksError.message}`);
      continue;
    }
    const tasks = (taskRows ?? []).filter((row) => Number(row.order_id) > 0);
    if (!tasks.length) continue;

    const orderIds = tasks.map((row) => Number(row.order_id));
    const { statuses } = await fetchFbsOrderStatuses(token, orderIds);
    result.checked += statuses.size;

    const soldTasks = tasks.filter((row) => statuses.get(Number(row.order_id))?.wbStatus === "sold");
    result.sold += soldTasks.length;
    if (!soldTasks.length) continue;

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
    const missing = soldIds.filter((id) => !codeByOrder.has(id));
    if (missing.length) {
      const meta = await fetchFbsOrdersMetaBatch(token, missing);
      for (const id of missing) {
        const first = (meta.codes.get(id) ?? [])[0];
        if (first) codeByOrder.set(id, first);
      }
    }

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

  if (result.soldWithoutCode > 0) {
    result.notes.push(`выкуплено без кода в мете: ${result.soldWithoutCode} — код смотреть в архиве заданий WB`);
  }
  return result;
}
