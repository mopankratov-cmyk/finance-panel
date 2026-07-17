export type SyncPayload = Record<string, unknown>;

export function asSyncPayload(value: unknown): SyncPayload {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as SyncPayload
    : {};
}

export function syncPayloadOk(httpOk: boolean, payload: unknown): boolean {
  const body = asSyncPayload(payload);
  return httpOk && body.ok !== false && !body.error && !hasErrorList(body);
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

export function syncDeferredMessage(payload: unknown): string | null {
  const body = asSyncPayload(payload);
  const candidates = [body, asSyncPayload(body.result)];

  for (const candidate of candidates) {
    const rotated = Array.isArray(candidate.rotated)
      ? candidate.rotated.filter((value): value is string => typeof value === "string" && !!value)
      : [];
    const alreadyRunning = rotated.filter((value) => value.includes("уже выполняется"));
    if (alreadyRunning.length) {
      return `Синхронизация уже выполняется: ${alreadyRunning.join(" · ")}. Повторите через несколько минут — блокировка снимется автоматически.`;
    }

    const progress = Array.isArray(candidate.progress) ? candidate.progress : [];
    const rateLimited = progress.some((value) => asSyncPayload(value).status === "rate_limited");
    if (rateLimited) {
      return "WB временно ограничил частоту запросов. Данные автоматически продолжат догружаться в следующем цикле.";
    }
  }

  return null;
}

function hasErrorList(body: SyncPayload): boolean {
  return Array.isArray(body.errors) && body.errors.some((value) => typeof value === "string" && !!value);
}
