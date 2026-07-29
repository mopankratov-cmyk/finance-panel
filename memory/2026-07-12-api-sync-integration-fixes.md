# API и синхронизация — расследование 2026-07-12

## Симптомы

- MPSTATS возвращал пустые ниши с HTTP 200, хотя проверка токена давала 401.
- Проверка коэффициентов приёмки WB завершалась 500; upstream использовал старый Supplies URL.
- `/api/sync/all` периодически завершался Vercel 504 через 60 секунд; интерфейс не показывал downstream-ошибки orders/sales.

## Корневые причины

1. MPSTATS-конфигурация разошлась: production-переменная пустая, локальный сохранённый токен недействителен. Клиент проглатывал 401 и превращал его в пустой массив.
2. WB отключил старый `supplies-api.../api/v1/acceptance/coefficients` после переноса метода в Tariffs API.
3. `/api/sync/all` запускал пять подзадач последовательно, затем в том же 60-секундном слоте строил AI-инсайты. Live-фолбэк комиссии скачивал отчёты WB на 19 и 55 МБ; production-лог фиксировал timeout.
4. `/api/sync/trigger` и SyncPage считали HTTP 200 успехом даже при `{ ok: false }` внутри ответа.

## Исправления

- WB endpoint заменён на `common-api.wildberries.ru/api/tariffs/v1/acceptance/coefficients`, добавлен timeout и корректная auth-ошибка.
- MPSTATS 401/403, 429 и upstream/network ошибки больше не маскируются пустыми данными; routes отдают понятные 502/503.
- Orders, sales, stocks и adverts запускаются параллельно; advert-stats ждёт adverts. Тяжёлые AI-инсайты удалены из критического `/sync/all`; ежедневные signals остаются отдельным cron.
- Trigger и UI проверяют и HTTP-статус, и payload `ok`; backfill останавливается на первой реальной ошибке и показывает её.
- Расписание в UI приведено к фактическому `vercel.json`.
- Устранён baseline lint-дефект `Date.now()` во время render в ReceivingTab.

## Регрессия и доказательства

- 8/8 Node tests: WB URL, MPSTATS auth, sync concurrency/dependency, nested errors.
- `npx tsc --noEmit` — pass.
- `npm run lint` — pass.
- `npm run build` — pass, 50 страниц.
- Local smoke без credentials: `/api/sync/all` вернул HTTP 502 + `{ ok:false }` за 182 мс вместо зависания; `/api/sync/trigger?job=orders` вернул HTTP 500 и сохранил downstream error.

## Статус

DONE_WITH_CONCERNS: кодовые причины исправлены. Для реальных данных MPSTATS владелец должен выпустить новый активный токен и записать его в Vercel; существующий токен проверить успешно невозможно (401).
