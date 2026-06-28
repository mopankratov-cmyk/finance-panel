# Factory Month Plan

Статус: `draft`

Горизонт: `4 недели`

Главная цель месяца: перевести контент-завод из режима "мы постоянно что-то чиним" в режим "система предсказуемо выпускает ролики, а оператор понимает, что происходит".

## North Star

К концу месяца завод должен работать так:

- production UI показывает правду, а не смешивает runtime-проблемы с сервисной телеметрией;
- heartbeat worker-а живой и не держится на fallback по умолчанию;
- execution path прогонов стабилен и прозрачен;
- каждый `warning` и `run_fail` классифицируется понятно;
- есть операторский runbook для ежедневной работы;
- `10/10` stress-pass проходит в реальном runtime или мы точно знаем, что именно этому мешает.

## Принципы месяца

1. Не добавлять новые функции, если они не уменьшают риск.
2. Не добавлять новых агентов и новых orchestration contours.
3. Сначала правдивость сигналов, потом удобство UI, потом улучшения качества.
4. Все спорные места закреплять guard-тестами или явной документацией.
5. Любой экран должен говорить языком оператора, а не языком внутреннего техдолга.

## Запрещено в рамках этого плана

- расширять batch/build/rewrite/variation-пайплайны;
- запускать новый quality-эксперимент до стабилизации базового execution path;
- смешивать roadmap по качеству контента с roadmap по надежности завода;
- чинить production на глаз без фиксации артефакта или отчета.

## Месячный результат

На выходе должны существовать:

- стабильный и честный `ops`/`worker`/`stability` слой;
- чистая operator-surface в Studio;
- актуальный `STABILITY_REPORT.md`;
- `DAILY_FACTORY_RUNBOOK.md`;
- короткий backlog следующего месяца с уже отделенными P0/P1/P2.

## Week 1 — Production Truth

Цель недели: синхронизировать правду между кодом, production runtime и operator UI.

### Задачи

1. Задеплоить текущую ветку cleanup для `worker/ops/studio`.
2. Проверить live Studio после деплоя:
   - `Командный центр`
   - `Пульс завода`
   - `Сборка / ОТК`
3. Убрать оставшиеся ложные статусы `degraded/critical`, если источник только служебный.
4. Пройти production smoke по ключевым API:
   - `/api/factory/ops`
   - `/api/factory/worker-state`
   - `/api/factory/stability`
   - `/api/factory/graph-run`
5. Развести по отдельным классам:
   - factory runtime issues
   - worker heartbeat issues
   - observability issues
   - provider issues
6. Зафиксировать правду в `PROD_GAP_REPORT.md`.

### Definition of Done

- Studio не показывает оператору внутренние worker-infra проблемы как будто это авария завода.
- Есть список реальных production-проблем, а не смесь runtime и UI-шума.
- Все расхождения между local/repo/prod описаны явно.

### Артефакты

- `docs/PROD_GAP_REPORT.md`
- обновленный `docs/factory-railway-night-log.md`

## Week 2 — Worker and Heartbeat Hardening

Цель недели: сделать worker state живым operational signal, а не полуфейковым fallback-контуром.

### Задачи

1. Поднять и проверить heartbeat sender.
2. Довести до рабочего состояния `railway_worker_states`.
3. Проверить:
   - миграцию
   - schema cache
   - права/permissions
   - fail-open поведение при недоступности записи
4. Убрать зависимость operator UI от queue-derived fallback там, где есть живой источник.
5. Нормализовать статусы:
   - `alive`
   - `stale`
   - `dead`
   - `fallback_active`
6. Добавить guard-тесты на worker heartbeat semantics.

### Definition of Done

- Worker heartbeat приходит из живого контура.
- Queue fallback остается запасным режимом, а не рабочей нормой.
- `worker-state` и `ops` дают одинаковую картину по liveness.

### Артефакты

- test coverage по heartbeat semantics
- обновление `EXECUTION_OBSERVABILITY.md`

## Week 3 — Real Run Reliability

Цель недели: добить execution path реальных прогонов.

### Задачи

1. Разобрать все актуальные `warning/run_fail` из production-like запусков.
2. Отдельно пройти:
   - render submit/poll
   - upload path
   - fallback после render failure
   - OTK frame extraction
   - critic fallback path
   - empty LLM responses
   - invalid JSON
3. Привести retry/fail-open/fail-fast политику к одному правилу по execution path.
4. Отделить harmless warnings от настоящих degradation precursors.
5. Повторить stress-pass на живом runtime.
6. Обновить `STABILITY_REPORT.md` по факту, а не по ожиданию.

### Definition of Done

- Реальный execution path прозрачен шаг за шагом.
- `warning` больше не скрывает неразобранный сбой.
- Есть повторяемый stress-pass с честным отчетом.

### Артефакты

- обновленный `STABILITY_REPORT.md`
- обновленный stress archive

## Week 4 — Operator UX and Daily Operations

Цель недели: сделать завод удобным для ежедневной эксплуатации.

### Задачи

1. Дочистить operator surfaces:
   - `Командный центр`
   - `Пульс завода`
   - `Сборка / ОТК`
2. Сделать явные action cards:
   - что идет сейчас
   - что реально сломано
   - что требует действия
   - что можно игнорировать
3. Привести терминологию экранов к одному словарю статусов.
4. Свернуть остатки инженерского языка в secondary diagnostics.
5. Собрать ежедневный runbook оператора.
6. Составить backlog следующего месяца.

### Definition of Done

- Оператор без чтения логов понимает состояние завода.
- Все основные экраны говорят в одной логике.
- Есть runbook на ежедневную работу.

### Артефакты

- `docs/DAILY_FACTORY_RUNBOOK.md`
- `docs/factory-next-month-backlog.md`

## P0 Queue

- production truth pass
- live deployment cleanup verification
- working heartbeat sender
- healthy `railway_worker_states`
- real stress-pass on production-like runtime
- triage актуальных `run_fail`

## P1 Queue

- warning taxonomy cleanup
- worker/ops/stability semantics alignment
- operator cleanup for `center/worker/assembly`
- regression guards for worker infra vs factory health

## P2 Queue

- compact secondary diagnostics
- archive/report ergonomics
- visual polish for operator cards
- cleanup of remaining legacy wording in factory screens

## Risks

1. Production env может расходиться с local сильнее, чем видно по repo.
2. Heartbeat sender может упираться не в код, а в Railway/runtime execution model.
3. Реальные run-fail могут быть привязаны к провайдерам, а не к orchestration.
4. Легко снова скатиться в "чинить все подряд", если не держать границу между reliability и quality.

## Anti-drift Rules

Перед любой новой задачей проверять:

1. Это уменьшает шанс срыва выпуска?
2. Это уменьшает ложный операторский шум?
3. Это делает execution path понятнее?
4. Это закрепляется тестом или документом?

Если на все четыре ответа "нет", задача не для этого месяца.

## Month Exit Criteria

Месяц считается закрытым, если выполнено большинство из списка:

- `ops` честно отражает здоровье execution path;
- worker heartbeat живой и понятный;
- Studio не паникует по ложным причинам;
- есть production-like `10/10` stress-pass или точный блокер к нему;
- оператор может работать по runbook;
- следующий месяц начинается уже не с "что у нас вообще ломается", а с осознанного backlog.
