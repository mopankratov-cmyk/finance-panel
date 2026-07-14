import { retryAfterMs } from "@/lib/wb/funnelRequest";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface WbStatisticsRequestOptions {
  url: string;
  token: string;
  deadline: number;
  reserveMs?: number;
  fallbackWaitMs?: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** One budget-aware retry for the shared WB statistics global limiter. */
export async function fetchWbStatistics(options: WbStatisticsRequestOptions): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const reserveMs = options.reserveMs ?? 5_000;
  const fallbackWaitMs = options.fallbackWaitMs ?? 2_000;
  const init: RequestInit = {
    headers: { Authorization: options.token },
    cache: "no-store",
  };

  let response = await fetchImpl(options.url, init);
  if (response.status !== 429) return response;

  const waitMs = retryAfterMs(response, fallbackWaitMs, now());
  if (now() + waitMs + reserveMs > options.deadline) return response;
  await sleep(waitMs);
  response = await fetchImpl(options.url, init);
  return response;
}
