// Сборщик «Полок» finance-panel. Основа — local-collector из наработок автора
// (Playwright + реальный Chrome с постоянным профилем; все антибот-эмпирики
// сохранены в scrape.js без изменений). Отличие от оригинала одно: снимки
// уходят не в Google Sheets, а в панель (panelClient.js, CRON_SECRET панели).
import 'dotenv/config';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tryDirectCheck } from './directCheck.js';
import { scrapeArticle, warmUp, AntibotBlockedError } from './scrape.js';
import { fetchActiveArticles, pushSnapshot } from './panelClient.js';
import { getDueSlot, markSlotDone } from './schedule.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, '..', '.chrome-profile');

const PANEL_URL = (process.env.PANEL_URL || '').replace(/\/+$/, '');
const PANEL_CRON_SECRET = process.env.PANEL_CRON_SECRET;
// headless заметно чаще упирается в антибот-челлендж WB — по умолчанию открываем окно.
const HEADLESS = process.env.HEADLESS === 'true';
const DELAY_MIN_MS = Number(process.env.DELAY_MIN_MS || 3000);
const DELAY_MAX_MS = Number(process.env.DELAY_MAX_MS || 8000);
// Длинный бэкофф при жёсткой антибот-блокировке — короткие повторы только продлевают блок.
const ANTIBOT_BACKOFF_MS = Number(process.env.ANTIBOT_BACKOFF_MS || 3 * 60 * 1000);

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function randomDelay(min, max) {
  const ms = Math.floor(min + Math.random() * (max - min));
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Реальный Chrome (channel: 'chrome') проходит антибот-челлендж WB заметно надёжнее,
 * чем связанный с Playwright Chromium, а ПОСТОЯННЫЙ профиль (.chrome-profile/)
 * копит куки/доверие между запусками — свежие профили WB блокирует чаще.
 * Оба вывода эмпирические (10.08.2026, автор наработок) — не менять без перепроверки.
 */
async function launchContext() {
  const opts = {
    headless: HEADLESS,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    viewport: { width: 1280, height: 1000 },
    args: ['--disable-blink-features=AutomationControlled']
  };
  try {
    return await chromium.launchPersistentContext(PROFILE_DIR, { ...opts, channel: 'chrome' });
  } catch (err) {
    log('channel "chrome" недоступен, использую встроенный Chromium:', err.message);
    return chromium.launchPersistentContext(PROFILE_DIR, opts);
  }
}

async function main() {
  // --now: внеплановый сбор в обход слот-гейта (после добавления артикулов).
  // Плановые слоты не отмечает — ближайший плановый сбор пройдёт как обычно.
  const adhoc = process.argv.includes('--now');

  let slot = null;
  if (!adhoc) {
    // Слот-проверка ПЕРЕД всем остальным: launchd дёргает сборщик каждые 15 минут,
    // и почти все запуски должны быть мгновенным no-op без браузера.
    slot = getDueSlot();
    if (!slot) {
      log('Плановый слот сбора ещё не наступил или уже собран сегодня — выхожу без запуска браузера.');
      return;
    }
    log(`Наступил слот ${slot.label} (Europe/Moscow), сегодня ещё не собирали — начинаю сбор.`);
  } else {
    log('Внеплановый сбор (--now) — плановые слоты не трогаю.');
  }

  if (!PANEL_URL || !PANEL_CRON_SECRET) {
    throw new Error('PANEL_URL и PANEL_CRON_SECRET обязательны — заполните .env (см. .env.example)');
  }

  log('Запрашиваю список активных артикулов у панели…');
  const articles = await fetchActiveArticles(PANEL_URL, PANEL_CRON_SECRET);
  log(`Активных артикулов: ${articles.length}`, articles);

  if (!articles.length) {
    log('Нечего собирать — реестр «Полок» пуст или все артикулы выключены.');
    return;
  }

  const context = await launchContext();

  const results = { success: 0, failed: 0, skipped: 0 };
  let aborted = false;

  try {
    log('Прогреваю профиль (заход через главную, не сразу на карточку)…');
    const warmupPage = await context.newPage();
    await warmUp(warmupPage);
    await warmupPage.close();

    for (let i = 0; i < articles.length; i++) {
      if (aborted) {
        results.skipped++;
        continue;
      }

      const article = articles[i];
      log(`[${i + 1}/${articles.length}] Артикул ${article}`);

      const direct = await tryDirectCheck(article);
      if (direct.ok) {
        log(`  прямой запрос (card.wb.ru): бренд="${direct.brand}", цена без Кошелька=${direct.priceWithoutWallet}₽`);
      } else {
        log(`  прямой запрос не дал данных (${direct.reason}) — иду через браузер`);
      }

      let attemptsLeft = 2; // 1 обычная попытка + 1 повтор после длинного бэкоффа при блокировке
      while (attemptsLeft > 0) {
        attemptsLeft--;
        const page = await context.newPage();
        try {
          const snapshot = await scrapeArticle(page, article);
          // Свою цену снять не удалось (вёрстка/флаки) — снимок всё равно ценен:
          // конкуренты собраны, а панель честно покажет «цена не снята» вместо
          // выброшенного сбора. Оригинал наработок тут падал — изменено сознательно.
          if (!snapshot.our.price) {
            snapshot.our.price = null;
            log('  ВНИМАНИЕ: наша цена не снята — отправляю снимок без неё');
          }
          log(
            `  собрано: наша цена=${snapshot.our.price ?? 'не снята'}, бренд=${snapshot.our.brand}, ` +
              `конкурентов=${snapshot.competitors.length}`
          );

          const written = await pushSnapshot(PANEL_URL, PANEL_CRON_SECRET, snapshot);
          log(`  записано в панель (кабинетов: ${written.written ?? '?'}${written.duplicates ? `, дублей: ${written.duplicates}` : ''})`);
          results.success++;
          break;
        } catch (err) {
          if (err instanceof AntibotBlockedError && attemptsLeft > 0) {
            log(
              `  АНТИБОТ ЗАБЛОКИРОВАЛ: ${err.message}. Жду ${Math.round(ANTIBOT_BACKOFF_MS / 1000)}с и пробую ещё раз.`
            );
            await new Promise((resolve) => setTimeout(resolve, ANTIBOT_BACKOFF_MS));
            continue;
          }
          if (err instanceof AntibotBlockedError) {
            log(
              `  АНТИБОТ ЗАБЛОКИРОВАЛ повторно по артикулу ${article} — останавливаю весь прогон, ` +
                `чтобы не усугублять блокировку. Уже собранное записано, остальные ` +
                'артикулы соберутся при следующем запуске.'
            );
            aborted = true;
            results.failed++;
          } else {
            log(`  ОШИБКА по артикулу ${article}:`, err.message || err);
            results.failed++;
          }
        } finally {
          await page.close();
        }
      }

      if (!aborted && i < articles.length - 1) {
        await randomDelay(DELAY_MIN_MS, DELAY_MAX_MS);
      }
    }
  } finally {
    await context.close();
  }

  log(
    `Готово. Успешно: ${results.success}, с ошибками: ${results.failed}, ` +
      `пропущено из-за блокировки: ${results.skipped}`
  );

  if (adhoc) {
    log('Внеплановый сбор завершён — плановые слоты не отмечены.');
  } else {
    markSlotDone(slot);
    log(`Слот ${slot.label} отмечен как собранный на сегодня — следующая попытка на следующем слоте.`);
  }
}

main().catch((err) => {
  console.error('Критическая ошибка сборщика:', err);
  process.exit(1);
});
