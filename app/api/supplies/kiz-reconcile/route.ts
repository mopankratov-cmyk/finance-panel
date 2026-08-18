import { NextRequest, NextResponse } from "next/server";
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
  fetchWbReturnFacts,
  reconcileKizFromWb,
  type KizCodesLookupResult,
  type KizReconcileDays,
  type KizReconcileResult,
  type WbReturnFact,
} from "@/lib/wb/kizReconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

const DAYS_OPTIONS: KizReconcileDays[] = [30, 60, 90];

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
  if (!days) return fail("Период сверки — 30, 60 или 90 дней", 400, 30);

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

  let tasks;
  try {
    tasks = await fetchFbsAssemblyTasks({ token, fromMs, toMs: generatedAt.getTime(), deadline });
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

  if (tasks.truncated) {
    warnings.push("Заданий за период больше, чем помещается в один прогон — сверьте период поменьше (30 дней).");
  }
  const scoped = tasks.tasks.filter((task) => allowsProduct(scope, task.nmId));
  const blocked = tasks.tasks.length - scoped.length;
  if (blocked) warnings.push(`Исключено заданий вне товарного контура кабинета: ${blocked}`);

  let soldIds = new Set<number>();
  let statusesAvailable = false;
  try {
    const statuses = await fetchFbsSoldTaskIds({ token, ids: scoped.map((task) => task.id), deadline });
    soldIds = statuses.sold;
    statusesAvailable = true;
    if (!statuses.complete) warnings.push("Статусы заданий догружены не полностью — часть продаж могла не попасть в сверку.");
  } catch (error) {
    warnings.push(error instanceof Error ? `Статусы заданий не получены: ${error.message}` : "Статусы заданий не получены");
  }

  // Старые задания горят первыми — их коды проверяем в первую очередь.
  const soldTasks = scoped
    .filter((task) => soldIds.has(task.id))
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  const meta: KizCodesLookupResult = statusesAvailable && soldTasks.length
    ? await fetchFbsTaskKizCodes({ token, ids: soldTasks.map((task) => task.id), deadline })
    : { codes: new Map<number, string[]>(), failed: 0, skipped: 0, lookupStopped: false, stopReason: null, stopMessage: null };
  if (soldTasks.length > KIZ_META_LOOKUP_LIMIT) {
    warnings.push(`За прогон проверяется не больше ${KIZ_META_LOOKUP_LIMIT} заданий — остальные показаны в корзине «Не проверено».`);
  }
  // Опрос мог оборваться целиком (нет прав, лимит, таймаут): молчать об этом нельзя —
  // иначе непроверенные задания читаются как факт о обороте продавца.
  if (meta.lookupStopped) {
    warnings.push(`Коды маркировки опрошены не полностью: ${meta.stopMessage ?? "опрос прерван"}. Проверено заданий: ${meta.codes.size} из ${soldTasks.length}.`);
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
