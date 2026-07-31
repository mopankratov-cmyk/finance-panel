import { getServerSession } from "./server";
import type { Session } from "./session";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

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
  if (session.role !== "manager" || session.cabinet_ids.length === 0) return true;
  return cabinetId !== null && session.cabinet_ids.includes(cabinetId);
}

export async function hasCabinetAccess(cabinetId: string | null): Promise<boolean> {
  const session = await getServerSession();
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
