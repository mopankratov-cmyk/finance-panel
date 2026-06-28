# Factory Next Month Backlog

Статус: `draft`

Контекст: этот backlog открывается только после выполнения основного стабилизационного месяца из [`factory-month-plan.md`](/Users/maksimpankratov/.codex/worktrees/5522/finance-panel/docs/factory-month-plan.md).

Главный принцип следующего месяца:

- не возвращаться к борьбе за базовую стабильность;
- использовать уже очищенный execution path как платформу для улучшения качества, обучения и publish-слоя.

## North Star

Если текущий месяц отвечает на вопрос "может ли завод выпускать стабильно?", то следующий месяц отвечает на вопрос:

"может ли завод учиться на результатах, повышать качество роликов и двигаться к real distribution layer без взрывного роста сложности?"

## Входные условия

Этот backlog можно открывать только если:

- `ops` честно отражает execution path;
- operator UI не шумит ложными авариями;
- worker heartbeat находится в живом или хотя бы контролируемом состоянии;
- stress path стабилен;
- есть рабочий `DAILY_FACTORY_RUNBOOK.md`.

## Theme 1 — Quality Signal Upgrade

Цель: улучшить качество оценки ролика без возврата к fail-closed выпуску.

### P0

- разобрать текущий `video-critic` basis split:
  - `model`
  - `text`
  - `fallback`
- понять, где модельный путь теряется:
  - timeout
  - upstream unavailable
  - empty response
  - frame extraction issue
- собрать `critic-quality-matrix`:
  - какие warning harmless
  - какие реально коррелируют с плохим результатом

### P1

- улучшить model-path extraction и structured output
- сделать richer reason taxonomy для critic fallback
- вывести в Studio не только warning count, но и нормальный quality basis summary

### P2

- добавить richer OTK incident drilldown
- позже думать про rank-based quality comparison между прогонами

## Theme 2 — Learning Loop

Цель: замкнуть обучение на реальных результатах, но не превратить learning в точку отказа.

### P0

- определить, какой минимальный набор реальных post metrics нужен для learning loop
- описать canonical path:
  - `publish`
  - `pull_metrics`
  - `post_metrics`
  - `knowledge item`
  - `learning hints`
- зафиксировать, что learning loop всегда fail-open для выпуска

### P1

- нормализовать `post_metrics`
- перестать пускать мусорные/отрицательные метрики в обучение
- привязать результаты к `generation_history`

### P2

- winner-pattern feedback в hints
- quality vs market signal comparison layer

## Theme 3 — Publish Layer Foundation

Цель: подготовить publish/distribution, не раздувая контур исполнения.

### P0

- определить минимальный supported publish path
- зафиксировать storage/output contract для derivative assets
- развести:
  - generation complete
  - quality accepted
  - publish ready
  - published

### P1

- определить scheduler boundary
- определить account/channel abstraction
- определить publish retry semantics отдельно от generation retry semantics

### P2

- backlog по channel integrations
- archive/report по post-distribution health

## Theme 4 — Operator Efficiency

Цель: сократить время между проблемой и правильным действием оператора.

### P0

- action cards для самых частых failure classes
- last failed run drilldown
- consistent wording across `center`, `worker`, `assembly`

### P1

- richer run history summaries
- warning clusters
- next-best-action hints per failure category

### P2

- тонкая визуальная полировка secondary diagnostics

## Theme 5 — Scale Readiness Without Scale Complexity

Цель: подготовить рост объёма без возврата к многоконтурной оркестрации.

### P0

- определить, где реальный bottleneck:
  - generation
  - render
  - OTK
  - save/bank
- собрать simple throughput model

### P1

- посмотреть, какие шаги можно ускорять без изменения архитектуры
- понять, нужен ли второй executor path или достаточно усиливать текущий `graph-run`

### P2

- только после этого обсуждать batch/variants/rewrite возврат в систему

## Explicitly Deferred

На следующий месяц всё ещё не стоит автоматически тащить:

- новый batch orchestration contour
- новый self-heal/watcher contour
- вариации ради количества
- rewrite route как обязательный path
- новую сложную многошаговую publish-автоматику

## Candidate Milestones

### M1 — Quality Signal

- critic path понятен
- fallback taxonomy нормализована
- quality basis видно оператору

### M2 — Learning Loop Skeleton

- есть минимальный real metrics path
- learning не ломает выпуск
- generation history и result signal связаны

### M3 — Publish-Ready State Model

- generation/quality/publish состояния разведены
- можно готовить distribution layer без смешения ролей

### M4 — Operator Efficiency

- основные triage-actions происходят из UI
- меньше походов в логи

## Exit Criteria For Next Month

Следующий месяц можно считать успешным, если:

- quality signal стал полезнее, но не опаснее;
- learning loop начал питаться реальными результатами;
- publish layer имеет ясный skeleton;
- оператор работает быстрее;
- архитектура всё ещё остаётся простой и одноконтурной.
