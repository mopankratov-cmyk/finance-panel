import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

// Ручной пересинк финотчёта: нужен после добавления поля в отчёт (старые строки
// его не содержат). Роут обязан быть узким — только пересинк, без уведомлений
// монитора, и с честным отказом вместо молчаливой обрезки периода.

test("пересинк доступен ответственным за деньги и машине по секрету", async () => {
  const route = await read("../app/api/opiu/report-sync/route.ts");
  assert.match(route, /MANUAL_ROLES = \["director", "finance"\]/);
  assert.match(route, /CRON_SECRET/);
  // Гейт-прокси знает только CRON_SECRET: обещанный, но непропускаемый секрет —
  // мёртвый ключ, на этом уже спотыкался сборщик «Полок».
  assert.doesNotMatch(route, /process\.env\.FINANCE_MONITOR_SECRET/);
  // Сессия проверяется, когда секрета нет — иначе крон не смог бы вызвать роут.
  assert.match(route, /if \(!machineAuthorized\(request\)\) \{\s*\n\s*const gate = await requireApiSession/);
});

test("границы периода проверяются, длинное окно отклоняется с числом дней", async () => {
  const route = await read("../app/api/opiu/report-sync/route.ts");
  assert.match(route, /Даты нужны в формате ГГГГ-ММ-ДД/);
  assert.match(route, /Начало периода позже его конца/);
  assert.match(route, /MAX_PERIOD_DAYS = 92/);
  assert.match(route, /Период не больше \$\{MAX_PERIOD_DAYS\} дней, запрошено \$\{days\}/);
});

test("ручной пересинк не тащит побочные эффекты монитора", async () => {
  const route = await read("../app/api/opiu/report-sync/route.ts");
  // Уведомления и анализ — забота /api/opiu/monitor; ручной запуск только качает данные.
  assert.doesNotMatch(route, /sendTelegramMessage|runServerFinancialAnalysis|buildMarketplacePayoutForecast/);
  assert.match(route, /syncOpiuReportPeriod\(\{ dateFrom, dateTo \}, brand\.cabinetId\)/);
});
