// Тонкий клиент returns-api.wildberries.ru — заявки покупателей на возврат
// («Возвраты» в ЛК WB: товар едет обратно продавцу на ПВЗ). Отдельный хост от
// статистики и маркетплейса, но живёт на основном токене кабинета (см. lib/wb/token.ts).
//
// Правило модуля: ничего не достраиваем за WB. Коды статусов и типов заявок WB
// официально не фиксирует стабильным словарём, поэтому мы НЕ переводим их в
// свои подписи — берём текст, если WB его прислал, иначе показываем сам код.
// Выдуманная подпись хуже честного «Код WB 3».

const BASE = "https://returns-api.wildberries.ru/api/v1/claims";

export class WbPvzReturnsError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "WbPvzReturnsError";
    this.status = status;
  }
}

/** Заявка покупателя на возврат в том виде, в каком её отдал WB. */
export interface WbReturnClaim {
  /** Идентификатор заявки WB. */
  id: string;
  nmId: number | null;
  /** Название товара из заявки; "" — WB не прислал. */
  productName: string;
  /** Код статуса заявки WB; null — поля не было. */
  statusCode: number | null;
  /** Текстовый статус, если WB его прислал; "" — переводить код нечем. */
  statusText: string;
  /** Код типа заявки (claim_type) WB; null — поля не было. */
  claimTypeCode: number | null;
  /** Текстовый тип заявки, если WB его прислал. */
  claimTypeText: string;
  /** Комментарий покупателя — по нему видно причину (брак, вложение, инициатива). */
  buyerComment: string;
  /** Комментарий WB по заявке. */
  wbComment: string;
  price: number | null;
  currency: string;
  /** srid — сквозной идентификатор заказа WB. */
  srid: string;
  createdAt: string | null;
  orderedAt: string | null;
  updatedAt: string | null;
  /** true — заявка взята из архива WB (is_archive=true), т.е. уже не в работе. */
  archived: boolean;
}

export interface WbReturnClaimsPage {
  items: WbReturnClaim[];
  /** Сколько заявок всего у WB по выборке; null — WB не прислал счётчик. */
  total: number | null;
}

