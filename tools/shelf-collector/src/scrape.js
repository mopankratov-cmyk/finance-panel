/**
 * Скрейпинг одной карточки товара WB через реальный рендеринг страницы (Playwright).
 * Это единственный модуль, который знает про DOM wildberries.ru — при переносе на
 * Cloud Run он переиспользуется без изменений, меняется только то, что его вызывает
 * (см. DEPLOY.md).
 *
 * Селекторы сняты и проверены вручную на живой карточке 10.08.2026:
 *   - наш бренд:        [class*="brandBadgeText"] ИЛИ [class*="productNameBrand"]
 *     (WB отдаёт разные варианты вёрстки между заходами — пробуем оба)
 *   - наша цена (WB Кошелёк): OUR_PRICE_SELECTOR (см. константу — старая и новая вёрстка WB вперемешку)
 *   - блок конкурентов: заголовок с текстом "Смотрите также" -> подняться к предку
 *     с >=5 потомками article.product-card[data-popup-nm-id] -> это и есть карточки
 *     конкурентов по порядку показа.
 *   - id конкурента:    атрибут data-popup-nm-id (не нужно парсить href regexp'ом)
 *   - бренд конкурента: .product-card__brand-wrap содержит "БРЕНД / Название",
 *     .product-card__name — часть после "/", бренд = остаток.
 *   - цена конкурента:  .price__lower-price.wallet-price внутри карточки.
 *
 * WB отдаёт блок "Смотрите также" только при полноценной навигации браузера
 * (см. project_wb_price_monitoring.md) — обычный fetch/XHR или UrlFetchApp его не увидят,
 * поэтому этот шаг обязателен именно как рендеринг страницы, а не HTTP-запрос.
 *
 * ВАЖНО: подгрузка блока нестабильна между заходами — эмпирически (10.08.2026, ~8 живых
 * прогонов) блок появлялся то за 2-3 секунды, то не появлялся вообще за 90 секунд ожидания
 * и скролла на одной и той же загрузке страницы. Скорость/стиль скролла тут ни при чём —
 * помогает именно повторная навигация (свежий page.goto), а не более долгое ожидание на
 * одной попытке. Поэтому здесь retry через перезаход, а не бесконечный скролл.
 */

const PRODUCT_URL = (article) => `https://www.wildberries.ru/catalog/${article}/detail.aspx`;
const ANTIBOT_MARKER = 'Проверяем браузер';
// WB постепенно катит новую вёрстку цены (CSS-модули с хэш-суффиксом в классе, например
// "priceBlockWalletPrice--K6fNr") — не на всех карточках сразу, вперемешку со старой.
// Матчим по стабильному смысловому префиксу класса (без хэша), а не по хэшу целиком —
// иначе он меняется при каждой пересборке фронтенда WB. Подтверждено эмпирически
// 11.08.2026: артикул 1224069918 отдавал ТОЛЬКО новую вёрстку, старый селектор молчал.
const OUR_PRICE_SELECTOR = '.price__wrap .price__lower-price.wallet-price, [class*="priceBlockWalletPrice"]';

const SCROLL_STEP_PX = 300;
const SCROLL_STEP_WAIT_MS = 400;
const PER_ATTEMPT_BUDGET_MS = 30000; // не торопимся — лучше подождать дольше, чем недобрать конкурентов
const MAX_NAVIGATION_ATTEMPTS = 5;

/**
 * Отдельный тип ошибки для жёсткой антибот-блокировки (экран "Проверяем браузер",
 * который не разрешается сам). Отличаем от обычной нестабильности блока "Смотрите
 * также" (это не блокировка, а флаки на стороне WB) намеренно: на жёсткую блокировку
 * нельзя реагировать частыми повторами — только длинным бэкоффом или остановкой всей
 * пачки, иначе можно только усугубить/продлить блокировку.
 */
export class AntibotBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AntibotBlockedError';
  }
}

async function isAntibotChallenge(page) {
  return page.evaluate((marker) => document.body.innerText.includes(marker), ANTIBOT_MARKER).catch(() => false);
}

/**
 * Прогрев профиля перед сбором: заходим на главную (а не сразу на карточку товара)
 * и немного "листаем" — это естественный вход для настоящего посетителя, а не прямой
 * deep-link на конкретный товар, который сам по себе более "подозрителен" для антибота.
 * Вызывать один раз в начале прогона (не на каждый артикул).
 */
