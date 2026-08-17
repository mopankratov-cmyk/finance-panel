/**
 * Проверка "можно ли обойтись без браузера" перед тем, как запускать Playwright —
 * по требованию: сначала всегда пробовать прямой запрос.
 *
 * card.wb.ru отдаёт бренд/название/id без антибота и без рендеринга JS — но НЕ
 * отдаёт цену "с WB Кошельком" (только обычную цену со скидкой) и НЕ отдаёт блок
 * "Смотрите также" (см. project_wb_price_monitoring.md — блок есть только при
 * полноценной браузерной навигации). Поэтому прямой запрос не заменяет Playwright
 * целиком, но даёт бренд как быстрый бесплатный фолбэк и раннюю проверку, что
 * артикул вообще существует, прежде чем тратить время браузера.
 */

const CARD_API = (article) =>
  `https://card.wb.ru/cards/v4/detail?appType=1&curr=rub&dest=-1257786&spp=30&ab_testing=false&nm=${article}`;

export async function tryDirectCheck(article) {
  try {
    const res = await fetch(CARD_API(article), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wb-price-monitor/1.0)' }
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

    const data = await res.json();
    const product = data.products && data.products[0];
    if (!product) return { ok: false, reason: 'товар не найден в card.wb.ru' };

    return {
      ok: true,
      brand: product.brand || null,
      name: product.name || null,
      // цена без учёта WB Кошелька — не для записи в таблицу, только справочно
      priceWithoutWallet: product.sizes?.[0]?.price?.product
        ? Math.round(product.sizes[0].price.product / 100)
        : null
    };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}
