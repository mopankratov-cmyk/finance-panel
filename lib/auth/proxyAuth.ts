import { getServerSession } from "./server";
import { verifyProxySig } from "./proxySign";

// Авторизация медиа-прокси-роутов (img-proxy / media-proxy / yandex-img / drive-img).
// Эти роуты в allowlist proxy.ts (гейт их пропускает), поэтому проверку несёт сам роут.
// Пускаем, если ВЫПОЛНЕНО ХОТЯ БЫ ОДНО:
//  1) dev (NODE_ENV!=='production') — как dev-skip в proxy.ts (локалка доверенная);
//  2) валидная HMAC-подпись в URL — cookie-less внешние рендеры (FAL/Seedance);
//  3) валидная сессия fp_session — браузерные канвас-редакторы и превью (кука уходит сама);
//  4) Bearer CRON_SECRET — внутренний серверный фан-аут.
// Иначе — отказ (анонимный неподписанный запрос ⇒ закрыт open-relay/SSRF).
export async function proxyAuthorized(req: Request): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return true;
  const url = new URL(req.url);
  if (verifyProxySig(url.searchParams, url.pathname)) return true;
  if (await getServerSession()) return true;
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return false;
}
