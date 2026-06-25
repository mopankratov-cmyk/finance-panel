# Execution Observability

Дата: 2026-06-25
Статус: `Milestone 2 — complete`

## Goal

Сделать исполнение контент-завода наблюдаемым без ручного чтения сырых логов:

- видеть `run_id` каждого прогона;
- видеть текущий и последний шаг;
- видеть длительность прогона и медленные шаги;
- отличать `warning` от `run_fail`;
- понимать, какие причины деградации повторяются чаще всего.

## Current Contract

### `GET /api/factory/graph-run?recipe_id=...`

Возвращает:

- `run_id`
- `status`
- `step`
- `warnings`
- `execution_log`
- `run_summary`

### `run_summary`

Поля:

- `started_at`
- `finished_at`
- `total_ms`
- `steps_total`
- `steps_done`
- `steps_warning`
- `steps_error`
- `active_step`
- `last_step`
- `last_status`

Назначение:

- быстро понять, жив ли прогон;
- увидеть, где он стоит сейчас;
- отделить долгий, но живой прогон от реально зависшего.

### `GET /api/factory/studio`

Возвращает:

- `recipes[]` с `run_summary`, `warnings`, `execution_log_tail`
- `observability`

### `observability`

Поля:

- `sample_runs`
- `running`
- `warning_runs`
- `failed`
- `stability_snapshot`
- `recent_runs[]`
- `incident_runs[]`
- `status_series[]`
- `step_duration_series[]`
- `slowest_steps[]`
- `top_error_categories[]`
- `top_errors[]`
- `top_warning_categories[]`
- `top_warnings[]`

Назначение:

- смотреть на последние прогоны как на систему, а не по одному рецепту;
- видеть, какие шаги самые медленные;
- видеть короткий run-by-run trend по последним запускам;
- видеть, какие warning-причины повторяются чаще всего.

### `recent_runs`

Каждая точка содержит:

- `recipe_id`
- `created_at`
- `status`
- `total_ms`
- `error_category`
- `warnings_count`

Назначение:

- быстро понять, улучшается ли ситуация от прогона к прогону;
- видеть, что именно ломается подряд, а не только aggregated top-5;
- отделить единичный сбой от начинающейся серии деградаций.

### `incident_runs`

Каждая точка содержит:

- `recipe_id`
- `run_id`
- `created_at`
- `status`
- `last_step`
- `last_status`
- `total_ms`
- `error_category`
- `error`
- `warnings_count`

Назначение:

- быстро увидеть, какой именно `warning` или `run_fail` сейчас важен;
- понять, на каком шаге сломался последний проблемный прогон;
- дать короткий triage-tail без чтения полного `execution_log`.

### `stability_snapshot`

Поля:

- `window_size`
- `sample_size`
- `successful_runs`
- `warning_runs`
- `failed_runs`
- `running_runs`
- `success_streak`
- `target_successes`
- `target_met`

Назначение:

- держать Sprint 1 KPI в живом backend contract, а не только в ручном отчёте;
- быстро видеть, выполнена ли цель `10 успешных прогонов подряд`;
- отличать локальные единичные сбои от реально восстановившейся серии прогонов.

### `status_series`

Каждая точка содержит:

- `bucket`
- `total`
- `passed`
- `warning`
- `failed`
- `running`

Назначение:

- видеть почасовой trend без новой таблицы телеметрии;
- быстро замечать час, с которого началась деградация;
- отличать случайный fail от серии падений.

### `step_duration_series`

Каждая точка содержит:

- `bucket`
- `step`
- `avg_ms`
- `samples`

Назначение:

- видеть, какой именно шаг начал замедляться;
- отличать общую деградацию прогона от локального bottleneck;
- наблюдать slowest-step trend без отдельной metrics storage.

### `GET /api/factory/worker-state`

Теперь дополнительно возвращает:

- `worker`
- `workers[]`
- `queue`
- `docs`
- `observability`
- `latest_stress`
- `stress_history`

`worker.source`:

- `heartbeat_db`
- `queue_fallback`

Назначение:

