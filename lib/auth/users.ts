import bcrypt from "bcryptjs";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { Role } from "./session";

export interface AppUser {
  id: string;
  email: string;
  role: Role;
  cabinet_ids: string[];
  organization_id: string | null;
  is_active: boolean;
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

/**
 * Сколько всего заведено пользователей. `null` — «не знаем»: база не ответила.
 *
 * Раньше ошибка чтения молча превращалась в ноль, а ноль означает «панель
 * пустая, первый вход создаёт директора». То есть на любой сбой Supabase
 * форма входа открывала бутстрап: кто угодно вводил любую почту с паролем
 * подлиннее и становился директором рядом с настоящими пользователями.
 * Незнание и пустоту здесь смешивать нельзя.
 */
export async function countUsers(): Promise<number | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { count, error } = await db.from("app_users").select("id", { count: "exact", head: true });
  if (error) return null;
  return count ?? 0;
}

// Аутентификация. Если пользователей НЕТ — первый вход создаёт директора (бутстрап).
export async function authenticate(
  email: string, password: string,
): Promise<{ ok: true; user: AppUser } | { ok: false; error: string }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Supabase не настроен" };
  email = email.trim().toLowerCase();
  if (!email || !password) return { ok: false, error: "Укажите email и пароль" };

  const total = await countUsers();
  // Бутстрап — только при ПОДТВЕРЖДЁННОМ нуле. При «не знаем» вход не пускаем.
  if (total === null) return { ok: false, error: "Не удалось проверить учётные записи, попробуйте позже" };
  if (total === 0) {
    if (password.length < 10) return { ok: false, error: "Пароль должен содержать не менее 10 символов" };
    const password_hash = await hashPassword(password);
    let organization = await db.from("organizations").select("id").eq("kind", "internal").order("created_at").limit(1).maybeSingle();
    if (organization.error) return { ok: false, error: organization.error.message };
    if (!organization.data) {
      organization = await db.from("organizations").insert({ name: "Finance Panel", kind: "internal" }).select("id").single();
      if (organization.error || !organization.data) return { ok: false, error: organization.error?.message ?? "Не удалось создать организацию" };
    }
    const { data, error } = await db
      .from("app_users")
      .insert({ email, password_hash, role: "director", cabinet_ids: [], organization_id: organization.data.id, is_active: true })
      .select("id, email, role, cabinet_ids, organization_id, is_active").single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, user: data as AppUser };
  }

  const primary = await db
    .from("app_users")
    .select("id, email, role, cabinet_ids, organization_id, is_active, password_hash")
    .eq("email", email).maybeSingle();
  let u = primary.data as Record<string, unknown> | null;
  if (primary.error?.code === "42703") {
    const legacy = await db
      .from("app_users")
      .select("id, email, role, cabinet_ids, is_active, password_hash")
      .eq("email", email)
      .maybeSingle();
    if (legacy.error) return { ok: false, error: legacy.error.message };
    u = legacy.data ? { ...legacy.data, organization_id: null } : null;
  } else if (primary.error) {
    return { ok: false, error: primary.error.message };
  }
  if (!u || !u.is_active) return { ok: false, error: "Неверный email или пароль" };
  const match = await bcrypt.compare(password, u.password_hash as string);
  if (!match) return { ok: false, error: "Неверный email или пароль" };
  return { ok: true, user: { id: u.id, email: u.email, role: u.role, cabinet_ids: u.cabinet_ids ?? [], organization_id: u.organization_id ?? null, is_active: u.is_active } as AppUser };
}
