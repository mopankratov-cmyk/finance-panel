// Валидация токена WB + получение данных продавца. common-api/seller-info.
const SELLER_INFO = "https://common-api.wildberries.ru/api/v1/seller-info";

export interface SellerInfo {
  name: string;
  sid: string;
  tin?: string;
  tradeMark?: string;
}

export async function validateWbToken(
  token: string,
): Promise<{ ok: true; seller: SellerInfo } | { ok: false; error: string; status?: number }> {
  if (!token || token.trim().length < 20) return { ok: false, error: "Токен слишком короткий" };
  try {
    const res = await fetch(SELLER_INFO, { headers: { Authorization: token.trim() }, cache: "no-store" });
    if (res.status === 401) return { ok: false, error: "Токен невалиден (401)", status: 401 };
    if (!res.ok) return { ok: false, error: `WB ответил ${res.status}`, status: res.status };
    const seller = (await res.json()) as SellerInfo;
    if (!seller?.sid) return { ok: false, error: "WB не вернул данные продавца" };
    return { ok: true, seller };
  } catch (e) {
    return { ok: false, error: `Сеть: ${String(e).slice(0, 80)}` };
  }
}
