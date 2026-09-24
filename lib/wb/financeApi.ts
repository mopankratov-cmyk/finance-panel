export interface WbAccountBalance {
  currency: string;
  current: number;
  forWithdraw: number;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Баланс из виджета «Главная» кабинета WB. Лимит метода — один запрос в минуту. */
export async function fetchWbAccountBalance(
  token: string,
  options: { fetchImpl?: FetchLike; retries?: number } = {},
): Promise<WbAccountBalance> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 2;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl("https://finance-api.wildberries.ru/api/v1/account/balance", {
      headers: { Authorization: token },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 429 && attempt < retries) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await delay(Number.isFinite(retryAfter) ? Math.min(30_000, retryAfter * 1_000) : 5_000 * (attempt + 1));
      continue;
    }
    if (!response.ok) throw new Error(`WB Finance ${response.status}: ${(await response.text()).slice(0, 160)}`);
    const body = await response.json() as { currency?: unknown; current?: unknown; for_withdraw?: unknown };
    const current = Number(body.current);
    const forWithdraw = Number(body.for_withdraw);
    if (!Number.isFinite(current) || !Number.isFinite(forWithdraw)) throw new Error("WB Finance вернул баланс в неизвестном формате");
    return { currency: String(body.currency || "RUB"), current, forWithdraw };
  }
}
