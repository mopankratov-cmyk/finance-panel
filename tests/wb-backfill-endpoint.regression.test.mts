import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

// Живая лента статистики WB стартует с «сейчас минус два часа»: у только что
// подключённого кабинета заказы и выкупы за прошлые дни отсутствуют, и экран
// показывает нули там, где были продажи. Забрать их можно только прогоном синка
// с параметром from, а он закрыт cron-секретом — недоступным из интерфейса.

test("бэкфилл доступен под сессией, а не только по cron-секрету", async () => {
  const route = await read("../app/api/wb/backfill/route.ts");
  assert.match(route, /requireApiSession\(\[\.\.\.WRITE_ROLES\]\)/);
  assert.match(route, /const WRITE_ROLES = \["director", "finance"\] as const/);
  // Секрет подставляет сервер, наружу он не уходит.
  assert.match(route, /Authorization: `Bearer \$\{secret\}`/);
  assert.doesNotMatch(route, /secret[^\n]*NextResponse\.json\(\{[^}]*secret/);
});

test("период проверяется, а не подставляется молча", async () => {
  const route = await read("../app/api/wb/backfill/route.ts");
  assert.match(route, /const DATE = \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//);
  assert.match(route, /Укажите дату начала/);
  assert.match(route, /Укажите кабинет/);
});

test("заказы и продажи забираются последовательно", async () => {
  const route = await read("../app/api/wb/backfill/route.ts");
  // Параллельный запуск двух тяжёлых отчётов упирается в общий лимит WB.
  assert.match(route, /for \(const job of \["orders", "sales"\] as const\)/);
  assert.doesNotMatch(route, /Promise\.all\(\s*\["orders"/);
});

// Воронка забирает по 20 SKU за прогон (лимит analytics-API WB), поэтому у
// кабинета на 350 SKU полный круг занимает почти сутки — срезы нужно уметь
// прогнать подряд, а не ждать по одному в час.
test("срезы воронки гоняются подряд и ограничены бюджетом функции", async () => {
  const route = await read("../app/api/wb/backfill/route.ts");
  assert.match(route, /const funnelPasses = Math\.max\(0, Math\.min\(20/);
  assert.match(route, /Date\.now\(\) < deadline/);
  // Ошибка на срезе останавливает цикл: гонять дальше в стену смысла нет.
  assert.match(route, /lastError = payload\.error[\s\S]{0,60}break;/);
});

// Дни старше окна дозаписи и добавления в корзину есть только в глубоком
// историческом отчёте: обычный синк воронки их не приносит вовсе.
test("глубокая история дёргается повторно, пока WB готовит отчёт", async () => {
  const route = await read("../app/api/wb/backfill/route.ts");
  assert.match(route, /const historyPasses = Math\.max\(0, Math\.min\(10/);
  // Между попытками нужна пауза: отчёт готовится не мгновенно.
  assert.match(route, /setTimeout\(resolve, 20_000\)/);
  // Готовый отчёт и отказ WB одинаково прекращают цикл.
  assert.match(route, /mine\?\.status === "complete"/);
  assert.match(route, /mine\?\.status === "unavailable"/);
});

test("синки умеют принудительный период по одному кабинету", async () => {
  const orders = await read("../app/api/sync/orders/route.ts");
  const sales = await read("../app/api/sync/sales/route.ts");
  for (const source of [orders, sales]) {
    assert.match(source, /sp\.get\("from"\)/);
    assert.match(source, /sp\.get\("cabinet"\)/);
  }
});
