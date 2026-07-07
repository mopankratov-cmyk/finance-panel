// Смена порядка фото карточки через WB Content API — реальный официальный write,
// не скрейпинг. Открытое допущение (проверить при реальном использовании): WB
// принимает уже загруженные CDN-урлы в новом порядке как переупаковку без
// повторной загрузки файлов — если это не так, роут вернёт понятную ошибку WB,
// не упадёт молча.
const MEDIA_SAVE_URL = "https://content-api.wildberries.ru/content/v3/media/save";

export async function saveCardMediaOrder(token: string, nmId: number, photoUrls: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(MEDIA_SAVE_URL, {
      method: "POST",
      headers: { Authorization: token.trim(), "Content-Type": "application/json" },
      body: JSON.stringify({ nmId, data: photoUrls }),
      cache: "no-store",
    });
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => "");
    return { ok: false, error: `WB ${res.status}: ${text.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Ошибка сети" };
  }
}
