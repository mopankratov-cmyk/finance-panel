# Railway worker night log

Этот журнал ведёт отдельный AI-worker на Railway во время ночных задач по контент-заводу.

## Итог ночи

- Дата: 2026-06-25
- Worker: codex / content-factory audit
- Last heartbeat: локально, в процессе работы
- Ветки: `fix/factory-...` текущая рабочая
- Проверки: `npx tsc --noEmit --pretty false`; `npx eslint app/api/factory/products/route.ts app/api/factory/decompose/route.ts lib/factory/graphRun.ts`; парс `public/inferno/studio.html`; `npm run dev -- --port 3007`; `curl` на `/api/factory/products`
- Что поправлено: честные метрики товаров в `products`, фильтры товаров, honest format fork, ElevenLabs в студии/графе, fallback текста для hook/caption/OTK, рабочий поиск в центре, кеш последнего снимка балансов
- Что осталось: дождаться деплоя и заново проверить прод-студию в Chrome; потом добить UX на экране конкурентов и пустые состояния

- Дата: 2026-06-24
- Worker: railway-content-factory
- Last heartbeat: локально, в процессе работы
- Ветки: feat/factory-video-public-urls
- PR: #30 merged
- Очередь на ночь: T-001 done, T-002 active, T-003 next, T-004 after gate, T-005 at the end
- Готово к ревью: scenario-quality gate, scenario-rewrite, taste-patterns, Creatify quality gate wire-up
- Не успел: дождаться следующего пинка worker и забрать T-002
- Блокеры: live Claude в тесте ответа дал connection error, но fallback JSON работает
- Проверки: `npx tsc --noEmit --pretty false`; `npx eslint app/api/factory/scenario-quality/route.ts app/api/factory/scenario-rewrite/route.ts app/api/factory/ugc-creatify/route.ts lib/factory/scenarioQuality.ts lib/factory/tastePatterns.ts`; `npm run dev`; `curl` POST на новые endpoints
- Следующие рекомендации: сразу брать T-002, затем T-003; PR #30 уже слит

## Записи

### 2026-06-25 08:30

- Ветка: `fix/factory-sprint1-stabilization`
- Цель: добить Sprint 1 по надёжности, а не по качеству контента
- Изменено:
  - создан `ARCHITECTURE_AUDIT.md`
  - создан `SYSTEM_EXECUTION_MAP.md`
  - создан `STABILITY_REPORT.md`
  - `graphRun` переведён на fail-open для ОТК/critic/artifact path
  - добавлены `run_id`, `warnings`, `execution_log`
  - `graph-run/tick` переведён с `after(...)` на синхронный шаг
  - `GET /api/factory/graph-run` теперь может мягко пнуть зависший ран
  - отключены `watchdog`, `self-heal`, `scenario-rewrite`, `hook-judge`, `variations`, `recipe-variants`, `batch-build`
  - добавлен raw clip fallback и wall-clock timeout для внутренних route-вызовов
  - добавлен повторяемый stress runner `lib/factory/stressGraphRun.mjs`
  - `video-critic` переведён на deterministic fallback вместо 502 при недоступном upstream
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
  - `node lib/factory/stressGraphRun.mjs --runs 0`
  - локальный stress-test на `recipe_id=68`
  - ручной `curl`/`fetch` на `/api/factory/graph-run`, `/api/factory/studio`
  - runtime-smoke `/api/factory/video-critic` вернул `200` с fallback-оценкой при отсутствующем Claude connection
- Результат:
  - контрольный рецепт проходит end-to-end
  - в `next dev` серия дала `9/10 done`, `1/10 failed`, что помогло поймать хрупкость continuation и dev-runtime
  - после перевода `graph-run/tick` на синхронный шаг и проверки через `next start` получено `10/10 done`
  - подтверждено: основной блокер был в dev-runtime/continuation path, а не в MVP-пайплайне как таковом
- Блокеры:
  - Turbopack dev server под stress перезапускается по памяти
- Следующий шаг:
  - Sprint 2: улучшить качество `video-critic` уже без риска для выпуска
  - привести docs/observer/UI в соответствие новой Sprint 1 модели (`warning` вместо блокирующего `otk_fail`)

### 2026-06-24 22:10

- Ветка: feat/factory-video-public-urls
- Цель: поставить сценарный quality gate и мягкую перепись до дорогого render path
- Изменено: добавлен `scenario-quality` endpoint, `scenario-rewrite` endpoint, библиотека taste patterns, wire-up quality gate в Creatify UGC route, документация по gate/rewrite
- Файлы: `app/api/factory/scenario-quality/route.ts`, `app/api/factory/scenario-rewrite/route.ts`, `app/api/factory/ugc-creatify/route.ts`, `lib/factory/scenarioQuality.ts`, `lib/factory/tastePatterns.ts`, `docs/factory-scenario-quality-gate.md`
- Проверки: `npx tsc --noEmit --pretty false`; `npx eslint app/api/factory/scenario-quality/route.ts app/api/factory/scenario-rewrite/route.ts app/api/factory/ugc-creatify/route.ts lib/factory/scenarioQuality.ts lib/factory/tastePatterns.ts`; `npm run dev`; `curl` POST на оба endpoint
- Результат: типы и линт зелёные, dev поднимается, JSON fallback работает при connection error к Claude, ветка запушена, PR #30 открыт
- Риски/блокеры: live Claude в этом окружении не отвечает напрямую, поэтому аварийная ветка важна
- Следующий шаг: ждать ревью PR #30 и при необходимости править замечания

### 2026-06-25 14:29

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть второй слой Milestone 2 `Execution Observability`
- Изменено:
  - `app/api/factory/studio/route.ts` получил нормализацию `run_fail` / `plan.error` в `error_category`
  - в `observability` добавлены `top_error_categories` и `top_errors`
  - в `observability` добавлен `recent_runs[]` по последним прогонам
  - в `observability` добавлен `status_series[]` с почасовыми бакетами по `created_at`
  - в `observability` добавлен `step_duration_series[]` по самым медленным шагам
  - вынесен shared helper `lib/factory/workerState.ts` для heartbeat/очереди/night-log
  - добавлен единый `GET /api/factory/ops`
  - в `/api/factory/ops` добавлены `suggested_actions`
  - в `/api/factory/ops` добавлен `ops_status` (`healthy|degraded|critical`)
  - в `recipeSummary` добавлены `error` и `error_category`
  - `public/inferno/studio.html` теперь показывает error categories и top errors в operational card
  - `public/inferno/studio.html` теперь показывает последние прогоны с `status`, `total_ms`, `error_category`, `warnings_count`
  - `public/inferno/studio.html` теперь показывает hourly trend по последним бакетам
  - `public/inferno/studio.html` теперь показывает trend длительности по slowest steps
  - экран worker теперь читает unified ops snapshot и показывает low-balance/alerts summary
  - экран worker теперь показывает balances + observability прямо внутри ops view
  - экран worker теперь показывает suggested actions с приоритетом `P0/P1/P2`
  - командный центр и worker screen теперь показывают единый `ops_status`
  - карточки рецептов теперь показывают `error <category>` для быстрых triage-разборов
  - обновлён `EXECUTION_OBSERVABILITY.md`
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - наблюдаемость поднята с уровня warning-only до уровня warning + run-fail taxonomy
  - оператор теперь видит не только факт падения, но и класс причины: `input`, `db`, `budget`, `timeout`, `render`, `quality`, `storage`, `generation`
  - появился короткий historical slice по последним прогонам без отдельной time-series таблицы
  - появился почасовой trend, рассчитанный из истории `node_recipes`, без миграции схемы
  - появился series по длительности самых медленных шагов, чтобы локализовать bottleneck
  - появился единый ops snapshot: heartbeat + balances + observability + alerts
  - появился guidance layer: ops snapshot теперь подсказывает следующий action, а не только сообщает symptom
  - alert policy стала явной: worker/balance/db/render/generation сигналы теперь нормализуются в приоритеты
  - появился единый health verdict для быстрого чтения состояния системы
  - билд и типизация зелёные
- Следующий шаг:
  - накопить history по step duration и классам ошибок уже в richer persistent series с большей глубиной, а не только в последних бакетах/срезах
  - при необходимости вывести отдельный ops dashboard поверх `/api/factory/ops`

- Дополнение:
  - `app/api/factory/worker-state/route.ts` теперь тоже отдаёт `observability` snapshot по последним `node_recipes`
  - это даёт единый backend-facing источник правды для будущих watchdog / alerts без парсинга UI-агрегатора

### 2026-06-25 15:05

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать раздвоение operational truth между `/ops` и `/observer`
- Изменено:
  - добавлен shared helper `lib/factory/observerPulse.ts`
  - `app/api/factory/observer/route.ts` переведён на shared pulse loader
  - `app/api/factory/ops/route.ts` теперь возвращает `observer` в составе unified snapshot
  - `public/inferno/studio.html` переведён на один источник правды для sidebar pulse и worker incident summary
  - командный центр и worker screen теперь читают один и тот же observer pulse через `/api/factory/ops`
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - убран риск рассинхрона, когда sidebar pulse и worker screen показывали разные состояния одной и той же фабрики
  - `/api/factory/observer` сохранён для обратной совместимости, но больше не тащит свою отдельную реализацию
  - observability layer стал проще: один ops snapshot на UI, один shared loader на backend
- Следующий шаг:
  - решить, нужен ли вообще публичный `/api/factory/observer` после периода совместимости, или его можно будет оставить как thin compatibility facade

### 2026-06-25 15:22

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать worker screen полезным даже при проблемах с таблицей heartbeat
- Изменено:
  - `lib/factory/workerState.ts` теперь строит synthetic worker из `docs/factory-railway-task-queue.md`, если `railway_worker_states` пуст или недоступен
  - `app/api/factory/ops/route.ts` и `app/api/factory/worker-state/route.ts` передают очередь в shared worker snapshot loader
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - UI больше не остаётся полностью слепым, когда БД не даёт heartbeat row
  - даже в fallback-режиме видно текущую задачу, ветку, PR и первый blocker из очереди
  - это уменьшает MTTR: можно triage-ить worker без обязательной починки таблицы в ту же минуту

### 2026-06-25 15:31

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать источник worker-state явным на UI и в ops-алертах
- Изменено:
  - `worker.source` теперь нормализуется как `heartbeat_db` или `queue_fallback`
  - `/api/factory/ops` поднимает `worker_queue_fallback` как отдельный warn alert и добавляет `repair_worker_heartbeat` в suggested actions
  - `public/inferno/studio.html` показывает `source: heartbeat|queue fallback` вместо двусмысленного `db: ok`
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - оператор видит не просто `unknown`, а понимает, что именно деградировало: heartbeat или только его storage
  - уменьшается риск ложного ощущения, что всё в порядке, когда UI уже живёт на fallback-данных

### 2026-06-25 15:42

- Ветка: текущая рабочая ветка контент-завода
- Цель: починить markdown queue fallback до реально рабочего состояния
- Изменено:
  - `lib/factory/workerState.ts` теперь нормализует значения вида `` `doing` `` → `doing`
  - это чинит счётчики очереди, выбор активной задачи и synthetic worker fallback
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - fallback перестал быть “формально включённым, но слепым”
  - worker screen сможет корректно распознать `doing/todo/done`, даже если очередь оформлена markdown-литералами
  - повторно подтверждено: первый запуск `tsc` может споткнуться о `.next/types` до `build`, но после успешного `build` типизация зелёная

### 2026-06-25 15:58

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть настоящий root cause у heartbeat path
- Изменено:
  - добавлен готовый sender `lib/factory/workerHeartbeat.mjs`
  - обновлён `docs/factory-railway-worker.md` с командами `--once` и `--every-sec`
  - обновлён `EXECUTION_OBSERVABILITY.md` с явным указанием на heartbeat sender
- Проверки:
  - `node lib/factory/workerHeartbeat.mjs --help`
  - `npm run build`
- Результат:
  - подтверждено, что в репозитории был `POST /api/factory/worker-state`, но не было ни одного отправителя heartbeat
  - теперь Railway worker можно реально подключить к Studio без нового сервиса и без зависимостей
  - сегодняшняя деградация heartbeat объясняется не только UI/storage, но и отсутствием sender path как такового

### 2026-06-25 16:09

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать ops-диагностику по heartbeat actionable, а не общей
- Изменено:
  - `/api/factory/ops` теперь различает `sender_missing`, `table_missing`, `db_permissions`, `fallback_active`
  - alerts/suggested_actions/ops_status используют эту классификацию
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - Studio и automation могут различать “нет sender” и “сломана таблица”
  - triage стал короче: первый шаг подсказывается сразу, без чтения сырого `db_error`

### 2026-06-25 16:21

- Ветка: текущая рабочая ветка контент-завода
- Цель: вернуть готовые repair hints прямо из heartbeat API и показать их в UI
- Изменено:
  - `lib/factory/workerState.ts` получил общий builder heartbeat diagnostics
  - `/api/factory/ops` теперь возвращает `heartbeat_diagnostics`
  - `POST /api/factory/worker-state` при ошибке возвращает `issue + diagnostics`
  - `public/inferno/studio.html` показывает отдельную карточку `Heartbeat diagnostics`
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - у оператора теперь есть migration path, sender script и пример команды прямо в интерфейсе
  - внешний heartbeat sender тоже получает структурированную причину ошибки, а не одну строку от Supabase

### 2026-06-25 16:34

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать лишний шум на странице worker и оставить только operational signals
- Изменено:
  - `public/inferno/studio.html` упрощён в секции `screenWorker`
  - убраны длинный night log preview, громоздкие task cards с acceptance/checks/result и дублирующая инцидентная сводка
  - добавлены компактные блоки `Factory pulse`, `Queue snapshot`, короткий `Sources`
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - экран worker стал короче и спокойнее
  - основные ответы теперь видны сразу: жив ли heartbeat, что чинить, какая задача активна, что следующее в очереди

### 2026-06-25 16:47

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать `run_fail` triage таким же быстрым, как heartbeat triage
- Изменено:
  - `lib/factory/observability.ts` теперь строит `failure_diagnostics`
  - `app/api/factory/studio/route.ts` возвращает этот блок в `observability`
  - `public/inferno/studio.html` показывает компактный `Run fail diagnostics`
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - Studio теперь показывает не только top error category, но и рекомендуемый первый шаг
  - triage по failing runs стал таким же short-path, как по worker heartbeat

### 2026-06-25 15:19

- Ветка: текущая рабочая ветка контент-завода
- Цель: вынести ключевые operational сигналы на главный экран Studio
- Изменено:
  - `public/inferno/studio.html` получил компактный блок `Factory health` прямо в `screenCenter`
  - в сводку выведены `ops_status`, `heartbeat_diagnostics`, `failure_diagnostics`, alert-коды и low balances
  - переход в экран worker оставлен одной кнопкой без необходимости сперва искать проблему вручную
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - command center теперь показывает, где болит pipeline, ещё до перехода в worker
  - оператор быстрее различает проблемы heartbeat, run_fail и provider balances

### 2026-06-25 15:33

- Ветка: текущая рабочая ветка контент-завода
- Цель: сократить путь от `run_fail`/`warning` до конкретного шага сбоя
- Изменено:
  - `lib/factory/observability.ts` теперь возвращает `incident_runs` по последним проблемным прогонам
  - `app/api/factory/studio/route.ts` добавляет `incident_runs` в default observability contract
  - `public/inferno/studio.html` показывает compact `incident runs` внутри `Execution observability`
  - `EXECUTION_OBSERVABILITY.md` обновлён под новый contract
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - triage warning/run_fail теперь идёт через короткий operational tail, а не через разбор полного `execution_log`
  - легче увидеть связку `recipe -> run -> last_step -> error_category`

### 2026-06-25 15:48

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать KPI `10 успешных прогонов подряд` видимым прямо в Studio
- Изменено:
  - `lib/factory/observability.ts` теперь возвращает `stability_snapshot` по последним 10 прогонам
  - `app/api/factory/studio/route.ts` добавляет `stability_snapshot` в default observability contract
  - `public/inferno/studio.html` показывает compact блок `10-run stability`
  - `EXECUTION_OBSERVABILITY.md` обновлён под новый KPI contract
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - KPI спринта теперь читается из живых данных, а не только из markdown-отчёта
  - оператор сразу видит streak и понимает, добили ли мы целевые `10/10`

### 2026-06-25 16:02

- Ветка: текущая рабочая ветка контент-завода
- Цель: вынести stability snapshot в отдельный backend contract для Milestone 3
- Изменено:
  - `lib/factory/observability.ts` получил `buildStabilityReport`
  - добавлен `GET /api/factory/stability`
  - `lib/factory/stressGraphRun.mjs` теперь печатает `STABILITY ...` после `SUMMARY ...`
  - `EXECUTION_OBSERVABILITY.md` обновлён под новый route
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - stress loop и Studio теперь могут опираться на один stability contract
  - KPI `10/10` стал доступен automation-friendly, без парсинга UI

### 2026-06-25 16:18

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать дублирование backend snapshot path в Milestone 3 cleanup
- Изменено:
  - добавлен shared loader `lib/factory/runSnapshots.ts`
  - `app/api/factory/ops/route.ts` переведён на shared observability snapshot
  - `app/api/factory/worker-state/route.ts` переведён на shared observability snapshot
  - `app/api/factory/stability/route.ts` переведён на shared stability snapshot
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - у ops/worker/stability теперь один canonical backend path для последних recipe runs
  - следующий change в snapshot-логике не придётся размазывать по нескольким route handler

### 2026-06-25 16:31

