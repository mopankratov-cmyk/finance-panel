# Factory Jobs Migration Backlog

Дата: 2026-06-25  
Контекст: `jobs/*` больше не является каноническим execution path и в Sprint 1 уже сведён к disabled stub уровню.

## Goal

Безопасно вывести репозиторий из legacy-очереди `jobs/*`, чтобы:

- основной путь выпуска был только через `graph-run`;
- `jobs/*` перестал участвовать в runtime orchestration;
- после миграции routes `jobs/enqueue`, `jobs/list`, `jobs/tick` можно было свести к stub-уровню.

## Current live dependencies

### 1. `public/inferno/patrick-legacy.html`

Исторически использовал:

- `POST /api/factory/jobs/enqueue`
- `GET /api/factory/jobs/list`

Что это значило:

- legacy cockpit ставил генерации в старую очередь;
- у него была собственная модель прогресса через `jobsSummary`;
- пока это не было отвязано, `jobs/*` нельзя было схлопывать.

Текущий статус:

- launch-flow заморожен;
- polling заморожен;
- живого UI-caller внутри repo больше нет.

### 2. `/api/sync/all`

Исторически использовал:

- `POST /api/factory/jobs/tick`

Что это значило:

- общий sync-cron будил старую очередь как backstop;
- даже после заморозки UI cron-path ещё держал runtime-зависимость.

Текущий статус:

- wake-вызов `jobs/tick` удалён;
- живого sync-caller внутри repo больше нет.

## Current state after M1 + M2 + M3

- известных product/runtime callers на `jobs/*` внутри repo больше нет;
- routes `jobs/enqueue`, `jobs/list`, `jobs/tick` сведены к disabled stub routes;
- `lib/factory/jobs.ts` удалён из runtime surface.

## Target end state

### Canonical runtime

- `POST /api/factory/graph-run`
- `POST /api/factory/graph-run/tick`
- `GET /api/factory/graph-run/cron`
- `GET /api/factory/ops`
- `GET /api/factory/stability`

### Legacy after migration

- `jobs/enqueue` → disabled stub
- `jobs/list` → disabled stub
- `jobs/tick` → disabled stub
- `lib/factory/jobs.ts` → delete or archive once no callers remain

## Milestone plan

### M1. Remove UI dependency

Задачи:

1. Найти в `patrick-legacy.html`, что именно пользователь получает от `jobs/*`:
   - enqueue
   - live progress
   - summary counters
2. Решить замену:
   - либо переключить enqueue на `graph-run`
   - либо вообще убрать запуск генерации из legacy cockpit
3. Убрать polling на `jobs/list`.

Status:

- prep done: `patrick-legacy.html` уже явно маркирует server queue как `Legacy queue / compatibility-live`
- done: UI launch-flow legacy queue в `patrick-legacy.html` заморожен
- done: UI progress polling через `jobs/list` в `patrick-legacy.html` заморожен
- done: product/UI callers внутри repo сняты
- done: backend routes `jobs/enqueue` / `jobs/list` / `jobs/tick` больше не несут runtime-логику и сведены к stub-уровню

Exit criteria:

- `patrick-legacy.html` больше не вызывает `jobs/enqueue`
- `patrick-legacy.html` больше не вызывает `jobs/list`

### M2. Remove sync dependency

Задачи:

1. Убрать из `/api/sync/all` wake-вызов `jobs/tick`
2. Если нужен backstop для контент-завода, заменить его на:
   - `graph-run/cron`
   - или explicit `ops`/heartbeat monitor

Exit criteria:

- `/api/sync/all` больше не вызывает `jobs/tick`

Status:

- done: wake-вызов `jobs/tick` удалён из `/api/sync/all`
- done: repo больше не держит runtime dependency на legacy queue через общий sync-cron

### M3. Freeze queue semantics

Задачи:

1. После снятия всех callers перевести:
   - `jobs/enqueue`
   - `jobs/list`
   - `jobs/tick`
   в disabled stub routes
2. Обновить docs:
   - `SYSTEM_EXECUTION_MAP.md`
   - `ARCHITECTURE_AUDIT.md`
   - `EXECUTION_OBSERVABILITY.md`

Exit criteria:

- `jobs/*` больше не содержит runtime orchestration logic
- docs помечают его как `disabled stub`

Status:

- done: `jobs/enqueue`, `jobs/list`, `jobs/tick` переведены в disabled stub routes
- done: `lib/factory/jobs.ts` удалён из runtime surface
- done: архитектурные docs переведены с `compatibility-live` на `disabled stub`

### M4. Delete implementation

Задачи:

1. Удалить `lib/factory/jobs.ts`, если нет живых импортов или compatibility-требований
2. Удалить упоминания `jobs/*` из старых roadmap/spec docs, где они описаны как основной путь
3. Перепроверить `rg` по repo.

Exit criteria:

- `rg "jobs/tick|jobs/enqueue|jobs/list|lib/factory/jobs"` не показывает живых product/runtime callers

Status:

- done: `lib/factory/jobs.ts` удалён
- done: factory-docs переведены на historical/stub framing вместо живого queue-path
- done: `rg` по repo не показывает живых product/runtime callers для `jobs/*`
- done: live runtime comments больше не описывают `graph-run` как legacy jobs queue
- done: `lib/factory/jobsMigrationGuard.test.mts` закрепляет отсутствие `lib/factory/jobs.ts`, runtime imports и callers disabled `jobs/enqueue|list|tick`

## Risks

### Risk 1. Silent legacy usage

Проблема:

- старые внутренние страницы или интеграции могут пользоваться `jobs/*`, хотя это неочевидно.

Mitigation:

- до stubbing прогонять `rg` по repo;
- если route остаётся live, держать в коде явный comment `compatibility-live`.

### Risk 2. Progress model mismatch

Проблема:

- `patrick-legacy` может ожидать `queued/running/polling/done/failed`, а `graph-run` живёт в другой модели.

Mitigation:

- не делать слепую замену API;
- либо адаптировать UI под `graph-run`, либо отключать сам flow, а не подменять контракт на лету.

### Risk 3. False confidence from docs

Проблема:

- если docs говорят “legacy”, это ещё не значит “можно удалять”.

Mitigation:

- различать два статуса:
  - `compatibility-live`
  - `disabled stub`

## Post-migration guardrails

P1 guardrails:

1. Если всплывут внешние интеграции вне repo, явно держать `jobs/*` как disabled compatibility facade.
2. Новые фичи/доки больше не должны ссылаться на `jobs/*` как на execution path.
3. Migration можно считать закрытой; дальше остаются только historical mentions.

## Success criterion

Можно считать migration complete, когда:

- `jobs/*` не участвует в генерации роликов;
- `graph-run` остаётся единственным execution path;
- `jobs/*` больше не является operational dependency ни для UI, ни для cron.

Текущий статус:

- эти условия выполнены внутри текущего repo.
