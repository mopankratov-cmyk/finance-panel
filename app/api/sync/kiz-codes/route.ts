import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";
import { fetchFbsOrders, fetchFbsOrderMeta } from "@/lib/wb/fbsMarketplace";
import { loadKnownKizCodes, rememberKizCodes } from "@/lib/wb/fbsKizStore";

// Коды маркировки добираются в фоне, а не по заходу пользователя.
//
// WB отдаёт код по одному заданию за запрос, а лимитер общий на кабинет: пока
// коды опрашивал открытый экран, он конкурировал с почасовыми синками — и
// проигрывал («Сверка оборота» падала с «WB ограничил частоту»).
//
// Первая версия за один прогон обходила все кабинеты и запрашивала список
// заданий за две недели. Замер 23.08.2026: у Оптимы это 12 000 заданий, и
// выборка списков съедала весь бюджет функции — три прогона подряд дали
// «+0 из 0», ни одного опрошенного задания.
//
// Поэтому прогон сузили до одной клетки: ОДИН кабинет и ОДИН день. Список за
// сутки — это одна страница, а не дюжина, и почти всё время достаётся опросу.
// Клетка выбирается по номеру пятнадцатиминутки, так что заходы идут по кругу
// и за сутки покрывают все кабинеты на всю глубину окна.
export const maxDuration = 60;

/** Сколько заданий добираем за прогон. Реальный потолок ставит дедлайн. */
const CODES_PER_RUN = 80;
/** Пауза между запросами: у WB лимит на кабинет, спешить некуда. */
const REQUEST_PAUSE_MS = 250;
/** Глубина окна в днях: столько суток обходим по кругу. */
const WINDOW_DAYS = 14;
/** Потолок на выборку списка, чтобы на сам опрос осталось время. */
const LIST_BUDGET_MS = 12_000;
/** Шаг ротации: крон ходит четыре раза в час. */
const SLOT_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  // Держимся заметно ниже лимита функции: прогон, убитый платформой, не пишет
  // журнал — именно так пропал результат ручного запуска, и понять, сработал
  // он или нет, было нельзя.
  const deadline = Date.now() + 45_000;

  const all = (await getWbSyncTargets())
    .filter((target) => target.cabinetId)
    // Порядок из базы не гарантирован, а ротация должна быть предсказуемой.
    .sort((a, b) => String(a.cabinetId).localeCompare(String(b.cabinetId)));

  if (!all.length) {
    await writeSyncLog("kiz-codes", "ok", 0, "Нет кабинетов с доступом к Marketplace", startedAt);
    return NextResponse.json({ ok: true, summary: [] });
  }

  const slot = Math.floor(Date.now() / SLOT_MS);
  const target = all[slot % all.length];
  const dayOffset = Math.floor(slot / all.length) % WINDOW_DAYS;
  const toMs = Date.now() - dayOffset * DAY_MS;
  const fromMs = toMs - DAY_MS;
  const day = new Date(fromMs).toISOString().slice(0, 10);

  try {
    const { orders } = await fetchFbsOrders(target.advertToken, {
      fromMs,
      toMs,
      maxPages: 3,
      deadlineMs: Math.min(deadline, Date.now() + LIST_BUDGET_MS),
    });
    const ids = orders.map((order) => order.id).filter((id) => Number.isFinite(id));

    const known = ids.length
      ? await loadKnownKizCodes(target.cabinetId!, ids)
      : { codes: new Map<number, string[]>(), recentlyProbed: new Set<number>() };
    const queue = ids.filter((id) => !known.codes.get(id)?.length && !known.recentlyProbed.has(id));
    const probed = new Map<number, string[]>();
    let found = 0;

    for (const id of queue.slice(0, CODES_PER_RUN)) {
      if (Date.now() > deadline) break;
      try {
        const meta = await fetchFbsOrderMeta(target.advertToken, id);
        const codes = [...meta.sgtin, ...meta.uin, ...meta.imei, ...meta.gtin].filter(Boolean);
        // Пустой ответ тоже пишем — как отметку «спрашивали», не как «кода нет».
        probed.set(id, codes);
        if (codes.length) found += 1;
      } catch {
        // Одно упавшее задание не должно рвать прогон: попробуем в следующий раз.
      }
      await new Promise((resolve) => setTimeout(resolve, REQUEST_PAUSE_MS));
    }

    await rememberKizCodes(target.cabinetId!, probed);

    const left = Math.max(0, queue.length - probed.size);
    const note =
      `${target.name}, ${day}: заданий ${ids.length}, опрошено ${probed.size}, с кодом ${found}` +
      (left ? `, осталось на этот день ${left}` : "");
    await writeSyncLog("kiz-codes", "ok", probed.size, note, startedAt);
    return NextResponse.json({
      ok: true,
      summary: [{ cabinet: target.name, day, orders: ids.length, probed: probed.size, found, left }],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 140) : "Не удалось добрать коды";
    await writeSyncLog("kiz-codes", "error", 0, `${target.name}, ${day}: ${message}`, startedAt);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
