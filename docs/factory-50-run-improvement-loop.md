# Factory 50-Run Improvement Loop

Статус: `working draft`

Цель:
не просто выпускать ролики, а довести завод до режима, где серия из `50` прогонов улучшается батчами по `5`, не ломая стабильный MVP-path.

## Принцип

Контур улучшения не должен:

- блокировать выпуск;
- добавлять новый orchestration layer;
- требовать ручного разбора каждого ролика;
- менять сразу все параметры генерации.

Контур улучшения должен:

- читать последние production runs;
- выделять лучший текущий `control-pattern`;
- сравнивать качество батчами по `5` роликов;
- возвращать в генерацию только короткие actionable hints.

## Источник правды

Используются уже существующие слои:

- `node_recipes`
- `generation_history`
- `post_metrics`
- `content_assets.is_winner`
- `viral_hooks`
- `cf_signals`

Новых обязательных таблиц для первого шага не требуется.

## Что считается улучшением

Для батча из `5` роликов improvement считается достигнутым, если выполнено хотя бы одно:

1. средний `otk_score` батча вырос минимум на `0.2` против предыдущего батча;
2. `success_rate` батча вырос против предыдущего батча;
3. доля `winner` в батче выросла;
4. выросло число `market_wins` или средние `views` по роликам, где уже есть обратная связь.

Это deliberately мягкое правило: цель сейчас не идеальный offline science, а практический производственный рост.

## Run Classification

Каждый рецепт попадает в одну из трёх корзин:

- `winner`
  - есть `output_url`
  - `otk_score >= 8`
  - warning-хвост не доминирует

- `salvageable`
  - ролик дошёл до выхода
  - но есть `warning` или score средний

- `loser`
  - `run_fail`
  - нет `output_url`
  - или score устойчиво слабый

При наличии внешней обратной связи классификация усиливается:

- `content_assets.is_winner` поднимает ролик в `winner`;
- `cf_signals.rejected` опускает ролик в `loser`;
- `post_metrics.views/watch_rate` помогают отделять “нормально дошло до mp4” от “реально есть рынок”.

## Pattern Key

Первый improvement loop группирует ролики не по “магическому креативу”, а по простому pattern key:

- `hook_type`
- `format`
- `visual_tool`

Формула:

`hook_type | format | visual_tool`

Этого достаточно, чтобы:

- найти лучший control-pattern;
- не смешивать слишком разные ролики;
- ограничить вариации.

## Control + Experiments

На каждый следующий батч из `5` роликов:

- `1-2` ролика идут как `control-pattern`;
- `2-3` ролика идут как ограниченные эксперименты;
- меняется только `один` фактор за раз:
  - либо hook angle,
  - либо proof density,
  - либо CTA shape.

Одновременно менять `hook + visual + format` запрещено.

## Уже внедрено в код

### 1. Improvement snapshot

Добавлен:

- [`lib/factory/improvementLoop.ts`](/Users/maksimpankratov/.codex/worktrees/5522/finance-panel/lib/factory/improvementLoop.ts)

Он:

- читает `node_recipes`;
- подтягивает `post_metrics`, `cf_signals`, `content_assets.is_winner`;
- строит окно до `50` последних прогонов;
- режет их на батчи по `5`;
- считает `winner/salvageable/loser`;
- считает `market_wins` и feedback coverage;
- выделяет top patterns;
- формирует `next_actions`.

### 2. Read-only API

Добавлен:

- [`app/api/factory/improvement/route.ts`](/Users/maksimpankratov/.codex/worktrees/5522/finance-panel/app/api/factory/improvement/route.ts)

Endpoint:

- `GET /api/factory/improvement?niche=...&target_runs=50&batch_size=5`

Он нужен для:

- Studio / operator surfaces;
- learning dashboard;
- ручного контроля серии.

### 3. Learning injection

Обновлён:

- [`lib/factory/learningHints.ts`](/Users/maksimpankratov/.codex/worktrees/5522/finance-panel/lib/factory/learningHints.ts)

Теперь в hint injection попадает не только:

- winners,
- hooks corpus,
- reject anti-patterns,

но и:

- status последних батчей,
- текущий control-pattern,
- следующий recommended move.

### 4. Script generation grounding

Обновлён:

- [`app/api/factory/scripts/route.ts`](/Users/maksimpankratov/.codex/worktrees/5522/finance-panel/app/api/factory/scripts/route.ts)

Теперь сценарный генератор получает:

- не только winners/corpus/rejects,
- но и improvement hints из последних серий.

Это значит:

