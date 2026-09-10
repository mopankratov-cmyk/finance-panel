import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/server";
import { sessionRoles, type Session } from "@/lib/auth/session";
import { rolesAreExternal, rolesCan } from "@/lib/auth/permissions";
import { DEFAULT_WAREHOUSE_LIMITS } from "@/lib/auth/approvals";
import { loadLimits, mergeLimits, saveLimits } from "@/lib/auth/limitsStore";
import { audit } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

/**
 * Пороги согласований.
 *
 * Читать может каждый, кому они мешают работать: человек должен видеть, за
 * какой суммой ему понадобится чужая подпись, ДО того как упрётся в отказ.
 * Менять — только тот, у кого право limits.manage.
 *
 * Область определяется ролью, а не параметром запроса: внешний клиент правит
 * пороги СВОЕЙ организации и не может дотянуться до компанейских, даже зная
 * их адрес. Передавать область телом значило бы отдать эту границу клиенту.
 */

function scopeOf(session: Session) {
  return rolesAreExternal(sessionRoles(session)) ? session.organization_id : null;
}

export async function GET() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const limits = await loadLimits(scopeOf(session));
  return NextResponse.json({
    limits,
    defaults: DEFAULT_WAREHOUSE_LIMITS,
    canEdit: rolesCan(sessionRoles(session), "limits.manage"),
    scope: rolesAreExternal(sessionRoles(session)) ? "organization" : "company",
  });
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  if (!rolesCan(sessionRoles(session), "limits.manage")) {
    return NextResponse.json({ error: "Пороги меняет руководство, а во внешнем контуре — главный пользователь клиента" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const organizationId = scopeOf(session);
  const before = await loadLimits(organizationId);
  const saved = await saveLimits(organizationId, mergeLimits(body.limits ?? body), session.email);
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 });
  await audit(request, session, {
    action: "user.scope.assign",
    subject: organizationId ? `лимиты организации` : "лимиты компании",
    before,
    after: saved.limits,
    organizationId,
  });
  return NextResponse.json({ limits: saved.limits });
}
