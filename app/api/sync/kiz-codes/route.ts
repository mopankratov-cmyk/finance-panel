import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";
import { fetchFbsOrders, fetchFbsOrdersMetaBatch } from "@/lib/wb/fbsMarketplace";
import { loadKnownKizCodes, loadOrderIdsFromDb, rememberKizCodes } from "@/lib/wb/fbsKizStore";
import { allowsProduct, type WbProductScope } from "@/lib/wb/productScope";

// Коды маркировки добираются в фоне, а не по заходу пользователя.
//
// WB отдаёт код по одному заданию за запрос, а лимитер общий НА КАБИНЕТ: пока
// коды опрашивал открытый экран, он конкурировал с почасовыми синками — и
// проигрывал («Сверка оборота» падала с «WB ограничил частоту»).
//
// Две мели, на которых прогон уже сидел:
//   1) За один заход обходили все кабинеты и брали список заданий за две
//      недели. У Оптимы это 12 000 заданий — выборка списков съедала весь
//      бюджет функции, и три прогона подряд дали «+0 из 0».
//   2) Сузили до одного кабинета за прогон — бюджет перестал утекать, но
//      Оптиме доставалось шесть заходов в сутки, и её очередь набиралась бы
//      месяц.
//
// Отсюда нынешняя раскладка: кабинеты идут ПАРАЛЛЕЛЬНО (лимит у каждого свой,
// они друг другу не мешают), а внутри кабинета — последовательно и с паузой.
// Список берём посуточно: страница за день вместо дюжины за две недели.
export const maxDuration = 60;

/** Сколько заданий добираем за прогон на кабинет. Потолок ставит дедлайн. */
const CODES_PER_RUN = 500;
/** Глубина окна в днях: столько суток обходим по кругу. */
const WINDOW_DAYS = 14;
/** Сколько дней максимум пролистать за прогон в поисках незакрытых заданий. */
const DAYS_PER_RUN = 4;
/** Потолок на ОДНУ выборку списка. Без него список съедает весь прогон:
 *  WB отвечает 429 и просит ждать до 20 секунд, а попыток три. */
const LIST_BUDGET_MS = 12_000;
/** Шаг ротации по дням: крон ходит четыре раза в час. */
const SLOT_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

interface CabinetResult {
  cabinet: string;
  orders: number;
  probed: number;
  found: number;
  left: number;
  days: string[];
  error?: string;
  /** Сколько запросов кода упало и с какой первой причиной. */
  failed: number;
  reason?: string;
  /** Сырая форма metaDetails с боевого ответа — чтобы разбор правился по факту. */
  sample?: string;
  /** Сколько заданий отсеяно как чужие: у агентских кабинетов это большинство. */
  foreign: number;
}

