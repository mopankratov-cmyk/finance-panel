import { NextResponse } from "next/server";
import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { probeWbScopes, decodeWbToken } from "@/lib/wb/token";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Диагностика: перепроверяет доступ (scope) каждого активного WB-кабинета
// живой пробой токена. Токены не возвращаются — только имя/sid + флаги.
export async function GET() {
  const cabs = await getActiveWbCabinets();
  const cabinets = await Promise.all(
    cabs.map(async (c) => {
      const scopes = await probeWbScopes(c.token);
      const info = decodeWbToken(c.token);
      const missing = (["statistics", "analytics", "advert", "content"] as const).filter((s) => scopes[s] === false);
      return { name: c.name, seller_id: c.seller_id, scopes, missing, daysLeft: info.daysLeft };
    }),
  );
  return NextResponse.json({ cabinets });
}
