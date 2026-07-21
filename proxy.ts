import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { canAccess, ROLE_HOME } from "@/lib/auth/roles";

// Защищаем всё, кроме /login, /privacy, /api/auth/*, статики и публичных шар-доков (/share/*).
export const config = {
  matcher: ["/((?!_next/|favicon.ico|login|privacy|api/auth|share).*)"],
};

// /api/*-эндпоинты, доступные БЕЗ сессии и БЕЗ cron-секрета (явный allowlist).
// Это тонкие прокси внешнего медиа — их публичный URL отдаётся внешним рендерам
// (FAL/Seedance), которые фетчат его сервер-сайд без нашей куки.
// ВНИМАНИЕ: всё ОСТАЛЬНОЕ под /api/* требует сессию ИЛИ Bearer CRON_SECRET (fail-closed).
//
// img-proxy / media-proxy / yandex-img / drive-img НЕ открыты нараспашку: гейт их пропускает,
// но САМ РОУТ требует HMAC-подпись (signProxyUrl) ИЛИ сессию ИЛИ cron (lib/auth/proxyAuth.ts),
// иначе 401 — это закрывает open-relay/SSRF. img-proxy вдобавок пускает только WB-баскеты.
// Подпись им выдаёт сервер при отдаче URL внешнему рендеру (см. disk-source). Прод-инвариант:
// задан SIGN_SECRET или AUTH_SECRET, иначе подпись на небезопасном дефолте.
const PUBLIC_API: { prefix: string; methods?: string[] }[] = [
  { prefix: "/api/lab/img-proxy" }, // CORS-прокси картинок (само-гард: подпись/сессия + host-allowlist WB)
  { prefix: "/api/lab/media-proxy" }, // CORS-прокси видео/аудио (само-гард: подпись/сессия)
  { prefix: "/api/lab/yandex-img" }, // «стабильный публичный URL» → FAL/Seedance (само-гард: подпись/сессия)
  { prefix: "/api/lab/drive-img" }, // фото моделей с Google Drive → Seedance i2v (само-гард: подпись/сессия)
  { prefix: "/api/lab/model-avatar" }, // аватар модели (<img> + внешний рендер)
  { prefix: "/api/lab/model-photos" }, // список фото модели (отдаёт yandex-img URL)
  { prefix: "/api/lab/product-image" }, // резолвер WB-картинки товара
  { prefix: "/api/opiu/telegram", methods: ["POST"] }, // Telegram webhook: сам роут проверяет secret-token
];

function isPublicApi(pathname: string, method: string): boolean {
  return PUBLIC_API.some(
    (p) => pathname.startsWith(p.prefix) && (!p.methods || p.methods.includes(method)),
  );
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  // ── API: явная авторизация на уровне приложения ──
  // Не полагаемся на Vercel Deployment Protection как на единственный контроль:
  // утечка preview-URL или мисконфиг протекшна не должны открывать данные/мутации.
  if (pathname.startsWith("/api/")) {
    // 1) явные публичные эндпоинты (медиа-прокси для внешних рендеров, вебхук Telegram)
    if (isPublicApi(pathname, req.method)) return NextResponse.next();
    // 2) залогиненный пользователь — кука fp_session уходит автоматически
    //    на same-origin fetch() и подзапросы <img>/<video src="/api/...">
    if (session) return NextResponse.next();
    // 3) машинные/cron-вызовы и внутренний фан-аут (route→route): Bearer CRON_SECRET
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.get("authorization") === `Bearer ${secret}`) {
      return NextResponse.next();
    }
    // 4) локальная разработка (не production) — не блокируем, как и прежний checkCronAuth dev-skip
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    // иначе — fail-closed
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  // ── Страницы: гейтим по сессии и роли ──
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  if (!canAccess(session.role, pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = ROLE_HOME[session.role] || "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
