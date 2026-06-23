// Тонкие обёртки над WB Promotion API (advert-api.wildberries.ru). Только то, что нужно докидыванию.
// Токен — рекламный (scope «Продвижение»). depositAdvert и startAdvert ТРАТЯТ/МЕНЯЮТ живые РК — вызывать
// только из крон-логики докидывания после явного решения decideDock.

const BASE = "https://advert-api.wildberries.ru";

// Текущий бюджет кампании, ₽. GET /adv/v1/budget?id= → { total }.
export async function getAdvertBudget(token: string, advertId: number): Promise<number | null> {
  try {
    const res = await fetch(`${BASE}/adv/v1/budget?id=${advertId}`, {
      headers: { Authorization: token }, cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as { total?: number } | null;
    return j && typeof j.total === "number" ? j.total : null;
  } catch {
    return null;
  }
}

// Пополнение бюджета. type: 0 — счёт, 1 — баланс, 3 — бонусы. return:true — вернуть остаток.
export async function depositAdvert(token: string, advertId: number, sum: number, type = 1): Promise<{ ok: boolean; total?: number; error?: string }> {
  try {
    const res = await fetch(`${BASE}/adv/v1/budget/deposit?id=${advertId}`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ sum, type, return: true }),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `WB ${res.status}: ${(await res.text()).slice(0, 160)}` };
    const j = (await res.json().catch(() => ({}))) as { total?: number };
    return { ok: true, total: j?.total };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "fetch error" };
  }
}

// Запуск кампании (релонч паузы). GET /adv/v0/start?id=.
export async function startAdvert(token: string, advertId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE}/adv/v0/start?id=${advertId}`, {
      headers: { Authorization: token }, cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `WB ${res.status}: ${(await res.text()).slice(0, 160)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "fetch error" };
  }
}
