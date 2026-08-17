import { NextRequest, NextResponse } from "next/server";

import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getActiveWbCabinets, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { decodeWbToken, probeWbScope, WB_SCOPE_LABEL, type WbScope } from "@/lib/wb/token";

export const maxDuration = 60;

// marketplace — для честного сплита ФБО/ФБС: warehouseType в статистике схему
// не отражает, прямой факт — FBS-заказы Marketplace API.
const SCOPES: WbScope[] = ["statistics", "marketplace", "analytics", "advert", "content", "prices", "feedbacks"];

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
  const ok = !upsertError && networkErrors === 0 && missingScopes === 0;
  const logError = upsertError
    || (networkErrors ? `Не проверено категорий: ${networkErrors}` : null)
    || (missingScopes ? `Нет доступа к категориям WB API: ${missingScopes}` : null);
  await writeSyncLog("token-health", ok ? "ok" : "error", rows.length, logError, startedAt);
  return NextResponse.json({ ok, cabinets: cabinets.length, checked: rows.length, missingScopes, networkErrors, error: upsertError }, { status: ok ? 200 : 502 });
}
