import bcrypt from "bcryptjs";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { Role } from "./session";

export interface AppUser {
  id: string;
  email: string;
  role: Role;
  cabinet_ids: string[];
  is_active: boolean;
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function countUsers(): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db) return 0;
  const { count } = await db.from("app_users").select("id", { count: "exact", head: true });
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
  if (total === 0) {
    const password_hash = await hashPassword(password);
    const { data, error } = await db
      .from("app_users")
      .insert({ email, password_hash, role: "director", cabinet_ids: [], is_active: true })
      .select("id, email, role, cabinet_ids, is_active").single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, user: data as AppUser };
  }

  const { data: u } = await db
    .from("app_users")
    .select("id, email, role, cabinet_ids, is_active, password_hash")
    .eq("email", email).maybeSingle();
  if (!u || !u.is_active) return { ok: false, error: "Неверный email или пароль" };
  const match = await bcrypt.compare(password, u.password_hash as string);
  if (!match) return { ok: false, error: "Неверный email или пароль" };
  return { ok: true, user: { id: u.id, email: u.email, role: u.role, cabinet_ids: u.cabinet_ids ?? [], is_active: u.is_active } as AppUser };
}
