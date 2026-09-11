import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getServerSession } from "@/lib/auth/server";
import { hashPassword } from "@/lib/auth/users";
import { isExternalRole, isRole } from "@/lib/auth/permissions";
import { audit } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

async function requireDirector() {
  const s = await getServerSession();
  return s && s.role === "director" ? s : null;
}

async function createSellerOrganization(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, email: string) {
  return db
    .from("organizations")
    .insert({ name: `WB · ${email.split("@", 1)[0] || "seller"}`, kind: "seller" })
    .select("id")
    .single();
}

async function resolveInternalOrganization(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  preferredId: string | null,
) {
  if (preferredId) return { data: { id: preferredId }, error: null };
  return db.from("organizations").select("id").eq("kind", "internal").order("created_at").limit(1).maybeSingle();
}

export async function GET() {
  if (!(await requireDirector())) return NextResponse.json({ error: "Доступ только для директора" }, { status: 403 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ users: [] });
  const primary = await db.from("app_users").select("id, email, role, cabinet_ids, organization_id, is_active, created_at").order("created_at");
  let data = primary.data;
  if (primary.error?.code === "42703") {
    const legacy = await db.from("app_users").select("id, email, role, cabinet_ids, is_active, created_at").order("created_at");
    if (legacy.error) return NextResponse.json({ error: legacy.error.message }, { status: 500 });
    data = (legacy.data ?? []).map((user) => ({ ...user, organization_id: null }));
  } else if (primary.error) {
    return NextResponse.json({ error: primary.error.message }, { status: 500 });
  }
  // Кабинеты, в которых человеку вообще есть что делать, — по ним и выдаются
  // уровни. Раньше экран брал для этого `cabinet_ids`, но у селлера этот список
  // принудительно пустой (доступ у него идёт через организацию), и выдать ему
  // «админа кабинета» было нечем: единственной видимой кнопкой «повысить»
  // оставалась глобальная роль директора — то есть доступ ко всем кабинетам
  // сразу. Директор одного кабинета и директор всей панели — разные вещи, и
  // выдаваться они должны разными органами управления.
  const { data: cabinets } = await db.from("wb_cabinets").select("id, organization_id");
  const allCabinetIds = (cabinets ?? []).map((row) => String(row.id));
  const byOrganization = new Map<string, string[]>();
  for (const row of cabinets ?? []) {
    const organization = String(row.organization_id ?? "");
    if (!organization) continue;
    byOrganization.set(organization, [...(byOrganization.get(organization) ?? []), String(row.id)]);
  }

  const withAccess = (data ?? []).map((user) => {
    const own = Array.isArray(user.cabinet_ids) ? user.cabinet_ids.map(String) : [];
    let access: string[];
    if (user.role === "seller") {
      // Организация задаёт границу, список — фактический доступ. Показываем
      // пересечение: уровень бессмысленно выдавать в кабинете, куда человек
      // всё равно не войдёт.
      const inOrganization = byOrganization.get(String(user.organization_id ?? "")) ?? [];
      access = own.length ? inOrganization.filter((id) => own.includes(id)) : inOrganization;
    }
    else if (user.role === "director") access = [];   // директор и так может всё — уровень ему не нужен
    else access = own.length ? own : allCabinetIds;   // пустой список у менеджера означает «все»
    return { ...user, access_cabinet_ids: access };
  });

  const session = await getServerSession();
  return NextResponse.json({ users: withAccess, me: session?.uid ?? null });
}

