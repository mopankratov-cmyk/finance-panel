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
  const body = await response.json() as { error?: string } & T;
  if (!response.ok) throw new OzonHttpResponseError(body.error || `Ozon ${response.status}`);
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
