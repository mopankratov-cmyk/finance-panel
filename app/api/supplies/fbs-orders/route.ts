import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";
import { loadHourlyDashboard } from "@/lib/cache/hourlyDashboard";
import { loadKnownKizCodes, rememberKizCodes } from "@/lib/wb/fbsKizStore";
import {
  fbsOrderBucket,
  fbsStatusLabel,
  fetchFbsOrdersMetaBatch,
  fetchFbsOrderStatuses,
  fetchFbsOrders,
  WB_FBS_BUCKET_LABELS,
  WbFbsApiError,
  type WbFbsBucket,
  type WbFbsOrderMeta,
} from "@/lib/wb/fbsMarketplace";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Состояние кода маркировки у сборочного задания. */
export type FbsKizStatus =
  /** Код привязан к заданию. */
  | "present"
  /** WB требует код по этому заданию, а его нет — товар вернётся с ПВЗ. */
  | "missing"
  /** WB не требует код для этой позиции. */
  | "not_required"
  /** WB не сказал, требуется ли код, либо мы не успели проверить задание. */
  | "unknown";

export interface FbsOrderRow {
  id: number;
  rid: string;
  createdAt: string | null;
  nmId: number;
  article: string;
  barcode: string;
  /** Цена продажи в рублях (WB отдаёт её умноженной на 100). */
  price: number | null;
  supplyId: string;
  deliveryType: string;
  supplierStatus: string;
  wbStatus: string;
  bucket: WbFbsBucket;
  statusLabel: string;
  kizStatus: FbsKizStatus;
  kizCode: string | null;
}

export interface FbsOrdersBucketCount {
  bucket: WbFbsBucket;
  label: string;
  count: number;
}

export interface FbsOrdersResponse {
  meta: {
    cabinetId: string;
    generatedAt: string;
    status: "ready" | "partial";
    days: number;
    warnings: string[];
  };
  data: {
    rows: FbsOrderRow[];
    buckets: FbsOrdersBucketCount[];
    /** Заданий, где WB требует КИЗ, а кода нет. */
    kizMissing: number;
    /** Заданий, у которых код реально проверен запросом в WB. */
    kizChecked: number;
    /** Заданий, по которым код может требоваться (WB не сказал «не нужен»). */
    kizRequired: number;
    /** Заданий, по которым код так и остался непроверенным. */
    kizUnchecked: number;
  } | null;
  error: string | null;
}

const ALLOWED_DAYS = [1, 3, 7, 14, 30, 60] as const;
// Потолок точечных запросов meta: WB отдаёт код только по одному заданию за раз,
// а лимитер у WB общий на продавца — один открытый экран не должен выедать его
// у остальных WB-вкладок кабинета. Найденные коды кэшируются (см. ниже), поэтому
// повторный заход тратит бюджет только на ещё не разобранные задания.
const META_BUDGET = 120;
const META_CONCURRENCY = 6;


const metaEnvelope = (cabinetId: string, days: number, warnings: string[] = [], status: "ready" | "partial" = "ready") => ({
  cabinetId,
  generatedAt: new Date().toISOString(),
  status,
  days,
  warnings,
});

function fail(message: string, httpStatus: number, cabinetId = "", days = 0): NextResponse<FbsOrdersResponse> {
  return NextResponse.json<FbsOrdersResponse>(
    { meta: metaEnvelope(cabinetId, days), data: null, error: message },
    { status: httpStatus },
  );
}

async function resolveCabinetId(raw: string | null): Promise<string | null> {
  if (!raw || raw === "all" || raw.startsWith("group:")) return null;
  return (await resolveShopCabinet(raw)).cabinetId;
}