- новые сценарии уже строятся не в вакууме,
- а с учётом того, что последние `5` прогонов реально показали.

### 5. Batch brief for next five

Теперь improvement loop не только описывает прошлую серию, но и собирает короткий `batch plan` для следующей:

- сколько идей должны быть `control`;
- сколько идут как `experiment`;
- какой `control-pattern` держим;
- какую `change_axis` разрешено менять в следующей пятёрке.

Это удерживает завод от хаотичных скачков, когда одновременно меняются hook, format и visual.

### 6. Experiment axis memory

Кроме `control-pattern`, loop теперь считает статистику по оси изменения:

- `hook_angle`
- `proof_density`
- `cta_shape`
- `format`

Для каждой оси сохраняется, сколько было control/experiment прогонов, сколько winner/salvage/loser, сколько market wins и какая средняя отдача по просмотрам. Следующая пятёрка получает не случайную ось эксперимента, а ту, которая уже дала лучший сигнал.

### 7. Studio feedback queue

Экран обучения показывает последние прогоны как очередь обратной связи:

- внести просмотры;
- пометить ролик как winner;
- записать reject с причиной.

Это снижает ручное трение: оператор не ищет нужный ролик по другим экранам, а закрывает market feedback там же, где смотрит, чему завод научился.

### 8. One next action

Studio теперь выделяет один главный следующий шаг из `next_actions` и ведёт в существующий запуск следующей пятёрки. Новый оркестратор не добавляется: используется текущий `/api/factory/batch`, чтобы не увеличивать сложность MVP.

### 8.1. Next-batch gate

Improvement snapshot теперь возвращает `next_batch_gate`:

- `ready`;
- `reason`;
- `current_feedback`;
- `required_feedback`.

Это переводит правило из runbook в сам продуктовый контур: следующая пятёрка не должна стартовать вслепую, если прошлая полная серия ещё не получила хотя бы 2-3 market feedback сигнала. Studio показывает `gate ready / gate hold` и блокирует кнопку `следующая пятёрка`, пока gate не готов.

Snapshot также отдаёт `feedback_queue`: это ролики именно из последней пятёрки, отсортированные так, чтобы сначала закрывались те, где ещё нет `views / winner / reject`. Studio читает эту очередь напрямую, а не угадывает её из последних run history.

Ещё один слой состояния — `series_state`: `target_batches`, `completed_batches`, `next_batch_index`, `remaining_runs`, `remaining_batches`. Он нужен, чтобы оператор и будущая автоматика видели не только “можно ли запускать”, но и где именно находится серия из 50 роликов.

При dry-run/launch batch API назначает каждому выбранному рецепту `batch_role` и `change_axis` из `batch_plan`. Эти поля идут в `graph-run`, затем в `gen-save`, затем возвращаются в `content_assets.analysis`, откуда `improvementLoop` строит axis memory.

`batch_run_id` из `run_plan` теперь поднимается в `ImprovementRun` и агрегируется в `ImprovementBatch`. Studio показывает этот id в блоке последней серии, чтобы оператор мог связать learning snapshot с конкретным запуском `/api/factory/batch`.

Это важно перед серийной генерацией: каждая пятёрка должна быть сравнима не только по времени, но и по реальному batch launch. Если batch id не виден, сначала чинить трассировку, потом запускать следующую пятёрку.

Для внешнего smoke/preflight есть read-only endpoint:

- `GET /api/factory/series-readiness?niche=...&target_runs=50&batch_size=5`;
- возвращает `ready_to_launch_next`, `blockers`, `series_state`, `next_batch_gate`, `batch_plan`, `feedback_queue_count`;
- если всё готово, отдаёт рекомендуемый `next_batch_request` с `require_full_batch: true` и `require_learning_gate: true`.
- Studio на экране обучения имеет read-only кнопку `readiness`, которая показывает этот verdict без запуска генерации.
- Когда 50-run окно закрыто, оператор может начать новый цикл через Studio: выставляется `series_after`, и следующая серия считает только ролики после этого timestamp.
- Локально тот же read-only check доступен как `node lib/factory/seriesReadinessSmoke.mjs --base-url ... --niche ... --series-after 2026-06-27T00:00:00.000Z`; он пишет `docs/factory-latest-series-readiness.json/md`.
- Перед реальным запуском нового цикла есть безопасный dry-run: `CRON_SECRET=... node lib/factory/seriesNewCyclePreflight.mjs --niche cosmetics`. Он сам выставляет `series_after=now`, проверяет readiness и делает только `/api/factory/batch` с `dry_run:true`.
- Если dry-run упёрся в `нет рецептов-черновиков`, Studio показывает штатный recovery: `подготовить черновики`. Он вызывает `POST /api/factory/prepare-drafts`, переносит существующие `node_templates` на недавние товары как `status=draft` и не запускает видео.

