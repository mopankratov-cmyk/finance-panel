import { DEMO_MODE_ENABLED } from "./demoMode";
import { NextResponse } from "next/server";
import { getServerSession } from "./server";
import type { Role } from "./session";

// Защита на уровне роута (defense-in-depth поверх гейта в proxy.ts).
// Док Next прямо предупреждает: «verify authentication inside each handler, not proxy alone» —
// рефактор matcher'а или перенос роута может молча снять покрытие прокси. Поэтому самые
// чувствительные (деньги/мутации) роуты дополнительно проверяют сессию у себя.
//
// Возвращает NextResponse (401/403) для короткого замыкания, либо null если пускаем дальше.
export async function requireApiSession(roles?: Role[]): Promise<NextResponse | null> {
  if (DEMO_MODE_ENABLED) return null;
  const s = await getServerSession();
  if (!s) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  if (roles && !roles.includes(s.role)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  return null;
}