- Ветка: текущая рабочая ветка контент-завода
- Цель: довести stress/report loop до удобного артефакта, а не только stdout
- Изменено:
  - `lib/factory/stressGraphRun.mjs` получил `--json-out` и `--md-out`
  - раннер теперь умеет сохранять machine-readable и human-readable отчёт серии
  - `STABILITY_REPORT.md` обновлён с примерами запуска
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - Milestone 3 получил нормальный stress artifact path
  - серию прогонов можно сохранять без копипасты из терминала

### 2026-06-25 16:39

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать latest stress report стандартным поведением, а не ручной опцией
- Изменено:
  - `lib/factory/stressGraphRun.mjs` теперь по умолчанию пишет в `docs/factory-latest-stress.json` и `docs/factory-latest-stress.md`
  - latest-режим можно выключить через `--latest=false`
  - `STABILITY_REPORT.md` обновлён под новый default flow
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - у stress loop появился предсказуемый latest-report path
  - команде не нужно каждый раз придумывать имя файла или помнить флаги

### 2026-06-25 16:52

- Ветка: текущая рабочая ветка контент-завода
- Цель: показать latest stress artifact прямо в Studio
- Изменено:
  - добавлен shared reader `lib/factory/stabilityArtifacts.ts`
  - `app/api/factory/ops/route.ts` и `app/api/factory/worker-state/route.ts` теперь возвращают `latest_stress`
  - `public/inferno/studio.html` показывает latest stress summary в command center и worker screen
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - последний stress-run теперь виден прямо в интерфейсе
  - оператору не нужно открывать `docs/factory-latest-stress.*` вручную

### 2026-06-25 17:02

- Ветка: текущая рабочая ветка контент-завода
- Цель: formal closeout по Milestone 2 и зафиксированный переход в late-stage Milestone 3
- Изменено:
  - `EXECUTION_OBSERVABILITY.md` переведён в статус `Milestone 2 — complete`
  - добавлен явный блок `Milestone 2 Closeout`
  - next-step секция обновлена под текущий state завода
- Проверки:
  - документационный апдейт, без изменения runtime-контракта
- Результат:
  - статус milestone больше не висит в неопределённости
  - следующий этап можно вести как отдельный cleanup/closeout Milestone 3, а не как хвост Milestone 2

### 2026-06-25 17:11

- Ветка: текущая рабочая ветка контент-завода
- Цель: formal closeout по Milestone 3 и явный backlog хвостов
- Изменено:
  - `STABILITY_REPORT.md` получил блок `Milestone 3 Closeout`
  - оставшиеся хвосты разделены на `P1 backlog` и `P2 backlog`
- Проверки:
  - документационный апдейт, без изменения runtime-контракта
- Результат:
  - Milestone 3 теперь закрыт как отдельный этап
  - следующий milestone можно открывать без скрытого долга и без “висящего” статуса

### 2026-06-25 17:26

- Ветка: текущая рабочая ветка контент-завода
- Цель: начать следующий этап с quality-signal visibility, не ломая fail-open выпуск
- Изменено:
  - `app/api/factory/video-critic/route.ts` теперь явно возвращает `basis: model|text|fallback`
  - `lib/factory/graphRun.ts` сохраняет `otk.basis` в `run_plan`
  - `lib/factory/observability.ts` строит `quality_signal`
  - `app/api/factory/studio/route.ts` получил честный default contract для `quality_signal`
  - `public/inferno/studio.html` показывает compact блок `Quality signal`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - Studio теперь видит, когда критик работает по модели, а когда по text/fallback
  - quality growth можно вести без возврата к fail-closed логике

### 2026-06-25 17:39

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать quality-signal operational, а не только визуальным
- Изменено:
  - `app/api/factory/ops/route.ts` теперь учитывает `quality_signal` в alerts, suggested actions и ops status
  - высокий `fallback_ratio` критика теперь поднимает отдельный ops signal
  - доминирование `text` basis тоже видно как мягкая деградация quality path
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - качество сигнала критика теперь попало в operational контур
  - система раньше подсказывает, что деградирует не сам выпуск, а его quality-evaluation слой

### 2026-06-25 17:52

- Ветка: текущая рабочая ветка контент-завода
- Цель: различать не только `fallback`, но и причину деградации quality path
- Изменено:
  - `app/api/factory/video-critic/route.ts` теперь возвращает `basis_reason`
  - `lib/factory/graphRun.ts` сохраняет `otk.basis_reason`
  - `lib/factory/observability.ts` строит `quality_signal.top_basis_reason`
  - `public/inferno/studio.html` показывает top basis reason в `Quality signal`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - quality hardening теперь можно делать адресно: видно, это upstream, timeout, empty response или text-parse path
  - контур наблюдаемости стал годиться не только для мониторинга, но и для следующего цикла улучшений

### 2026-06-25 18:06

- Ветка: текущая рабочая ветка контент-завода
- Цель: превратить `basis_reason` в operational сигнал, а не просто подпись в UI
- Изменено:
  - `app/api/factory/ops/route.ts` теперь учитывает `quality_signal.top_basis_reason`
  - ops alerts различают `upstream_unavailable`, `timeout`, `model_empty_response`, `text_empty_response`
  - suggested actions теперь дают отдельные ходы: `inspect_claude_upstream`, `inspect_video_critic_timeout_budget`, `inspect_video_critic_structured_output`, `inspect_text_critic_fallback`
  - `ops_status` поднимает критичность выше, если quality degradation идёт из upstream-unavailable, а не из обычного text/fallback drift
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - command center теперь не просто видит, что critic деградировал, а подсказывает, куда идти первым
  - triage quality path стал короче: меньше ручного чтения run artifacts перед первым решением

### 2026-06-25 18:19

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать лишний шум с экрана `Railway worker`
- Изменено:
  - `public/inferno/studio.html` убран дублирующий верхний блок `Очередь`
  - те же queue counters перенесены в `Queue snapshot`, рядом с реальным списком задач
  - удалён нижний блок `Источники`, который занимал место, но редко помогал принятию решений
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Наблюдение:
  - во время параллельного прогона после `next build` был разовый transient `.next/types/validator.ts -> routes.js`, повторный отдельный `tsc` прошёл без ошибок
- Результат:
  - worker screen стал компактнее и сфокусирован на heartbeat, current task, ops и реальной очереди
  - меньше визуальных дублей, быстрее читается при ночном дежурстве

### 2026-06-25 18:31

- Ветка: текущая рабочая ветка контент-завода
- Цель: дополировать `latest stress` blocks в Studio
- Изменено:
  - `public/inferno/studio.html` перевёл `Latest stress` на compact chips вместо длинных строк
  - summary в `Factory health` теперь показывает `stress`, `avg`, `streak`, timestamp более плотным scan-friendly форматом
  - worker screen `Latest stress` тоже сжат до коротких метрик `runs/fails/warn/avg` и `streak/target`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - один из оставшихся P2 из `STABILITY_REPORT.md` фактически закрыт
  - observability/stress слой стал удобнее именно для операторского чтения, без изменения backend-логики

### 2026-06-25 18:44

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать ложные manual-heal CTA с legacy execution surface
- Изменено:
  - `public/inferno/studio.html` получил флаг `SELF_HEAL_ENABLED=false`
  - helper `selfHeal(...)` теперь сразу возвращает disabled-note и не делает fetch, если manual heal выключен
  - из rail pulse, worker pulse и recipe cards убраны живые кнопки `wake/rejudge`
  - вместо них Studio честно показывает `manual heal off · sprint 1` / `heal off`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Наблюдение:
  - при параллельном `build + tsc` снова всплыл transient `.next/types/validator.ts -> routes.js`; отдельный повторный `tsc` прошёл чисто
- Результат:
  - UI больше не обещает ручную самопочинку там, где backend уже intentionally disabled
  - legacy execution surface стал честнее и чище для оператора

### 2026-06-25 18:57

- Ветка: текущая рабочая ветка контент-завода
- Цель: синхронизировать experimental variants UI с Sprint 1 режимом
- Изменено:
  - `public/inferno/studio.html` получил флаг `EXPERIMENTAL_VARIANTS_ENABLED=false`
  - hook-node inspector больше не показывает живую кнопку `Хук-турнир`, когда variants path выключен; вместо неё честная пометка `hook tournament off · sprint 1`
  - `runHookTournament(...)` теперь short-circuit'ится с toast, если experimental variants выключены
  - в recipe cards `🔀` заменён на `variants off`, чтобы не дёргать disabled `/api/factory/recipe-variants`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Наблюдение:
  - при параллельном `build + tsc` transient `.next/types` снова воспроизвёлся; отдельный повторный `tsc` прошёл чисто
- Результат:
  - Studio больше не подталкивает пользователя к отключённым A/B-механикам
  - Sprint 1 surface стал ближе к реальной MVP-архитектуре без скрытых продуктовых хвостов

### 2026-06-25 19:11

- Ветка: текущая рабочая ветка контент-завода
- Цель: дочистить тексты и disabled routes под реальный Sprint 1 режим
- Изменено:
  - `public/inferno/studio.html`:
    - worker coaching больше не советует «будить» воркер вручную, а ведёт к heartbeat/sender/blocker triage
    - смета прогона теперь честно говорит, что `variants path` выключен в Sprint 1
  - `app/api/factory/recipe-variants/route.ts` очищен до минимального disabled-stub
  - `app/api/factory/variations/route.ts` очищен до минимального disabled-stub
  - `app/api/factory/hook-judge/route.ts` очищен до минимального disabled-stub
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - меньше мёртвого кода в отключённых API-path
  - Studio и backend surface теперь лучше совпадают и по действиям, и по текстам

### 2026-06-25 19:24

- Ветка: текущая рабочая ветка контент-завода
- Цель: ужать disabled batch-build surface до stub-уровня
- Изменено:
  - `app/api/factory/batch-build/route.ts` очищен до минимального disabled-stub (`POST` + `GET`)
  - `app/api/factory/batch-build/tick/route.ts` очищен до минимального disabled-stub
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - из runtime surface убрана мёртвая async-очередь batch-build
  - Sprint 1 disabled-контуры стали не только выключены, но и реально проще по коду и импорту зависимостей

### 2026-06-25 19:37

- Ветка: текущая рабочая ветка контент-завода
- Цель: зафиксировать в архитектурных доках переход disabled-контуров к stub-route уровню
- Изменено:
  - `SYSTEM_EXECUTION_MAP.md` теперь различает просто `disabled` и `disabled stub route`
  - в execution map добавлена явная пометка, что `watchdog`, `self-heal`, `batch-build`, `variations`, `recipe-variants`, `hook-judge`, `scenario-rewrite` сведены к compatibility contracts без скрытой runtime-логики
  - `ARCHITECTURE_AUDIT.md` обновлён: Sprint 1 рекомендация теперь явно предпочитает tiny stub routes вместо legacy-реализаций за ранним `return`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - docs теперь отражают реальное состояние кода, а не только план отключения
  - future cleanup и возможный re-enable будут опираться на более честную execution map

### 2026-06-25 19:49

- Ветка: текущая рабочая ветка контент-завода
- Цель: честно размечать `jobs/*` как compatibility-live, а не как “кандидат на мгновенный stub”
- Изменено:
  - `SYSTEM_EXECUTION_MAP.md` теперь явно фиксирует, что `jobs/*` ещё жив из-за `patrick-legacy.html` и `/api/sync/all`
  - `ARCHITECTURE_AUDIT.md` обновлён: `jobs/*` отмечен как контур, который нельзя схлопывать до stub до миграции зависимостей
  - комментарии в `app/api/factory/jobs/enqueue/route.ts`, `app/api/factory/jobs/tick/route.ts`, `app/api/factory/jobs/list/route.ts` теперь прямо называют этот контур compatibility-live
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - следующий этап cleanup не перепутает `jobs/*` со stub-кандидатами
  - архитектурная карта теперь различает `disabled stub` и `compatibility-live legacy`

### 2026-06-25 20:02

- Ветка: текущая рабочая ветка контент-завода
- Цель: оформить отдельный migration backlog для вывода `jobs/*`
- Изменено:
  - создан `docs/factory-jobs-migration-backlog.md`
  - backlog описывает:
    - живые зависимости (`patrick-legacy.html`, `/api/sync/all`)
    - целевое состояние после миграции
    - этапы `M1..M4`
    - риски и exit criteria
  - `SYSTEM_EXECUTION_MAP.md` и `ARCHITECTURE_AUDIT.md` теперь ссылаются на этот backlog
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - вывод `jobs/*` из системы теперь стал отдельной явной задачей, а не размытой идеей
  - следующий этап можно брать как нормальный migration milestone

### 2026-06-25 20:14

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать `patrick-legacy` честнее по отношению к legacy queue
- Изменено:
  - `public/inferno/patrick-legacy.html` теперь маркирует queue-кнопки как `Legacy очередь`
  - queue summary в legacy cockpit явно подписан как compatibility-live контур
  - комментарии в `patrick-legacy.html` теперь тоже различают legacy queue и канонический `graph-run` path
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - `M1` migration backlog получил безопасный подготовительный шаг
  - legacy cockpit меньше маскирует переходный контур под основной execution path

### 2026-06-25 20:21

- Ветка: текущая рабочая ветка контент-завода
- Цель: зафиксировать `M1-prep` в backlog вывода `jobs/*`
- Изменено:
  - `docs/factory-jobs-migration-backlog.md` теперь явно отмечает:
    - prep done: `patrick-legacy.html` уже маркирует queue как `compatibility-live`
    - not done yet: launch-flow всё ещё сидит на `jobs/enqueue` + `jobs/list`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - следующий заход в `M1` можно начинать уже с содержательной миграции, а не с повторной разведки

### 2026-06-25 20:33

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать первый реальный `M1` шаг по снятию UI-зависимости от `jobs/*`
- Изменено:
  - `public/inferno/patrick-legacy.html` получил `legacyQueueLaunchEnabled: false`
  - кнопка `Legacy очередь (фоном)` теперь отключена
  - legacy cockpit показывает явное предупреждение, что запуск новых задач через legacy queue заморожен
  - `enqueueServer()` short-circuit'ится и не создаёт новые jobs во время миграции
  - `docs/factory-jobs-migration-backlog.md` обновлён: `M1` теперь имеет статус `partial done`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - `patrick-legacy` больше не создаёт новые задачи через legacy queue
  - UI-зависимость от `jobs/enqueue` заметно ослаблена, при этом progress/read-only compatibility path сохранён

### 2026-06-25 20:45

- Ветка: текущая рабочая ветка контент-завода
- Цель: завершить UI-часть `M1` и снять чтение `jobs/list` из `patrick-legacy`
- Изменено:
  - `public/inferno/patrick-legacy.html` получил `legacyQueueReadEnabled: false`
  - кнопка polling legacy-очереди отключена
  - `loadJobs()` и `_startJobsPoll()` short-circuit'ятся и больше не ходят в `jobs/list`
  - в UI добавлено явное предупреждение, что чтение legacy queue из кокпита тоже заморожено на время миграции
  - `docs/factory-jobs-migration-backlog.md` обновлён: UI-часть `M1` теперь done
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - `patrick-legacy` больше не пишет и не читает `jobs/*`
  - следующая реальная зависимость для снятия — backend wake в `/api/sync/all`

### 2026-06-25 20:58

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать ложные следы старой очереди из factory-доков
- Изменено:
  - `docs/content-factory-spec.md` теперь прямо говорит, что `jobs/tick` — исторический путь, а канон уже `graph-run`
  - `docs/factory-v3-tz.md` обновлён: `graph-run` больше не описан как thin wrapper над `jobs/tick`
  - `docs/factory-shotstack-tz.md` больше не называет `jobs/*` единственным конвейером после слияния
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - старые factory-доки меньше навязывают устаревшую модель очереди
  - cleanup почти дошёл до точки, где следующий реальный шаг уже вне мандата контент-завода

### 2026-06-25 21:12

