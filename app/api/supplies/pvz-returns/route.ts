import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { loadCabinetPimRowsHourly, PimSnapshotColdError } from "@/lib/wb/cards";
import { fetchWbReturnClaims, WbPvzReturnsError, type WbReturnClaim } from "@/lib/wb/pvzReturns";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** «В работе» — только активные заявки WB; «Все» — плюс архив WB. */
export type PvzReturnsScope = "work" | "all";

/** Строка вкладки «Возвраты на ПВЗ»: товар, который WB везёт обратно продавцу. */
export interface PvzReturnRow {
  id: string;
  nmId: number | null;
  /** Артикул продавца из каталога кабинета; "" — карточка не найдена. */
  article: string;
  /** Название товара: из заявки WB, иначе из каталога. */
  product: string;
  brand: string | null;
  /** Подпись статуса: текст WB, либо «Код WB N» — свои переводы не выдумываем. */
  status: string;
  statusCode: number | null;
  /** Подпись типа заявки по тому же правилу. */
  claimType: string;
  /** Причина словами покупателя (брак, неверное вложение и т.п.); "" — не прислана. */
  reason: string;
  wbComment: string;
  price: number | null;
  currency: string;
  createdAt: string | null;
  orderedAt: string | null;
  updatedAt: string | null;
  srid: string;
  /** true — заявка из архива WB (не в работе). */
  archived: boolean;
}

/** Строка «Обезлички» — товара, потерявшего опознание на складе WB. */
export interface PvzAnonymizedRow {
  nmId: number | null;
  article: string;
  brand: string | null;
  barcode: string;
  quantity: number;
  detectedAt: string | null;
}

/**
 * Обезличка отдельным блоком: публичного WB API под неё нет, поэтому секция
 * приходит пустой и честно объясняет почему. Цифры сюда не досочиняем.
 */
export interface PvzAnonymizedSection {
  available: boolean;
  rows: PvzAnonymizedRow[];
  note: string;
}

export interface PvzReturnsStatusCount {
  key: string;
  label: string;
  count: number;
}

export interface PvzReturnsResponse {
  meta: {
    cabinetId: string;
    generatedAt: string;
    /** "unavailable" — WB не отдал возвраты; список пуст, причина в error. */
    status: "ready" | "unavailable";
    scope: PvzReturnsScope;
    /** Сколько заявок всего у WB по активной выборке; null — счётчика нет. */
    total: number | null;
    warnings: string[];
  };
  data: {
    returns: PvzReturnRow[];
    anonymized: PvzAnonymizedSection;
    statuses: PvzReturnsStatusCount[];
  } | null;
  error: string | null;
}

const ANONYMIZED_NOTE = "Обезличенные товары WB не отдаёт через публичное API продавца. "
  + "Пока источника нет, раздел остаётся пустым — списки здесь не выдумываются. "
  + "Проверяйте обезличку в ЛК WB: Возвраты → Обезличенные товары.";

const emptySection = (): PvzAnonymizedSection => ({ available: false, rows: [], note: ANONYMIZED_NOTE });

// Ошибка отвечает тем же контрактом, что и успех: meta в PvzReturnsResponse
// ненулевая, и клиент вправе на это рассчитывать.
function fail(
  error: string,
  status: number,
  scope: PvzReturnsScope,
  cabinetId = "",
): NextResponse {
  const body: PvzReturnsResponse = {
    meta: {
      cabinetId,
      generatedAt: new Date().toISOString(),
      status: "unavailable",
      scope,
      total: null,
      warnings: [],
    },
    data: null,
    error,
  };
  return NextResponse.json(body, { status });
}

async function resolveCabinetId(raw: string | null): Promise<string | null> {
  if (!raw || raw === "all" || raw.startsWith("group:")) return null;
  return (await resolveShopCabinet(raw)).cabinetId;
}

function statusLabel(claim: WbReturnClaim): string {
  if (claim.statusText) return claim.statusText;
  if (claim.statusCode !== null) return `Код WB ${claim.statusCode}`;
  return "Статус не передан";
}

function claimTypeLabel(claim: WbReturnClaim): string {
  if (claim.claimTypeText) return claim.claimTypeText;
  if (claim.claimTypeCode !== null) return `Тип WB ${claim.claimTypeCode}`;
  return "—";
}

