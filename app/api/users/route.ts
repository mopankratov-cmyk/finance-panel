import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getServerSession } from "@/lib/auth/server";
import { hashPassword } from "@/lib/auth/users";

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
  const b = (await request.json().catch(() => ({}))) as { email?: string; password?: string; role?: string; cabinet_ids?: string[] };
  const email = (b.email || "").trim().toLowerCase();
  const role = ["director", "finance", "manager", "ozon_manager", "seller", "warehouse"].includes(b.role || "") ? b.role : "manager";
  if (!email || !b.password || b.password.length < 10) return NextResponse.json({ error: "Email и пароль (≥10 символов)" }, { status: 400 });
  const password_hash = await hashPassword(b.password);
  const { data: existing } = await db.from("app_users").select("id,role,organization_id").eq("email", email).maybeSingle();
  let organizationId: string | null = null;
  if (role === "seller") {
    if (existing?.role === "seller" && existing.organization_id) organizationId = existing.organization_id;
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
  const userPatch = { role, cabinet_ids: role === "seller" || role === "warehouse" ? [] : b.cabinet_ids ?? [], organization_id: organizationId, password_hash, is_active: true };
  if (existing) ({ error } = await db.from("app_users").update(userPatch).eq("id", existing.id));
  else ({ error } = await db.from("app_users").insert({ email, ...userPatch }));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