export async function warmUp(page) {
  await page.goto('https://www.wildberries.ru/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2000 + Math.random() * 2000);
  await page.mouse.wheel(0, 400 + Math.random() * 300);
  await page.waitForTimeout(1500 + Math.random() * 1500);
}

export async function scrapeArticle(page, article) {
  await page.goto(PRODUCT_URL(article), { waitUntil: 'domcontentloaded', timeout: 45000 });

  try {
    await page.waitForSelector(OUR_PRICE_SELECTOR, { timeout: 20000 });
  } catch (err) {
    if (await isAntibotChallenge(page)) {
      throw new AntibotBlockedError(`Антибот застрял на проверке браузера для артикула ${article}`);
    }
    throw err;
  }

  const our = await extractOur(page, article);
  const competitors = await extractCompetitorsWithRetry(page, article);

  return {
    article: Number(article),
    collectedAt: new Date().toISOString(),
    our,
    competitors
  };
}

async function extractOur(page, article) {
  return page.evaluate(({ articleId, priceSelector }) => {
    const parsePrice = (text) => {
      if (!text) return null;
      const digits = text.replace(/\D/g, '');
      return digits ? parseInt(digits, 10) : null;
    };

    const brandEl =
      document.querySelector('[class*="brandBadgeText"]') ||
      document.querySelector('[class*="productNameBrand"]');
    const priceEl = document.querySelector(priceSelector);

    const imgs = [...document.querySelectorAll('img')];
    const ownImg = imgs.find((img) => img.src && img.src.includes(`/${articleId}/images/`));

    return {
      brand: brandEl ? brandEl.textContent.trim() : null,
      price: parsePrice(priceEl ? priceEl.textContent : null),
      img: ownImg ? ownImg.src : null,
      link: `https://www.wildberries.ru/catalog/${articleId}/detail.aspx`
    };
  }, { articleId: String(article), priceSelector: OUR_PRICE_SELECTOR });
}

/**
 * Блок конкурентов подгружается нестабильно (см. комментарий в шапке файла).
 * Стратегия: медленно скроллить и ждать до PER_ATTEMPT_BUDGET_MS на одной загрузке;
 * если не появился — сделать свежую навигацию (page.goto заново) и повторить,
 * до MAX_NAVIGATION_ATTEMPTS раз. Свежий заход помогает чаще, чем более долгое
 * ожидание на одной и той же загрузке.
 */
async function extractCompetitorsWithRetry(page, article) {
  for (let attempt = 1; attempt <= MAX_NAVIGATION_ATTEMPTS; attempt++) {
    const found = await slowScrollUntilBlockVisible(page);
    if (found) {
      const competitors = await extractCompetitorsFromDom(page);
      if (competitors.length > 0) return competitors;
    }

    if (attempt < MAX_NAVIGATION_ATTEMPTS) {
      await page.goto(PRODUCT_URL(article), { waitUntil: 'domcontentloaded', timeout: 45000 });
      const priceAppeared = await page
        .waitForSelector(OUR_PRICE_SELECTOR, { timeout: 20000 })
        .then(() => true)
        .catch(() => false);

      if (!priceAppeared && (await isAntibotChallenge(page))) {
        throw new AntibotBlockedError(`Антибот застрял на проверке браузера для артикула ${article} (повтор ${attempt})`);
      }
    }
  }
  return [];
}

async function slowScrollUntilBlockVisible(page) {
  const start = Date.now();
  while (Date.now() - start < PER_ATTEMPT_BUDGET_MS) {
    const found = await page.evaluate(() => document.body.innerHTML.includes('Смотрите также'));
    if (found) return true;

    await page.mouse.wheel(0, SCROLL_STEP_PX);
    await page.waitForTimeout(SCROLL_STEP_WAIT_MS);

    const atBottom = await page.evaluate(
      () => window.scrollY + window.innerHeight >= document.body.scrollHeight - 5
    );
    if (atBottom) {
      // на дне страницы ждём подольше — вдруг блок ещё довантажится
      await page.waitForTimeout(2000);
    }
  }
  return page.evaluate(() => document.body.innerHTML.includes('Смотрите также'));
}

async function extractCompetitorsFromDom(page) {
  return page.evaluate(() => {
    const parsePrice = (text) => {
      if (!text) return null;
      const digits = text.replace(/\D/g, '');
      return digits ? parseInt(digits, 10) : null;
    };

    const headers = [...document.querySelectorAll('h1,h2,h3')].filter(
      (h) => h.textContent.trim() === 'Смотрите также'
    );
    if (!headers.length) return [];

    let el = headers[0];
    let container = null;
    for (let i = 0; i < 10 && el; i++) {
      el = el.parentElement;
      if (el && el.querySelectorAll('article.product-card[data-popup-nm-id]').length >= 5) {
        container = el;
        break;
      }
    }
    if (!container) return [];

    const cards = [...container.querySelectorAll('article.product-card[data-popup-nm-id]')].slice(0, 30);

    return cards.map((card, index) => {
      const nmId = card.getAttribute('data-popup-nm-id');

      const brandWrap = card.querySelector('.product-card__brand-wrap');
      let brand = null;
      if (brandWrap) {
        const nameEl = brandWrap.querySelector('.product-card__name');
        const fullText = brandWrap.textContent.trim();
        const nameText = nameEl ? nameEl.textContent.trim() : '';
        brand = fullText.slice(0, fullText.length - nameText.length).replace(/\/\s*$/, '').trim();
      }

      // Третий вариант — на случай новой CSS-модульной вёрстки WB в карточках
      // (camelCase c хэш-суффиксом, как это уже случилось с ценой своей карточки —
      // см. OUR_PRICE_SELECTOR). Сегодня карточки блока на старой вёрстке.
      const priceEl = card.querySelector('.price__lower-price.wallet-price, [class*="wallet-price"], [class*="walletPrice"]');
      const img = card.querySelector('img');

      return {
        position: index + 1,
        article: nmId ? parseInt(nmId, 10) : null,
        brand: brand || null,
        price: parsePrice(priceEl ? priceEl.textContent : null),
        img: img ? img.src : null
      };
    });
  });
}
