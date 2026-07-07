// Тонкий клиент feedbacks-api.wildberries.ru (Вопросы и Отзывы) — отдельная
// категория токена от Статистики/Контента (см. lib/wb/token.ts, token_feedbacks).

const BASE = "https://feedbacks-api.wildberries.ru/api/v1/feedbacks";

export class WbFeedbacksScopeError extends Error {
  constructor() {
    super("Нет доступа к отзывам (нужен WB-токен с категорией «Вопросы и Отзывы»)");
    this.name = "WbFeedbacksScopeError";
  }
}

export interface WbFeedbackRaw {
  id: string;
  text?: string;
  pros?: string;
  cons?: string;
  productValuation: number;
  createdDate: string;
  photoLinks?: { fullSize?: string; miniSize?: string }[];
  video?: unknown;
  answer?: { text?: string } | null;
  productDetails?: { nmId: number; imtId?: number; productName?: string; supplierArticle?: string; brandName?: string };
}

// Одна страница. 401/403 → WbFeedbacksScopeError (не путать с сетевой/прочей ошибкой,
// чтобы вызывающий код мог не падать, а внятно сообщить о нехватке скоупа).
export async function fetchWbFeedbacksPage(
  token: string, isAnswered: boolean, skip: number, take = 5000,
): Promise<WbFeedbackRaw[]> {
  const url = new URL(BASE);
  url.searchParams.set("isAnswered", String(isAnswered));
  url.searchParams.set("take", String(take));
  url.searchParams.set("skip", String(skip));
  url.searchParams.set("order", "dateDesc");
  const res = await fetch(url.toString(), { headers: { Authorization: token.trim() }, cache: "no-store" });
  if (res.status === 401 || res.status === 403) throw new WbFeedbacksScopeError();
  if (!res.ok) throw new Error(`WB ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const j = (await res.json().catch(() => null)) as { data?: { feedbacks?: WbFeedbackRaw[] } } | null;
  return j?.data?.feedbacks ?? [];
}