// GET ?cabinet=<uuid>&scope=work|all — заявки покупателей на возврат по одному
// реальному WB-кабинету. Недоступность WB не роняет роут: приходит пустой
// список плюс честный текст ошибки в error.
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const params = new URL(request.url).searchParams;
  const scope: PvzReturnsScope = params.get("scope") === "all" ? "all" : "work";
  const cabinetId = await resolveCabinetId(params.get("cabinet"));
  if (!cabinetId) return fail("Выберите один реальный WB-кабинет", 400, scope);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403, scope, cabinetId);

  const cabinet = await getWbCabinet(cabinetId);
  if (!cabinet) return fail("Кабинет не найден", 404, scope, cabinetId);

  const warnings: string[] = [];

  const [pim, allowedNmIds] = await Promise.all([
    // cacheOnly: холодный обход Content API занимает до минуты и не укладывается
    // в лимит пользовательской функции. Снимок греет cron; пока он холодный —
    // говорим об этом в warnings, а не заставляем пользователя ждать 504.
    loadCabinetPimRowsHourly(cabinetId, { cacheOnly: true }).catch((error: unknown) => {
      warnings.push(error instanceof PimSnapshotColdError
        ? "Снимок карточек ещё не прогрет — артикулы и бренды подтянутся после обновления"
        : "Каталог кабинета не загрузился — артикулы и бренды показаны не будут");
      return [];
    }),
    requestAllowedNmIds(cabinetId),
  ]);

  const cardByNm = new Map(pim.map((row) => [row.nmId, row]));
  const token = resolveWbToken(cabinet, "marketplace");

  let claims: WbReturnClaim[] = [];
  let total: number | null = null;
  let failure: string | null = null;

  try {
    const active = await fetchWbReturnClaims(token, { archived: false });
    claims = active.items;
    total = active.total;
    if (active.truncated) warnings.push("У WB осталось больше заявок, чем помещается в выборку — показаны первые 1000");

    if (scope === "all") {
      try {
        const archive = await fetchWbReturnClaims(token, { archived: true });
        claims = claims.concat(archive.items);
        if (archive.truncated) warnings.push("Архив возвратов WB длиннее выборки — показаны первые 1000 архивных заявок");
      } catch (error) {
        warnings.push(error instanceof WbPvzReturnsError
          ? `Архив возвратов не загрузился: ${error.message}`
          : "Архив возвратов не загрузился");
      }
    }
  } catch (error) {
    failure = error instanceof WbPvzReturnsError
      ? error.message
      : error instanceof Error ? error.message : "Не удалось получить возвраты WB";
  }

  let outOfScope = 0;
  const returns: PvzReturnRow[] = [];
  for (const claim of claims) {
    if (!requestAllowsNm(allowedNmIds, claim.nmId)) {
      outOfScope += 1;
      continue;
    }
    const card = claim.nmId !== null ? cardByNm.get(claim.nmId) : undefined;
    returns.push({
      id: claim.id,
      nmId: claim.nmId,
      article: card?.article ?? "",
      product: claim.productName || card?.name || "",
      brand: card?.brand || null,
      status: statusLabel(claim),
      statusCode: claim.statusCode,
      claimType: claimTypeLabel(claim),
      reason: claim.buyerComment,
      wbComment: claim.wbComment,
      price: claim.price,
      currency: claim.currency,
      createdAt: claim.createdAt,
      orderedAt: claim.orderedAt,
      updatedAt: claim.updatedAt,
      srid: claim.srid,
      archived: claim.archived,
    });
  }
  if (outOfScope > 0) warnings.push(`Скрыто заявок вне товарного контура кабинета: ${outOfScope}`);

  returns.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const byStatus = new Map<string, number>();
  for (const row of returns) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
  const statuses: PvzReturnsStatusCount[] = [...byStatus.entries()]
    .map(([label, count]) => ({ key: label, label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"));

  const body: PvzReturnsResponse = {
    meta: {
      cabinetId,
      generatedAt: new Date().toISOString(),
      status: failure ? "unavailable" : "ready",
      scope,
      total,
      warnings,
    },
    data: { returns, anonymized: emptySection(), statuses },
    error: failure,
  };
  return NextResponse.json(body);
}