/** Мини-пул: WB держит общий лимитер на продавца, поэтому шире шести не идём. */
async function mapWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const params = new URL(request.url).searchParams;
  const days = Number(params.get("days") ?? 7);
  if (!ALLOWED_DAYS.includes(days as (typeof ALLOWED_DAYS)[number])) {
    return fail("Период должен быть одним из: 1, 3, 7, 14, 30, 60 дней", 400);
  }
  const cabinetId = await resolveCabinetId(params.get("cabinet"));
  if (!cabinetId) return fail("Выберите один реальный WB-кабинет", 400, "", days);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403, cabinetId, days);

  const cabinet = await getWbCabinet(cabinetId);
  if (!cabinet) return fail("WB-кабинет не найден", 404, cabinetId, days);

  const deadlineMs = Date.now() + 48_000;
  const token = resolveWbToken(cabinet, "marketplace");
  const warnings: string[] = [];

  try {
    const toMs = Date.now();
    const fromMs = toMs - days * 86_400_000;
    const [allowedNmIds, orderPage] = await Promise.all([
      requestAllowedNmIds(cabinetId),
      fetchFbsOrders(token, { fromMs, toMs, deadlineMs }),
    ]);
    if (!orderPage.complete) {
      warnings.push("Сборочные задания догружены не полностью — WB отдаёт их страницами, сузьте период.");
    }

    const scoped = orderPage.orders.filter((order) => requestAllowsNm(allowedNmIds, order.nmId));
    const droppedByScope = orderPage.orders.length - scoped.length;
    if (droppedByScope > 0) {
      warnings.push(`${droppedByScope} заданий вне товарного контура кабинета скрыто.`);
    }

    const statusPage = await fetchFbsOrderStatuses(token, scoped.map((order) => order.id), { deadlineMs });
    if (!statusPage.complete) {
      warnings.push("Статусы части заданий не догружены — они показаны как «архив» до следующей загрузки.");
    }

    // true — WB требует код, false — не требует, null — WB не сказал.
    const kizRequirement = new Map<number, boolean | null>();
    const rows: FbsOrderRow[] = scoped.map((order) => {
      const status = statusPage.statuses.get(order.id);
      const supplierStatus = status?.supplierStatus ?? "";
      const wbStatus = status?.wbStatus ?? "";
      // requiredMeta — единственный честный признак «WB ждёт код по этой позиции».
      // Нет поля — состояние неизвестно, и мы так и пишем, а не считаем «не нужен».
      const requiresKiz = order.requiredMeta === null ? null : order.requiredMeta.includes("sgtin");
      kizRequirement.set(order.id, requiresKiz);
      return {
        id: order.id,
        rid: order.rid,
        createdAt: order.createdAt,
        nmId: order.nmId,
        article: order.article,
        barcode: order.barcode,
        price: order.price,
        supplyId: order.supplyId,
        deliveryType: order.deliveryType,
        supplierStatus,
        wbStatus,
        bucket: fbsOrderBucket(supplierStatus, wbStatus),
        statusLabel: status ? fbsStatusLabel(supplierStatus, wbStatus) : "статус не получен",
        kizStatus: requiresKiz === false ? "not_required" : "unknown",
        kizCode: null,
      };
    });

    // Код маркировки WB отдаёт только точечно, по одному заданию за запрос.
    // Вкладка про работу склада: нужны задания, которые ещё предстоит собрать.
    // Уехавшие и архивные собирать уже нечего, а бюджет опроса они выедали —
    // на скриншоте 23.08.2026 это 1356 заданий, из которых на сборке 0.
    const pending = rows.filter((row) => row.bucket === "new" || row.bucket === "assembling");
    const doneCount = rows.length - pending.length;
    if (doneCount) {
      warnings.push(`Скрыто уже собранных и уехавших заданий: ${doneCount} — собирать по ним нечего.`);
    }

    // Спрашиваем сначала те, где риск живой: задание ещё не уехало.
    const byId = new Map(pending.map((row) => [row.id, row]));
    const candidates = pending
      .filter((row) => row.kizStatus === "unknown")
      .sort((left, right) => {
        const weight = (row: FbsOrderRow) => (row.bucket === "new" ? 0 : row.bucket === "assembling" ? 1 : 2);
        return weight(left) - weight(right) || (right.createdAt ?? "").localeCompare(left.createdAt ?? "");
      });
    // Известные коды поднимаются из базы одним запросом, поэтому бюджет
    // тратится только на задания, которых там ещё нет: «проверено N из M»
    // растёт от захода к заходу, а не начинается каждый раз заново.
    const kizSnapshot = await loadKnownKizCodes(cabinetId, candidates.map((row) => row.id))
      .catch(() => ({ codes: new Map<number, string[]>(), recentlyProbed: new Set<number>() }));
    const knownCodes = kizSnapshot.codes;
    const discoveredCodes = new Map<number, string[]>();
    for (const row of candidates) {
      const cached = knownCodes.get(row.id);
      const target = byId.get(row.id);
      if (!cached?.length || !target) continue;
      target.kizCode = cached[0];
      target.kizStatus = "present";
    }
    // Недавно опрошенные пропускаем: у них WB кода не дал, и повторять запрос
    // сейчас — значит снова упереться в тот же бюджет, не добравшись до
    // остальных заданий. Через несколько часов они вернутся в очередь.
    const probed = candidates
      .filter((row) => !knownCodes.get(row.id)?.length && !kizSnapshot.recentlyProbed.has(row.id))
      .slice(0, META_BUDGET);
    let checked = 0;
    let metaFailed = 0;
    // Пакетом: одиночный GET .../meta WB закрыл (405), и вкладка честно
    // показывала «код известен у 0 заданий». Действующий метод отдаёт до 100
    // заданий за запрос.
    try {
      const batch = await fetchFbsOrdersMetaBatch(token, probed.map((row) => row.id), { deadlineMs });
      for (const [id, codes] of batch.codes) {
        const target = byId.get(id);
        if (!target) continue;
        checked += 1;
        const code = codes[0] ?? null;
        target.kizCode = code;
        discoveredCodes.set(id, code ? [code] : []);
        // «Кода нет» говорим только там, где WB сам объявил код обязательным.
        // Если WB промолчал про требование — остаёмся при «не проверен», а не
        // вешаем на продавца несуществующий риск.
        target.kizStatus = code ? "present" : kizRequirement.get(id) === true ? "missing" : "unknown";
      }
    } catch {
      // Не вышло пачкой — оставляем «не проверено», а не выдаём за «кода нет».
      metaFailed = probed.length;
    }

    if (discoveredCodes.size) void rememberKizCodes(cabinetId, discoveredCodes).catch(() => {});

    if (candidates.length > probed.length) {
      // Раньше здесь стояло «проверено 120 из 598» — это был размер бюджета, а
      // не накопленный результат: цифра не двигалась от захода к заходу, хотя
      // опрос каждый раз брал новые задания. Считаем то, что действительно
      // накопилось: коды из базы, спрошенное сейчас и остаток очереди.
      const withCode = candidates.filter((row) => knownCodes.get(row.id)?.length).length;
      const waiting = candidates.length - withCode - probed.length;
      warnings.push(
        `Код маркировки известен у ${withCode} заданий, за этот заход спрошено ещё ${probed.length}`
        + (waiting > 0 ? `, в очереди ${waiting}` : "")
        + ". WB отдаёт код по одному заданию за запрос, поэтому список обходится за несколько заходов.",
      );
    }
    if (metaFailed > 0) {
      warnings.push(`У ${metaFailed} заданий WB не отдал код маркировки — они помечены как «не проверен».`);
    }

    const buckets: FbsOrdersBucketCount[] = (Object.keys(WB_FBS_BUCKET_LABELS) as WbFbsBucket[]).map((bucket) => ({
      bucket,
      label: WB_FBS_BUCKET_LABELS[bucket],
      count: rows.filter((row) => row.bucket === bucket).length,
    }));

    // Счёт по кодам — только по тем заданиям, с которыми ещё можно что-то
    // сделать: по уехавшим цифра «не проверено» не значит ничего.
    const kizMissing = pending.filter((row) => row.kizStatus === "missing").length;
    const kizRequired = pending.filter((row) => row.kizStatus !== "not_required").length;
    const kizUnchecked = pending.filter((row) => row.kizStatus === "unknown").length;
    const partial = !orderPage.complete || !statusPage.complete || candidates.length > probed.length;

    return NextResponse.json<FbsOrdersResponse>({
      meta: metaEnvelope(cabinetId, days, warnings, partial ? "partial" : "ready"),
      data: { rows: pending, buckets, kizMissing, kizChecked: checked, kizRequired, kizUnchecked },
      error: null,
    });
  } catch (error) {
    if (error instanceof WbFbsApiError) return fail(error.message, error.status >= 400 && error.status < 600 ? error.status : 502, cabinetId, days);
    return fail(error instanceof Error ? error.message : "Не удалось загрузить сборочные задания", 500, cabinetId, days);
  }
}