Batch API тоже поддерживает server-side guard:

- Studio передаёт `require_learning_gate: true` при запуске следующей пятёрки из экрана обучения;
- `/api/factory/batch` читает `next_batch_gate` из improvement snapshot;
- production launch возвращает `409`, если gate не готов;
- dry-run/preflight возвращает `learning_gate`, чтобы оператор видел причину hold;
- если improvement snapshot временно недоступен, guard работает fail-open с warning, чтобы не ломать MVP-выпуск.

### 9. Market wins before quality wins

Top patterns теперь сортируются сначала по `market_wins`, а уже потом по внутреннему `winner_rate`. Внутренние победы ОТК сохраняются отдельно как `quality_wins`, чтобы завод не принимал “хорошо выглядит” за “реально зашло рынку”.

### 10. Warning memory

Loop сохраняет первый warning каждого run как `warning_reason` и поднимает повторяющуюся причину на уровень батча/pattern как `dominant_warning_reason`. Это не блокирует выпуск, но помогает видеть, какой дефект повторяется в серии.

## Что ещё нужно, чтобы цикл стал сильнее

### Уже закрыт P0-минимум

В текущем слое improvement loop уже учитывает:

- `views`
- `watch_rate`
- `CTR` proxy
- `approve / reject`
- `winner asset`
- `batch_role / change_axis`
- `dominant_warning_reason`

То есть batch comparison теперь опирается не только на внутренний `OTK`, но и на первую production feedback-петлю.

## Runbook: когда идти генерить видосы

Генерацию серии включаем после двух условий:

1. текущие правки смержены и задеплоены на production;
2. в Studio на экране обучения dry-run для кнопки `следующая пятёрка` показывает готовность полной пятёрки.

Операционный порядок:

1. Открыть Studio -> экран `Обучение`.
2. Выбрать нужную нишу.
3. Если начинается новое 50-run окно, сначала выполнить `seriesNewCyclePreflight.mjs` или нажать `новый цикл` в Studio.
4. Нажать `следующая пятёрка`.
5. Дождаться auto-preflight / dry-run.
6. Запускать production-батч только если видно:
   - `готово к полной пятёрке`;
   - `learning gate ready`;
   - `draft 5/5`;
   - `budget fit 5`;
   - есть список `selected_recipes`;
   - после запуска появился `batch_run_id`.
7. Если preflight не готов, не запускать неполную пятёрку. Сначала добрать черновики, бюджет или исправить конкретную причину из preflight.
   - если причина `нет рецептов-черновиков`, нажать `подготовить черновики`, затем повторить preflight.
8. После запуска нажать `Проверить прогресс batch` и убедиться, что по всем пяти `recipe_id` есть статус graph-run.
9. Когда ролики дошли до выхода, закрыть очередь обратной связи:
   - внести `views`;
   - отметить `winner`, если ролик реально сильный;
   - поставить `reject`, если ролик плохой или не годится для публикации.
10. Следующую пятёрку запускать только после того, как у предыдущей есть хотя бы 2-3 market feedback записи.
10. Повторить до `50` роликов: 10 батчей по 5.

Правило стабилизации:

- не запускать сразу 50 роликов одним кликом;
- не запускать неполную пятёрку;
- не оптимизировать промпты вручную между батчами;
- менять только один фактор эксперимента за батч;
- если OTK упал, но MP4 получен, сохранять как warning и разбирать после серии.

Acceptance для каждого батча:

- `batch_run_id` сохранён;
- выбрано 5 `selected_recipes`;
- 5 graph-run статусов доступны через `Проверить прогресс batch`;
- MP4 или warning/error видны по каждому run;
- market feedback внесён минимум по 2-3 роликам перед следующей пятёркой.

### P1

- связать batch-level feedback с публикационным статусом площадок, когда появится стабильный источник внешних метрик.

### P2

- хранить richer pattern memory:
  - CTA shape
  - proof shape
  - structure archetype

## Что нельзя обещать честно

Этот слой можно внедрить сразу.

Но нельзя честно обещать автоматически:

- что все `50` роликов будут строго лучше предыдущего поштучно;
- что без distribution signal система сама поймёт market quality;
- что OTK полностью заменит human/editor feedback.

Реалистичная цель:

- улучшение батчами по `5`;
- уменьшение числа `loser` серий;
- рост доли `winner/salvageable`;
- накопление устойчивого control-pattern по нишам.