const MAX_LIMIT = 200;

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function iso(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// WB отдаёт одни и те же поля то в snake_case, то в camelCase (разные версии
// хендлеров), поэтому читаем оба написания и не теряем данные молча.
function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function normalizeClaim(row: Record<string, unknown>, archived: boolean): WbReturnClaim {
  return {
    id: text(pick(row, ["id", "claim_id", "claimId"])),
    nmId: num(pick(row, ["nm_id", "nmId", "nmID"])),
    productName: text(pick(row, ["imt_name", "imtName", "product_name", "productName", "subject_name"])),
    statusCode: num(pick(row, ["status", "status_id", "statusId"])),
    statusText: text(pick(row, ["status_name", "statusName", "status_ex", "statusEx", "state"])),
    claimTypeCode: num(pick(row, ["claim_type", "claimType", "type"])),
    claimTypeText: text(pick(row, ["claim_type_name", "claimTypeName", "type_name", "typeName"])),
    buyerComment: text(pick(row, ["user_comment", "userComment", "client_comment", "reason"])),
    wbComment: text(pick(row, ["wb_comment", "wbComment"])),
    price: num(pick(row, ["price", "sum", "amount"])),
    currency: text(pick(row, ["currency_code", "currencyCode"])) || "RUB",
    srid: text(pick(row, ["srid", "rid", "order_id", "orderId"])),
    createdAt: iso(pick(row, ["dt", "created_at", "createdAt", "claim_dt"])),
    orderedAt: iso(pick(row, ["order_dt", "orderDt", "order_date"])),
    updatedAt: iso(pick(row, ["dt_update", "dtUpdate", "updated_at", "updatedAt"])),
    archived,
  };
}

function extractRows(body: unknown): { rows: Record<string, unknown>[]; total: number | null } {
  if (Array.isArray(body)) return { rows: body as Record<string, unknown>[], total: null };
  if (!body || typeof body !== "object") return { rows: [], total: null };
  const envelope = body as Record<string, unknown>;
  const nested = envelope.data && typeof envelope.data === "object" ? (envelope.data as Record<string, unknown>) : null;
  const source = (envelope.claims ?? nested?.claims ?? envelope.items ?? nested?.items) as unknown;
  const rows = Array.isArray(source) ? (source as Record<string, unknown>[]) : [];
  const total = num(envelope.total ?? nested?.total ?? envelope.count ?? nested?.count);
  return { rows, total };
}

async function requestClaims(token: string, archived: boolean, limit: number, offset: number): Promise<unknown> {
  const url = new URL(BASE);
  url.searchParams.set("is_archive", String(archived));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(url.toString(), {
      headers: { Authorization: token.trim() },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }).catch((cause: unknown) => {
      throw new WbPvzReturnsError(
        cause instanceof Error && cause.name === "TimeoutError"
          ? "WB не ответил за 15 секунд по возвратам покупателей"
          : "Не удалось связаться с API возвратов WB",
        502,
      );
    });

    if (response.status === 429 && attempt === 0) {
      const seconds = Number(response.headers.get("retry-after"));
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(seconds) ? Math.min(5_000, Math.max(500, seconds * 1000)) : 2_100));
      continue;
    }
    if (response.status === 429) throw new WbPvzReturnsError("WB ограничил частоту запросов к возвратам — повторите через минуту", 429);
    if (response.status === 401 || response.status === 403) {
      throw new WbPvzReturnsError("WB-токен не даёт доступа к возвратам покупателей — выдайте токен с категорией «Маркетплейс»", response.status);
    }
    // Пустой список здесь солгал бы, что возвратов нет: молчим только когда WB
    // реально ответил пустотой, а не когда адрес недоступен этому кабинету.
    if (response.status === 404 || response.status === 405) {
      throw new WbPvzReturnsError("WB не отдаёт заявки на возврат по этому адресу — список получить нечем", 502);
    }
    if (!response.ok) throw new WbPvzReturnsError(`WB ${response.status}: ${(await response.text()).slice(0, 240)}`, response.status);
    return await response.json().catch(() => {
      throw new WbPvzReturnsError("WB вернул не JSON по возвратам покупателей", 502);
    });
  }
  throw new WbPvzReturnsError("WB не ответил после повторной попытки", 502);
}

export interface WbReturnClaimsOptions {
  /** true — архив WB (заявки не в работе), false — активные заявки. */
  archived?: boolean;
  /** Сколько строк максимум забрать (постранично по 200). */
  maxRows?: number;
}

/**
 * Заявки покупателей на возврат по кабинету. Ходит постранично, пока WB отдаёт
 * полные страницы или пока не набрано maxRows. `truncated: true` честно говорит,
 * что у WB осталось ещё — вместо тихой обрезки.
 */
export async function fetchWbReturnClaims(
  token: string,
  options: WbReturnClaimsOptions = {},
): Promise<WbReturnClaimsPage & { truncated: boolean }> {
  const archived = options.archived === true;
  const maxRows = Math.max(1, Math.min(2_000, Math.floor(options.maxRows ?? 1_000)));
  const items: WbReturnClaim[] = [];
  let total: number | null = null;

  for (let offset = 0; offset < maxRows; offset += MAX_LIMIT) {
    const limit = Math.min(MAX_LIMIT, maxRows - offset);
    const body = await requestClaims(token, archived, limit, offset);
    const page = extractRows(body);
    if (total === null) total = page.total;
    for (const row of page.rows) items.push(normalizeClaim(row, archived));
    if (page.rows.length < limit) return { items, total, truncated: false };
  }
  return { items, total, truncated: total === null ? true : items.length < total };
}
