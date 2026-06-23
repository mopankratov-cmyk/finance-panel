// Смена порядка медиа карточки (первое фото = главное) через WB Content API.
// ⚠️ ЖИВАЯ МУТАЦИЯ ВИТРИНЫ. Двойной гейт: вызывается только из enabled-теста И только если
// env CTRTEST_PHOTO_SWAP_LIVE=1. Без флага — no-op (applied:false), чтобы случайно не переставить
// фото на боевых карточках. Реализация требует ЖИВОЙ валидации перед включением флага.

const BASE = "https://content-api.wildberries.ru";

// orderedUrls — полный список медиа в нужном порядке (индекс 0 = главное фото).
export async function setCardMedia(
  token: string,
  nmId: number,
  orderedUrls: string[],
): Promise<{ ok: boolean; applied: boolean; error?: string }> {
  if (process.env.CTRTEST_PHOTO_SWAP_LIVE !== "1") {
    return { ok: true, applied: false, error: "swap выключен (нет CTRTEST_PHOTO_SWAP_LIVE=1) — требует живой валидации" };
  }
  if (!orderedUrls.length) return { ok: false, applied: false, error: "пустой список медиа" };
  try {
    const res = await fetch(`${BASE}/content/v3/media/save`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ nmId, data: orderedUrls }),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, applied: false, error: `WB ${res.status}: ${(await res.text()).slice(0, 160)}` };
    return { ok: true, applied: true };
  } catch (e) {
    return { ok: false, applied: false, error: (e as Error)?.message || "fetch error" };
  }
}