async function collectForCabinet(
  target: { name: string; cabinetId: string; advertToken: string; productScope: WbProductScope },
  startDay: number,
  deadline: number,
): Promise<CabinetResult> {
  const result: CabinetResult = { cabinet: target.name, orders: 0, probed: 0, found: 0, left: 0, days: [], failed: 0, foreign: 0 };

  for (let step = 0; step < DAYS_PER_RUN; step++) {
    if (Date.now() > deadline || result.probed >= CODES_PER_RUN) break;

    const dayOffset = (startDay + step) % WINDOW_DAYS;
    const toMs = Date.now() - dayOffset * DAY_MS;
    const fromMs = toMs - DAY_MS;

    // Сперва своя база: синк fbs-orders хранит задания кабинета и, в отличие
    // от WB, только свои. Тогда запросов к WB не нужно вовсе — ни одного на
    // список, весь бюджет уходит на сами коды.
    // srid собираем заодно: он известен из очереди заданий, и сохранить его
    // рядом с кодом дешевле, чем потом искать связь заново.
    const sridByOrderId = new Map<number, string>();
    const stored = await loadOrderIdsFromDb(target.cabinetId, fromMs, toMs, CODES_PER_RUN * 4, sridByOrderId);
    if (stored) {
      result.orders += stored.length;
      const known = await loadKnownKizCodes(target.cabinetId, stored);
      const queue = stored.filter((id) => !known.codes.get(id)?.length && !known.recentlyProbed.has(id));
      if (!queue.length) continue;
      result.days.push(new Date(fromMs).toISOString().slice(0, 10));
      const batch = await fetchFbsOrdersMetaBatch(target.advertToken, queue.slice(0, CODES_PER_RUN - result.probed), {
        deadlineMs: deadline,
      });
      for (const codes of batch.codes.values()) if (codes.length) result.found += 1;
      if (batch.sample && !result.sample) result.sample = batch.sample;
      await rememberKizCodes(target.cabinetId, batch.codes, sridByOrderId);
      result.probed += batch.codes.size;
      result.left += Math.max(0, queue.length - batch.codes.size);
      continue;
    }

    const { orders } = await fetchFbsOrders(target.advertToken, {
      fromMs,
      toMs,
      // Одной страницы (1000 заданий) с запасом хватает прогону на 80 кодов,
      // а каждая лишняя страница — ещё один запрос в общий лимит продавца.
      maxPages: 1,
      deadlineMs: Math.min(deadline, Date.now() + LIST_BUDGET_MS),
    });
    // Агентская схема: WB отдаёт задания ВСЕГО продавца, а кабинет ограничен
    // своими товарами. Без отсева прогон тратил бюджет на чужие задания —
    // у Оптимы это 500 опрошенных на 41 найденный код, а экран сверки прямо
    // сообщал: «за 30 дн. просмотрено 20 000 заданий, все чужие».
    const mine = orders.filter((order) => allowsProduct(target.productScope, order.nmId));
    result.foreign += orders.length - mine.length;
    // rid задания — это и есть srid продажи. В этой ветке он под рукой, и не
    // сохранить его значило бы снова оставить код без связи с выкупом: искать
    // связь потом негде, order_id в таблице заданий заполнен не у всех строк.
    for (const order of mine) {
      if (order.rid) sridByOrderId.set(Number(order.id), String(order.rid));
    }
    const ids = mine.map((order) => order.id).filter((id) => Number.isFinite(id));
    result.orders += ids.length;
    if (!ids.length) continue;

    const known = await loadKnownKizCodes(target.cabinetId, ids);
    const queue = ids.filter((id) => !known.codes.get(id)?.length && !known.recentlyProbed.has(id));
    if (!queue.length) continue;

    result.days.push(new Date(fromMs).toISOString().slice(0, 10));

    // Пакетом по 100: одиночный запрос WB закрыл (405), да и 1000 заданий
    // одним по одному в бюджет прогона не влезали никогда.
    const batch = await fetchFbsOrdersMetaBatch(target.advertToken, queue.slice(0, CODES_PER_RUN), {
      deadlineMs: deadline,
    });
    const probed = batch.codes;
    for (const codes of probed.values()) if (codes.length) result.found += 1;
    if (batch.sample && !result.sample) result.sample = batch.sample;

    await rememberKizCodes(target.cabinetId, probed, sridByOrderId);
    result.probed += probed.size;
    result.left += Math.max(0, queue.length - probed.size);
  }

  return result;
}

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  // Держимся заметно ниже лимита функции: прогон, убитый платформой, не пишет
  // журнал — именно так пропал результат ручного запуска, и понять, сработал
  // он или нет, было нельзя.
  const deadline = Date.now() + 45_000;

  const targets = (await getWbSyncTargets()).filter(
    (target): target is typeof target & { cabinetId: string } => Boolean(target.cabinetId),
  );

  if (!targets.length) {
    await writeSyncLog("kiz-codes", "ok", 0, "Нет кабинетов с доступом к Marketplace", startedAt);
    return NextResponse.json({ ok: true, summary: [] });
  }

  const startDay = Math.floor(Date.now() / SLOT_MS) % WINDOW_DAYS;

  const settled = await Promise.allSettled(
    targets.map((target) => collectForCabinet(target, startDay, deadline)),
  );

  const summary: CabinetResult[] = settled.map((item, index) =>
    item.status === "fulfilled"
      ? item.value
      : {
          cabinet: targets[index].name,
          orders: 0,
          probed: 0,
          found: 0,
          left: 0,
          days: [],
          failed: 0,
          foreign: 0,
          error:
            item.reason instanceof Error ? item.reason.message.slice(0, 120) : "Не удалось добрать коды",
        },
  );

  const worked = summary.filter((row) => row.probed || row.left || row.error || row.failed || row.foreign);
  const note =
    (worked.length ? worked : summary)
      .map((row) => {
        if (row.error) return `${row.cabinet}: ${row.error}`;
        const where = row.days.length ? ` (${row.days.join(", ")})` : "";
        const why = row.failed ? `, отказов ${row.failed}: ${row.reason ?? "?"}` : "";
        const shape = row.sample ? ` · форма ${row.sample}` : "";
        const alien = row.foreign ? `, чужих отсеяно ${row.foreign}` : "";
        return `${row.cabinet}: опрошено ${row.probed}, с кодом ${row.found}${row.left ? `, осталось ${row.left}` : ""}${alien}${why}${where}${shape}`;
      })
      .join("; ") || "Незакрытых заданий не нашлось";

  const failed = summary.filter((row) => row.error);
  await writeSyncLog(
    "kiz-codes",
    failed.length ? "error" : "ok",
    summary.reduce((sum, row) => sum + row.probed, 0),
    note,
    startedAt,
  );
  return NextResponse.json({ ok: failed.length === 0, summary });
}
