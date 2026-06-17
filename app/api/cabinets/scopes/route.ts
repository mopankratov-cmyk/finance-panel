import { NextResponse } from "next/server";
import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { probeWbScope, probeWbScopes, decodeWbToken, WB_SCOPE_LABEL, type WbScope } from "@/lib/wb/token";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Диагностика: перепроверяет доступ (scope) каждого активного WB-кабинета
// живой пробой токена. Токены не возвращаются — только имя/sid + флаги.
export async function GET() {
  const cabs = await getActiveWbCabinets();
  const cabinets = await Promise.all(
    cabs.map(async (c) => {
      const scopes = await probeWbScopes(c.token);
      // реклама/контент могут жить в отдельных токенах — добираем
      if (!scopes.advert && c.token_advert) scopes.advert = await probeWbScope(c.token_advert, "advert");
      if (!scopes.content && c.token_content) scopes.content = await probeWbScope(c.token_content, "content");
      const info = decodeWbToken(c.token);
      const missing = (Object.keys(scopes) as WbScope[])
        .filter((s) => scopes[s] === false)
        .map((s) => WB_SCOPE_LABEL[s]);
      return { name: c.name, seller_id: c.seller_id, scopes, missing, daysLeft: info.daysLeft, isExpired: info.isExpired };
    }),
  );
  return NextResponse.json({ labels: WB_SCOPE_LABEL, cabinets });
}
