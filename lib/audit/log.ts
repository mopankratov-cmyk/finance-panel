import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { sessionRoles, type Session } from "@/lib/auth/session";

/**
 * Журнал действий: одна дверь на всю панель.
 *
 * ТЗ §17 перечисляет четырнадцать видов событий и девять полей у каждого.
 * Если каждое место будет писать журнал само, поля разъедутся на третьем
 * вызове: где-то забудут роль, где-то IP, а «старое значение» окажется
 * строкой в одном месте и объектом в другом. Поэтому запись только отсюда.
 *
 * ОТКАЗ ЖУРНАЛА НЕ ЛОМАЕТ ОПЕРАЦИЮ. Платёж не должен срываться из-за того,
 * что не записалась строка истории. Но и молчать нельзя: несработавший
 * журнал — это отсутствие истории там, где её обещали, поэтому отказ
 * попадает в консоль сервера с полным событием, а функция возвращает
 * признак, чтобы вызывающий мог показать предупреждение.
 */

/** Машинные метки событий из §17. Строка свободной формы сюда не принимается:
 *  журнал ищут по действию, а «изменил цену» и «Изменение цены» — два разных
 *  фильтра и половина истории мимо. */
export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "auth.login.failed"
  | "user.create"
  | "user.update"
  | "user.block"
  | "user.role.assign"
  | "user.scope.assign"
  | "payroll.change"
  | "cost.change"
  | "price.change"
  | "ads.budget.change"
  | "supply.change"
  | "mp_report.sync"
  | "mp_report.reclassify"
  | "payment.create"
  | "payment.update"
  | "payment.approve"
  | "warehouse.receipt"
  | "warehouse.move"
  | "warehouse.writeoff"
  | "warehouse.discrepancy"
  | "data.export";

export interface AuditEvent {
  action: AuditAction;
  /** Над чем: артикул, номер платежа, почта сотрудника. */
  subject?: string | null;
  before?: unknown;
  after?: unknown;
  /** Области. Пишется та, что у события есть: у входа нет ни одной. */
  organizationId?: string | null;
  entityId?: string | null;
  cabinetId?: string | null;
  warehouseId?: string | null;
}

export interface AuditActor {
  id?: string | null;
  email?: string | null;
  roles?: string[];
}

/**
 * Кто и откуда — из сессии и запроса.
 *
 * За прокси адрес клиента лежит в X-Forwarded-For, и там он первым в списке;
 * брать заголовок целиком значит записать в журнал ещё и адреса прокси.
 */
export function auditContext(request: Request | null, session: Pick<Session, "uid" | "email" | "role" | "roles"> | null) {
  const forwarded = request?.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || request?.headers.get("x-real-ip") || null;
  return {
    actor: {
      id: session?.uid ?? null,
      email: session?.email ?? null,
      roles: session ? sessionRoles(session) : [],
    } satisfies AuditActor,
    ip,
    userAgent: request?.headers.get("user-agent")?.slice(0, 300) ?? null,
  };
}

export interface AuditResult {
  ok: boolean;
  error?: string;
}

/** Запись события. Никогда не бросает: журнал не должен ронять операцию. */
export async function writeAudit(
  event: AuditEvent,
  context: { actor: AuditActor; ip?: string | null; userAgent?: string | null },
): Promise<AuditResult> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Supabase не настроен" };
  const row = {
    actor_id: context.actor.id ?? null,
    actor_email: context.actor.email ?? null,
    actor_roles: context.actor.roles?.length ? context.actor.roles : null,
    organization_id: event.organizationId ?? null,
    entity_id: event.entityId ?? null,
    cabinet_id: event.cabinetId ?? null,
    warehouse_id: event.warehouseId ?? null,
    action: event.action,
    subject: event.subject ?? null,
    before_data: event.before ?? null,
    after_data: event.after ?? null,
    ip: context.ip ?? null,
    user_agent: context.userAgent ?? null,
  };
  try {
    const { error } = await db.from("access_audit_log").insert(row);
    if (error) {
      // Таблица появляется миграцией, которую применяет владелец, а код
      // выкладывается раньше: до неё журнал молчит, но панель работает.
      const missing = error.code === "42P01" || /relation .*access_audit_log.* does not exist/i.test(error.message);
      if (!missing) console.error("[audit] не записано", event.action, error.message, row);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (error) {
    console.error("[audit] не записано", event.action, String(error), row);
    return { ok: false, error: String(error).slice(0, 200) };
  }
}

/** Короткая форма для роутов: контекст собирается сам. */
export async function audit(
  request: Request | null,
  session: Pick<Session, "uid" | "email" | "role" | "roles"> | null,
  event: AuditEvent,
): Promise<AuditResult> {
  return writeAudit(event, auditContext(request, session));
}

/**
 * Журналирование роута целиком, а не каждой ветки отдельно.
 *
 * Роуты-диспетчеры устроены как «одно действие в теле, десяток ветвей в
 * коде»: у зарплатного их пятьдесят пять точек выхода. Расставить запись в
 * каждую — значит гарантированно забыть одну, и именно та окажется важной.
 * Поэтому запись делается один раз, вокруг обработчика.
 *
 * Пишется ТОЛЬКО успех: неудавшийся запрос не менял данных, и строка о нём в
 * истории изменений — ложный след. Тело читается с копии запроса: обработчик
 * читает поток сам, и второй раз он уже пуст.
 */
export async function auditedMutation(
  request: Request,
  action: AuditAction,
  session: Pick<Session, "uid" | "email" | "role" | "roles"> | null,
  handler: () => Promise<Response>,
  describe?: (body: Record<string, unknown>) => Partial<AuditEvent>,
): Promise<Response> {
  const copy = request.clone();
  const response = await handler();
  if (!response.ok) return response;
  const body = await copy.json().catch(() => ({})) as Record<string, unknown>;
  const detail = describe ? describe(body) : { after: body };
  await audit(request, session, { action, ...detail });
  return response;
}

/** Тело без секретов: пароли и токены в историю не попадают никогда. */
export function redactSecrets(body: Record<string, unknown>): Record<string, unknown> {
  const hidden = /password|token|secret|api[-_]?key|hash/i;
  return Object.fromEntries(Object.entries(body).filter(([key]) => !hidden.test(key)));
}
