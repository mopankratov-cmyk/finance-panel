// Разбор WB API-токена (JWT) и определение доступных категорий (scope).
//
// WB-токен — это один JWT, при создании которого продавец галочками выбирает
// категории доступа (Контент, Статистика, Аналитика, Продвижение, …). Один токен
// с нужными галками работает для всех соответствующих API. Битовую маску scope WB
// официально не раскрывает стабильно, поэтому наличие категории определяем НАДЁЖНО —
// живой read-only пробой каждого хоста этим же токеном (401/403 = нет доступа).

export type WbScope = "statistics" | "analytics" | "advert" | "content" | "prices";

export const WB_SCOPE_LABEL: Record<WbScope, string> = {
  statistics: "Статистика",
  analytics: "Аналитика",
  advert: "Продвижение",
  content: "Контент",
  prices: "Цены и скидки",
};

export interface WbTokenInfo {
  sid?: string; // seller id из payload
  isTest: boolean; // токен песочницы
  expiresAt: string | null; // ISO срок действия
  daysLeft: number | null; // дней до истечения
  isExpired: boolean;
}

// Декод payload JWT без проверки подписи (нам нужны только sid/exp/test).
export function decodeWbToken(token: string): WbTokenInfo {
  const empty: WbTokenInfo = { isTest: false, expiresAt: null, daysLeft: null, isExpired: false };
  try {
    const part = token.trim().split(".")[1];
    if (!part) return empty;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const p = JSON.parse(json) as { sid?: string; exp?: number; t?: boolean };
    const exp = typeof p.exp === "number" ? p.exp * 1000 : null;
    const now = Date.now();
    return {
      sid: p.sid,
      isTest: p.t === true,
      expiresAt: exp ? new Date(exp).toISOString() : null,
      daysLeft: exp ? Math.round((exp - now) / 86_400_000) : null,
      isExpired: exp ? exp < now : false,
    };
  } catch {
    return empty;
  }
}

// Один read-only зонд на категорию. 401/403 → доступа нет. Прочее (200/400/429) → есть.
interface Probe { url: string; method: "GET" | "POST"; body?: string; fallback?: Probe }

const PROBES: Record<WbScope, Probe> = {
  statistics: {
    url: "https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=2026-01-01&flag=1",
    method: "GET",
  },
  analytics: {
    // канонический analytics-эндпоинт (воронка продаж) — его даёт галка «Аналитика».
    // запасной — search-texts: если WB выдал права через него, тоже считаем «Аналитика есть».
    url: "https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products/history",
    method: "POST",
    body: "{}",
    fallback: {
      url: "https://seller-analytics-api.wildberries.ru/api/v2/search-report/product/search-texts",
      method: "POST",
      body: "{}",
    },
  },
  advert: {
    url: "https://advert-api.wildberries.ru/adv/v1/promotion/count",
    method: "GET",
  },
  content: {
    url: "https://content-api.wildberries.ru/content/v2/get/cards/list",
    method: "POST",
    body: '{"settings":{"cursor":{"limit":1},"filter":{"withPhoto":-1}}}',
  },
  prices: {
    // «Цены и скидки» — read-only список товаров с ценами
    url: "https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1",
    method: "GET",
  },
};

// null = не удалось проверить (сеть), true/false = категория доступна/нет.
export type ScopeStatus = Record<WbScope, boolean | null>;

// один HTTP-зонд: false = 401/403, true = принят (200/400/429/5xx), null = сеть
async function hitProbe(token: string, p: Probe): Promise<boolean | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(p.url, {
      method: p.method,
      headers: { Authorization: token.trim(), "Content-Type": "application/json" },
      body: p.method === "POST" ? p.body : undefined,
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (res.status === 401 || res.status === 403) return false;
    return true;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function probeWbScope(token: string, scope: WbScope): Promise<boolean | null> {
  const p = PROBES[scope];
  const primary = await hitProbe(token, p);
  // доступ подтверждён напрямую
  if (primary === true) return true;
  // основной отказал/не достучались — пробуем запасной эндпоинт категории
  if (p.fallback) {
    const fb = await hitProbe(token, p.fallback);
    if (fb === true) return true;
    if (primary === false || fb === false) return false;
    return null; // оба не достучались
  }
  return primary;
}

// Проверить все категории параллельно.
export async function probeWbScopes(token: string): Promise<ScopeStatus> {
  const scopes: WbScope[] = ["statistics", "analytics", "advert", "content", "prices"];
  const results = await Promise.all(scopes.map((s) => probeWbScope(token, s)));
  return Object.fromEntries(scopes.map((s, i) => [s, results[i]])) as ScopeStatus;
}
