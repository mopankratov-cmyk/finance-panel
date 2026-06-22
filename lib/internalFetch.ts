// Сервер-к-серверу вызовы наших же /api/*-роутов должны нести Bearer CRON_SECRET,
// чтобы пройти гейт авторизации в proxy.ts (у внутреннего фан-аута нет куки сессии).
// Используй это вместо голого fetch для ЛЮБОГО запроса к ${origin}/api/... из роута/lib.
// Если Authorization уже задан вызывающим — не перетираем; если CRON_SECRET нет (dev) —
// заголовок не добавляем (в dev гейт всё равно отключён).
export function internalFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const secret = process.env.CRON_SECRET;
  if (secret && !headers.has("authorization")) {
    headers.set("Authorization", `Bearer ${secret}`);
  }
  return fetch(input, { ...init, headers });
}
