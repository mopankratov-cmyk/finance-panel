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
  const s = await getServerSession();
  if (!s) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  if (roles && !roles.includes(s.role)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  return null;
}

/**
 * Машинное чтение: внутренний фан-аут и прогрев кэшей.
 *
 * Прокси уже пускает вызовы с `Bearer CRON_SECRET` (proxy.ts), но роут поверх
 * него требовал куку сессии — которой у крона нет. Из-за этого прогрев
 * «Юнита» и «Журнала РК» возвращал 401 КАЖДЫЙ раз: кэш не наполнялся никогда,
 * и первый заход человека собирал экран с нуля — те самые пять-семь секунд.
 * Прогрев при этом честно писал «не удалось», но выглядело это как случайный
 * сбой, а не как систематическая дыра.
 *
 * Дверь узкая намеренно: только GET и только с тем же секретом, который уже
 * знает прокси. Мутации и любые POST по-прежнему требуют живую сессию.
 */
export function isMachineReadRequest(request: Request): boolean {
  if (request.method !== "GET") return false;
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

/** Сессия — как обычно, но внутреннему прогреву разрешено читать. */
export async function requireApiSessionOrMachine(request: Request, roles?: Role[]): Promise<NextResponse | null> {
  if (isMachineReadRequest(request)) return null;
  return requireApiSession(roles);
}
