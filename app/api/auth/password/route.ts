import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { hashPassword } from "@/lib/auth/users";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * Смена собственного пароля.
 *
 * Экран «Команда кабинета» обещал: «сотрудник сможет сменить его после входа»,
 * а сменить было негде — пароль, который завёл админ, оставался у него навсегда.
 * Меняем ТОЛЬКО свой и только зная текущий: без этого любая утёкшая сессия
 * закрывала бы человеку доступ к его же учётке.
 */
const MIN_LENGTH = 10;

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const session = await getServerSession();
  if (!session?.uid) return NextResponse.json({ ok: false, error: "Требуется вход" }, { status: 401 });

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Сервис данных временно недоступен" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { currentPassword?: string; newPassword?: string } | null;
  const currentPassword = String(body?.currentPassword ?? "");
  const newPassword = String(body?.newPassword ?? "");
  if (!currentPassword || newPassword.length < MIN_LENGTH) {
    return NextResponse.json(
      { ok: false, error: `Нужен текущий пароль и новый не короче ${MIN_LENGTH} символов` },
      { status: 400 },
    );
  }
  if (newPassword === currentPassword) {
    return NextResponse.json({ ok: false, error: "Новый пароль совпадает с текущим" }, { status: 400 });
  }

  const { data, error } = await db
    .from("app_users")
    .select("id, password_hash, is_active")
    .eq("id", session.uid)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: "Не удалось проверить пароль" }, { status: 502 });
  // Учётки нет или она отключена — менять нечего, но и подсказывать, что
  // именно не так, незачем.
  if (!data?.is_active || !data.password_hash) {
    return NextResponse.json({ ok: false, error: "Текущий пароль не подошёл" }, { status: 403 });
  }
  if (!(await bcrypt.compare(currentPassword, String(data.password_hash)))) {
    return NextResponse.json({ ok: false, error: "Текущий пароль не подошёл" }, { status: 403 });
  }

  const password_hash = await hashPassword(newPassword);
  const updated = await db.from("app_users").update({ password_hash }).eq("id", session.uid);
  if (updated.error) return NextResponse.json({ ok: false, error: "Не удалось сохранить пароль" }, { status: 502 });
  return NextResponse.json({ ok: true });
}
