import { isWbGlobalRateLimitMessage } from "@/lib/wb/rateLimit";

export interface WbSyncHealthStatusInput {
  sourceError?: string | null;
  progressStatus?: string | null;
  stateLastError?: string | null;
  stale: boolean;
  hasLastSyncedAt: boolean;
}

export function wbSyncHealthStatus(input: WbSyncHealthStatusInput): { status: string; lastError: string | null } {
  const deferredRateLimit = isWbGlobalRateLimitMessage(input.stateLastError);
  const lastError = input.sourceError ?? (deferredRateLimit ? null : input.stateLastError ?? null);
  const status = input.sourceError
    ? "error"
    : deferredRateLimit
      ? "running"
      : input.progressStatus === "error"
        ? "error"
        : input.progressStatus === "running" || input.progressStatus === "pending" || input.progressStatus === "backfill"
          ? input.progressStatus
          : input.stale
            ? "stale"
            : input.hasLastSyncedAt ? "caught_up" : "pending";
  return { status, lastError };
}
