import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getServerSession } from "@/lib/auth/server";
import { hashPassword } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

async function director() {
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

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const directorSession = await director();
  if (!directorSession) return NextResponse.json({ error: "Доступ только для директора" }, { status: 403 });
  const { id } = await ctx.params;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = (await request.json().catch(() => ({}))) as { role?: string; cabinet_ids?: string[]; is_active?: boolean; password?: string };
  const { data: currentUser, error: currentUserError } = await db
    .from("app_users")
    .select("email,role,organization_id")
    .eq("id", id)
    .maybeSingle();
  if (currentUserError || !currentUser) return NextResponse.json({ error: currentUserError?.message ?? "Пользователь не найден" }, { status: 404 });
  const patch: Record<string, unknown> = {};
  if (b.role && ["director", "finance", "manager", "seller"].includes(b.role)) {
    patch.role = b.role;
    if (b.role === "seller") {
      if (currentUser.role !== "seller" || !currentUser.organization_id) {
        const { data: organization, error: organizationError } = await createSellerOrganization(db, String(currentUser.email));
        if (organizationError || !organization) return NextResponse.json({ error: organizationError?.message ?? "Не удалось создать организацию" }, { status: 500 });
        patch.organization_id = organization.id;
      }
      patch.cabinet_ids = [];
    } else if (currentUser.role === "seller" || !currentUser.organization_id) {
      const { data: organization, error: organizationError } = await resolveInternalOrganization(db, directorSession.organization_id);
      if (organizationError || !organization) return NextResponse.json({ error: organizationError?.message ?? "Не удалось найти внутреннюю организацию" }, { status: 500 });
      patch.organization_id = organization.id;
    }
  }
  const effectiveRole = b.role && ["director", "finance", "manager", "seller"].includes(b.role)
    ? b.role
    : String(currentUser.role);
  if (Array.isArray(b.cabinet_ids) && effectiveRole !== "seller") patch.cabinet_ids = b.cabinet_ids;
  if (typeof b.is_active === "boolean") patch.is_active = b.is_active;
  if (b.password && b.password.length >= 10) patch.password_hash = await hashPassword(b.password);
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Нечего обновлять" }, { status: 400 });
  const { error } = await db.from("app_users").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await director();
  if (!s) return NextResponse.json({ error: "Доступ только для директора" }, { status: 403 });
  const { id } = await ctx.params;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  if (s.uid === id) return NextResponse.json({ error: "Нельзя удалить себя" }, { status: 400 });
  const { error } = await db.from("app_users").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