export async function POST(request: NextRequest) {
  const directorSession = await requireDirector();
  if (!directorSession) return NextResponse.json({ error: "Доступ только для директора" }, { status: 403 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = (await request.json().catch(() => ({}))) as { email?: string; password?: string; role?: string; roles?: string[]; cabinet_ids?: string[]; replace_existing?: boolean };
  const email = (b.email || "").trim().toLowerCase();
  /**
   * Роли берутся из общего словаря, а не из списка строк рядом.
   *
   * Список здесь был написан руками и отстал от словаря: после разделения
   * ролей он всё ещё принимал «finance» и «manager», которых больше нет, и
   * молча подставлял несуществующую роль по умолчанию — то есть заводил
   * сотрудника, которому потом не открылся бы ни один экран. Компилятор
   * этого не видел: обычный массив строк.
   *
   * Роль может быть не одна: сотрудник, ведущий оба маркетплейса, получает
   * обе роли менеджера (решение владельца от 09.09.2026).
   */
  const requested = (b.roles?.length ? b.roles : [b.role]).filter((value): value is string => Boolean(value));
  const roles = requested.filter(isRole);
  if (requested.length && roles.length !== requested.length) {
    const unknown = requested.filter((value) => !isRole(value));
    return NextResponse.json({ error: `Неизвестная роль: ${unknown.join(", ")}` }, { status: 400 });
  }
  if (!roles.length) return NextResponse.json({ error: "Укажите роль сотрудника" }, { status: 400 });
  // Внешний контур не смешивается с внутренним ни при каких сочетаниях:
  // иначе сотрудник клиента получил бы права нашей компании.
  if (roles.some(isExternalRole) && roles.some((value) => !isExternalRole(value))) {
    return NextResponse.json({ error: "Внешнюю роль нельзя совмещать с внутренней" }, { status: 400 });
  }
  const role = roles[0];
  if (!email || !b.password || b.password.length < 10) return NextResponse.json({ error: "Email и пароль (≥10 символов)" }, { status: 400 });
  const password_hash = await hashPassword(b.password);
  const { data: existing } = await db.from("app_users").select("id,role,organization_id").eq("email", email).maybeSingle();
  // Форма называется «добавить сотрудника», а при совпадении почты она молча
  // переписывала существующему человеку пароль, роль и список кабинетов — и
  // заново включала отключённую учётку. Директор при этом видел «сохранён» и
  // не знал, что только что сбросил доступ живому пользователю (в том числе
  // другому директору). Замену теперь надо подтвердить осознанно.
  if (existing && !b.replace_existing) {
    return NextResponse.json(
      {
        error: `Пользователь ${email} уже есть (роль «${existing.role}»). Замена перезапишет пароль, роль и кабинеты.`,
        exists: true,
        current_role: existing.role,
      },
      { status: 409 },
    );
  }
  let organizationId: string | null = null;
  if (roles.some(isExternalRole)) {
    if (existing && isExternalRole(existing.role) && existing.organization_id) organizationId = existing.organization_id;
    else {
      const { data: organization, error: organizationError } = await createSellerOrganization(db, email);
      if (organizationError || !organization) return NextResponse.json({ error: organizationError?.message ?? "Не удалось создать организацию" }, { status: 500 });
      organizationId = organization.id;
    }
  } else {
    const { data: organization, error: organizationError } = await resolveInternalOrganization(db, directorSession.organization_id);
    if (organizationError || !organization) return NextResponse.json({ error: organizationError?.message ?? "Не удалось создать организацию" }, { status: 500 });
    organizationId = organization.id;
  }
  let error;
  // Кабинет внешнего селлера связывается только self-service endpoint после
  // проверки WB-токена. Нельзя назначить ему чужой внутренний кабинет из формы.
  // Кабинеты внешнему контуру и складу не выдаются здесь: у первого они
  // приходят из его организации, второму не нужны вовсе.
  const withoutCabinets = roles.some(isExternalRole) || roles.includes("warehouse");
  const userPatch = { role, cabinet_ids: withoutCabinets ? [] : b.cabinet_ids ?? [], organization_id: organizationId, password_hash, is_active: true };
  /**
   * Колонка `roles` появляется миграцией, которую применяет владелец, а код
   * выкладывается раньше. Поэтому запись идёт с ней, а на отказ «нет такой
   * колонки» повторяется без неё: до миграции сотрудник получит одну роль,
   * после — все, и ни в один из моментов форма не сломается.
   */
  const missingRolesColumn = (message: string | undefined) => /column .*roles.* does not exist/i.test(message ?? "");
  const save = async (patch: Record<string, unknown>) => existing
    ? db.from("app_users").update(patch).eq("id", existing.id)
    : db.from("app_users").insert({ email, ...patch });
  let saved = await save({ ...userPatch, roles });
  if (missingRolesColumn(saved.error?.message)) saved = await save(userPatch);
  error = saved.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await audit(request, directorSession, {
    action: existing ? "user.update" : "user.create",
    subject: email,
    before: existing ? { role: existing.role, organization_id: existing.organization_id } : null,
    // Ни пароля, ни его хеша: секрет остаётся секретом и в журнале.
    after: { roles, cabinet_ids: userPatch.cabinet_ids, organization_id: organizationId, is_active: true },
    organizationId,
  });
  return NextResponse.json({ ok: true });
}
