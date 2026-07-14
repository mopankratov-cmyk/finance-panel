type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface FunnelHistoryRequestOptions {
  url: string;
  token: string;
  body: string;
  deadline: number;
  reserveMs: number;
  fallbackWaitMs: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function retryAfterMs(response: Response, fallbackMs: number, nowMs = Date.now()) {
  const raw = response.headers.get("retry-after");
  const seconds = raw ? Number(raw) : Number.NaN;
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const retryAt = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - nowMs) : fallbackMs;
}

export async function fetchWbFunnelHistory(options: FunnelHistoryRequestOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const init: RequestInit = {
    method: "POST",
    headers: { Authorization: options.token, "Content-Type": "application/json" },
    body: options.body,
    cache: "no-store",
  };
  let response = await fetchImpl(options.url, init);
  if (response.status !== 429) return response;

  const waitMs = retryAfterMs(response, options.fallbackWaitMs, now());
  if (now() + waitMs + options.reserveMs > options.deadline) return response;
  await sleep(waitMs);
  response = await fetchImpl(options.url, init);
  return response;
}
