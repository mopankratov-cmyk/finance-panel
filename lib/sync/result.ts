export type SyncPayload = Record<string, unknown>;

export function asSyncPayload(value: unknown): SyncPayload {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as SyncPayload
    : {};
}

export function syncPayloadOk(httpOk: boolean, payload: unknown): boolean {
  const body = asSyncPayload(payload);
  return httpOk && body.ok !== false && !body.error;
}

export function syncErrorMessage(payload: unknown, fallback = "Ошибка синхронизации"): string {
  const body = asSyncPayload(payload);
  if (typeof body.error === "string" && body.error) return body.error;
  if (Array.isArray(body.errors)) {
    const errors = body.errors.filter((value): value is string => typeof value === "string" && !!value);
    if (errors.length) return errors.join("; ");
  }
  if (body.result) {
    const nested = syncErrorMessage(body.result, "");
    if (nested) return nested;
  }
  if (body.results && typeof body.results === "object") {
    for (const [job, result] of Object.entries(body.results)) {
      const nested = syncErrorMessage(result, "");
      if (nested) return `${job}: ${nested}`;
    }
  }
  return fallback;
}
