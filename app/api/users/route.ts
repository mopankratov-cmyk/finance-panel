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
  return NextResponse.json({ users: data ?? [] });
}

export async function POST(request: NextRequest) {
  const directorSession = await requireDirector();
  if (!directorSession) return NextResponse.json({ error: "Доступ только для директора" }, { status: 403 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = (await request.json().catch(() => ({}))) as { email?: string; password?: string; role?: string; cabinet_ids?: string[] };
  const email = (b.email || "").trim().toLowerCase();
  const role = ["director", "finance", "manager", "seller"].includes(b.role || "") ? b.role : "manager";
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
  const userPatch = { role, cabinet_ids: role === "seller" ? [] : b.cabinet_ids ?? [], organization_id: organizationId, password_hash, is_active: true };
  if (existing) ({ error } = await db.from("app_users").update(userPatch).eq("id", existing.id));
  else ({ error } = await db.from("app_users").insert({ email, ...userPatch }));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
