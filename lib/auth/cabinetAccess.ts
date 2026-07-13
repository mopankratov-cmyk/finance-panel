import { getServerSession } from "./server";
import type { Session } from "./session";

// Пустой cabinet_ids у менеджера исторически означает «все кабинеты».
// Непустой список — жёсткое ограничение. В таком режиме агрегат "all" запрещён,
// потому что текущие RPC не умеют агрегировать только разрешённое подмножество.
export function sessionHasCabinetAccess(
  session: Pick<Session, "role" | "cabinet_ids"> | null,
  cabinetId: string | null,
): boolean {
  if (!session) return true; // cron и локальная разработка уже проверяются в proxy.
  if (session.role !== "manager" || session.cabinet_ids.length === 0) return true;
  return cabinetId !== null && session.cabinet_ids.includes(cabinetId);
}

export async function hasCabinetAccess(cabinetId: string | null): Promise<boolean> {
  return sessionHasCabinetAccess(await getServerSession(), cabinetId);
}
