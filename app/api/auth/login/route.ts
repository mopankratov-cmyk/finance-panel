import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth/users";
import { signSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { email, password } = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  const res = await authenticate(email || "", password || "");
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 401 });

  const token = await signSession({
    uid: res.user.id, email: res.user.email, role: res.user.role, cabinet_ids: res.user.cabinet_ids,
  });
  const out = NextResponse.json({ ok: true, role: res.user.role });
  out.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return out;
}