- Ветка: текущая рабочая ветка контент-завода
- Цель: снять последнюю repo-level runtime-зависимость от legacy queue через `/api/sync/all`
- Изменено:
  - из `app/api/sync/all/route.ts` удалён backstop wake на `POST /api/factory/jobs/tick`
  - `docs/factory-jobs-migration-backlog.md` обновлён: `M2` теперь done, current state описывает отсутствие известных repo-callers
  - `SYSTEM_EXECUTION_MAP.md` обновлён: `jobs/*` теперь помечен как `compatibility-live without active repo callers`
  - `ARCHITECTURE_AUDIT.md` обновлён: зафиксировано, что preconditions для stubbing уже выполнены
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "api/factory/jobs/(tick|enqueue|list)|jobs/tick|jobs/enqueue|jobs/list" app public lib`
- Результат:
  - старый `jobs/*` больше не участвует в runtime orchestration через UI или общий sync-cron
  - следующий логичный шаг — схлопнуть `jobs/enqueue`, `jobs/list`, `jobs/tick` до disabled stub routes и затем удалить legacy implementation
  - `npm run build` зелёный
  - повторный `tsc` после завершённого build зелёный; первый параллельный запуск снова поймал transient `.next/types/validator.ts` noise

### 2026-06-25 21:28

- Ветка: текущая рабочая ветка контент-завода
- Цель: завершить `M3` и реально убрать legacy queue runtime из `jobs/*`
- Изменено:
  - `app/api/factory/jobs/enqueue/route.ts` очищен до disabled stub route
  - `app/api/factory/jobs/list/route.ts` очищен до disabled stub route с пустым `summary/jobs`
  - `app/api/factory/jobs/tick/route.ts` очищен до disabled stub route
  - `lib/factory/jobs.ts` удалён, так как живых импортов после stubbing не осталось
  - `docs/factory-jobs-migration-backlog.md`, `SYSTEM_EXECUTION_MAP.md`, `ARCHITECTURE_AUDIT.md` обновлены под новый статус `disabled stub`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "from \\\"@/lib/factory/jobs\\\"|from '@/lib/factory/jobs'|lib/factory/jobs" app lib public docs`
- Результат:
  - `jobs/*` больше не несёт runtime orchestration logic
  - legacy queue implementation выведена из active code path
  - следующий шаг сместился из runtime cleanup в doc cleanup (`M4`)
  - `npm run build` зелёный
  - repo больше не содержит живых импортов `lib/factory/jobs` в коде; остались только historical doc mentions
  - повторный отдельный `tsc` после build зелёный; параллельный запуск по-прежнему может ловить transient `.next/types/validator.ts` noise

### 2026-06-25 21:44

- Ветка: текущая рабочая ветка контент-завода
- Цель: пройти `M4` по factory-docs и убрать ложное ощущение, что `jobs/*` всё ещё живой execution contour
- Изменено:
  - `docs/content-factory-spec.md` теперь прямо говорит, что `jobs/*` уже сведён к disabled stub уровню
  - `docs/factory-shotstack-tz.md` переведён с `compatibility-live` на historical/stub framing
  - `docs/factory-v3-roadmap.md` больше не отправляет читателя чинить `jobs/tick`
  - `docs/factory-viral-plan.md` получил явную historical note и несколько замен `jobs/tick` → `graph-run` / `execution runner`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "jobs/tick|lib/factory/jobs|compatibility-live|jobs/enqueue|jobs/list" docs/factory-*.md docs/content-factory*.md`
- Результат:
  - в factory-docs почти не осталось опасных ссылок, которые звучат как текущая runtime-архитектура
  - оставшиеся упоминания в основном либо backlog/history, либо сознательно historical context

### 2026-06-25 21:58

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть `M4` до уровня repo-truth и убрать последние живые ссылки на старую очередь в активных factory-spec docs
- Изменено:
  - `docs/factory-v3-autopilot-tz.md` переведён с `self-chaining очередь` на `graph-run execution runner`
  - `docs/factory-v3-tz.md` больше не называет `jobs.ts` reusable execution core; reused core теперь `graph-run`
  - `docs/factory-jobs-migration-backlog.md` получил явный status для `M4` и фиксацию, что migration complete внутри repo
  - `docs/content-factory-spec.md` больше не описывает server-side execution как абстрактную legacy queue
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "self-chaining очередь|jobs/tick|lib/factory/jobs|compatibility-live|jobs/enqueue|jobs/list" docs/factory-*.md docs/content-factory*.md`
- Результат:
  - `M4` практически закрыт: активные factory-spec docs уже говорят на языке `graph-run`
  - в repo остаются в основном backlog/history mentions, а не вводящие в заблуждение runtime-описания
  - `npm run build` зелёный
  - `npx tsc --noEmit --pretty false` зелёный
  - финальный `rg` подтверждает: в активных factory-spec docs остались в основном conscious historical mentions, backlog и night-log, а не живые runtime-инструкции

### 2026-06-25 22:09

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать из `patrick-legacy` последний мёртвый UI-хвост старой queue-модели
- Изменено:
  - из `public/inferno/patrick-legacy.html` удалены кнопки запуска/polling legacy queue
  - удалены JS-методы `enqueueServer`, `loadJobs`, `_startJobsPoll`
  - удалены `legacyQueue*` state fields и queue summary block
  - вместо этого в setup-screen оставлена честная ссылка на `V3 studio` и note, что канонический execution path уже `graph-run`
- Проверки:
  - `rg -n "enqueueServer|loadJobs\\(|_startJobsPoll|legacyQueueLaunchEnabled|legacyQueueReadEnabled|jobsSummary|_jobsPoll" public/inferno/patrick-legacy.html`
  - `npm run build`
- Результат:
  - legacy cockpit больше не содержит dead controls для уже удалённого queue-runtime
  - интерфейс стал честнее: historical surface без фальшивых кнопок и ложных ожиданий

### 2026-06-25 22:29

- Ветка: текущая рабочая ветка контент-завода
- Цель: довести `patrick-legacy` до честного legacy-позиционирования и закрыть verification loop
- Изменено:
  - `public/inferno/patrick-legacy.html` явно переименован в `Контент-завод Legacy`
  - в header добавлен badge `historical surface`
  - добавлен amber-banner с прямым указанием, что новые запуски и orchestration идут через `V3 studio` и `graph-run`
  - copy на экране приведён к режиму historical/operator surface без двусмысленности
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `rg -n "Контент-завод Legacy|historical surface|V3 studio|graph-run" public/inferno/patrick-legacy.html`
- Результат:
  - legacy screen теперь не только не содержит dead queue-controls, но и визуально не маскируется под живой production cockpit
  - проверка типов зелёная
  - пользовательский сигнал стал чище: рабочий execution path завода читается как `V3 studio` + `graph-run`

### 2026-06-25 22:35

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать лишний UI-шум из живого `V3 studio`, чтобы оператор видел execution path, а не декоративные хвосты
- Изменено:
  - `public/inferno/studio.html`: экран `Railway worker` упрощён до `heartbeat · current task · queue`
  - убрана кнопка `🧠 Обучение` из header worker-экрана
  - убраны вторичные блоки `Factory pulse` и `Service balances` с dedicated worker-screen
  - из command center удалена disabled-кнопка `+ Новая ниша`, которая не была подключена и только создавала ложное ожидание
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "\\+ Новая ниша|Factory pulse|Service balances|header\\(\\\"Railway worker\\\",\\\"heartbeat · current task · queue\\\"" public/inferno/studio.html`
- Результат:
  - worker-screen стал более операционным: меньше отвлекающего health-noise, больше фокуса на heartbeat, current task и очереди
  - command center стал честнее и компактнее
  - сборка и типы зелёные

### 2026-06-25 22:44

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать скрытую оркестрацию из read-path `graph-run`, чтобы polling не запускал execution побочным эффектом
- Изменено:
  - `app/api/factory/graph-run/route.ts`: `GET /api/factory/graph-run` больше не дёргает `graph-run/tick`
  - read-path оставлен read-only: запуск и продолжение исполнения теперь живут только в `POST /graph-run`, self-chain `graph-run/tick` и cron-страховке
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "canNudge|GET.*tick|status polling|graph-run.*GET.*tick|пинк|nudge" ARCHITECTURE_AUDIT.md SYSTEM_EXECUTION_MAP.md docs/factory-*.md docs/content-factory*.md app/api/factory/graph-run/route.ts`
- Результат:
  - status polling больше не меняет состояние execution-контура
  - уменьшен один из скрытых duplicate-orchestration paths
  - сборка и типы зелёные

### 2026-06-25 22:56

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать дублирование step-runner логики между `graph-run/tick` и cron-watchdog
- Изменено:
  - в `lib/factory/graphRun.ts` вынесен общий helper `advanceClaimedRecipe`
  - `app/api/factory/graph-run/tick/route.ts` переведён на этот helper
  - `lib/factory/graphWatchdog.ts` тоже переведён на тот же helper
  - retry/attempts/reset_step_attempts/persist-on-fail policy теперь живут в одном месте вместо двух почти одинаковых реализаций
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "advanceClaimedRecipe|MAX_STEP_ATTEMPTS|reset_step_attempts|plan\\.attempts = attempts|status: \\\"run_fail\\\"" lib/factory/graphRun.ts lib/factory/graphWatchdog.ts app/api/factory/graph-run/tick/route.ts`
- Результат:
  - execution core стал проще и консистентнее
  - снижен риск, что tick и watchdog будут по-разному обрабатывать один и тот же step-failure
  - сборка и типы зелёные

### 2026-06-25 23:05

- Ветка: текущая рабочая ветка контент-завода
- Цель: синхронизировать repo-truth вокруг disabled wake-paths и убрать лишний compatibility-noise
- Изменено:
  - `app/api/factory/graph-run/watchdog/route.ts` очищен от мёртвых импортов и явно помечен как historical compatibility stub
  - `app/api/factory/self-heal/route.ts` комментариями приведён к реальному Sprint 1 статусу: disabled stub, а не живой repair path
  - `SYSTEM_EXECUTION_MAP.md` обновлён: `GET /api/factory/graph-run` больше не фигурирует как wake mechanism
  - `ARCHITECTURE_AUDIT.md` обновлён: активные wake-paths теперь зафиксированы как `graph-run/tick` self-chain + cron fallback
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `rg -n 'GET-based resurrection|read-only|duplicate wake source|Historical compatibility stub|graph-run/tick self-chain plus cron fallback' SYSTEM_EXECUTION_MAP.md ARCHITECTURE_AUDIT.md app/api/factory/graph-run/watchdog/route.ts app/api/factory/self-heal/route.ts`
- Результат:
  - код, комментарии и архитектурные доки снова описывают один и тот же execution model
  - уменьшен риск, что следующий проход будет опираться на устаревшую схему wake/resurrection

### 2026-06-25 23:14

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать cron-backstop более предсказуемым и менее burst-heavy
- Изменено:
  - `lib/factory/graphWatchdog.ts`: `wakeStaleRecipes(...)` переведён с `Promise.all(...)` на последовательный проход по stuck recipe
  - `SYSTEM_EXECUTION_MAP.md` теперь явно фиксирует, что `graph-run/cron` будит stale runs последовательно
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "Promise\\.all\\(|последователь|serial|burst-runner|wakeStaleRecipes" lib/factory/graphWatchdog.ts SYSTEM_EXECUTION_MAP.md ARCHITECTURE_AUDIT.md`
- Результат:
  - fallback-контур стал спокойнее: меньше шанс, что cron сам создаст параллельный всплеск дорогих шагов поверх живого self-chain
  - execution model для Sprint 1 стал ещё ближе к цели "один основной runner + одна предсказуемая страховка"

### 2026-06-25 23:22

- Ветка: текущая рабочая ветка контент-завода
- Цель: ещё сильнее сузить rescue-policy cron под стабильный MVP
- Изменено:
  - `lib/factory/graphWatchdog.ts`: `DEFAULT_MAX_WAKE` уменьшен с `10` до `3`
  - `SYSTEM_EXECUTION_MAP.md`: rescue-pass явно описан как small batch (`maxWake=3`)
  - `ARCHITECTURE_AUDIT.md`: cron fallback зафиксирован как sequential + small-batch path
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "DEFAULT_MAX_WAKE|maxWake=3|small batch|sequential and capped" lib/factory/graphWatchdog.ts SYSTEM_EXECUTION_MAP.md ARCHITECTURE_AUDIT.md`
- Результат:
  - cron-страховка стала ещё менее похожа на второй полноценный orchestrator
  - уменьшен объём одновременного rescue-work при накоплении stale recipe
  - политика backstop теперь лучше соответствует цели Sprint 1: надёжность важнее throughput

### 2026-06-25 23:31

- Ветка: текущая рабочая ветка контент-завода
- Цель: обновить formal closeout `Milestone 3` под фактическое состояние execution-core после поздних cleanup-правок
- Изменено:
  - `STABILITY_REPORT.md` синхронизирован с текущей repo-truth
  - в `What Was Changed In Sprint 1` убрана устаревшая формулировка про `GET /graph-run` как wake-path
  - `Milestone 3 Closeout` теперь включает:
    - read-only `GET /graph-run`
    - shared helper `advanceClaimedRecipe(...)`
    - sequential + small-batch cron fallback (`maxWake=3`)
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `rg -n "GET /api/factory/graph-run|advanceClaimedRecipe|maxWake=3|Milestone 3 Closeout|cleanup execution orchestration" STABILITY_REPORT.md`
- Результат:
  - `Milestone 3` теперь закрыт не только по runtime-факту, но и по актуальным документам
  - остатки переведены в явный backlog, а не висят как скрытый mid-flight статус

### 2026-06-25 23:42

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть один из явных post-M3 `P1` по bank/gen-save semantics
- Изменено:
  - `lib/factory/graphRun.ts`: если `gen-save` в шаге `bank` не сохранил asset, в warnings теперь явно добавляется `gen-save warning: ...`
  - итоговый статус рецепта больше не может остаться слишком оптимистичным при `catalog_error`: fail-open сохраняется, но финал помечается `warning`
  - `STABILITY_REPORT.md` обновлён: `P1-2` переведён из "надо сделать" в "runtime-policy закрыта, осталось наблюдение"
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false` (standalone rerun после известного transient `.next/types/validator.ts`)
  - `rg -n "gen-save warning|catalogError|finalStatus = summarizeWarnings|qualityStatus" lib/factory/graphRun.ts STABILITY_REPORT.md`
- Результат:
  - bank-step стал честнее по итоговой семантике
  - один из заметных `P1` после Milestone 3 фактически закрыт без расширения архитектуры

### 2026-06-25 23:51

- Ветка: текущая рабочая ветка контент-завода
- Цель: дочистить error-contract consistency в живых factory routes без ломки legacy-клиентов
- Изменено:
  - `app/api/factory/creatify-avatars/route.ts`: ошибка недоступного Creatify теперь возвращается как `error` + `detail`
  - `app/api/factory/ugc-creatify/route.ts`: 503 / 422 / 400 / 502 ответы переведены на канонический `error`, при этом `detail` оставлен как compatibility mirror
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false` (standalone rerun после известного transient `.next/types/validator.ts`)
  - `rg -n "error, detail|detail: error|quality gate" app/api/factory/ugc-creatify/route.ts app/api/factory/creatify-avatars/route.ts`
- Результат:
  - живые factory clients могут опираться на единообразный `error` field
  - compatibility с возможными старыми потребителями `detail` не потеряна

### 2026-06-26 00:02

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть ещё один backend `P2`, где DB-сбой мог маскироваться под "просто пусто"
- Изменено:
  - `app/api/factory/assemble/route.ts`: lookup в `product_costs` теперь тоже пишет в общий `dbErr`
  - ошибки `product_costs` и `content_assets` больше не теряются отдельно друг от друга
  - роут по-прежнему отдаёт `404` на реально пустую библиотеку, но при DB-проблеме теперь честно отвечает `500` с `{ error }`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "dbErr|product_costs|сбой запроса библиотеки|не маскируем сбой БД" app/api/factory/assemble/route.ts`
- Результат:
  - `assemble` меньше маскирует инфраструктурную проблему под контентную пустоту
  - ещё один старый backend `P2` из factory QA фактически закрыт

### 2026-06-26 00:12

- Ветка: текущая рабочая ветка контент-завода
- Цель: усилить диагностику `media-store`, чтобы partial upload failures не выглядели как немая магия
- Изменено:
  - `app/api/factory/media-store/route.ts` теперь собирает краткие per-slide ошибки при upload/publicUrl failures
  - при полном провале роут отдаёт `{ error, attempted, failed[] }`
  - при частичном успехе роут отдаёт `{ urls, uploaded, skipped, warnings[] }`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "attempted|failed: errors|uploaded: urls.length|warnings: errors.slice" app/api/factory/media-store/route.ts`
- Результат:
  - оператор/клиент получает больше причинности, если часть base64-слайдов битая или storage-path спотыкается
  - diagnostic-hardening улучшен без изменения основного happy path

### 2026-06-26 00:50

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать ещё одну скрытую точку нестабильности в FAL-утилитах, где разные shape-ответы могли ломать post-processing
- Изменено:
  - `lib/factory/falVideo.ts`: добавлен helper `extractFalVideoUrl()` для нормализации `video.url`, `video_url`, `url`, `output.url`, `output`
  - `falCompose()` и `falTimeline()` больше не завязаны только на `video_url`
  - `falMergeVideos()` и `falAutoSubtitle()` больше не завязаны только на `result.video.url`
  - `falVideoStatus()` переведён на тот же helper, чтобы все FAL-пути читали результат одинаково
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "extractFalVideoUrl|falMergeVideos|falAutoSubtitle|falCompose|falTimeline" lib/factory/falVideo.ts`
- Результат:
  - utility-цепочки FAL меньше зависят от конкретного формата ответа модели/endpoint
  - закрыт ещё один backend `P2` из старого QA-хвоста без расширения поверхности системы

### 2026-06-26 01:15

- Ветка: текущая рабочая ветка контент-завода
- Цель: уменьшить flakiness LLM-роутов, где часть factory endpoints всё ещё жёстко парсила "идеальный" JSON
- Изменено:
  - `app/api/factory/niche-brief/route.ts` и `app/api/factory/niche-playbook/route.ts` переведены на общий `lib/factory/extractJson`
  - `app/api/factory/director/route.ts`, `app/api/factory/trends/route.ts`, `app/api/factory/content-learn/route.ts`, `app/api/factory/telegram/route.ts` больше не завязаны на локальный regex + `JSON.parse`
  - локальные дубли tolerant-JSON логики сокращены; object-style ответы теперь читаются единообразно
- Осознанно не тронуто:
  - `repurpose` и `trends/search` пока оставлены как array-specific paths; для них нужен отдельный helper, чтобы не смешивать объектный и массивный парсинг впопыхах
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "extractJson\\(|const plan = extractJson|const patterns = extractJson" app/api/factory/{niche-brief,niche-playbook,director,trends,content-learn,telegram}/route.ts`
- Результат:
  - factory-роуты спокойнее переживают markdown-ограждение, обрыв по токен-лимиту и хвостовые запятые в ответах модели
  - сокращён ещё один живой класс "иногда 502 без понятной причины" без добавления новых компонентов

### 2026-06-26 01:54

- Ветка: текущая рабочая ветка контент-завода
- Цель: добить array-style JSON parsing в factory, чтобы массивные ответы модели не зависели от идеального `[...]`
- Изменено:
  - `lib/factory/extractJson.ts`: добавлен `extractJsonArray()` с tolerant parsing для JSON-массивов
  - `app/api/factory/repurpose/route.ts` переведён с regex + `JSON.parse` на `extractJsonArray`
  - `app/api/factory/trends/search/route.ts` теперь так же толерантно читает сгенерированные ключевые фразы
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false` (отдельный rerun после известного transient `.next/types/validator.ts`)
  - `rg -n "extractJsonArray|keywords = parsed|const posts = extractJsonArray" lib/factory/extractJson.ts app/api/factory/repurpose/route.ts app/api/factory/trends/search/route.ts`
- Результат:
  - object-style и array-style LLM parsing в factory теперь покрыты общими helper'ами
  - ещё один класс случайных 502 на почти-валидных ответах модели закрыт без роста сложности

### 2026-06-26 02:03

- Ветка: текущая рабочая ветка контент-завода
- Цель: посадить критичный ОТК-маршрут на общий tolerant JSON path, не потеряв локальный salvage fallback
- Изменено:
  - `app/api/factory/video-critic/route.ts`: `parseLooseJson()` теперь сначала использует общий `extractJson()`
  - локальный fallback по осям/arrays сохранён, так что обрезанные ответы по-прежнему можно частично восстановить
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "extractJson|parseLooseJson" app/api/factory/video-critic/route.ts`
- Результат:
  - `video-critic` стал ближе к остальным factory-роутам по поведению и меньше зависит от собственного regex-path
  - ещё один риск спонтанного 502 на ОТК-петле снят без изменения продуктовой логики

### 2026-06-26 02:58

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть пару живых UI-хвостов в `studio.html`, которые мешали оператору и путали контекст
- Изменено:
  - `public/inferno/studio.html`: `go()` теперь мягко сбрасывает тред Проводника при переходе между экранами
  - в тред добавляется короткий разделитель `— переход: экран —`, а накопленный старый чат не тянется через весь UI-флоу
  - переключение инструментов в инспекторе теперь чистит чужой `preview` state, если там висела `error` или `in_progress` от другого tool
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false` (отдельный rerun после известного transient `.next/types/validator.ts`)
  - `rg -n "resetAssistantThread|clearForeignPreviewState|function go\\(" public/inferno/studio.html`
- Результат:
  - Проводник меньше тащит устаревший контекст между экранами
  - инспектор меньше показывает оператору stale-state от другого инструмента

### 2026-06-26 03:00

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать технический жаргон из пустых состояний Studio, чтобы UI разговаривал с оператором, а не с разработчиком
- Изменено:
  - `public/inferno/studio.html`: empty-state в бренд-ките больше не ссылается на `migration brand_kits`
  - `public/inferno/studio.html`: empty-state балансов больше не ссылается на `migration service_balances`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false` (отдельный rerun после известного transient `.next/types/validator.ts`)
  - `rg -n "пока нет брендов для бренд-кита|нет сервисов для показа балансов" public/inferno/studio.html`
- Результат:
  - пустые состояния Studio звучат спокойнее и чище
  - пользовательский UI меньше светит внутренние названия схем/таблиц

### 2026-06-26 03:06

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать ещё один мёртвый UI-контрол из канваса, который только создавал ожидание несуществующей функции
- Изменено:
  - `public/inferno/studio.html`: из хедера канваса убран декоративный `зум/пан — скоро` блок
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "ИИ-заполнить граф|зум/пан — скоро" public/inferno/studio.html`
- Результат:
  - хедер канваса стал чище
  - UI меньше обещает оператору функцию, которой всё равно нельзя воспользоваться

### 2026-06-26 03:12

- Ветка: текущая рабочая ветка контент-завода
- Цель: сузить MVP-навигацию Studio и убрать из неё placeholder-экран, который не участвует в текущем выпуске контента
- Изменено:
  - `public/inferno/studio.html`: экран `Тексты` убран из массива `SCREENS`
  - `restoreSession()` теперь переводит legacy `screen="text"` обратно в `center`
  - сам `screenText()` оставлен как мягкий fallback с честным сообщением, если кто-то попадёт туда напрямую
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n 'screen==="text"|Линия текстов пока выключена|Пины и карточки' public/inferno/studio.html`
- Результат:
  - боковая навигация стала ближе к реальному MVP-флоу
  - Studio меньше отвлекает на неактивную линию завода

### 2026-06-26 03:18

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать ещё один служебный экран из основной навигации Studio, не ломая прямой fallback-path
- Изменено:
  - `public/inferno/studio.html`: `Дизайн-система` убрана из массива `SCREENS`
  - `restoreSession()` теперь переводит legacy `screen="ds"` обратно в `center`
  - `screenDS()` оставлен как служебный fallback с честным сообщением, что это dev-only экран
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n 'screen==="ds"|служебный fallback|Дизайн-система' public/inferno/studio.html`
- Результат:
  - системная навигация Studio стала ещё уже и ближе к операторскому MVP
  - dev-only поверхность меньше торчит в основном UI

### 2026-06-26 03:24

- Ветка: текущая рабочая ветка контент-завода
- Цель: вычистить legacy self-heal хвост из Studio, раз в Sprint 1 ручная самопочинка всё равно отключена
- Изменено:
  - `public/inferno/studio.html`: удалён неиспользуемый helper `selfHeal()`
  - убран флаг `SELF_HEAL_ENABLED`, который больше только шумел в UI
  - вместо старых `manual heal off / heal off` оставлен спокойный статус `sprint 1 · fail-open`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false` (отдельный rerun после известного transient `.next/types/validator.ts`)
  - `rg -n 'SELF_HEAL_ENABLED|selfHeal\\(|manual heal|heal off|fail-open' public/inferno/studio.html`
- Результат:
  - код Studio стал чуть уже и честнее отражает текущий режим Sprint 1
  - операторский UI меньше показывает legacy-подсказки про отключённую самопочинку

### 2026-06-26 03:31

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать из Studio ещё одну мёртвую experimental-ветку, чтобы оператор не видел отключённые action-потоки
- Изменено:
  - `public/inferno/studio.html`: удалён выключенный `EXPERIMENTAL_VARIANTS_ENABLED`
  - вырезан неиспользуемый UI потока `hook tournament` в инспекторе ноды
  - удалены мёртвые helper'ы `runHookTournament()` и `openHookPicker()`
  - из карточек библиотеки убран legacy action для `recipe-variants`, который всё равно был недоступен в Sprint 1
- Проверки:
  - `rg -n 'EXPERIMENTAL_VARIANTS_ENABLED|runHookTournament|openHookPicker|hook tournament|recipe-variants' public/inferno/studio.html`
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - Studio стала ближе к реальному Sprint 1 MVP без ложных кнопок и выключенных веток
  - код фронта упростился: меньше мёртвых состояний, меньше лишних сценариев для сопровождения

### 2026-06-26 03:39

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать расхождение в разборе LLM-ответов между живыми factory route'ами и перевести их на общий tolerable parser
- Изменено:
  - `app/api/factory/autofill/route.ts`: локальный `looseJson()` удалён, route переведён на `extractJson()`
  - `app/api/factory/broll/route.ts`: удалён локальный `parseJson()`, разбор ответа Claude теперь идёт через `extractJson()`
  - `app/api/factory/scripts/route.ts`: самодельный `extractScripts()` заменён на общий `extractJsonArray()`
- Проверки:
  - `rg -n 'looseJson|function parseJson|function extractScripts|extractJsonArray\\(|extractJson\\(' app/api/factory/autofill/route.ts app/api/factory/broll/route.ts app/api/factory/scripts/route.ts`
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - живые LLM-path теперь ближе по поведению при markdown-обёртке, хвостовых запятых и обрезанном JSON
  - уменьшено дублирование parsing-логики, значит ниже риск, что один маршрут переживает битый ответ модели, а соседний падает 502

### 2026-06-26 03:47

- Ветка: текущая рабочая ветка контент-завода
- Цель: довести до общего tolerant parsing ещё и внешние video/API-интеграции, чтобы баланс/submit-ответы не зависели от локальных `JSON.parse(text)`-веток
- Изменено:
  - `lib/factory/creatify.ts`: `creatifyBalance()` и `jpost()` переведены на общий `extractJson()`
  - `lib/factory/falVideo.ts`: `falBalance()` тоже переведён на `extractJson()`
- Проверки:
  - `rg -n 'extractJson\\(|JSON\\.parse\\(text\\)' lib/factory/creatify.ts lib/factory/falVideo.ts`
  - `npm run build`
  - `npx tsc --noEmit --pretty false` (после известного transient `.next/types/validator.ts` сделан отдельный rerun)
- Результат:
  - FAL/Creatify-слой теперь использует тот же tolerant parsing-контракт, что и живые LLM-route'ы
  - снижен риск локального 500/diagnostic drift из-за чуть нестандартного JSON-ответа от внешнего сервиса

### 2026-06-26 03:55

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть класс ошибок, где живой factory route мог свалиться платформенным 500 без ясного JSON-диагноза
- Изменено:
  - `app/api/factory/prepare-product/route.ts`: добавлен outer `try/catch` с `prepare-product crash: ...`
  - `app/api/factory/subtitle/route.ts`: добавлен outer `try/catch` с `subtitle crash: ...`
  - `app/api/factory/scenario-quality/route.ts`: добавлен outer `try/catch` с `scenario-quality crash: ...`
- Проверки:
  - `rg -n 'prepare-product crash|subtitle crash|scenario-quality crash' app/api/factory/prepare-product/route.ts app/api/factory/subtitle/route.ts app/api/factory/scenario-quality/route.ts`
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - подготовка ассетов, субтитры и quality-check теперь отдают явный JSON-диагноз даже при throw внутри helper'ов
  - меньше шансов получить “тихое” platform-level 500 без понятного контекста в factory execution path

### 2026-06-26 04:03

- Ветка: текущая рабочая ветка контент-завода
- Цель: добить ещё два живых route'а из execution path и operator-facing creatify service-endpoint'ы тем же crash-contract hardening
- Изменено:
  - `app/api/factory/creatify-credits/route.ts`, `creatify-avatars/route.ts`, `creatify-voices/route.ts`, `creatify-music/route.ts`: добавлен outer `try/catch` с явным JSON-диагнозом
  - `app/api/factory/assemble/route.ts`: добавлен `assemble crash: ...`
  - `app/api/factory/wb-index/route.ts`: добавлен `wb-index crash: ...`
- Проверки:
  - `rg -n 'creatify-(credits|avatars|voices|music) crash|assemble crash|wb-index crash' app/api/factory/creatify-credits/route.ts app/api/factory/creatify-avatars/route.ts app/api/factory/creatify-voices/route.ts app/api/factory/creatify-music/route.ts app/api/factory/assemble/route.ts app/api/factory/wb-index/route.ts`
  - `npm run build`
  - `npx tsc --noEmit --pretty false` (после известного transient `.next/types/validator.ts` сделан отдельный rerun)
- Результат:
  - сервисные creatify-эндпоинты для worker/studio теперь меньше рискуют отдавать пустоту при внезапном throw
  - `assemble` и `wb-index` тоже переведены на явный JSON error-surface, что упрощает диагностику падений в живом прогоне

### 2026-06-26 04:14

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть crash-contract на ключевых execution/diagnostic endpoints без изменения успешного пути
- Изменено:
  - `app/api/factory/graph-run/tick/route.ts`: добавлен `graph-run/tick crash: ...`
  - `app/api/factory/graph-run/cron/route.ts`: добавлен `graph-run/cron crash: ...`
  - `app/api/factory/shotstack-smoke/route.ts`: добавлен `shotstack-smoke crash: ...`
  - `app/api/factory/trends/result/route.ts`: добавлен `trends/result crash: ...`
- Проверки:
  - `rg -n 'graph-run/tick crash|graph-run/cron crash|shotstack-smoke crash|trends/result crash' app/api/factory/graph-run/tick/route.ts app/api/factory/graph-run/cron/route.ts app/api/factory/shotstack-smoke/route.ts app/api/factory/trends/result/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - основной tick/cron execution loop теперь отдаёт явный JSON crash-diagnostic при неожиданном throw
  - smoke/status endpoints стали полезнее для оператора: вместо platform 500 будет понятный route-level контекст

### 2026-06-26 04:22

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать polling/status endpoints устойчивыми к throw в интеграционных helper'ах
- Изменено:
  - `app/api/factory/video-fal-status/[id]/route.ts`: добавлен `video-fal-status crash: ...`
  - `app/api/factory/ugc-creatify-status/[id]/route.ts`: добавлен `ugc-creatify-status crash: ...`
  - `app/api/factory/ugc-creatify-render/[id]/route.ts`: добавлен `ugc-creatify-render crash: ...`
  - `app/api/factory/static-status/route.ts`: добавлен `static-status crash: ...`
- Проверки:
  - `rg -n 'video-fal-status crash|ugc-creatify-status crash|ugc-creatify-render crash|static-status crash' ...`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - browser/studio polling теперь должен получать JSON `{status:"error", error:"..."}` даже при неожиданном исключении
  - меньше шансов, что оператор увидит generic non-JSON/API failure вместо понятного статуса задачи

### 2026-06-26 04:30

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть оставшиеся live route'ы без внешнего crash-contract
- Изменено:
  - `app/api/factory/jobs/corpus-cron/route.ts`: добавлен `jobs/corpus-cron crash: ...`
  - `app/api/factory/jobs/balances-cron/route.ts`: добавлен `jobs/balances-cron crash: ...`
  - `app/api/factory/corpus/sync-orbit/route.ts`: добавлен `corpus/sync-orbit crash: ...`
- Проверки:
  - `rg -n 'jobs/corpus-cron crash|jobs/balances-cron crash|corpus/sync-orbit crash' app/api/factory/jobs/corpus-cron/route.ts app/api/factory/jobs/balances-cron/route.ts app/api/factory/corpus/sync-orbit/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
  - контрольный scan: `factory route без try` → пусто для non-stub route'ов
- Результат:
  - текущий класс P1 `platform 500 без route-level JSON` закрыт по всему живому `app/api/factory`
  - фоновые cron/corpus endpoints теперь дают диагностируемый JSON even on unexpected throw

### 2026-06-26 04:37

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать helper-level падения на не-JSON ответах render-интеграций
- Изменено:
  - `lib/factory/shotstack.ts`: `shotstackSubmit()` и `shotstackStatus()` теперь парсят `r.json().catch(() => ({}))`
  - `lib/factory/remotionRender.ts`: `remotionSubmit()` и `remotionStatus()` теперь парсят `r.json().catch(() => ({}))`
- Проверки:
  - `rg -n 'r\\.json\\(\\)\\)' lib/factory/shotstack.ts lib/factory/remotionRender.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - Shotstack/Remotion helper'ы больше не превращают HTML/пустое тело при HTTP 200 в необъяснимый throw
  - graph-run/render-poll получает обычный `null`/`error` контракт, а не исключение из JSON parser

### 2026-06-26 04:44

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать Creatify helper устойчивее к не-JSON ответам API на read-only/status paths
- Изменено:
  - `lib/factory/creatify.ts`: `creatifyListCreators()`, `creatifyListAvatars()`, `creatifyGetArray()` и `creatifyStatus()` теперь используют `r.json().catch(() => ({}))`
- Проверки:
  - `rg -n 'await r\\.json\\(\\)' lib/factory/creatify.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - голосовые/музыкальные/аватарные picker paths и Creatify status меньше зависят от идеального JSON-тела ответа
  - Studio/worker получают мягкий пустой список или `status:error`, а не исключение из helper'а

### 2026-06-26 04:51

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать ещё несколько helper-level JSON parse throws из ASR/TTS/media extraction paths
- Изменено:
  - `lib/factory/asr.ts`: `transcribeFal()` теперь парсит Whisper JSON через `r.json().catch(() => ({}))`
  - `lib/factory/elevenlabs.ts`: `elevenListVoices()` теперь мягко переживает не-JSON ответ `/voices`
  - `lib/factory/serverMedia.ts`: `extractFrames()` и `extractPosterUrl()` теперь мягко переживают не-JSON ответ FAL extract-frame
- Проверки:
  - `rg -n 'await r\\.json\\(\\)' lib/factory/asr.ts lib/factory/elevenlabs.ts lib/factory/serverMedia.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - ASR, voice picker и server-side frame/poster extraction больше не падают на пустом/HTML теле ответа при HTTP 200
  - helper'ы возвращают штатный пустой/error результат, который graph-run и UI уже умеют отображать

### 2026-06-26 04:58

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть остаточные naked `r.json()` на live factory paths
- Изменено:
  - `lib/factory/telegram.ts`: Telegram API теперь возвращает `{ ok:false, error:"telegram ... не JSON" }` при не-JSON ответе
  - `lib/factory/falVideo.ts`: `falVideoSubmitDetailed()` мягко обрабатывает не-JSON success response
  - `lib/factory/trendSources.ts`: Apify dataset response теперь мягко деградирует в `[]`
  - `app/api/factory/oembed/route.ts`: oEmbed response теперь best-effort без JSON throw
  - `app/api/factory/telegram/route.ts`: internal verdict posts теперь возвращают `null` при не-JSON ответе
- Проверки:
  - `rg -n 'await r\\.json\\(\\)' lib/factory app/api/factory`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - в factory-path scan больше нет голых `await r.json()` без `.catch`
  - внешние API/внутренние POST helper'ы дают штатную мягкую деградацию вместо JSON parser exception

### 2026-06-26 05:05

- Ветка: текущая рабочая ветка контент-завода
- Цель: чуть упростить worker screen для оператора и убрать лишний технический шум
- Изменено:
  - `public/inferno/studio.html`: заголовки worker screen переведены с `Ops status / Suggested actions / Latest stress / Queue snapshot` на спокойные русские подписи
  - из видимой heartbeat diagnostics карточки убран длинный raw `cmd`, вместо него показывается короткий `next`
- Проверки:
  - `rg -n 'Состояние завода|Что сделать дальше|Диагностика heartbeat|Последний стресс-тест|Очередь задач|cmd:|Ops status|Suggested actions|Latest stress|Queue snapshot' public/inferno/studio.html`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - worker page стал менее шумным и ближе к операторскому dashboard
  - технические детали не удалены из backend-диагностики, но перестали занимать основное место в UI

### 2026-06-26 05:13

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть handler-level crash-contract на трёх важных endpoints, которые не поймал file-level scan
- Изменено:
  - `app/api/factory/products/route.ts`: добавлен `products crash: ...` и мягкий `{count:0,items:[]}` при неожиданном сбое
  - `app/api/factory/static-generate/route.ts`: добавлен `static-generate crash: ...`
  - `app/api/factory/worker-state/route.ts`: `POST` heartbeat endpoint получил `worker-state POST crash: ...`
- Проверки:
  - `rg -n 'products crash|static-generate crash|worker-state POST crash' app/api/factory/products/route.ts app/api/factory/static-generate/route.ts app/api/factory/worker-state/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - стартовый список товаров Studio, static render submit и worker heartbeat sender теперь дают route-level JSON при unexpected throw
  - уточнён подход: дальше нужен handler-level scan, потому что file-level `try` может скрывать соседний незащищённый handler

### 2026-06-26 05:24

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть crash-contract на ops/status/stability endpoints, от которых зависит worker screen и диагностика
- Изменено:
  - `app/api/factory/ops/route.ts`: `loadWorkerDocs()` и вся сборка ops snapshot теперь внутри route-level `try/catch`
  - `app/api/factory/status/route.ts`: добавлен общий `status crash: ...` с безопасной формой ответа
  - `app/api/factory/stability/route.ts`: `getSupabaseAdmin()` перенесён внутрь общего crash-contract
- Проверки:
  - `rg -n 'ops crash|status crash|stability crash|ops_crash|route-level crash' app/api/factory/ops/route.ts app/api/factory/status/route.ts app/api/factory/stability/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - worker/ops/status страницы теперь не должны превращать неожиданный backend throw в HTML/500 без контекста
  - production build зелёный

### 2026-06-26 05:35

- Ветка: текущая рабочая ветка контент-завода
- Цель: укрепить MVP-путь сохранения/медиа/рендера без добавления новых функций
- Изменено:
  - `app/api/factory/gen-save/route.ts`: `POST` и `GET` получили route-level `gen-save ... crash`
  - `app/api/factory/media-store/route.ts`: добавлен `media-store crash` и безопасный пустой media response
  - `app/api/factory/video-fal/route.ts`: добавлен `video-fal crash`
  - `app/api/factory/ugc-creatify/route.ts`: добавлен `ugc-creatify crash`
  - `app/api/factory/ugc-creatify/route.ts`: pre-render quality gate переведён из hard stop `422` в fail-open warning
- Проверки:
  - `rg -n 'gen-save POST crash|gen-save GET crash|media-store crash|video-fal crash|ugc-creatify crash|fail-open stabilization' app/api/factory/gen-save/route.ts app/api/factory/media-store/route.ts app/api/factory/video-fal/route.ts app/api/factory/ugc-creatify/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - сохранение генераций, загрузка медиа, FAL submit и Creatify submit теперь возвращают JSON crash-contract при unexpected throw
  - Creatify больше не блокируется pre-render quality gate во время стабилизационного спринта; дефект сохраняется как warning

### 2026-06-26 05:43

- Ветка: текущая рабочая ветка контент-завода
- Цель: ослабить вторичные агентские endpoints, чтобы они не валили операторский поток
- Изменено:
  - `app/api/factory/artifact-check/route.ts`: добавлен внешний fail-open `artifact-check crash: ...`
  - `app/api/factory/director/route.ts`: добавлен `director crash: ...` с пустым структурированным планом
- Проверки:
  - `rg -n 'artifact-check crash|director crash' app/api/factory/artifact-check/route.ts app/api/factory/director/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - artifact gate при unexpected throw пропускает контент как warning, а не блокирует выпуск
  - director endpoint возвращает машинно-читаемый fallback вместо неструктурированного 500

### 2026-06-26 05:55

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать hard-stop на сценарии и producer decision при пустом/битом ответе LLM
- Изменено:
  - `app/api/factory/scenario/route.ts`: добавлен детерминированный fallback-сценарий с `warnings`
  - `app/api/factory/scenario/route.ts`: отсутствие Claude, invalid JSON и model exception теперь возвращают fallback вместо `502`
  - `app/api/factory/produce/route.ts`: добавлен fallback decision (`repurpose_cut` при footage, иначе `slideshow`)
  - `app/api/factory/produce/route.ts`: отсутствие Claude, invalid JSON и model exception теперь возвращают fallback decision вместо `502`
  - `app/api/factory/repurpose/route.ts`: добавлен `repurpose crash: ...`
  - `app/api/factory/hybrid-compose/route.ts`: добавлен `hybrid-compose crash: ...`
- Проверки:
  - `rg -n 'scenario fallback|scenario crash|producer fallback|produce crash|repurpose crash|hybrid-compose crash' app/api/factory/scenario/route.ts app/api/factory/produce/route.ts app/api/factory/repurpose/route.ts app/api/factory/hybrid-compose/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - MVP-путь больше не зависит полностью от идеального JSON сценариста/продюсера
  - при деградации система выбирает простой `slideshow`/`repurpose_cut`, что ближе к цели 10/10 прогонов

### 2026-06-26 06:07

- Ветка: текущая рабочая ветка контент-завода
- Цель: укрепить источники материалов и лёгкую сборку вокруг MVP-пути
- Изменено:
  - `app/api/factory/disk-source/route.ts`: добавлен мягкий `disk-source crash: ...` с пустыми `images/videos`
  - `app/api/factory/overlay/route.ts`: добавлен `overlay crash: ...`
  - `app/api/factory/broll/route.ts`: добавлен детерминированный fallback выбора фраз без Claude
  - `app/api/factory/broll/route.ts`: добавлен `broll crash: ...`
  - `app/api/factory/content-index/route.ts`: `POST/GET` получили `content-index ... crash`
- Проверки:
  - `rg -n 'disk-source crash|overlay crash|broll crash|content-index POST crash|content-index GET crash|fallbackBrollPicks' app/api/factory/disk-source/route.ts app/api/factory/overlay/route.ts app/api/factory/broll/route.ts app/api/factory/content-index/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - сбой каталога/диска теперь деградирует в “материалов нет”, а не валит downstream
  - b-roll specs можно получить без LLM, если рендерная VM/Claude временно недоступны

### 2026-06-26 06:18

- Ветка: текущая рабочая ветка контент-завода
- Цель: защитить worker/brand/winner endpoints от route-level падений
- Изменено:
  - `app/api/factory/worker-state/route.ts`: `GET` теперь ловит сбой `loadWorkerDocs()` и возвращает `worker-state GET crash: ...`
  - `app/api/factory/brand-kit/route.ts`: `GET/POST` получили `brand-kit ... crash`
  - `app/api/factory/winners/route.ts`: `POST/GET` получили `winners ... crash`
- Проверки:
  - `rg -n 'worker-state GET crash|brand-kit GET crash|brand-kit POST crash|winners POST crash|winners GET crash' app/api/factory/worker-state/route.ts app/api/factory/brand-kit/route.ts app/api/factory/winners/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - операторский worker screen больше не зависит от безошибочного чтения docs до основного `try`
  - бренд-киты и winners loop возвращают понятный JSON при unexpected throw

### 2026-06-26 06:29

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать feedback/learning слой best-effort и не мешающим выпуску
- Изменено:
  - `app/api/factory/hook-pick/route.ts`: добавлен `hook-pick crash: ...`
  - `app/api/factory/reject/route.ts`: добавлен `reject crash: ...`
  - `app/api/factory/post-metrics/route.ts`: добавлен `post-metrics crash: ...`
  - `app/api/factory/content-learn/route.ts`: `POST/GET` получили `content-learn ... crash`
- Проверки:
  - `rg -n 'hook-pick crash|reject crash|post-metrics crash|content-learn POST crash|content-learn GET crash' app/api/factory/hook-pick/route.ts app/api/factory/reject/route.ts app/api/factory/post-metrics/route.ts app/api/factory/content-learn/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - выбор/отклонение/метрики/визуальное обучение теперь возвращают структурированный JSON при unexpected throw
  - learning loop остаётся полезным, но не становится точкой отказа MVP-выпуска

### 2026-06-26 06:41

- Ветка: текущая рабочая ветка контент-завода
- Цель: ослабить LLM/API helper endpoints, которые могут вернуть пустой JSON или упасть на внешнем API
- Изменено:
  - `app/api/factory/assistant/route.ts`: добавлен `assistant crash: ...` для outer handler
  - `app/api/factory/improve-prompt/route.ts`: отсутствие Claude, пустой ответ и exception теперь возвращают prompt fallback/warning
  - `app/api/factory/improve-prompt/route.ts`: добавлен `improve-prompt crash: ...`
  - `app/api/factory/niche-playbook/route.ts`: добавлен `fallbackPlaybook()` для отсутствия Orbit/Claude/JSON
  - `app/api/factory/niche-playbook/route.ts`: добавлен `niche-playbook crash: ...`
  - `app/api/factory/trends/search/route.ts`: добавлен `trends/search crash: ...`
- Проверки:
  - `rg -n 'assistant crash|improve-prompt crash|improve-prompt empty|fallbackPlaybook|niche-playbook crash|trends/search crash' app/api/factory/assistant/route.ts app/api/factory/improve-prompt/route.ts app/api/factory/niche-playbook/route.ts app/api/factory/trends/search/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - пустой/битый playbook больше не обязан останавливать выпуск
  - prompt improvement деградирует в исходный/усиленный prompt, а не в hard failure

### 2026-06-26 06:53

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть read-only helper endpoints и trend-анализ для UI
- Изменено:
  - `app/api/factory/corpus/top-hooks/route.ts`: добавлен `top-hooks crash: ...`
  - `app/api/factory/corpus/top-sounds/route.ts`: добавлен `top-sounds crash: ...`
  - `app/api/factory/corpus/top-videos/route.ts`: добавлен `top-videos crash: ...`
  - `app/api/factory/niche-playbook/cached/route.ts`: добавлен `niche-playbook/cached crash: ...`
  - `app/api/factory/oembed/route.ts`: добавлен `oembed crash: ...`
  - `app/api/factory/trends/route.ts`: отсутствие Claude и пустой разбор теперь возвращают warning/fallback вместо `502`
  - `app/api/factory/trends/route.ts`: добавлен `trends crash: ...`
- Проверки:
  - `rg -n 'top-hooks crash|top-sounds crash|top-videos crash|niche-playbook/cached crash|oembed crash|trends crash|Claude недоступен' app/api/factory/corpus/top-hooks/route.ts app/api/factory/corpus/top-sounds/route.ts app/api/factory/corpus/top-videos/route.ts app/api/factory/niche-playbook/cached/route.ts app/api/factory/oembed/route.ts app/api/factory/trends/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - UI helpers теперь возвращают пустые списки/notes при unexpected throw
  - trend-анализ больше не валит поток из-за недоступного Claude

### 2026-06-26 07:04

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть оставшиеся операторские POST-оркестраторы crash-contract'ами
- Изменено:
  - `app/api/factory/batch/route.ts`: добавлен `batch crash: ...`
  - `app/api/factory/graph-run/rejudge/route.ts`: добавлен `graph-run/rejudge crash: ...`
  - `app/api/factory/corpus/init-monitors/route.ts`: добавлен `corpus/init-monitors crash: ...`
  - `app/api/factory/telegram/route.ts`: `GET` получил `telegram GET crash: ...`
  - `app/api/factory/telegram/route.ts`: `POST` получил fail-open `telegram POST crash: ...` с `ok:true`, чтобы Telegram не ретраил webhook
- Проверки:
  - `rg -n 'batch crash|graph-run/rejudge crash|corpus/init-monitors crash|telegram GET crash|telegram POST crash' app/api/factory/batch/route.ts app/api/factory/graph-run/rejudge/route.ts app/api/factory/corpus/init-monitors/route.ts app/api/factory/telegram/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - batch/rejudge/monitor init теперь возвращают структурированный JSON при unexpected throw
  - Telegram webhook продолжает отвечать `ok:true` даже при route-level exception, сохраняя fail-closed безопасность на входе

### 2026-06-26 07:15

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть последние найденные handler-level gaps в factory routes
- Изменено:
  - `app/api/factory/corpus/analyze-niches/route.ts`: добавлен `corpus/analyze-niches crash: ...`
  - `app/api/factory/corpus/build-missing-playbooks/route.ts`: добавлен `corpus/build-missing-playbooks crash: ...`
  - `app/api/factory/corpus/sync-all-orbits/route.ts`: добавлен `corpus/sync-all-orbits crash: ...`
  - `app/api/factory/graph-run/watchdog/route.ts`: `POST` получил safe wrapper вокруг disabled stub
- Проверки:
  - `rg -n 'corpus/analyze-niches crash|corpus/build-missing-playbooks crash|corpus/sync-all-orbits crash|graph-run/watchdog POST crash' app/api/factory/corpus/analyze-niches/route.ts app/api/factory/corpus/build-missing-playbooks/route.ts app/api/factory/corpus/sync-all-orbits/route.ts app/api/factory/graph-run/watchdog/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
  - custom handler scan over `app/api/factory/**/route.ts`
- Результат:
  - handler scan result: `remaining=0`
  - по текущему критерию у factory route handlers не осталось голых handler-level точек без `try/fallback/crash/disabled` контракта

### 2026-06-26 07:28

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать quality-signal честнее и убрать false-positive шум из ops alerts
- Изменено:
  - `lib/factory/observability.ts`: `quality_signal` теперь считается по последним 10 прогонам, где реально есть `run_plan.otk.basis`
  - `quality_signal.top_basis_reason` теперь считается из того же quality-window, а не из всех строк выборки
  - `missing_basis` больше не накапливается из старых/недошедших до ОТК рецептов
  - `app/api/factory/studio/route.ts` и `app/api/factory/video-critic/route.ts`: убраны устаревшие `eslint-disable` комментарии
- Проверки:
  - `npx eslint lib/factory/observability.ts app/api/factory/ops/route.ts app/api/factory/studio/route.ts app/api/factory/video-critic/route.ts`
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Наблюдение:
  - первый параллельный `tsc` попал в гонку с `next build`, когда `.next/types` пересоздавались; повторный отдельный `tsc` прошёл зелёным
- Результат:
  - алерты `critic_fallback_dominates` / `critic_text_prefilter_dominates` стали основываться на реальных ОТК-оценках
  - quality observability остаётся fail-open и не блокирует выпуск роликов

### 2026-06-26 07:41

- Ветка: текущая рабочая ветка контент-завода
- Цель: синхронизировать worker queue с фактическим состоянием задач и починить fallback-парсинг
- Изменено:
  - `docs/factory-railway-task-queue.md`: T-002/T-004/T-005 переведены в `done`, T-003 честно отмечен как `blocked`
  - `docs/factory-railway-task-queue.md`: зафиксировано, что `scenario-rewrite` временно disabled для MVP-stability
  - `lib/factory/workerState.ts`: queue parser теперь берёт task id из заголовка `### T-002 · ...`
  - `lib/factory/workerState.ts`: inline-блокер после `- Блокеры:` теперь попадает в worker fallback snapshot
  - `lib/factory/workerHeartbeat.mjs`: sender получил тот же парсинг task id и inline blocker
