import { cookies } from "next/headers";
import { getServerSession } from "./server";
import { SESSION_COOKIE } from "./session";
import type { Session } from "./session";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isCabinetScopedRole } from "@/lib/auth/roles";

// Пустой cabinet_ids у менеджера исторически означает «все кабинеты».
// Непустой список — жёсткое ограничение. В таком режиме агрегат "all" запрещён,
// потому что текущие RPC не умеют агрегировать только разрешённое подмножество.
export function sessionHasCabinetAccess(
  session: Pick<Session, "role" | "cabinet_ids"> | null,
  cabinetId: string | null,
): boolean {
  if (!session) return true; // cron и локальная разработка уже проверяются в proxy.
  if (session.role === "seller") {
    // Для внешнего селлера пустой список всегда означает «нет кабинетов»,
    // а агрегаты all/group запрещены: они не должны пересечь tenant-границу.
    return cabinetId !== null
      && cabinetId !== "all"
      && !cabinetId.startsWith("group:")
      && session.cabinet_ids.includes(cabinetId);
  }
  if (!isCabinetScopedRole(session.role) || session.cabinet_ids.length === 0) return true;
  return cabinetId !== null && session.cabinet_ids.includes(cabinetId);
}

/**
 * Отсутствие сессии значит РАЗНОЕ, и раньше эти два случая были смешаны.
 *
 * «Куки нет вовсе» — это машинный вызов: прогрев и cron проходят гейт по
 * Bearer-секрету, и кабинет им открыт намеренно. А вот «кука есть, но сессия не
 * подтвердилась» — это человек, которого база не признала: учётку отключили,
 * пользователя удалили, чтение app_users упало. Подписанная кука живёт семь
 * дней и гейт прокси проходит, поэтому уволенный сотрудник ещё неделю видел
 * любой кабинет на всех роутах, где нет собственной проверки сессии.
 */
async function looksLikeMachineCall(): Promise<boolean> {
  const jar = await cookies();
  return !jar.get(SESSION_COOKIE)?.value;
}

export async function hasCabinetAccess(cabinetId: string | null): Promise<boolean> {
  const session = await getServerSession();
  if (!session && !(await looksLikeMachineCall())) return false;
  if (!sessionHasCabinetAccess(session, cabinetId)) return false;
  if (!session || session.role !== "seller") return true;
  if (!cabinetId || !session.organization_id) return false;
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { data, error } = await db
    .from("wb_cabinets")
    .select("organization_id")
    .eq("id", cabinetId)
    .eq("marketplace", "wb")
    .maybeSingle();
  return !error && String(data?.organization_id ?? "") === session.organization_id;
}
