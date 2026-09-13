import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { hashPassword } from "@/lib/auth/users";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit/log";

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

/**
 * Лимит попыток на ТЕКУЩИЙ пароль (аудит P2).
 *
 * Кука сессии живёт неделю и не привязана к IP: украденная (XSS, забытый
 * открытым чужой браузер) кука без предела попыток превращала этот роут в
 * подборщик пароля — атакующему не нужно ничего, кроме куки и терпения.
 * Таблица password_attempt_failures (миграция 202609130006) — счётчик на
 * пользователя, без внешней инфры (Redis тут нет и не нужен для разовой
 * проверки при смене пароля).
 */
const RATE_LIMIT_TABLE = "password_attempt_failures";
const RATE_LIMIT_MAX_FAILURES = 5;
const RATE_LIMIT_LOCK_MS = 15 * 60 * 1000;

/** Таблица ещё не создана (миграция не применена) — деградируем без лимита, а не падаем. */
function isRateLimitStoreMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "42P01") return true;
  return /relation .*password_attempt_failures.* does not exist/i.test(error.message ?? "");
}

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

  // Лимит попыток проверяется ДО bcrypt.compare: заблокированная сессия не
  // должна получать даже ещё одну попытку сравнения с хешем.
  const attempts = await db.from(RATE_LIMIT_TABLE).select("failed_count, locked_until").eq("uid", session.uid).maybeSingle();
  const rateLimitAvailable = !isRateLimitStoreMissing(attempts.error);
  if (attempts.error && rateLimitAvailable) {
    // Реальная ошибка базы (не «таблицы ещё нет») — не блокируем смену
    // пароля из-за неё, но и не считаем лимит доступным на этот запрос.
    console.error("[auth/password] не удалось прочитать счётчик попыток", attempts.error.message);
  }
  const lockedUntil = attempts.data?.locked_until ? new Date(attempts.data.locked_until).getTime() : 0;
  if (rateLimitAvailable && !attempts.error && lockedUntil > Date.now()) {
    return NextResponse.json(
      { ok: false, error: "Слишком много неверных попыток. Попробуйте через 15 минут." },
      { status: 429 },
    );
  }

  if (!(await bcrypt.compare(currentPassword, String(data.password_hash)))) {
    if (rateLimitAvailable && !attempts.error) {
      const failedCount = (attempts.data?.failed_count ?? 0) + 1;
      const locked = failedCount >= RATE_LIMIT_MAX_FAILURES;
      const bump = await db.from(RATE_LIMIT_TABLE).upsert(
        {
          uid: session.uid,
          failed_count: failedCount,
          locked_until: locked ? new Date(Date.now() + RATE_LIMIT_LOCK_MS).toISOString() : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "uid" },
      );
      if (bump.error && !isRateLimitStoreMissing(bump.error)) {
        console.error("[auth/password] не удалось записать неудачную попытку", bump.error.message);
      }
    }
    return NextResponse.json({ ok: false, error: "Текущий пароль не подошёл" }, { status: 403 });
  }

  const password_hash = await hashPassword(newPassword);
  // password_changed_at отзывает уже выданные сессии (см. getServerSession):
  // без него смена пароля не мешала утёкшей куке работать ещё неделю.
  let updated = await db.from("app_users").update({ password_hash, password_changed_at: new Date().toISOString() }).eq("id", session.uid);
  if (updated.error?.code === "42703") {
    // Миграция 202609130003_app_users_password_changed_at ещё не применена.
    updated = await db.from("app_users").update({ password_hash }).eq("id", session.uid);
  }
  if (updated.error) return NextResponse.json({ ok: false, error: "Не удалось сохранить пароль" }, { status: 502 });

  // Успех сбрасывает счётчик: владелец пароля не должен упереться в чужую
  // блокировку, накопленную до того, как он сам сменил пароль.
  if (rateLimitAvailable) {
    const reset = await db.from(RATE_LIMIT_TABLE).upsert(
      { uid: session.uid, failed_count: 0, locked_until: null, updated_at: new Date().toISOString() },
      { onConflict: "uid" },
    );
    if (reset.error && !isRateLimitStoreMissing(reset.error)) {
      console.error("[auth/password] не удалось сбросить счётчик попыток", reset.error.message);
    }
  }

  // Каждое другое событие входа пишется в журнал (см. lib/audit/log.ts) —
  // смена собственного пароля была невидимым исключением: владелец, который
  // заподозрил утечку куки, не видел на /audit, менял ли человек пароль сам
  // и когда. Пароль и его хеш в событие не попадают — только факт и почта.
  await audit(request, session, { action: "auth.password.change", subject: session.email });

  // Отзыв бьёт и по кухе ЭТОГО же запроса (её iat старше свежего
  // password_changed_at) — переподписываем сессию сразу, чтобы автор смены
  // пароля не вылетел из своей же вкладки, а вылетели только чужие копии
  // токена (украденные, забытые на общем компьютере).
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await signSession(session), sessionCookieOptions);
  return response;
}
