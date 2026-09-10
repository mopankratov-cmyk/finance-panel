import { SignJWT, jwtVerify } from "jose";

// Роль и её права живут в одном месте — lib/auth/permissions.ts. Здесь только
// перевывоз, чтобы старые импорты `from "@/lib/auth/session"` не переписывать:
// словарь ролей обязан быть один, иначе матрица прав и проверка сессии
// разойдутся молча.
export type { Role } from "./permissions";
import type { Role } from "./permissions";
import { isRole } from "./permissions";
export interface Session {
  uid: string;
  email: string;
  /**
   * Основная роль. Осталась обязательной ради уже выданных кук: подписанная
   * сессия живёт неделю, и человек с прежним токеном не должен вылететь.
   */
  role: Role;
  /**
   * Все роли сотрудника. Пусто у старых кук — тогда действует одна `role`.
   * Читать ЭТО поле, а не `role`: решение владельца — один человек может
   * вести и WB, и Ozon, получив обе роли.
   */
  roles?: Role[];
  /**
   * Модули внешнего контура: wb, ozon, warehouse. Пусто — все три.
   * У внутренних ролей поле не используется: их ограничивают роль и карта
   * прав, а третьей оси ТЗ для них не просило.
   */
  modules?: string[];
  cabinet_ids: string[];
  organization_id: string | null;
}

/**
 * Роли сессии — всегда списком.
 *
 * Единственная точка, где «одна роль» и «несколько» сводятся вместе. Пока
 * такой точки не было, каждое место решало само, и часть кода смотрела бы
 * только на первую роль, молча отнимая права второй.
 */
export function sessionRoles(session: Pick<Session, "role" | "roles"> | null | undefined): Role[] {
  if (!session) return [];
  const list = session.roles?.length ? session.roles : [session.role];
  return list.filter((role): role is Role => typeof role === "string" && role.length > 0);
}

export const SESSION_COOKIE = "fp_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 дней

function secret(): Uint8Array {
  const configured = process.env.AUTH_SECRET;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET обязателен в production");
  }
  const s = configured || "dev-insecure-secret-change-me-finance-panel";
  return new TextEncoder().encode(s);
}

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.email || !isRole(payload.role)) return null;
    // Список ролей обязан доехать до гейта: без него многоролевость мертва —
    // проверка увидит одну роль там, где сотруднику выдали две.
    const roles = Array.isArray(payload.roles)
      ? (payload.roles as unknown[]).filter((role): role is Role => isRole(role))
      : [];
    return {
      uid: String(payload.uid ?? ""),
      email: String(payload.email),
      role: payload.role,
      roles: roles.length ? roles : undefined,
      modules: Array.isArray(payload.modules) ? (payload.modules as unknown[]).map(String) : undefined,
      cabinet_ids: Array.isArray(payload.cabinet_ids) ? (payload.cabinet_ids as string[]) : [],
      organization_id: typeof payload.organization_id === "string" && payload.organization_id
        ? payload.organization_id
        : null,
    };
  } catch {
    return null;
  }
}

// Проверка роли живёт в словаре, а не здесь.
//
// Своя копия списка тут была, и она отстала при разделении ролей: verifySession
// сверял роль с перечнем «finance | manager | …» и на любой НОВОЙ роли —
// финдиректор, финансист, HR, закупщик, менеджер WB, главный внешний — возвращал
// null. Для гейта это значит «человек не залогинен»: такой сотрудник не смог бы
// войти вовсе, а в проде уехал бы на /login по кругу. Компилятор молчал —
// сравнение строк, не тип. Второго словаря ролей в панели быть не должно.
export { isRole } from "./permissions";

export const sessionCookieOptions = {
  httpOnly: true as const,
  secure: true as const,
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE,
};