- дать automation-friendly snapshot без тяжёлой студийной выборки;
- совместить ливнес воркера, очередь и последние execution signals в одном ответе;
- показывать latest stress и историю stress-серий рядом с worker state;
- упростить будущий watchdog поверх фактов, а не догадок;
- явно показывать, это живой heartbeat или аварийный fallback из markdown-очереди.

### `GET /api/factory/stability`

Возвращает:

- `stability`
- `stress_history`

Где `stability` содержит:

- `window_size`
- `sample_size`
- `successful_runs`
- `warning_runs`
- `failed_runs`
- `running_runs`
- `success_streak`
- `target_successes`
- `target_met`
- `incident_runs[]`
- `recent_runs[]`
- `failure_diagnostics`
- `generated_at`

Назначение:

- дать отдельный machine-readable snapshot для stress-test loop;
- держать KPI `10 успешных прогонов подряд` в отдельном backend contract;
- не заставлять automation читать Studio UI или весь `/ops`.
- дать короткую историю последних stress-серий из файлового архива без новой БД.

### `stress_history`

Поля:

- `total_reports`
- `total_runs`
- `completed_runs`
- `failed_runs`
- `warning_runs`
- `run_failures`
- `timeouts`
- `target_met_reports`
- `avg_duration_sec`
- `latest_generated_at`
- `recent_reports[]`

Назначение:

- смотреть не только последний stress snapshot, но и серию последних проверок;
- видеть, ухудшается ли стабильность между запусками;
- держать long-range основу без отдельной telemetry table.

### `GET /api/factory/ops`

Возвращает единый ops snapshot:

- `ops_status`
- `worker`
- `workers[]`
- `queue`
- `docs`
- `balances`
- `observer`
- `observability`
- `latest_stress`
- `stress_history`
- `alerts`
- `suggested_actions`
- `generated_at`

Назначение:

- собрать worker liveness, balances и execution observability в одном backend-facing контракте;
- вернуть тот же observer pulse, что раньше жил отдельно в `/api/factory/observer`;
- дать студии и automation одинаковую operational truth;
- уменьшить количество разрозненных опросов по нескольким route handler.

### `observer`

Поля:

- `updated_at`
- `heartbeat`
- `gens`
- `otk`
- `runs`
- `batches_active`
- `signals`

Назначение:

- держать sidebar pulse и worker incident summary на одном и том же snapshot;
- убрать рассинхрон между `/ops` и `/observer`;
- сохранить обратную совместимость: `/api/factory/observer` остаётся, но использует тот же shared loader.

### `suggested_actions`

Каждая точка содержит:

- `priority`
- `action`
- `reason`

Назначение:

- уменьшить неопределённость при triage;
- подсказывать первый operational move прямо из ops snapshot;
- отделить symptom reporting от next-step guidance.

### `ops_status`

Поля:

- `level`
- `summary`

Уровни:

- `healthy`
- `degraded`
- `critical`

Назначение:

- дать один главный health signal для центра и ops-экрана;
- свести несколько alert sources в один итоговый operational verdict;
- упростить чтение состояния без просмотра всех карточек.

## Warning Categories

Текущая нормализация:

- `critic`
- `artifact`
- `catalog`
- `render`
- `frames`
- `timeout`
- `quality`
- `other`

Это не финальная taxonomy. Она нужна, чтобы одинаковые по смыслу warning не расползались по десяткам строк.

## Error Categories

Текущая нормализация `run_fail` / `plan.error`:

- `input`
- `db`
- `budget`
- `timeout`
- `render`
- `quality`
- `storage`
- `generation`
- `other`

Назначение:

- быстро видеть, из-за чего реально обрываются прогоны;
- отличать продуктовые деградации от инфраструктурных;
- собирать P0/P1 не по сырым строкам, а по классам отказов.

## UI Surfaces

### Командный центр

Показывает operational summary:

- верхний `OPS healthy|degraded|critical` pill;
- sidebar pulse из unified `/api/factory/ops`, а не из отдельного опроса `/observer`;
- живой переход в worker screen без смены источника правды.

