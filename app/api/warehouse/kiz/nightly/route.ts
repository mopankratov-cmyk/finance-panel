import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listAccessibleEntities } from "@/lib/warehouse/entityAccess";
import { attachKizEntities } from "@/lib/warehouse/kizEntity";
import { collectKizFromTasks, KIZ_NIGHTLY_JOB, KizTasksMigrationError } from "@/lib/warehouse/kizTasks";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });

// Машинный вызов — только CRON_SECRET: гейт-прокси знает именно его, и обещать
// здесь узкий секрет значило бы дать мёртвый ключ — запрос умер бы в прокси, не
// дойдя до роута.
function machineAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Ночной сбор кодов на вывод из оборота.
 *
 * Берёт только быстрый источник — сборочные задания и факт выкупа из нашей же
 * базы. В Wildberries не ходит ни разу, поэтому лимитов не касается и не может
 * выхватить 429 в четыре утра, когда починить это некому.
 *
 * Этого достаточно, чтобы человек не нажимал кнопку каждый день: код из
 * сборочного задания известен в день отгрузки, а не через неделю, когда продажа
 * дойдёт до отчёта о реализации. Чтение отчётов WB осталось ручным — оно стоит
 * минут и имеет смысл только когда за ним следят.
 *
 * Цепочка, на которую опирается: /api/sync/kiz-codes кладёт коды заданий каждые
 * четверть часа, /api/sync/sales — факт выкупа каждый час. Здесь они сходятся.
 */
/** Vercel-крон ходит GET-запросом. Людям этот вход закрыт намеренно: сессионная
 *  кука объявлена SameSite=lax и уходит при переходе по ссылке, а значит
 *  меняющий данные GET запускался бы кликом по присланной ссылке. */
export async function GET(request: NextRequest) {
  if (!machineAuthorized(request)) return fail("Этот вход только для расписания", 401);
  return run(request);
}

/** Ручной запуск из интерфейса. */
export async function POST(request: NextRequest) {
  if (!machineAuthorized(request)) {
    // Те же роли, что запускают руками остальные фоновые задачи.
    const gate = await requireApiSession(["director", "finance"]);
    if (gate) return gate;
  }
  return run(request);
}

async function run(request: NextRequest) {
  const startedAt = new Date();
  void request;

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  // Без сессии список юрлиц отдаётся целиком — так и нужно: ночной прогон
  // собирает по всем кабинетам, а не по тем, что видит конкретный человек.
  const list = await listAccessibleEntities();
  if (!list.ok) return fail(list.error, list.status);

  const cabinetIds = [...new Set(list.rows.flatMap((entity) =>
    entity.cabinets.filter((link) => link.marketplace === "wb").map((link) => link.cabinetId)))];
  if (cabinetIds.length === 0) {
    await writeSyncLog(KIZ_NIGHTLY_JOB, "error", 0, "Нет кабинетов Wildberries, связанных с юрлицами", startedAt);
    return fail("Нет кабинетов Wildberries, связанных с юрлицами", 400);
  }

  try {
    const result = await collectKizFromTasks(db, cabinetIds);
    const attached = await attachKizEntities(db);
    // В журнал пишем то, ради чего прогон был: сколько кодов прибавилось.
    // Дописанные даты идут туда же — по ним видно, что старый долг убывает.
    await writeSyncLog(KIZ_NIGHTLY_JOB, "ok", result.added + result.enriched, null, startedAt);
    return NextResponse.json({ data: { ...result, attached }, error: null });
  } catch (error) {
    const message = error instanceof KizTasksMigrationError
      ? error.message
      : error instanceof Error ? error.message : String(error);
    await writeSyncLog(KIZ_NIGHTLY_JOB, "error", null, message, startedAt);
    return fail(message, error instanceof KizTasksMigrationError ? 503 : 500);
  }
}
