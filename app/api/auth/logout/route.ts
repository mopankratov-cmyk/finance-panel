import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { getServerSession } from "@/lib/auth/server";
import { audit } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // Сессию читаем ДО того, как погасили куку: иначе в журнале останется
  // «кто-то вышел», а кто именно — уже неизвестно.
  const session = await getServerSession();
  await audit(request, session, { action: "auth.logout", organizationId: session?.organization_id ?? null });
  const out = NextResponse.json({ ok: true });
  out.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return out;
}
