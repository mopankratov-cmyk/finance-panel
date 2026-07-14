import { NextRequest, NextResponse } from "next/server";

import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getActiveWbCabinets, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { decodeWbToken, probeWbScope, WB_SCOPE_LABEL, type WbScope } from "@/lib/wb/token";

export const maxDuration = 60;

const SCOPES: WbScope[] = ["statistics", "analytics", "advert", "content", "prices", "feedbacks"];

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const cabinets = await getActiveWbCabinets();
  const rows = (await Promise.all(cabinets.map(async (cabinet) => Promise.all(SCOPES.map(async (scope) => {
    const token = resolveWbToken(cabinet, scope);
    const info = decodeWbToken(token);
    let available: boolean | null = null;
    let lastError: string | null = null;
    try {
      available = await probeWbScope(token, scope);
      if (available === null) lastError = "Не удалось проверить доступность WB API";
      else if (!available) lastError = `Нет категории «${WB_SCOPE_LABEL[scope]}»`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Ошибка проверки WB API";
    }
    return {
      cabinet_id: cabinet.id,
      scope,
      available,
      expires_at: info.expiresAt,
      days_left: info.daysLeft,
      checked_at: new Date().toISOString(),
      last_error: lastError,
    };
  }))))).flat();

  const upsertError = rows.length ? await chunkedUpsert("wb_token_health", rows, "cabinet_id,scope") : null;
  const networkErrors = rows.filter((row) => row.available === null).length;
  const missingScopes = rows.filter((row) => row.available === false).length;
  const ok = !upsertError && networkErrors === 0;
  await writeSyncLog("token-health", ok ? "ok" : "error", rows.length, upsertError || (networkErrors ? `Не проверено категорий: ${networkErrors}` : null), startedAt);
  return NextResponse.json({ ok, cabinets: cabinets.length, checked: rows.length, missingScopes, networkErrors, error: upsertError }, { status: ok ? 200 : 502 });
}
