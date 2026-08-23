import { NextRequest, NextResponse } from "next/server";
import { loadHourlyDashboard } from "@/lib/cache/hourlyDashboard";
import { loadKnownKizCodes, rememberKizCodes } from "@/lib/wb/fbsKizStore";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { cabinetProductScope, getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { loadCabinetPimRowsHourly, PimSnapshotColdError, type PimRow } from "@/lib/wb/cards";
import { allowsProduct } from "@/lib/wb/productScope";
import {
  KIZ_META_LOOKUP_LIMIT,
  WbKizSourceError,
  emptyKizReconcileResult,
  fetchFbsAssemblyTasks,
  fetchFbsSoldTaskIds,
  fetchFbsTaskKizCodes,
  fetchReturnClaimReasons,
  fetchTaskKizCodesBatch,
  fetchTaskKizCodesDirect,
  fetchWbReturnFacts,
  reconcileKizFromWb,
  type FbsAssemblyTask,
  type KizCodesLookupResult,
  type KizReconcileDays,
  type KizReconcileResult,
  type WbReturnFact,
} from "@/lib/wb/kizReconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Сверка не помещается в один прогон на живом кабинете: сначала тянутся все
 * сборочные задания за период, потом их статусы, и только потом опрашиваются
 * коды — до кодов дело не доходило вовсе (проверено 0 из N).
 *
 * Поэтому дорогой префикс (задания + статусы) кэшируется на час, а коды
 * кэшируются поштучно: код задания не меняется. В итоге каждый следующий
 * «Проверить» идёт сразу к неопрошенным заданиям и досчитывает — прогресс
 * накапливается, а не обнуляется.
 */
interface KizTasksSnapshot {
  tasks: FbsAssemblyTask[];
  truncated: boolean;
}

async function loadTasksSnapshot(
  cabinetId: string,
  token: string,
  days: KizReconcileDays,
  fromMs: number,
  toMs: number,
  deadline: number,
  forceRefresh: boolean,
): Promise<KizTasksSnapshot> {
  return loadHourlyDashboard<KizTasksSnapshot>(
    "wb-kiz-tasks",
    { cabinetId, days, schema: 1 },
    async () => {
      const result = await fetchFbsAssemblyTasks({ token, fromMs, toMs, deadline });
      return { tasks: result.tasks, truncated: result.truncated };
    },
    { forceRefresh },
  );
}

async function loadSoldIdsSnapshot(
  cabinetId: string,
  token: string,
  days: KizReconcileDays,
  ids: number[],
  deadline: number,
  forceRefresh: boolean,
): Promise<{ sold: number[]; complete: boolean }> {
  return loadHourlyDashboard<{ sold: number[]; complete: boolean }>(
    "wb-kiz-sold",
    { cabinetId, days, schema: 1, count: ids.length },
    async () => {
      const statuses = await fetchFbsSoldTaskIds({ token, ids, deadline });
      return { sold: [...statuses.sold], complete: statuses.complete };
    },
    { forceRefresh },
  );
}

/** Пустой список кодов в кэш не пускаем: продавец привяжет код позже, а мы
 *  целый час утверждали бы, что кода нет. Такие задания перезапрашиваются. */
class EmptyKizCodesError extends Error {}

/**
 * Резолвер кодов: сначала база, потом WB.
 *
 * Код, привязанный к заданию, уже не меняется, поэтому найденное запоминается
 * навсегда и следующий заход тратит бюджет только на новые задания. Раньше
 * кэш жил в unstable_cache — он не общий между роутами и умирает с каждой
 * сборкой, так что прогресс терялся и опрос начинался почти с нуля.
 */
function cachedKizCodeResolver(
  cabinetId: string,
  token: string,
  deadline: number,
  known: Map<number, string[]>,
  discovered: Map<number, string[]>,
) {
  return async (id: number): Promise<string[]> => {
    // Пустой ответ — тоже ответ: без этой проверки задания без кода
    // переспрашивались бы у WB на каждом заходе.
    const already = discovered.get(id);
    if (already) return already;
    const cached = known.get(id);
    if (cached?.length) return cached;
    const codes = await fetchTaskKizCodesDirect(token, id, deadline);
    // Пустой ответ тоже отмечаем: это «спрашивали», а не «кода нет».
    discovered.set(id, codes);
    return codes;
  };
}

export interface KizReconcileResponse {
  meta: {
    cabinetId: string;
    cabinetName: string | null;
    generatedAt: string;
    /** "partial" — часть источников не догрузилась, корзины неполные (см. warnings). */
    status: "ready" | "partial";
    days: KizReconcileDays;
    warnings: string[];
  };
  data: KizReconcileResult | null;
  error: string | null;
}

const DAYS_OPTIONS: KizReconcileDays[] = [1, 3, 7, 30, 60, 90];

function fail(error: string, status: number, days: KizReconcileDays, cabinetId = ""): NextResponse {
  const body: KizReconcileResponse = {
    meta: { cabinetId, cabinetName: null, generatedAt: new Date().toISOString(), status: "partial", days, warnings: [] },
    data: null,
    error,
  };
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const params = new URL(request.url).searchParams;
  const rawDays = Number(params.get("days") ?? 30);
  const days = (DAYS_OPTIONS as number[]).includes(rawDays) ? (rawDays as KizReconcileDays) : null;
  if (!days) return fail("Период сверки — 1, 3, 7, 30, 60 или 90 дней", 400, 30);

  const rawCabinet = params.get("cabinet");
  if (!rawCabinet || rawCabinet === "all" || rawCabinet.startsWith("group:")) {
    return fail("Выберите один реальный WB-кабинет: коды маркировки живут в конкретном юрлице", 400, days);
  }
  const { cabinetId, label } = await resolveShopCabinet(rawCabinet);
  if (!cabinetId) return fail("Кабинет не найден", 404, days);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403, days);

  const cabinet = await getWbCabinet(cabinetId);
  if (!cabinet) return fail("Кабинет не найден", 404, days, cabinetId);
  const token = resolveWbToken(cabinet, "marketplace");
  const scope = cabinetProductScope(cabinet);

  const generatedAt = new Date();
  // Пользовательская функция живёт 60 с — оставляем запас на сборку ответа.
  const deadline = generatedAt.getTime() + 50_000;
  const fromMs = generatedAt.getTime() - days * 86_400_000;
  const fromIso = new Date(fromMs).toISOString();
  const warnings: string[] = [];

  // Каталог греется отдельно и может быть холодным — бренды тогда просто пустые.
  // cacheOnly: пользовательский путь читает только готовый снимок — холодный
  // обход Content API не укладывается в лимит функции и съел бы весь дедлайн,
  // отведённый на главный источник (сборочные задания).
  const brandsPromise: Promise<PimRow[]> = loadCabinetPimRowsHourly(cabinetId, { cacheOnly: true }).catch((error: unknown) => {
    warnings.push(error instanceof PimSnapshotColdError
      ? "Снимок карточек ещё не прогрет — бренды не подставлены, повторите через минуту."
      : "Каталог карточек недоступен — бренды не подставлены.");
    return [];
  });

  // refresh=1 — принудительно перечитать снимок заданий и статусов у WB.
  const forceRefresh = params.get("refresh") === "1";
  let tasks: KizTasksSnapshot;
  try {
    tasks = await loadTasksSnapshot(cabinetId, token, days, fromMs, generatedAt.getTime(), deadline, forceRefresh);
  } catch (error) {
    // Главный источник недоступен — отдаём честную ошибку и пустые корзины,
    // а не молчаливый ноль, который прочитали бы как «нарушений нет».
    const message = error instanceof Error ? error.message : "WB не отдал сборочные задания";
    const status = error instanceof WbKizSourceError ? error.status : 502;
    const body: KizReconcileResponse = {
      meta: { cabinetId, cabinetName: label ?? cabinet.name, generatedAt: generatedAt.toISOString(), status: "partial", days, warnings },
      data: emptyKizReconcileResult(days, ["Сверка не выполнена: источник сборочных заданий WB недоступен."]),
      error: message,
    };
    return NextResponse.json(body, { status });
  }

  const scoped = tasks.tasks.filter((task) => allowsProduct(scope, task.nmId));
  const blocked = tasks.tasks.length - scoped.length;

  // Агентский кабинет: WB отдаёт задания всего продавца, панель показывает только
  // товары кабинета. Если потолок прогона выбран целиком и своих товаров в срезе
  // не оказалось — сверка по этому периоду невозможна в принципе, и сказать об
  // этом надо прямо. Прежние две фразы («исключено N» + «возьмите период меньше»)
  // выглядели как настройка, хотя объясняли разные вещи и вводили в заблуждение.
  if (tasks.truncated && scoped.length === 0 && blocked > 0) {
    warnings.push(
      `Сверка по этому периоду невозможна: WB отдаёт сборочные задания всего продавца, `
      + `а кабинет ограничен вашими товарами. За ${days} дн. панель успела просмотреть ${blocked} заданий — `
      + `все чужие, ваших среди них не встретилось. Возьмите период короче (1–7 дней): `
      + `чем он меньше, тем выше шанс, что ваши товары попадут в просмотренный срез.`,
    );
  } else {
    if (tasks.truncated) {
      warnings.push(`Заданий за период больше, чем помещается в один прогон (просмотрено ${tasks.tasks.length}) — возьмите период короче.`);
    }
    if (blocked) warnings.push(`Исключено заданий вне товарного контура кабинета: ${blocked}`);
  }

  let soldIds = new Set<number>();
  let statusesAvailable = false;
  try {
    const statuses = await loadSoldIdsSnapshot(cabinetId, token, days, scoped.map((task) => task.id), deadline, forceRefresh);
    soldIds = new Set(statuses.sold);
    statusesAvailable = true;
    if (!statuses.complete) warnings.push("Статусы заданий догружены не полностью — часть продаж могла не попасть в сверку.");
  } catch (error) {
    warnings.push(error instanceof Error ? `Статусы заданий не получены: ${error.message}` : "Статусы заданий не получены");
  }

  // Старые задания горят первыми — их коды проверяем в первую очередь.
  const soldTasks = scoped
    .filter((task) => soldIds.has(task.id))
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  // Известные коды поднимаются из базы одним запросом: они не меняются, и
  // задание, опрошенное когда-либо раньше, больше не стоит запроса к WB.
  const kizSnapshot = statusesAvailable && soldTasks.length
    ? await loadKnownKizCodes(cabinetId, soldTasks.map((task) => task.id))
      .catch(() => ({ codes: new Map<number, string[]>(), recentlyProbed: new Set<number>() }))
    : { codes: new Map<number, string[]>(), recentlyProbed: new Set<number>() };
  const knownKizCodes = kizSnapshot.codes;
  const discoveredKizCodes = new Map<number, string[]>();

  // Пакетный добор: WB отдаёт до 100 заданий за запрос, поэтому 400 заданий
  // стоят четырёх запросов, а не четырёхсот. Поштучный цикл ниже остаётся
  // страховкой — он доберёт то, чего не оказалось в пачке.
  if (statusesAvailable && soldTasks.length) {
    const wanted = soldTasks
      .map((task) => task.id)
      .slice(0, KIZ_META_LOOKUP_LIMIT)
      .filter((id) => !knownKizCodes.get(id)?.length);
    if (wanted.length) {
      try {
        const fetched = await fetchTaskKizCodesBatch(token, wanted, deadline);
        for (const [id, codes] of fetched) discoveredKizCodes.set(id, codes);
      } catch {
        // Не вышло пачкой — поштучный цикл сам сообщит причину обрыва.
      }
    }
  }

  const meta: KizCodesLookupResult = statusesAvailable && soldTasks.length
    ? await fetchFbsTaskKizCodes({
      token,
      ids: soldTasks.map((task) => task.id),
      deadline,
      // Уже опрошенные задания достаются из кэша мгновенно, поэтому за прогон
      // добираются новые — «проверено N из M» растёт от захода к заходу.
      resolve: cachedKizCodeResolver(cabinetId, token, deadline, knownKizCodes, discoveredKizCodes),
    })
    : { codes: new Map<number, string[]>(), failed: 0, skipped: 0, lookupStopped: false, stopReason: null, stopMessage: null };
  // Найденное дописываем в базу, не задерживая ответ: не сохранилось —
  // просто спросим WB в следующий раз.
  if (discoveredKizCodes.size) void rememberKizCodes(cabinetId, discoveredKizCodes).catch(() => {});
  if (soldTasks.length > KIZ_META_LOOKUP_LIMIT) {
    warnings.push(`За прогон проверяется не больше ${KIZ_META_LOOKUP_LIMIT} заданий — остальные показаны в корзине «Не проверено».`);
  }
  // Опрос мог оборваться целиком (нет прав, лимит, таймаут): молчать об этом нельзя —
  // иначе непроверенные задания читаются как факт о обороте продавца.
  if (meta.lookupStopped) {
    warnings.push(`Коды маркировки опрошены не полностью: ${meta.stopMessage ?? "опрос прерван"}. Проверено заданий: ${meta.codes.size} из ${soldTasks.length}.`);
    // Опрошенное сохраняется, поэтому повтор не начинает с нуля — говорим об этом прямо,
    // иначе «проверено 0 из 302» читается как «раздел не работает».
    if (meta.codes.size < soldTasks.length) {
      warnings.push("Нажмите «Проверить» ещё раз — уже опрошенные задания сохранены, каждый заход добирает новые.");
    }
  }
  if (meta.failed) warnings.push(`WB не отдал коды по ${meta.failed} заданиям — они в корзине «Не проверено».`);
  if (!meta.lookupStopped && meta.skipped) {
    warnings.push(`Заданий, до которых опрос кодов не дошёл: ${meta.skipped} — они в корзине «Не проверено».`);
  }

  let returns: WbReturnFact[] = [];
  try {
    returns = (await fetchWbReturnFacts({ token, fromIso, deadline }))
      .filter((row) => (row.returnedAt ?? "") >= fromIso.slice(0, 10))
      .filter((row) => allowsProduct(scope, row.nmId, row.brand));
  } catch (error) {
    warnings.push(error instanceof Error ? `Возвраты не получены: ${error.message}` : "Возвраты не получены");
  }

  let reasonBySrid = new Map<string, string>();
  if (returns.length) {
    try {
      reasonBySrid = await fetchReturnClaimReasons({ token, deadline });
    } catch {
      warnings.push("Причины возвратов недоступны (нужен доступ к разделу «Возвраты») — показан факт возврата без текста причины.");
    }
  }

  const pimRows = await brandsPromise;
  const brandByNm = new Map<number, string>();
  const brandByArticle = new Map<string, string>();
  for (const row of pimRows) {
    if (!row.brand) continue;
    brandByNm.set(row.nmId, row.brand);
    const key = row.article.trim().toLocaleLowerCase("ru-RU");
    if (key) brandByArticle.set(key, row.brand);
  }

  const result = reconcileKizFromWb({
    todayIso: generatedAt.toISOString(),
    days,
    tasks: scoped,
    soldIds,
    codesByTask: meta.codes,
    codesLookup: meta,
    statusesAvailable,
    returns,
    reasonBySrid,
    brandByNm,
    brandByArticle,
  });

  const complete = statusesAvailable && result.coverage.checked === result.coverage.soldTotal && !warnings.length;
  const body: KizReconcileResponse = {
    meta: {
      cabinetId,
      cabinetName: label ?? cabinet.name,
      generatedAt: generatedAt.toISOString(),
      status: complete ? "ready" : "partial",
      days,
      warnings,
    },
    data: result,
    error: null,
  };
  return NextResponse.json(body);
}
