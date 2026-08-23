import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";
import { fetchFbsOrders, fetchFbsOrderMeta } from "@/lib/wb/fbsMarketplace";
import { loadKnownKizCodes, rememberKizCodes } from "@/lib/wb/fbsKizStore";

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
const CODES_PER_RUN = 80;
/** Пауза между запросами внутри кабинета: лимит общий, спешить некуда. */
const REQUEST_PAUSE_MS = 250;
/** Глубина окна в днях: столько суток обходим по кругу. */
const WINDOW_DAYS = 14;
/** Сколько дней максимум пролистать за прогон в поисках незакрытых заданий. */
const DAYS_PER_RUN = 4;
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
}

async function collectForCabinet(
  target: { name: string; cabinetId: string; advertToken: string },
  startDay: number,
  deadline: number,
): Promise<CabinetResult> {
  const result: CabinetResult = { cabinet: target.name, orders: 0, probed: 0, found: 0, left: 0, days: [] };

  for (let step = 0; step < DAYS_PER_RUN; step++) {
    if (Date.now() > deadline || result.probed >= CODES_PER_RUN) break;

    const dayOffset = (startDay + step) % WINDOW_DAYS;
    const toMs = Date.now() - dayOffset * DAY_MS;
    const fromMs = toMs - DAY_MS;

    const { orders } = await fetchFbsOrders(target.advertToken, {
      fromMs,
      toMs,
      maxPages: 3,
      deadlineMs: deadline,
    });
    const ids = orders.map((order) => order.id).filter((id) => Number.isFinite(id));
    result.orders += ids.length;
    if (!ids.length) continue;

    const known = await loadKnownKizCodes(target.cabinetId, ids);
    const queue = ids.filter((id) => !known.codes.get(id)?.length && !known.recentlyProbed.has(id));
    if (!queue.length) continue;

    result.days.push(new Date(fromMs).toISOString().slice(0, 10));
    const probed = new Map<number, string[]>();

    for (const id of queue.slice(0, CODES_PER_RUN - result.probed)) {
      if (Date.now() > deadline) break;
      try {
        const meta = await fetchFbsOrderMeta(target.advertToken, id);
        const codes = [...meta.sgtin, ...meta.uin, ...meta.imei, ...meta.gtin].filter(Boolean);
        // Пустой ответ тоже пишем — как отметку «спрашивали», не как «кода нет».
        probed.set(id, codes);
        if (codes.length) result.found += 1;
      } catch {
        // Одно упавшее задание не должно рвать прогон: вернёмся к нему позже.
      }
      await new Promise((resolve) => setTimeout(resolve, REQUEST_PAUSE_MS));
    }

    // Пишем сразу за днём: если платформа оборвёт прогон, уже опрошенное
    // останется в базе, а не пропадёт вместе с функцией.
    await rememberKizCodes(target.cabinetId, probed);
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
          error:
            item.reason instanceof Error ? item.reason.message.slice(0, 120) : "Не удалось добрать коды",
        },
  );

  const worked = summary.filter((row) => row.probed || row.left || row.error);
  const note =
    (worked.length ? worked : summary)
      .map((row) => {
        if (row.error) return `${row.cabinet}: ${row.error}`;
        const where = row.days.length ? ` (${row.days.join(", ")})` : "";
        return `${row.cabinet}: опрошено ${row.probed}, с кодом ${row.found}${row.left ? `, осталось ${row.left}` : ""}${where}`;
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
