import { cache } from "react";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession, type Session } from "./session";
import { isRole } from "./permissions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Каждая проверка доступа перечитывала пользователя из БД: на экране склада, где
// прав спрашивают по каждому юрлицу и кабинету, набегал десяток лишних запросов.
// cache() из React запоминает результат на время одного HTTP-запроса — отзыв доступа
// по-прежнему применяется сразу, потому что следующий запрос читает заново.
export const getServerSession = cache(async function getServerSession(): Promise<Session | null> {
  const c = await cookies();
  const signed = await verifySession(c.get(SESSION_COOKIE)?.value);
  if (!signed) return null;

  // Proxy делает быстрый optimistic-check по подписанной cookie. Рядом с данными
  // перечитываем пользователя из БД, чтобы отзыв доступа/кабинета применялся
  // сразу, а не после окончания семидневной сессии.
  const db = getSupabaseAdmin();
  if (!db || !signed.uid) return signed;
  const primary = await db
    .from("app_users")
    .select("id,email,role,roles,modules,cabinet_ids,organization_id,is_active")
    .eq("id", signed.uid)
    .maybeSingle();
  let data = primary.data as Record<string, unknown> | null;
  let error = primary.error;
  // Во время безопасной выкладки код может попасть в Vercel на несколько минут
  // раньше tenant-миграции. Старые внутренние сессии продолжают работать, но
  // роль seller остаётся недоступной до появления organization_id.
  if (error?.code === "42703") {
    const legacy = await db
      .from("app_users")
      .select("id,email,role,cabinet_ids,is_active")
      .eq("id", signed.uid)
      .maybeSingle();
    data = legacy.data ? { ...legacy.data, organization_id: null, roles: null, modules: null } : null;
    error = legacy.error;
  }
  if (error || !data?.is_active) return null;
  /**
   * Роль сверяется со СЛОВАРЁМ, а не со списком, написанным здесь.
   *
   * Список тут уже стоял, и он уже подводил: оператора склада в нём не было,
   * и модуль склада был для этой роли мёртв целиком — страницу человек
   * открывал (гейт верит подписанной куке), а любой запрос к данным отвечал
   * «Требуется вход». Тогда в список дописали одну роль; сегодня, после
   * разделения ролей, он отстал снова и точно так же выключил менеджера WB —
   * первого же живого сотрудника, заведённого по новому ТЗ.
   *
   * Список ролей в панели должен быть один. Здесь — проверка по нему.
   */
  if (!isRole(data.role)) return null;
  const roles = Array.isArray(data.roles) ? (data.roles as unknown[]).filter(isRole) : [];
  return {
    uid: String(data.id),
    email: String(data.email),
    role: data.role,
    // Список ролей и модули обязаны пережить перечитывание из базы. Иначе
    // многоролевость и модули внешнего контура работали бы только до первого
    // обращения к данным: гейт видел бы их из куки, а роут — уже нет.
    roles: roles.length ? roles : undefined,
    modules: Array.isArray(data.modules) ? (data.modules as unknown[]).map(String) : undefined,
    cabinet_ids: Array.isArray(data.cabinet_ids) ? data.cabinet_ids.map(String) : [],
    organization_id: typeof data.organization_id === "string" ? data.organization_id : null,
  };
})
