# DEBUG REPORT: Ozon health red Performance report

- **Symptom:** на `/ozon/health` последняя синхронизация рекламы Ozon показывалась красной ошибкой с длинным текстом `Performance report: batch ... status NOT_STARTED / create HTTP 429`.
- **Root cause:** Ozon Performance формирует отчёты асинхронно и иногда временно отвечает `NOT_STARTED` или `HTTP 429`. Код считал отсутствие готового batch как fatal sync error, писал `sync_log.status = error`, а health-экран любой не-`ok` статус рисовал красным.
- **Fix:** добавлена классификация retryable/deferred ошибок Performance report. Для `NOT_STARTED`, `IN_PROGRESS`, `PENDING`, `PROCESSING`, `HTTP 429` и отсутствия готовых batch Ozon sync теперь считается non-fatal, возвращает 200 и остаётся на автоповтор. Health классифицирует старые такие записи как warning, а UI показывает дружелюбное жёлтое сообщение вместо красной простыни.
- **Evidence:** `node --import tsx --test tests/ozon-sync-health.regression-1.test.mts tests/ozon-cockpit-quality.test.mts tests/ozon-performance-concurrency.regression-1.test.mts`, `npm run lint`, `npx tsc --noEmit`, `git diff --check`, `npm test`, `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npm run build`, `npm run dev -- --webpack --port 3047` + `curl -I /ozon/health`.
- **Regression test:** `tests/ozon-sync-health.regression-1.test.mts`.
- **Status:** DONE.