- Проверки:
  - `npx tsx -e "...loadWorkerDocs()..."`
  - `npx eslint lib/factory/workerState.ts`
  - `node --check lib/factory/workerHeartbeat.mjs`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - worker fallback теперь показывает `T-003` и причину blocked-состояния вместо пустого task id
  - экран worker меньше путает оператора, если heartbeat DB недоступна и Studio живёт от markdown queue

### 2026-06-26 07:55

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать живой UI-вызов disabled `batch-build` из Studio
- Изменено:
  - `public/inferno/studio.html`: режим ночного прогона «с нуля» теперь визуально отключён
  - `public/inferno/studio.html`: активный запрос к `/api/factory/batch-build` и polling `/batch-build?build_id=...` удалены из UI path
  - `public/inferno/studio.html`: оператор видит пояснение, что `batch-build` выведен из MVP-контура, и может запускать только прогон из готовых черновиков
- Проверки:
  - `rg -n "batch-build" public/inferno/studio.html`
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - Studio больше не предлагает кнопку, которая дергает disabled orchestrator
  - UI стал ближе к фактической Sprint 1 архитектуре: один канонический execution path без второго batch-build оркестратора

### Verification / cleanup follow-up

- Ветка: текущая рабочая ветка контент-завода
- Цель: снизить шум проверок после большого stabilization/observability набора
- Изменено:
  - `app/api/factory/**`: убраны неиспользуемые `eslint-disable` директивы
  - `lib/factory/**`: убраны неиспользуемые `eslint-disable` директивы
  - `app/api/lab/**`, `lib/lab/**`, `app/uniquizer/page.tsx`, `app/video-overlay/page.tsx`: убран автофиксируемый lint-шум из соседних генерационных helper surfaces
  - `app/abc/page.tsx`: заменён последний `<img>` на `next/image`, чтобы общий lint был полностью чистым
  - `STABILITY_REPORT.md`: добавлены latest verification notes по sandbox-блокерам
