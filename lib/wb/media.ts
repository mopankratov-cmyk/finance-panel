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

/**
 * Умеет ли ключ писать в карточку — спрашиваем WB, а не гадаем по токену.
 *
 * Проба идёт по ЗАВЕДОМО НЕСУЩЕСТВУЮЩЕЙ карточке: менять нечего, а отказ по
 * правам приходит раньше проверки товара. Это единственный способ узнать
 * правду заранее — битовую маску scope WB официально не раскрывает стабильно,
 * и полагаться на разбор JWT здесь нельзя.
 *
 * 05.09.2026 все пять ключей кабинетов оказались «только на чтение»: WB
 * отвечает 403 и прямым текстом `read-only token cannot perform non-readonly
 * requests`. Автоматическая смена фото на таком ключе не заработает никогда, и
 * узнать об этом человек должен ДО запуска теста, а не из ошибки крона.
 */
export type ContentWriteVerdict =
  | { can: true }
  | { can: false; reason: "read-only" | "no-scope" | "unknown"; message: string };

const PROBE_NM_ID = 1;

export async function probeContentWriteAbility(token: string): Promise<ContentWriteVerdict> {
  try {
    const res = await fetch(MEDIA_SAVE_URL, {
      method: "POST",
      headers: { Authorization: token.trim(), "Content-Type": "application/json" },
      body: JSON.stringify({ nmId: PROBE_NM_ID, data: [] }),
      cache: "no-store",
    });
    const text = await res.text().catch(() => "");
    if (/read-only token/i.test(text)) {
      return {
        can: false,
        reason: "read-only",
        message: "Ключ выпущен «только на чтение». Нужен новый ключ WB с доступом «Контент» и снятой галочкой «Только на чтение».",
      };
    }
    if (res.status === 401) {
      return { can: false, reason: "no-scope", message: "WB не принял ключ: нет доступа «Контент» или ключ отозван." };
    }
    if (res.status === 403) {
      return { can: false, reason: "no-scope", message: `WB отказал в записи: ${text.slice(0, 160)}` };
    }
    // Любой другой ответ — это уже разговор про саму карточку (её нет), а
    // значит право писать у ключа есть.
    return { can: true };
  } catch (error) {
    return { can: false, reason: "unknown", message: error instanceof Error ? error.message : "Сеть не ответила" };
  }
}