- сколько последних прогонов в `running`
- сколько в `warning`
- сколько в `run_fail`
- последние прогоны поштучно
- почасовой trend по последним бакетам
- trend длительности по самым медленным шагам
- самые медленные шаги
- top error categories
- top error strings
- top warning categories
- top warning strings

### Ops / worker-state

Показывает backend-facing snapshot:

- liveness Railway worker
- очередь задач
- последние error/warning categories
- медленные шаги последних прогонов
- `worker.source = heartbeat_db | queue_fallback`
- `db_error`, если heartbeat storage недоступен

Для живого heartbeat нужен sender:

```bash
BASE_URL=https://finance-panel-two.vercel.app \
CRON_SECRET=... \
node lib/factory/workerHeartbeat.mjs --every-sec=120
```

### Ops / unified route

Показывает:

- active alerts
- low balances
- worker heartbeat
- observability snapshot
- suggested actions

### Worker Screen

Теперь экран `worker` в студии использует `/api/factory/ops` и показывает:

- heartbeat и очередь
- active alerts
- low balances
- observability card
- suggested actions
- night log sources

## Alert Policy

Текущий policy layer в `/api/factory/ops`:

- `worker_dead` → `P0`
- `worker_stale` → `P1`
- `2+ low balances` → `P0`
- `1 low balance` → `P1`
- `top error category = db` → `P0`
- `top error category = render|generation` → `P1`
- warning-only деградации → `P2`

Назначение:

- превратить сырые сигналы в operational priority;
- дать утреннему разбору фиксированный порядок действий;
- подготовить основу для future safe automation.

### Сборка / ОТК

Показывает:

- `run_id`
- warning block
- `active step`
- `last step`
- `steps total`
- `time`
- execution log tail

### Библиотека рецептов

Карточка рецепта показывает:

- `run`
- `log N`
- `warn N`
- `error_category`
- `active ...`
- `last ...`
- `time ...`

## Operational Reading Guide

Если `status=running`, но `active_step` долго не меняется:

- сначала смотреть `execution_log_tail`
- потом смотреть `last_step`
- потом проверять, не упёрлись ли в `render`, `critic`, `catalog`

Если `status=warning`:

- выпуск не заблокирован;
- сначала смотреть `top_warning_categories`;
- затем конкретную строку из `warnings` или `top_warnings`.

Если `status=run_fail`:

- это уже не деградация, а реальный обрыв цепочки;
- сначала смотреть `error_category`;
- затем `plan.error`, `execution_log_tail`, `node_errors`.

Если `quality_signal` показывает деградацию:

- sample считается по последним 10 прогонам, где уже есть `run_plan.otk.basis`;
- старые рецепты без `basis` и текущие прогоны до шага `otk` не должны ухудшать `fallback_ratio`;
- `top_basis_reason` читается в том же quality-window, поэтому action в `/api/factory/ops` должен указывать на текущую причину, а не на исторический шум.

## Milestone 2 Closeout

Milestone 2 можно считать закрытым по core scope.

Что уже есть:

- единый `ops` snapshot;
- shared execution observability builder;
- heartbeat diagnostics и worker fallback diagnostics;
- `incident_runs` и `failure_diagnostics`;
- `stability_snapshot` для KPI `10 успешных прогонов подряд`;
- отдельный `stability` backend contract;
- latest stress artifact path, видимый и в Studio, и в worker screen.
- timestamped stress archive в `docs/factory-stress-history/` для истории серий без новой таблицы телеметрии.

Чего намеренно нет:

- отдельной витрины-дашборда вне Studio/worker screen;
- расширенной аналитики по неделям и месяцам.

Это уже следующий слой, а не обязательный минимум для observability MVP.

## Next Step

Текущий фокус после Milestone 2 и Milestone 3:

- держать `stress_history` как лёгкую историю серий без новой БД;
- развивать long-range аналитику по warning/error classes только поверх уже стабильного archive path;
- не добавлять новый ops dashboard, пока Studio/worker screen закрывают операторский минимум.