- Проверки:
  - `npm run lint`: pass, `0` errors, `0` warnings
  - `npx tsc --noEmit`: pass
  - custom factory handler scan: `96` route handlers, `0` gaps
  - `npm run build`: blocked by sandbox/Turbopack `Operation not permitted` while creating process / binding port for `geist` CSS module
  - `npx tsx lib/factory/*.test.mts`: blocked by sandbox `EPERM` on `tsx` IPC pipe
  - later superseded: build переведён на webpack и прошёл; factory tests переведены на `node --import tsx` и прошли
- Результат:
  - весь репозиторий стал чище для будущих проверок: lint теперь не прячет новые проблемы в старом шуме
  - build/unit-test блокеры зафиксированы как ограничения текущего execution окружения, а не как найденные ошибки приложения

### Quality fail-open follow-up

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать оставшиеся secondary paths, которые могли возвращать старую `otk_fail/rejected` семантику
- Изменено:
  - `app/api/factory/graph-run/rejudge/route.ts`: score < 7 теперь даёт `status:"warning"`, пишет warning в `run_plan.warnings` и не создаёт `rejected` signal
  - `app/api/factory/graph-run/rejudge/route.ts`: `basis` / `basis_reason` из `video-critic` сохраняются в `plan.otk`
  - `app/api/factory/graph-run/rejudge/route.ts`: warning-записи теперь дедуплицируются через локальный `addPlanWarning`
  - `app/api/factory/gen-save/route.ts`: новые записи `generation_history` при `otk < 7` получают `status:"warning"`, а не `otk_fail`
  - `lib/factory/genHistory.ts`: комментарий статусов уточнён: `otk_fail` остаётся legacy read-only статусом
