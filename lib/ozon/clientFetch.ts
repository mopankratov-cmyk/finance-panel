interface OzonFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export type OzonFetch = (
  input: string,
  init: { cache: "no-store"; signal: AbortSignal },
) => Promise<OzonFetchResponse>;

class OzonHttpResponseError extends Error {}

async function loadOnce<T>(url: string, signal: AbortSignal, request: OzonFetch) {
  const response = await request(url, { cache: "no-store", signal });
  // Разбирать тело до проверки статуса нельзя: 504 и страницы ошибок Vercel
  // приходят HTML-ом, и человек видел «Unexpected token <» вместо причины.
  let body: ({ error?: string } & T) | null = null;
  let parseError: unknown = null;
  try {
    body = await response.json() as { error?: string } & T;
  } catch (cause) {
    parseError = cause;
  }
  if (!response.ok) {
    throw new OzonHttpResponseError(
      body?.error
        || (response.status === 504 ? "Ozon не ответил вовремя — попробуйте ещё раз" : `Ozon ответил ${response.status}`),
    );
  }
  if (!body) throw new OzonHttpResponseError(`Ответ не разобран: ${String(parseError).slice(0, 80)}`);
  return body as T;
}

/** Repeats only a transport failure. HTTP errors are already authoritative. */
export async function fetchOzonCockpitJson<T>(
  url: string,
  signal: AbortSignal,
  request: OzonFetch = fetch,
) {
  try {
    return await loadOnce<T>(url, signal, request);
  } catch (error) {
    if (signal.aborted || error instanceof OzonHttpResponseError) throw error;
    return loadOnce<T>(url, signal, request);
  }
}
