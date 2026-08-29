import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isPanelOwner } from "@/lib/auth/owner";
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
  // Права нельзя отобрать ни у себя, ни у владельца панели.
  //
  // Роль у каждой строки списка меняется одинаковым выпадающим списком, и
  // промах по своей строке стоил директору всех прав: вернуть их можно было
  // только запросом в базу мимо приложения. Понижение — не та операция, где
  // цена ошибки должна лежать на внимательности.
  const touchesRights = typeof b.role === "string" || typeof b.is_active === "boolean";
  if (touchesRights && directorSession.uid === id) {
    return NextResponse.json({ error: "Свою роль и доступ менять нельзя" }, { status: 400 });
  }
  if (touchesRights && isPanelOwner(currentUser.email)) {
    return NextResponse.json({ error: "Владелец панели не понижается" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (b.role && ["director", "finance", "manager", "ozon_manager", "seller", "warehouse"].includes(b.role)) {
    patch.role = b.role;
    if (b.role === "seller") {
      // Своя организация у селлера обязана быть — через неё он видит свой
      // кабинет и никакие чужие. Но если она у него уже есть и она селлерская,
      // новую заводить нельзя: человек тут же потеряет кабинет, к которому его
      // привязали. Новая нужна только тому, кто приходит из внутренней
      // организации, — иначе внешний селлер оказался бы внутри наших юрлиц.
      const { data: organizationNow } = currentUser.organization_id
        ? await db.from("organizations").select("kind").eq("id", currentUser.organization_id).maybeSingle()
        : { data: null };
      if (String(organizationNow?.kind ?? "") !== "seller") {
        const { data: organization, error: organizationError } = await createSellerOrganization(db, String(currentUser.email));
        if (organizationError || !organization) return NextResponse.json({ error: organizationError?.message ?? "Не удалось создать организацию" }, { status: 500 });
        patch.organization_id = organization.id;
      }
    } else if (currentUser.role === "seller" || !currentUser.organization_id) {
      const { data: organization, error: organizationError } = await resolveInternalOrganization(db, directorSession.organization_id);
      if (organizationError || !organization) return NextResponse.json({ error: organizationError?.message ?? "Не удалось найти внутреннюю организацию" }, { status: 500 });
      patch.organization_id = organization.id;
    }
  }
  const effectiveRole = b.role && ["director", "finance", "manager", "ozon_manager", "seller", "warehouse"].includes(b.role)
    ? b.role
    : String(currentUser.role);
  // Список кабинетов селлеру не обнуляем, а заполняем кабинетами его
  // организации. Доступ селлера требует ОБОИХ условий — совпадения организации
  // и наличия кабинета в списке (lib/auth/cabinetAccess.ts), поэтому пустой
  // список означает «доступа нет». Прежнее обнуление отрезало человека от его
  // кабинета ровно в тот момент, когда ему выдавали роль селлера: кабинет при
  // этом оставался виден на экране подключений, а вся аналитика говорила
  // «подключите хотя бы один кабинет». У новой организации кабинетов ещё нет —
  // там список честно пуст, и селлер подключает свой кабинет сам.
  const roleChanging = typeof b.role === "string";
  if (effectiveRole === "seller" && (roleChanging || Array.isArray(b.cabinet_ids))) {
    const organizationId = String(patch.organization_id ?? currentUser.organization_id ?? "");
    const { data: organizationCabinets } = organizationId
      ? await db.from("wb_cabinets").select("id").eq("organization_id", organizationId)
      : { data: [] as { id: string }[] };
    const own = (organizationCabinets ?? []).map((row) => String(row.id));
    // Директор вправе сузить список, но не вывести его за пределы организации.
    patch.cabinet_ids = Array.isArray(b.cabinet_ids)
      ? b.cabinet_ids.map(String).filter((cabinetId) => own.includes(cabinetId))
      : own;
  } else if (Array.isArray(b.cabinet_ids) && effectiveRole !== "seller") {
    patch.cabinet_ids = b.cabinet_ids;
  }
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
  const { data: victim } = await db.from("app_users").select("email").eq("id", id).maybeSingle();
  if (victim && isPanelOwner(victim.email)) {
    return NextResponse.json({ error: "Владельца панели удалить нельзя" }, { status: 400 });
  }
  const { error } = await db.from("app_users").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