- Проверки:
  - `npx eslint app/api/factory/graph-run/rejudge/route.ts`
  - `npx eslint app/api/factory/graph-run/rejudge/route.ts && npx tsc --noEmit`
  - `npm run lint`
  - `npx tsc --noEmit`
  - `rg -n "status: .*otk_fail|= \"otk_fail\"|event: status === .*rejected" app/api/factory lib/factory public/inferno/studio.html`
- Результат:
  - основной и вторичный quality paths теперь совпадают по Sprint 1 принципу: низкое качество помечается warning, выпуск/сохранение не блокируется
  - новые `otk_fail` больше не создаются в live factory routes; старые значения остаются только для исторической аналитики и stress summary

### Stress history archive follow-up

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть backlog по historical stress storage без новой БД и без нового сервиса
- Изменено:
  - `lib/factory/stressGraphRun.mjs`: добавлен archive mode по умолчанию
  - `lib/factory/stressGraphRun.mjs`: каждый stress-run теперь пишет timestamped JSON/Markdown в `docs/factory-stress-history/`
  - `lib/factory/stabilityArtifacts.ts`: добавлен `readStressHistorySummary()`
  - `app/api/factory/stability/route.ts`, `app/api/factory/ops/route.ts`, `app/api/factory/worker-state/route.ts`: добавлен `stress_history` summary
  - `stress_history` и `latest_stress` читаются из файлового архива даже на ветке `db_ready:false`
  - `public/inferno/studio.html`: command center и worker screen показывают compact summary stress history
  - `docs/factory-stress-history/README.md`: добавлен контракт папки и способ отключения архива
  - `STABILITY_REPORT.md` и `EXECUTION_OBSERVABILITY.md`: обновлены под latest + archive модель
- Проверки:
  - `node --check lib/factory/stressGraphRun.mjs`
  - inline script syntax check for `public/inferno/studio.html`
  - `npx tsc --noEmit && npm run lint`
- Результат:
  - latest artifacts остаются стабильным UI/backend path
  - historical stress серии теперь не затираются следующим запуском
  - automation может читать историю через `stress_history`, не парся markdown и не открывая папку
  - при Supabase outage оператор всё равно видит последний stress context из файлов
  - long-range анализ можно строить поверх файлового архива, не усложняя MVP runtime

### Static route TODO cleanup

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать misleading TODO из live route без расширения static pipeline
- Изменено:
  - `app/api/factory/static-generate/route.ts`: большой TODO-блок заменён на ссылку на backlog в `docs/factory-pin-canon.md`
- Проверки:
  - `npx eslint app/api/factory/static-generate/route.ts && npx tsc --noEmit`
  - `rg -n 'TODO|FIXME' app/api/factory lib/factory public/inferno/studio.html`
- Результат:
  - live factory/studio код больше не содержит `TODO/FIXME`
  - static line остаётся submit-only и не расширяет MVP-видео контур

### Final sandbox verification

- Ветка: текущая рабочая ветка контент-завода
- Цель: повторно проверить базовые gates после docs/UI/observability cleanup
- Проверки:
  - `npm run lint`: pass
  - `npx tsc --noEmit`: pass
  - inline script syntax check for `public/inferno/studio.html`: pass
  - custom factory handler scan: `96` route handlers, `0` gaps
  - `npx next build --webpack`: pass
  - `package.json`: `build` переведён на `next build --webpack`
  - `package.json`: добавлен `test:factory` через `node --import tsx`
  - `package.json`: добавлен `check:factory`
  - `npm run test:factory`: pass
  - `npm run build`: pass
  - `npm run check:factory`: pass
  - `npm run start -- --hostname 127.0.0.1 --port 3021`: blocked by sandbox `listen EPERM`
- Результат:
  - кодовые проверки чистые
  - production build больше не зависит от Turbopack path, который в текущем sandbox падал на `Operation not permitted`
  - factory unit tests теперь запускаются без `npx tsx` IPC path, который блокировался sandbox
  - HTTP smoke/stress нужно запускать в обычном терминале/CI, где разрешён localhost bind

### Stress history unit coverage

- Ветка: текущая рабочая ветка контент-завода
- Цель: покрыть файловый stress archive unit-тестом
- Изменено:
  - `lib/factory/stabilityArtifacts.test.mts`: добавлен изолированный тест latest/history artifacts через temp cwd
  - `lib/factory/stabilityArtifacts.ts`: `limit` теперь применяется к валидным parsed reports, а не к сырым файлам до JSON-parse
- Проверки:
  - `npm run test:factory`: pass, 9 factory test files
  - `npm run lint && npx tsc --noEmit && git diff --check`: pass
- Результат:
  - тест поймал edge case: битый самый новый JSON мог обнулить `readStressHistorySummary(1)`
  - stress history summary теперь устойчив к partial/manual archive файлам даже при малом limit

### Learning fail-open cleanup

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать последний UI/analytics хвост, где legacy quality statuses выглядели как runtime failure
- Изменено:
  - `app/api/factory/learning/route.ts`: `otk_fail`, `rejected` и `artifact_fail` теперь попадают в `warn`, а не в `fail`; `fail` зарезервирован под настоящий `run_fail`
  - `public/inferno/studio.html`: история генераций показывает legacy quality/artifact statuses как `warning`, а не как красный runtime reject
- Проверки:
  - inline script syntax check for `public/inferno/studio.html`: pass
- Результат:
  - learning dashboard согласован с Sprint 1 fail-open политикой
  - старые записи остаются видимыми, но больше не создают ложное ощущение, что выпуск роликов заблокирован

### Factory dependency cycle cleanup

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать лишнюю сцепку helper-слоя вариантов с главным graph-run оркестратором
- Найдено:
  - dependency scan показывал цикл: `graphRun -> nodeEngine -> rehostImage -> reelVariants -> graphRun`
  - импорт был type-only, но архитектурно `reelVariants` всё равно зависел от большого orchestration module
- Изменено:
  - добавлен `lib/factory/graphTypes.ts` с `RunStep`, `RunNode`, `RunPlan`, `ExecutionLogEntry`
  - `lib/factory/graphRun.ts` использует эти типы и re-export'ит их для обратной совместимости старых импортов
  - `lib/factory/reelVariants.ts` импортирует `RunNode` из `graphTypes`, а не из `graphRun`
  - type-only импорты `RunPlan` в `graphWatchdog`, `graph-run`, `graph-run/rejudge`, `reel-recompose` переведены на `graphTypes`
  - добавлен `lib/factory/dependencyCycles.test.mts`, чтобы цикл не вернулся незаметно
- Проверки:
  - factory dependency scan: `147` files, `0` import cycles
  - `npx tsc --noEmit`: pass
  - `npm run test:factory`: pass, 10 factory test files
  - `rg graphRun imports`: runtime `graphRun` imports остались только в execution/recompose paths
- Результат:
  - helper variants layer больше не связан с runtime orchestration module
  - риск hidden init/test coupling вокруг `graphRun` снижен без изменения поведения генерации

### CLI timeout guard cleanup

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать риск, что автономный stress/heartbeat процесс зависнет на одном HTTP-запросе без понятного failure result
- Root cause hypothesis:
  - production factory fetch paths в основном уже имели `AbortSignal.timeout`, но `lib/factory/stressGraphRun.mjs` и `lib/factory/workerHeartbeat.mjs` могли ждать HTTP без верхнего лимита
  - это ломает именно автономную проверку: вместо записанного timeout/fail процесс может просто висеть
- Изменено:
  - `lib/factory/stressGraphRun.mjs`: добавлен `FACTORY_STRESS_REQUEST_TIMEOUT_MS` / `--request-timeout-ms`, `fetchJson` теперь использует `AbortController`
  - `lib/factory/stressGraphRun.mjs`: timeout-конфиг clamp'ится к безопасному минимуму `5000ms`, мусорный env возвращается к дефолту `45000ms`
  - `lib/factory/stressGraphRun.mjs`: request-level failure внутри `runOnce` теперь возвращает результат `run_fail/failed` и попадает в JSON/Markdown отчёт, а не обрывает весь stress без artifact
  - `lib/factory/workerHeartbeat.mjs`: heartbeat `POST` получил `AbortSignal.timeout(15_000)`
  - `lib/factory/workerHeartbeat.mjs`: daemon-loop теперь логирует transient POST failure и продолжает следующий heartbeat, вместо выхода процесса
  - `lib/factory/cliTimeouts.test.mts`: добавлен regression guard на эти таймауты
- Проверки:
  - `node --check lib/factory/stressGraphRun.mjs && node --check lib/factory/workerHeartbeat.mjs`: pass
  - `npm run test:factory`: pass, 11 factory test files
  - `npx tsc --noEmit`: pass
- Результат:
  - stress/heartbeat больше не могут бесконечно висеть на одном HTTP-запросе
  - stress runner сохраняет отчёт даже при падении стартового `POST /graph-run` или poll-запроса после ретраев
  - один сетевой сбой heartbeat больше не превращает живой worker в ложный `stale/dead`
  - KPI-проверка лучше различает “сервер не ответил” и “прогон ещё идёт”

### Ops crash-path stress context cleanup

- Ветка: текущая рабочая ветка контент-завода
- Цель: сохранить файловый stress context даже при route-level degradation в ops endpoints
- Root cause hypothesis:
  - happy path `ops`, `worker-state`, `stability` уже отдавали latest/history stress artifacts
  - crash path этих endpoints возвращал `latest_stress:null` / `stress_history:null`, теряя самый полезный контекст для оператора
- Изменено:
  - `app/api/factory/worker-state/route.ts`: catch path best-effort читает `latest_stress` и `stress_history`
  - `app/api/factory/ops/route.ts`: catch path best-effort читает `latest_stress` и `stress_history`
  - `app/api/factory/stability/route.ts`: catch path best-effort читает `stress_history`
  - `lib/factory/opsFailOpen.test.mts`: добавлен regression guard на crash-path contracts
- Проверки:
  - `npm run test:factory`: pass, 12 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по затронутым route/test файлам: pass
- Результат:
  - при ops-route сбое UI/automation всё равно получает последний файловый stress context
  - observability layer стал ближе к fail-open контракту Sprint 1

### M4 jobs migration guard closeout

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть M4 не только документально, но и guard-тестом против возврата legacy jobs runner
- Root cause:
  - `jobs/enqueue/list/tick` и `lib/factory/jobs.ts` уже были выведены из runtime, но в живом factory-коде оставались формулировки про `self-chaining очередь` / `jobs/tick`
  - это не ломало код, но поддерживало неверную модель “у нас всё ещё второй runner”
- Изменено:
  - `lib/factory/shotstack.ts`, `lib/factory/remotionRender.ts`, `lib/factory/graphRun.ts`, `app/api/factory/batch/route.ts`, `app/api/factory/graph-run/tick/route.ts`: comments переведены на `graph-run runner` terminology
  - `lib/factory/jobsMigrationGuard.test.mts`: добавлен guard на отсутствие `lib/factory/jobs.ts`, runtime imports, live callers disabled `jobs/enqueue|list|tick`, и stale comments
  - `docs/factory-jobs-migration-backlog.md`: M4 status обновлён guard-строками
- Проверки:
  - `npm run test:factory`: pass, 13 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по затронутым файлам: pass
- Результат:
  - M4 jobs deletion/migration теперь закреплён автоматической проверкой
  - graph-run остаётся единственным runtime execution runner для MP4 path

### M5 market feedback loop hardening

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать контур `post_metrics -> winners -> learning` честным и fail-open
- Root cause:
  - `/api/factory/post-metrics` выставлял `forwarded:true` сразу после вызова `/winners`, даже если `/winners` вернул ошибку
  - `/api/factory/ab-rank` мог падать route-level ошибкой при отсутствующей/неприменённой `post_metrics`, хотя это read-only analytics
  - `views=-5` проходил валидацию как truthy number и мог загрязнить market ranking
- Изменено:
  - `app/api/factory/post-metrics/route.ts`: `forwarded:true` теперь только при `res.ok && payload.ok === true`
  - `app/api/factory/post-metrics/route.ts`: добавлен `warnings[]` для случаев, когда метрики сохранены, но winner-forward не прошёл
  - `app/api/factory/post-metrics/route.ts`: `views/saves` нормализуются как неотрицательные целые, `watch_rate/ctr` clamp'ятся в `0..1`
  - `app/api/factory/ab-rank/route.ts`: отсутствие `post_metrics` или сбой `node_recipes` возвращает пустой рейтинг с `note`, а не 500
  - `public/inferno/studio.html`: карточка рецепта показывает `✓ метрики · warning`, если winner-forward не завершился
  - `lib/factory/marketFeedback.test.mts`: добавлен regression guard на M5-контракт
- Проверки:
  - `npm run test:factory`: pass, 14 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по M5-файлам: pass
  - inline Studio JS syntax check: pass
- Результат:
  - market feedback loop перестал давать ложноположительный `forwarded`
  - read-only ranking больше не блокирует UI при ещё не готовой таблице метрик
  - в learning loop не попадают отрицательные/мусорные просмотры

### M6 learning readback hardening

- Ветка: текущая рабочая ветка контент-завода
- Цель: оставить learning hints полезными для генерации/критика, но не дать им стать новой точкой отказа или prompt-bloat
- Root cause:
  - `learningHints` уже работал best-effort, но читал `winners`, `hook_corpus` и `rejects` почти как есть
  - длинные hooks/reasons теоретически могли раздувать prompt context для `decompose` / `video-critic`
  - readback слой не был закреплён отдельным regression guard
- Изменено:
  - `lib/factory/learningHints.ts`: winner/corpus/reject snippets нормализуются и ограничиваются по длине
  - `lib/factory/learningHints.ts`: пустые niche и ошибки БД продолжают возвращать пустой hint без падения основного path
  - `lib/factory/learningHints.test.mts`: добавлен guard на bounded hints и fail-open contract
- Проверки:
  - `npm run test:factory`: pass, 15 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по M6-файлам: pass
- Результат:
  - learning readback остаётся вспомогательным сигналом, а не блокером выпуска
  - winners/corpus/reject feedback не может бесконтрольно раздуть промпт
  - fail-open поведение learning hints закреплено тестом

### M7 generation history lineage hardening

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть дыру, где `gen-save` мог сохранить/найти ролик, но не оставить запись попытки в `generation_history`
- Root cause:
  - happy path уже писал историю после успешного insert в `content_assets`
  - early returns при `already:true` и dedupe-race возвращали URL до записи `generation_history`
  - ошибки storage/catalog insert возвращались как `ok:false`, но не оставляли `artifact_fail` след для разборов
- Изменено:
  - `app/api/factory/gen-save/route.ts`: добавлен локальный `logGenSaveHistory(...)` helper
  - `gen-save` теперь best-effort логирует success, dedupe hit, unique-index race, storage failure, catalog insert failure и carousel path
  - низкий ОТК в history остаётся `warning`, а не fail-closed статусом
  - `lib/factory/genSaveHistory.test.mts`: добавлен regression guard на lineage contract
- Проверки:
  - `npm run test:factory`: pass, 16 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по M7-файлам: pass
- Результат:
  - идемпотентный каталог больше не означает потерянную попытку генерации
  - failed artifact/catalog saves теперь видны как данные для оператора и learning/debug loop
  - lineage слой стал полезнее без изменения основного execution runner

### M8 node-preview lineage cache-hit hardening

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть вторую dedupe/cache дыру в V20 history path
- Root cause:
  - `node-preview` уже писал `generation_history` на instant done и async done
  - cache-hit path возвращал готовый preview до записи истории
  - для оператора это выглядело как новая попытка, но для learning/history слоя попытка исчезала
- Изменено:
  - `app/api/factory/node-preview/route.ts`: cache-hit теперь best-effort пишет `generation_history` с `source:"node_preview"` и `reason:"cache_hit"`
  - `lib/factory/nodePreviewHistory.test.mts`: добавлен guard на cache-hit, instant done и async done history paths
