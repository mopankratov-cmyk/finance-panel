import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { canAccess, ROLE_HOME } from "@/lib/auth/roles";

// Защищаем всё, кроме /login, /api/auth/*, статики и публичных шар-доков (/share/*).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login|api/auth|inferno/vendor|share).*)"],
};

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // API кроме auth — пропускаем (защита данных — отдельно; гейтим страницы)
  const isPage = !pathname.startsWith("/api/");

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    if (!isPage) return NextResponse.next(); // API без сессии не редиректим (вернёт данные/401 сам)
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  // Ролевой гейтинг страниц
  if (isPage && !canAccess(session.role, pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = ROLE_HOME[session.role] || "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
