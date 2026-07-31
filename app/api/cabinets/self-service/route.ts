import { after, NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/server";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session";
import { claimMarketplaceSeller } from "@/lib/auth/tenantClaim";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveSyncBase } from "@/lib/sync/orchestrator";
import { validateWbToken } from "@/lib/wb/sellerInfo";
import { decodeWbToken, probeWbScopes, WB_SCOPE_LABEL, type WbScope } from "@/lib/wb/token";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function mask(token: string) {
  return token ? `••••${token.slice(-4)}` : "";
}

async function ensureSellerOrganization(userId: string, currentId: string | null, email: string) {
  if (currentId) return currentId;
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  const label = email.split("@", 1)[0] || "WB seller";
  const { data, error } = await db
    .from("organizations")
    .insert({ name: `WB · ${label}`, kind: "seller" })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message || "Не удалось создать организацию");
  const organizationId = String(data.id);
  const { error: userError } = await db.from("app_users").update({ organization_id: organizationId }).eq("id", userId);
  if (userError) throw new Error(userError.message);
  return organizationId;
}

function scheduleInitialSync(origin: string, cabinetId: string) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const base = resolveSyncBase(origin);
  const headers = { Authorization: `Bearer ${secret}` };
  const firstWave = ["orders", "sales", "stocks", "adverts", "feedbacks"];
  const secondWave = ["advert-stats", "funnel", "commissions"];
  after(async () => {
    await Promise.allSettled(firstWave.map((job) => fetch(
      `${base}/api/sync/${job}?cabinet=${encodeURIComponent(cabinetId)}`,
      { headers, cache: "no-store" },
    )));
    await Promise.allSettled(secondWave.map((job) => fetch(
      `${base}/api/sync/${job}?cabinet=${encodeURIComponent(cabinetId)}`,
      { headers, cache: "no-store" },
    )));
  });
  return true;
}

export async function GET() {
  const session = await getServerSession();
  if (!session || session.role !== "seller") {
    return NextResponse.json({ error: "Доступно только внешнему селлеру" }, { status: 403 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  if (!session.organization_id) return NextResponse.json({ cabinets: [] });
  const { data, error } = await db
    .from("wb_cabinets")
    .select("id,name,trade_mark,seller_id,inn,is_active,token,created_at")
    .eq("organization_id", session.organization_id)
    .eq("marketplace", "wb")
    .order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    cabinets: (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      trade_mark: row.trade_mark,
      seller_id: row.seller_id,
      inn: row.inn,
      is_active: row.is_active,
      token_mask: mask(String(row.token ?? "")),
      created_at: row.created_at,
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session || session.role !== "seller") {
    return NextResponse.json({ error: "Доступно только внешнему селлеру" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({})) as { token?: string; name?: string };
  const token = String(body.token ?? "").trim();
  if (!token) return NextResponse.json({ error: "Укажите API-токен Wildberries" }, { status: 400 });
  if (token.length > 8_192) return NextResponse.json({ error: "Некорректный API-токен Wildberries" }, { status: 400 });
  const requestedName = String(body.name ?? "").trim();
  if (requestedName.length > 160) return NextResponse.json({ error: "Название кабинета не должно превышать 160 символов" }, { status: 400 });

  const validation = await validateWbToken(token);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  const tokenInfo = decodeWbToken(token);
  if (tokenInfo.isExpired) return NextResponse.json({ error: "Срок действия токена истёк" }, { status: 400 });
  const scopes = await probeWbScopes(token);
  const requiredScopes: WbScope[] = ["statistics", "analytics", "advert", "content", "prices", "feedbacks"];
  const missingScopes = requiredScopes.filter((scope) => scopes[scope] !== true);
  if (missingScopes.length > 0) {
    return NextResponse.json({
      error: `В токене не хватает разделов на чтение: ${missingScopes.map((scope) => WB_SCOPE_LABEL[scope]).join(", ")}`,
      scopes,
    }, { status: 422 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  try {
    const organizationId = await ensureSellerOrganization(session.uid, session.organization_id, session.email);
    const claim = await claimMarketplaceSeller(db, "wb", validation.seller.sid, organizationId);
    if (!claim.ok) return NextResponse.json({ error: claim.error }, { status: claim.status });
    const { data: existing, error: existingError } = await db
      .from("wb_cabinets")
      .select("id,organization_id")
      .eq("marketplace", "wb")
      .eq("seller_id", validation.seller.sid)
      .eq("organization_id", organizationId)
      .limit(1)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    const row = {
      marketplace: "wb",
      organization_id: organizationId,
      name: requestedName || validation.seller.tradeMark || validation.seller.name || "Кабинет WB",
      trade_mark: validation.seller.tradeMark ?? null,
      seller_id: validation.seller.sid,
      inn: validation.seller.tin ?? null,
      token,
      is_active: true,
    };
    const result = existing?.id
      ? await db.from("wb_cabinets").update(row).eq("id", existing.id).select("id,name").single()
      : await db.from("wb_cabinets").insert(row).select("id,name").single();
    if (result.error || !result.data) throw new Error(result.error?.message || "Кабинет не сохранён");

    const cabinetId = String(result.data.id);
    const cabinetIds = [...new Set([...session.cabinet_ids, cabinetId])];
    const { error: userError } = await db
      .from("app_users")
      .update({ organization_id: organizationId, cabinet_ids: cabinetIds })
      .eq("id", session.uid);
    if (userError) throw new Error(userError.message);

    const syncQueued = scheduleInitialSync(new URL(request.url).origin, cabinetId);
    const refreshedSession = {
      ...session,
      organization_id: organizationId,
      cabinet_ids: cabinetIds,
    };
    const response = NextResponse.json({
      ok: true,
      cabinet: { id: cabinetId, name: result.data.name, token_mask: mask(token) },
      scopes,
      expires_at: tokenInfo.expiresAt,
      days_left: tokenInfo.daysLeft,
      sync_queued: syncQueued,
    });
    response.cookies.set(SESSION_COOKIE, await signSession(refreshedSession), sessionCookieOptions);
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось подключить кабинет" }, { status: 500 });
  }
}