- Проверки:
  - `npm run test:factory`: pass, 17 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по M8-файлам: pass
- Результат:
  - hash-cache больше не скрывает реальные operator/test attempts
  - `node-preview` остаётся быстрым и идемпотентным, но lineage теперь честнее

### M9 graph-run clip lineage hardening

- Ветка: текущая рабочая ветка контент-завода
- Цель: чтобы дорогие i2v/fal клипы, которые graph-run переносит в durable storage, тоже попадали в lineage
- Root cause:
  - `persistClips` уже спасал эфемерные external clip URLs в `factory-media/clips/*`
  - dedupe/success/failure paths меняли `node.url` или silently degraded, но не писали `generation_history`
  - при разборе качества было видно финальный ролик, но не всегда было видно clip-level provenance
- Изменено:
  - `lib/factory/graphRun.ts`: `persistClips(...)` теперь принимает `recipeId`
  - clip durable success и dedupe hit пишут `generation_history` с `reason:"clip_library"` / `clip_library_dedupe`
  - fetch/upload/publicUrl failures пишутся как `artifact_fail` best-effort, не ломая сборку
  - `lib/factory/graphRunClipHistory.test.mts`: добавлен guard на clip lineage contract
- Проверки:
  - `npm run test:factory`: pass, 18 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по M9-файлам: pass
- Результат:
  - clip-level provenance стал видимым в `generation_history`
  - durable clip cache остаётся best-effort и не блокирует MP4 path
  - debugging “почему финальный ролик такой” получил больше данных без нового сервиса

### M10 generation-history API warning contract

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать history read-path честным: fail-open сохраняется, но деградация не маскируется под “история пустая”
- Root cause:
  - `getRecipeHistory()` возвращал `[]` при отсутствующем Supabase, ошибке таблицы или исключении
  - `/api/factory/generation-history` из-за этого не различал “нет попыток” и “history слой недоступен”
- Изменено:
  - `lib/factory/genHistory.ts`: добавлен `getRecipeHistoryResult(...) -> { history, warning? }`
  - старый `getRecipeHistory(...)` сохранён как совместимый wrapper
  - `app/api/factory/generation-history/route.ts`: ответ теперь содержит `warning:null|string`
  - `lib/factory/generationHistoryApi.test.mts`: добавлен guard на warning contract
- Проверки:
  - `npm run test:factory`: pass, 19 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по M10-файлам: pass
- Результат:
  - UI/оператор может отличить пустую историю от недоступной `generation_history`
  - fail-open поведение сохранено: выпуск роликов не зависит от readback слоя

### M11 learning dashboard warning contract

- Ветка: текущая рабочая ветка контент-завода
- Цель: чтобы learning dashboard не маскировал недоступные read-модели под “нулевые метрики”
- Root cause:
  - `/api/factory/learning` был best-effort, но `safe(...)` возвращал fallback без объяснения
  - Supabase `{ error }` из отдельных таблиц не пробрасывался в warning context
  - оператор видел пустые `signals/hooks/history/winners`, но не видел, какой слой деградировал
- Изменено:
  - `app/api/factory/learning/route.ts`: добавлен `warnings[]`
  - каждый read-block получил label (`cf_signals`, `viral_hooks`, `generation_history`, `node_templates`, `content_assets winners`)
  - Supabase query errors теперь превращаются в warning, route остаётся `ok:true`
  - `lib/factory/learningApiWarnings.test.mts`: добавлен guard на warning contract
- Проверки:
  - `npm run test:factory`: pass, 20 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по M11-файлам: pass
- Результат:
  - learning dashboard остаётся fail-open, но стал наблюдаемым
  - следующий раз пустые метрики будет проще отличить от отсутствия данных

### M12 observer route fail-open contract

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать route-level 500 из read-only observer pulse
- Root cause:
  - `loadObserverPulse(...)` уже деградировал в `partial:true`
  - но `/api/factory/observer` возвращал 500 при отсутствующем Supabase или outer crash
  - внешний монитор/Studio могли видеть красную ошибку вместо частичного pulse
- Изменено:
  - `app/api/factory/observer/route.ts`: missing-db и crash paths теперь возвращают `ok:true, partial:true, updated_at, error`
  - ответы observer route остаются `Cache-Control: no-store`
  - `lib/factory/observerFailOpen.test.mts`: добавлен guard на observer fail-open contract
- Проверки:
  - `npm run test:factory`: pass, 21 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по M12-файлам: pass
- Результат:
  - observer больше не превращает read-only деградацию в route-level failure
  - мониторинг получает частичный диагноз вместо “endpoint упал”

### Live stress verification + report contract cleanup

- Ветка: текущая рабочая ветка контент-завода
- Цель: зафиксировать реальный production-like stress и убрать путаницу между текущим stress-result и DB-wide stability snapshot
- Факт прогона:
  - base: `http://127.0.0.1:3012`
  - recipe_id: `68`
  - total_runs: `10`
  - completed: `10`
  - failed: `0`
  - run_fail: `0`
  - timeouts: `0`
  - avg_duration_sec: `19`
  - warnings: `10` (`OTK below threshold: 6`, fail-open допустим)
- Root cause:
  - `docs/factory-latest-stress.md` показывал `target_met:no` из `/api/factory/stability`
  - этот endpoint считает DB-wide recent runs и включает старые failures, а не только текущий stress-run
- Изменено:
  - `lib/factory/stressGraphRun.mjs`: добавлен `summary.targetMet`
  - Markdown-отчёт теперь пишет `stress_target_met`
  - DB-блок переименован в `DB Stability Snapshot` и помечен как historical database-wide snapshot
  - `lib/factory/stressReportContract.test.mts`: добавлен guard на separation текущего stress target и DB snapshot target
- Проверки:
  - `npm run test:factory`: pass, 22 factory test files
  - `node --check lib/factory/stressGraphRun.mjs`: pass
  - targeted eslint по `stressReportContract.test.mts`: pass
- Результат:
  - Sprint KPI по выпуску MP4 подтверждён live stress: `10/10 done`
  - отчёт больше не путает успешный текущий stress с историческими падениями в БД

### Production stress runner progress diagnostics

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать “молчание” CLI во время production stress, когда первый запрос долго ретраится или ждёт удалённый endpoint
- Изменено:
  - `lib/factory/stressGraphRun.mjs`: перед каждым прогоном печатает `RUN_START ...`
  - добавлен `FACTORY_STRESS_REQUEST_RETRIES` / `--request-retries` для короткой диагностики зависших remote-запросов
  - `lib/factory/cliTimeouts.test.mts`: добавлен guard на progress output и retry controls
- Результат:
  - оператор сразу видит, что stress runner стартовал
  - smoke-команду можно запускать с `--runs 1 --request-retries 1 --request-timeout-ms 10000`, не ожидая длинных retry windows

### Studio compact operator mode

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать нагромождение на экранах Studio, не удаляя диагностические данные для инженера
- Изменено:
  - `public/inferno/studio.html`: краткий операторский режим включён по умолчанию
  - в краткой навигации скрыты не-MVP экраны `inspector`, `static`, `balances`, `learn`
  - sidebar-пульс в кратком режиме показывает только статус, обновление и переход в Worker
  - командный центр больше не дублирует отдельную worker-карточку и скрывает `Execution observability`
  - Worker screen в кратком режиме показывает меньше suggested actions, скрывает stress-history и подробный heartbeat-detail
  - кнопка “что тут?” автоматически включает полный режим, чтобы проводник был видим
  - `lib/factory/studioSimplification.test.mts`: добавлен guard на compact-mode contract
- Результат:
  - первый экран стал ближе к операторскому cockpit: меньше debug-бейджей и меньше системных веток
  - full mode сохраняет расширенную диагностику без удаления инструментов

### Optional worker heartbeat fail-open status

- Ветка: текущая рабочая ветка контент-завода
- Цель: не показывать optional heartbeat telemetry как P0/critical блокер MVP-выпуска
- Root cause:
  - `/api/factory/ops` повышал missing `railway_worker_states` до `critical`
  - Studio Worker показывал `worker не отвечает`, хотя snapshot уже строился через queue fallback
  - таблица heartbeat полезна для наблюдаемости, но не обязательна для получения MP4
- Изменено:
  - missing worker heartbeat table теперь `warn` + `degraded`, не `error` + `critical`
  - suggested action заменён с `apply_worker_state_table` P0 на `enable_optional_worker_heartbeat` P2
  - компактный Worker UI пишет `heartbeat не настроен`, а не `worker не отвечает`, когда активен queue fallback
  - `lib/factory/opsFailOpen.test.mts` и `lib/factory/studioSimplification.test.mts`: добавлены guards
- Проверки:
  - inline `public/inferno/studio.html` script `node --check`: pass
  - `npm run test:factory`: pass
  - `npm run build`: pass
- Результат:
  - операторский экран больше не создаёт ложный P0 из optional telemetry
  - реальный выпуск роликов остаётся главным KPI, а heartbeat table можно подключить позже как P2-наблюдаемость

### Rejudge fail-open + stale running triage

- Ветка: текущая рабочая ветка контент-завода
- Цель: добрать оставшийся operational хвост после UI-упрощения — убрать fail-closed поведение в `graph-run/rejudge` и отдельно подсветить застрявшие `running`
- Root cause:
  - основной `graphRun` уже банкует fail-open при пустом/недоступном `video-critic`, но `app/api/factory/graph-run/rejudge/route.ts` всё ещё оставлял item с `error` и без финального warning-state
  - `/api/factory/ops` считал только `running/failed/warning`, поэтому застрявший прогон виделся как обычный `running`
- Изменено:
  - `app/api/factory/graph-run/rejudge/route.ts`: добавлен `persistWarningResult(...)`
  - `rejudge` теперь деградирует в `status:"warning"` вместо жёсткого stop, если:
    - `extractFrames` упал
    - кадры не извлеклись
    - `video-critic` недоступен
    - `video-critic` вернул payload без `score`
  - `lib/factory/observability.ts`: добавлен stale-running detector (`30m+` в `status:"running"`)
  - stale run теперь:
    - учитывается в `stale_running`
    - попадает в `incident_runs` как `status:"stale_running"`
    - получает timeout-like triage вместо “ещё один running”
  - `app/api/factory/ops/route.ts`: добавлены alert/action/status-reason для `stale_running_runs`
  - `public/inferno/studio.html`: Worker queue теперь показывает `stale` отдельно от обычного `running`
- Тесты:
  - `lib/factory/observabilityStaleRuns.test.mts`
  - `lib/factory/rejudgeFailOpen.test.mts`
  - обновлены `lib/factory/opsFailOpen.test.mts`, `lib/factory/studioSimplification.test.mts`
- Проверки:
  - `npm run test:factory`: pass
  - `npm run lint`: pass
  - `npm run build`: pass
- Результат:
  - rejudge больше не возвращает систему к скрытому fail-closed поведению
  - оператор видит не просто “running 1”, а отдельно застрявший прогон, который надо тормошить
  - `/api/factory/ops` теперь тоже fail-open по observability snapshot: деградация `node_recipes` больше не убивает весь worker/ops экран целиком
  - `worker-state` приведён к тому же partial-mode: деградация snapshot больше не обнуляет весь endpoint наблюдаемости

### Active incidents vs legacy noise

- Ветка: текущая рабочая ветка контент-завода
- Цель: перестать показывать старые `run_fail`/`warning` как живую текущую аварию на worker/ops экранах
- Root cause:
  - observability считала любые последние строки `node_recipes` одинаково “живыми”, даже если это старые исторические прогоны вне текущего operational окна
  - из-за этого Worker screen продолжал пугать `23 failed runs`, хотя это были не активные инциденты текущего окна
- Изменено:
  - `lib/factory/observability.ts`:
    - добавлено active-incident окно `24h`
    - live метрики `failed` / `warning_runs` теперь считают только активные инциденты
    - добавлены поля `active_sample_runs`, `legacy_failed_runs`, `legacy_warning_runs`
    - `recent_runs` помечаются флагами `active` / `legacy`
    - `incident_runs` теперь держит только живые инциденты + stale-running
  - `app/api/factory/ops/route.ts`:
    - suggested actions и alerts больше не эскалируют legacy-only хвост как живую поломку
    - при отсутствии live fail/warn добавляется спокойный `legacy_incidents_only`
  - `public/inferno/studio.html`:
    - Worker queue приоритетно показывает активные прогоны, а не старую историю
    - queue meta теперь разделяет `active` и `history`
    - full observability card объясняет, когда на экране остались только исторические шрамы
  - `app/api/factory/worker-state/route.ts` и `app/api/factory/studio/route.ts`: расширены default contracts под новые поля observability
- Тесты:
  - добавлен `lib/factory/observabilityLegacyIncidents.test.mts`
  - обновлены `lib/factory/studioSimplification.test.mts`, `lib/factory/workerStateFailOpen.test.mts`
- Проверки:
  - `node --import tsx lib/factory/observabilityLegacyIncidents.test.mts`: pass
  - `npm run test:factory`: pass
  - `npm run lint`: pass
  - `npm run build`: pass
- Ограничение:
  - локальная GUI-проверка `http://127.0.0.1:3013/inferno/studio.html` уходит в общий login middleware, поэтому визуальную проверку полного worker UI надо добить уже после деплоя на живом домене
- Результат:
  - ops/worker экран стал ближе к живому состоянию фабрики, а не к архиву ошибок
  - старые падения больше не давят на текущее triage-решение как будто они произошли “прямо сейчас”
