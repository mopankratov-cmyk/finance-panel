import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession, type Session } from "./session";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function getServerSession(): Promise<Session | null> {
  const c = await cookies();
  const signed = await verifySession(c.get(SESSION_COOKIE)?.value);
  if (!signed) return null;

  // Proxy делает быстрый optimistic-check по подписанной cookie. Рядом с данными
  // перечитываем пользователя из БД, чтобы отзыв доступа/кабинета применялся
  // сразу, а не после окончания семидневной сессии.
  const db = getSupabaseAdmin();
  if (!db || !signed.uid) return signed;
  const { data, error } = await db
    .from("app_users")
    .select("id,email,role,cabinet_ids,organization_id,is_active")
    .eq("id", signed.uid)
    .maybeSingle();
  if (error || !data?.is_active) return null;
  if (!["director", "finance", "manager", "seller"].includes(String(data.role))) return null;
  return {
    uid: String(data.id),
    email: String(data.email),
    role: data.role as Session["role"],
    cabinet_ids: Array.isArray(data.cabinet_ids) ? data.cabinet_ids.map(String) : [],
    organization_id: typeof data.organization_id === "string" ? data.organization_id : null,
  };
}
