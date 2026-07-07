// Тонкий клиент МойСклад JSON API 1.2. Только валидация токена сейчас (форма
// подключения + заглушка синка) — точные поля/эндпоинты для импорта товаров/остатков
// не завязаны жёстко, проверить при реализации реального синка.

const BASE = "https://api.moysklad.ru/api/remap/1.2";

export type MoySkladValidation = { ok: true; accountName: string | null } | { ok: false; error: string };

// GET /context/employee — лёгкий read-only эндпоинт: подтверждает токен и даёт имя
// сотрудника/аккаунта для отображения (как WB seller-info на /cabinets).
export async function validateMoySkladToken(token: string): Promise<MoySkladValidation> {
  try {
    const res = await fetch(`${BASE}/context/employee`, {
      headers: { Authorization: `Bearer ${token.trim()}`, Accept: "application/json;charset=utf-8" },
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: "Неверный токен МойСклад (нет доступа)" };
    if (!res.ok) return { ok: false, error: `МойСклад ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const j = (await res.json().catch(() => null)) as { name?: string } | null;
    return { ok: true, accountName: j?.name ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Ошибка сети" };
  }
}