- 2026-06-26 00:48 MSK - normalized factory Creatify error contracts around canonical `error` field across route handlers, legacy operator surface, and the internal Creatify adapter; added a guard test so old dual-field payloads do not quietly creep back in.
- 2026-06-26 01:00 MSK - enriched learn-screen generation history with lineage context (`recipe_id`, `attempt`, `variant_idx`, `reason`, `article`) and surfaced `learning` read-path warnings in the UI, so degraded read models no longer flatten into a silent empty feed and recent attempts explain what actually happened.
- 2026-06-26 01:04 MSK - synced `docs/factory-v3-roadmap.md` with current repo-truth: V1 is already wired in V3 studio, V5 manual `post-metrics` loop exists, and V20 is no longer “history absent” but “standalone/local paths still bypass shared lineage sink”.
- 2026-06-26 01:08 MSK - upgraded `media-store` from a pure upload shim into a shared history sink: standalone/manual uploads can now opt into `generation_history` with recipe/node/article/source metadata, and full upload failure is recorded as `artifact_fail` instead of disappearing as a silent storage-only event.
- 2026-06-26 01:21 MSK - simplified the worker screen so the top status card is driven by real `graph-run` / `node_recipes` observability instead of the Railway markdown task queue; the operator now sees the current or latest `recipe` run first, while task-note noise stays out of the primary factory flow.
- 2026-06-26 01:34 MSK - cleaned the remaining worker-screen copy to match the new runtime truth: header/help/CTA now talk about heartbeat and live factory runs instead of the old “task queue” language, so the UI no longer points operators back to deprecated Railway mental models.
- 2026-06-26 01:38 MSK - removed more infra-noise from the compact operator UI: the command center no longer leaks raw worker task ids, the pulse card now uses plain run-state language (`идут прогоны`, `есть сбои`, `пульс пропал`) instead of self-heal jargon, and the worker entry point is renamed in the UI to `Пульс завода` so operators navigate by product meaning instead of Railway internals.
- 2026-06-26 01:38 MSK - trimmed the command-center health banner back to a short alert surface: it keeps the active 10-run / heartbeat / fail / balance signals, but no longer expands into a second observability dashboard with stress-history and streak chatter.
- 2026-06-26 02:06 MSK - collapsed the worker heartbeat diagnostics and run list into product language: the screen now says `Живые прогоны`, uses `идёт / подвис / сбой / архив` chips instead of task-board jargon, and compresses heartbeat troubleshooting into one short factory-impact explanation plus a single “Следом” hint.
- 2026-06-26 02:06 MSK - compacted the marketer rail so the brief opens on demand (`Развернуть бриф`) and the side column no longer spills into a long wall of examples: viral examples are capped at 2 cards, recommendations at 3 items, and distribution hints at 3 chips.
- 2026-06-26 02:14 MSK - removed the last mixed telemetry wording from the worker screen: `last_seen / age / avg / fails / streak` are now operator-facing labels (`сигнал / тишина / среднее / сбоев`) and the latest stress card explains the 10/10 goal in one sentence instead of stacking extra diagnostic chips.
- 2026-06-26 02:24 MSK - translated the full observability surface into consistent product language: worker status chips now read `на связи / молчит / потерян`, run chips use `идёт / подвис / сбой`, and the deep-dive card now says `Разбор прогонов`, `Сигнал качества`, `живые инциденты`, `тренд по часам` instead of mixed English telemetry labels.
- 2026-06-26 02:31 MSK - aligned the assistant hints and summary chips with the same operator vocabulary: guidance now talks about `молчит / потерян`, the health banner says `пульс`, and the hourly trend chips no longer mix English `fail` labels into otherwise Russian run summaries.
- 2026-06-26 02:41 MSK - hid raw backend codes behind operator labels on the worker surface: `table_missing` now renders as `таблица не поднята`, `other` as `без категории`, latest-run failures no longer say `error other`, and the worker header/loading/state cards now consistently talk about `пульс`, not mixed `heartbeat/artifact/archive` internals.
- 2026-06-26 02:48 MSK - cleaned the remaining user-facing English from OTK and learning surfaces: `warnings` became `предупреждения`, step/time pills now read `идёт / последний / шагов / время`, learn warnings are labeled `предупреждения чтения`, and generation history now says `собрано / отклонено` instead of raw `generated / reject`.
- 2026-06-26 02:55 MSK - removed the duplicate stress-history slab from the worker screen: `Последний стресс-тест` and `История стресс-тестов` are now one compact `Стресс 10/10` card with a short archive line, so the operator keeps the KPI context without losing another full-width panel to repeated counters.
- 2026-06-26 03:06 MSK - tightened the command-center system banner: the chip now says `Пульс`, the banner title is shorter (`Нужна проверка` / `Есть риск` / `Система в норме`), the details drawer is renamed to `Что проверить`, and heartbeat/fail/balance hints are humanized through the same operator vocabulary instead of raw internal labels.
- 2026-06-26 03:19 MSK - reduced command-center card density in the niche and product area: niche tiles no longer duplicate video counts as a second virality chip, the templates chip is spelled out in product language, and product cards now say `арт … · сигналы есть/нет` plus `победитель есть` / `Не хватает` instead of backend-ish `Данные по товару` / `winner` copy.
- 2026-06-26 04:05 MSK - hardened the worker screen into fail-open mode when `/api/factory/ops` flakes: the screen now keeps the last good snapshot instead of collapsing into `ошибка ops`, shows a short `Пульс временно недоступен` warning with a retry CTA, and only falls back to an empty error state when there has never been a successful ops read in the session.
- 2026-06-26 04:11 MSK - removed the last navigation-level infra label from the system rail: the worker screen chip is now a neutral `08`, while the title/subtitle stay `Пульс завода` / `живые прогоны`, so the sidebar no longer leaks `RW` shorthand from the old Railway mental model.
- 2026-06-26 04:18 MSK - cleaned another layer of operator copy across worker/observability/learn surfaces: `heartbeat` became `пульс` or `таблица`, stuck-run fallback no longer says `running`, warning counters now say `предупр.`, and the assistant/observability texts use the same `путь пульса` vocabulary instead of mixed English telemetry fragments.
- 2026-06-26 04:29 MSK - translated another visible operator layer in OTK and the video library: `execution log` became `шаги прогона`, recipe cards now say `предупр.` / `сбой` / `идёт` with `последний` / `время`, winners toasts now speak about `победители`, market feedback no longer says `winners` / `warning`, and lineage bits in learning history now read `попытка` / `вариант`.
- 2026-06-26 04:35 MSK - finished another micro-pass over status chrome: node rows in OTK no longer leak raw `submitted/pending/skip`, recipe badges say `прогон` and `шаги`, execution-log fallback says `шаг` instead of `step`, and the remaining tiny library labels now read like operator UI instead of internal trace markers.
- 2026-06-26 04:53 MSK - stripped the last operator-facing infra scraps from the worker pulse screen: run cards now say `рецепт #…` and `ролик сохранён`, the fail-open fallback talks about a missing factory summary instead of raw `/ops`, the suggested-actions slab is translated into concrete operator tasks (`разобрать подвисшие прогоны`, `проверить путь рендера`, etc.), and the count pill now says `пунктов` instead of `items`.
- 2026-06-26 05:05 MSK - finished one more terminology pass over the live pulse surfaces: `фолбэк` became `резерв`, helper text now says `передатчик пульса` instead of `sender`, action labels no longer leak `upstream / video-critic / structured output`, and the winner preset badge on the learning screen now reads `победитель`.
- 2026-06-26 05:16 MSK - cleaned the remaining mixed locale crumbs across secondary factory screens: durations now render as `с/м` instead of `s/m`, OTK shows `прогон <id>` instead of `run <id>`, the static generator uses `Охват / Сохранения` plus a local-render note instead of `Reach / Saves / renderStill / fal`, and the balances screen now marks API-fed services as `авто` rather than `live API`.
- 2026-06-26 05:31 MSK - did another operator-copy pass on the remaining visible content-factory chrome: the rail subtitle now says `завод коротких роликов`, competitor analysis uses `разбор` instead of `decompose`, virality badges say `индекс` / `топ` instead of `score` / `viral`, and recipe cards now render human labels for niche, format, and assembly mode (`ручной / с подсказкой / авто`) instead of leaking raw `built_by` enums.
- 2026-06-26 05:47 MSK - translated the remaining run-step and helper jargon on active factory screens: `render-submit / render-poll / render-done` now render as readable step labels in the worker pulse, library, and OTK; the static screen now says `лента 4:5` instead of `IG`; the canvas legend is fully Russian (`Хук / Сцена / Ревил / Титры / Музыка / Эффекты`); and small helper labels now avoid `Vercel`/raw ID wording where the operator only needs the intent.
- 2026-06-26 06:08 MSK - tightened another UI-runtime language layer: node types now pass through `nodeTypeLabel` before they reach canvas cards, mini-graph cards, timeline clips, OTK node rows, and assistant context; timeline track names use `Видео / UGC / Анимация / Звук / Музыка / Титры`; competitor format labels now use `formatLabel` instead of raw `format_detected`; and the assistant's active run hint uses the same translated step labels as OTK.
- 2026-06-26 06:17 MSK - ran the full factory contract suite after the UI-runtime cleanup: `npm run test:factory` passed across all current `lib/factory/*.test.mts` files. The only red check was a stale market-feedback assertion that still expected English `warning`; it now matches the localized `предупр.` operator copy.
- 2026-06-26 06:43 MSK - started Milestone 4 production run control: recent run snapshots now carry `article`, `niche`, `otk_score`, and `output_url`; the factory pulse screen shows `Очередь прогонов` with graph/MP4/restart actions wired to the existing `graph-run` endpoint; added `runControlSnapshot.test.mts` plus Studio guards. Checks: `npm run test:factory` pass, `npm run build` pass.
- 2026-06-26 06:49 MSK - added `docs/factory-daily-runbook.md` for the operator loop: morning check, run launch, success/failure criteria, P0/P1/P2 triage, evening check, and deploy/auth smoke expectations.
- 2026-06-26 06:58 MSK - added production controls directly to library recipe cards: `старт` uses the same `graph-run` path, running recipes show `пульс` instead of another start button, completed recipes expose `MP4`, and `ОТК` opens the assembly screen. Runbook updated with the shorter launch path.
- 2026-06-26 07:02 MSK - closed Milestone 4 operator scope in `docs/factory-milestone4-run-control.md`: documented pulse controls, library run controls, backend snapshot fields, guard tests, prod deploy id, auth smoke expectations, and what remains outside M4.
- 2026-06-26 07:13 MSK - tightened the manual market-feedback loop after M4: `POST /api/factory/post-metrics` now marks recipes as `posted` when metrics are saved or forwarded to winners, Studio reflects the posted state after entry, and the daily runbook now includes the evening metrics step.
- 2026-06-26 07:21 MSK - hardened `post-metrics` posted-state marking: metrics can still save fail-open, but recipe status now changes to `posted` only when an `output_url` exists and the recipe is not `running`; Studio refreshes the library card after a successful posted mark.
- 2026-06-26 07:27 MSK - tightened market metrics UX: recipe cards now show the views input only after a recipe has an MP4/output URL or is already marked `posted`, preventing accidental market-signal entry on drafts/running recipes.
- 2026-06-26 07:34 MSK - hardened `/post-metrics` against orphan market signals: the route now verifies `node_recipes` first and returns `404` for a missing recipe before inserting metrics; the existing lookup also feeds winner-forward and posted-state marking.
- 2026-06-26 08:02 MSK - started closing V11 budget guardrails in Studio: both library `старт` and assembly launch now check `/ops` before `graph-run`, block only on explicit `balances.low`, and show a per-recipe cost estimate plus `x3` OTK-regeneration ceiling. Backend `cost_hint` remains a follow-up, but the operator no longer starts paid runs fully blind.
- 2026-06-26 08:12 MSK - closed the practical V10 preview-reuse gap: Studio now persists accepted `preview_url + preview_hash` immediately via `saveNode` instead of waiting for delayed autosave, so a fast click into assembly cannot race the database and cause a second paid FAL submit for the same node.
- 2026-06-26 08:23 MSK - hardened V8 reality-first routing after `decompose`: even if Claude returns AI tools for `problem|solution|proof`, the route now forces those backbone roles to `disk_real` unless the node is an explicit AI accent (`talking_head`, `before_after`, or `voiceover`). Added a guard test to keep the factory from drifting back into all-AI-slop graphs.
- 2026-06-26 08:34 MSK - closed V2 transfer safety: competitor decompose nodes now become product-scoped draft prompts via `recipeDraft`, keeping the reference meaning but explicitly forbidding literal copying; winner presets still keep their exact production prompt.
- 2026-06-26 08:55 MSK - locked V18-1 as a Studio contract: legacy `patrick`/`text` entry points remain hidden from navigation while the files stay reachable by direct URL until a later V18-2 deletion decision.
- 2026-06-26 09:08 MSK - closed the V11 backend contract: added shared `costEstimate` logic, persisted `run_plan.cost_hint`, returned `cost_hint` from `/api/factory/graph-run`, and switched batch budget guard to the same estimator so UI and unattended runs share one typical/worst-case cost model.
- 2026-06-26 09:15 MSK - audited V7 read-back and found it already wired in the current runtime (`decompose`/`autofill` via `learningHints`, `video-critic` via `rejectAntiFor`); added a contract test so the winner/corpus/reject feedback loop does not silently regress.
- 2026-06-26 09:24 MSK - advanced V20 history coverage inside the factory scope: StaticV1 Remotion submits now log `submitted` history rows, `static-status` logs completed PNGs or terminal failures, and Studio passes article/format/headline lineage into polling. Repo-local `scripts/*` remains the explicit V20 gap because it is outside the Railway worker file mandate.
- 2026-06-26 09:32 MSK - prepared V3/V4 without destabilizing MVP: `graphRun` can now route low-OTK/artifact failures into single-node `regenCulprit` + `/improve-prompt`, but only behind `FACTORY_OTK_REGEN=1` and still bounded by `MAX_RENDERS=3`; default production remains fail-open warning→bank.
- 2026-06-26 09:41 MSK - reopened V9 only as a safe judging primitive: `/hook-judge` is no longer a Sprint-1 disabled stub, but it is deterministic and cheap (ranks supplied hooks using heuristic signals plus `viral_hooks` corpus). `/variations` remains disabled, so no new LLM fan-out or paid preview loop is introduced.
- 2026-06-26 12:43 MSK - strengthened V5 market feedback without adding UI complexity: `/post-metrics` now normalizes `platform/views/watch_rate/ctr/saves/posted_at` once and forwards that full snapshot into `/winners`, where it is persisted under `winner_learnings.market_signal` for the learning loop. The library card still keeps the MVP one-field workflow for the operator.
- 2026-06-26 12:49 MSK - added a V6 market-noise guard to read-only `/ab-rank`: variants are still scored by views × retention/CTR, but a market `winner` now requires `min_winner_views` (default 100, query-overridable). This keeps future scale/recompose advice from treating tiny samples as proof.
- 2026-06-26 12:56 MSK - hardened V14 winner presets: extracted `sanitizeWinnerPresetNodes()` from `/winners` and added a unit test proving winner presets preserve production prompt/settings while stripping volatile `preview_url`/`preview_hash`, so V10 preview reuse cannot leak old clips into transferred recipes.
- 2026-06-26 13:05 MSK - advanced V17 without adding ffprobe/fal-extract infrastructure: `autoBindAssets` now selects `content_assets.duration_sec`, `assetBind` preserves known real-video durations, and `graphRun` copies them into run nodes when the recipe node has no explicit duration. This fixes silent fallback to 5s for cataloged real clips while leaving heavy duration backfill for later.
- 2026-06-26 13:12 MSK - closed V12 at MVP level as a planning preview: Studio already renders the assembly timeline from recipe node durations before the paid `graph-run` starts. Added a guard test so this free timeline preview cannot disappear or be replaced by a misleading paid-render promise.
- 2026-06-26 13:18 MSK - cleaned up a post-M4 stress-history false alarm: archive `target_met` is now computed from the stress run summary itself (`completed == totalRuns` and no failures/timeouts), not from the wider DB stability snapshot that can include older unrelated failures. Added a guard test so a real 10/10 run does not show as `target 0/n` in the operator stress history.
- 2026-06-26 13:29 MSK - separated stress-run authorization problems from factory failures: `stressGraphRun` now marks 401/403 as `auth_fail`, the Markdown report exposes `auth_fail`, and Studio shows `нужна авторизация/CRON_SECRET` instead of counting this as a red content-factory run failure.
- 2026-06-26 13:44 MSK - added a read-only V16-lite market feedback panel to the learning screen: `/api/factory/learning` now returns `market_summary` from `post_metrics` with best-per-recipe views, retention, CTR, saves, 100+ view sample count, and a simple `ОТК vs рынок` alignment check; Studio shows the totals and top recipes without enabling auto-scaling or changing generation policy.
- 2026-06-26 13:58 MSK - expanded the same V16 read-only learning panel with market-by-niche aggregation: the API now groups real post metrics by niche, and Studio shows total views, average views, retention, and 100+ sample counts per niche without turning that into auto-upgrade logic.
- 2026-06-26 14:10 MSK - softened `/api/factory/ab-rank` recommendation semantics: the read-only response now exposes `review` / `hold` buckets and keeps old `scale` / `kill` only as compatibility aliases, so market ranking cannot be mistaken for an auto-scale or auto-stop command.
- 2026-06-26 14:22 MSK - localized `/api/factory/ops` alert and suggested-action reasons before they reach Studio: the worker pulse screen no longer depends on frontend-only label patches and does not leak `worker heartbeat`, `fallback ratio`, or `failed runs` text into the operator checklist.
- 2026-06-26 14:31 MSK - cleaned remaining operator-facing factory fallback copy: route-level crash fallbacks in produce/scenario/playbook/status/stability/ops now explain the degraded state in Russian product language while preserving the same fail-open contracts.
- 2026-06-26 14:39 MSK - synced roadmap/runbook with the new market-learning reality: V6 is explicitly `review/hold` read-only, V16 includes market-by-niche learning, and the daily operator loop now says how to read market signals without turning them into auto-scale commands.
- 2026-06-26 14:48 MSK - improved Studio graph-run error handling: the shared `api()` helper now preserves HTTP status/network state, and run-start toasts translate 401/403 and network failures into clear operator actions instead of raw `Не авторизовано` / `fetch failed`.
- 2026-06-26 14:54 MSK - extended the same readable error handling to static generation startup and graph-run polling failures, so auth/network issues no longer leak through secondary status panels after retries.
- 2026-06-26 15:06 MSK - expanded Studio readable error handling across common operator actions: open recipe, competitor search/decompose, transfer skeleton, node preview, autofill, brand-kit save, winner save, delete recipe, balances, learning, and winner-preset transfer now use the shared `apiErrorText()` path.
- 2026-06-26 15:15 MSK - hardened V16 learning market enrichment against malformed market rows: if `post_metrics` has no valid `recipe_id`, `/api/factory/learning` now records a warning and skips the empty `node_recipes.in([])` lookup instead of risking a read-path degradation.
- 2026-06-26 15:28 MSK - cleaned the remaining raw observability values in the full pulse view: slow-step names and incident `last_status` now pass through `runStepLabel()` / `runQueueTone()` instead of leaking backend step/status strings.
- 2026-06-26 15:35 MSK - finished the same full-pulse translation pass for step-duration series: hourly duration rows now use `runStepLabel()` instead of raw backend step ids.
- 2026-06-26 15:47 MSK - added a defensive translation layer for full-pulse failure diagnostics and balance chips: backend `issue/action/next_step/status` codes now render as operator tasks instead of English/raw enums.
- 2026-06-26 15:58 MSK - cleaned learning generation history lineage: node types now use `nodeTypeLabel()`, source codes use a small operator dictionary, and unknown statuses fall back to `неясно` instead of leaking backend enums.
- 2026-06-26 16:12 MSK - advanced V16 read-only learning without enabling auto-scale: `market_summary` now carries overall and per-niche 100+ view win-rate, and Studio shows that signal beside market-by-niche totals.
- 2026-06-26 16:18 MSK - synced operator docs after the V16 win-rate pass: daily runbook, M4 closeout, and roadmap now describe `win-rate 100+` as a read-only market signal, not an auto-scale command.
- 2026-06-26 16:25 MSK - localized the visible `/api/factory/graph-run` crash fallback: start/poll failures now return `graph-run упал` instead of English `graph-run crash`, with a regression guard in the factory contract tests.
- 2026-06-26 16:37 MSK - clarified stress-run timeout semantics: deadline exits now report `status: timeout`, preserve `lastStatus`, include `timeout_budget_sec`, and the runbook explains that timeout is not the same thing as factory `run_fail`.
- 2026-06-26 16:48 MSK - localized crash fallbacks for the primary Studio routes (`decompose`, `node-preview`, `recipes`, `balances`, `studio`, `niche-brief`, `static-generate`, `creatify-options`, `node-save`) and added a contract guard against English crash prefixes on those live operator paths.
- 2026-06-26 16:58 MSK - localized disabled stub responses for parked MVP components (`scenario-rewrite`, `variations`, `recipe-variants`, `batch-build`, `self-heal`, `watchdog`, legacy `jobs/*`) and extended the jobs migration guard so English `disabled for Sprint 1 stability` notes do not return.
- 2026-06-26 17:08 MSK - localized ops/graph orchestration fallbacks: `/ops`, `/stability`, `/worker-state`, `graph-run/tick|cron|rejudge` now explain crashes and auth blocks in Russian operator language (`неверный CRON_SECRET`) with a regression guard.
