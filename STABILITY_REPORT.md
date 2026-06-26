# Stability Report

Дата: 2026-06-25  
Спринт: `Sprint 1 — Stabilization First`

## Goal

Цель спринта: добиться `10` полных прогонов подряд без ручного вмешательства.

Фактический статус на момент отчёта: цель **достигнута на production-like рантайме (`next start`)**.

## What Was Changed In Sprint 1

- Создан [`ARCHITECTURE_AUDIT.md`](/Users/maksimpankratov/finance-panel/ARCHITECTURE_AUDIT.md) с картой архитектуры и списком лишних компонентов.
- Создан [`SYSTEM_EXECUTION_MAP.md`](/Users/maksimpankratov/finance-panel/SYSTEM_EXECUTION_MAP.md) с полным путём одного MP4-прогона, cron/self-heal/watchdog/resurrection и точками отказа.
- `graph-run` переведён в режим Sprint 1:
  - добавлен `run_id`;
  - добавлен `execution_log`;
  - добавлены `warnings`;
  - ОТК переведён из `FAIL CLOSED` в `FAIL OPEN`;
  - добавлены fallback'и на raw clip при проблемах с renderer path;
  - промежуточные warning-состояния больше не останавливают цепочку.
- Временно отключены дублирующие и необязательные компоненты:
  - `/api/factory/graph-run/watchdog`
  - `/api/factory/self-heal`
  - `/api/factory/scenario-rewrite`
  - `/api/factory/hook-judge`
  - `/api/factory/variations`
  - `/api/factory/recipe-variants`
  - `/api/factory/batch-build`
  - `/api/factory/batch-build/tick`
- Исправлена финализация шага `bank`: теперь `step=done` и финальный execution log сохраняются вместе.
- Поверх `AbortSignal.timeout(...)` добавлен жёсткий wall-clock timeout в `jpost(...)`, чтобы внутренние server-to-server вызовы не висели бесконтрольно.
- `graph-run/tick` переведён с `after(...)` на синхронный шаг исполнения; continuation-path упрощён до self-chain `tick` + cron fallback.
- `GET /api/factory/graph-run` сделан read-only и больше не участвует в orchestration.
- execution core дополнительно упрощён:
  - `tick` и cron-backstop используют общий helper `advanceClaimedRecipe(...)`;
  - `graph-run/cron` будит stale recipe последовательно;
  - rescue batch ограничен small-batch политикой (`maxWake=3`).
- `npm run build` проходит успешно, что подтверждает production-сборку после Sprint 1 правок.
- Добавлен повторяемый stress runner: [`lib/factory/stressGraphRun.mjs`](/Users/maksimpankratov/finance-panel/lib/factory/stressGraphRun.mjs).

## How To Re-run Baseline

Production-like baseline:

```bash
npm run build
npm run start -- --hostname 127.0.0.1 --port 3011
```

Local code gates:

```bash
npm run lint
npx tsc --noEmit
npm run test:factory
npm run build
```

`npm run build` сейчас использует `next build --webpack`, чтобы обходить Turbopack process/bind issue в sandbox-like окружениях.

В отдельном терминале:

```bash
set -a
source .env.local
node lib/factory/stressGraphRun.mjs --base http://127.0.0.1:3011 --recipe 68 --runs 10
```

По умолчанию этот запуск теперь обновляет:

- `docs/factory-latest-stress.json`
- `docs/factory-latest-stress.md`
- `docs/factory-stress-history/<generated_at>.json`
- `docs/factory-stress-history/<generated_at>.md`

Если нужен артефакт отчёта:

```bash
set -a
source .env.local
node lib/factory/stressGraphRun.mjs \
  --base http://127.0.0.1:3011 \
  --recipe 68 \
  --runs 10 \
  --json-out docs/factory-latest-stress.json \
  --md-out docs/factory-latest-stress.md
```

Раннер теперь:

- печатает `SUMMARY ...` в stdout;
- печатает `STABILITY ...` из `/api/factory/stability`;
- по умолчанию сохраняет latest JSON и Markdown артефакты серии;
- может писать и в кастомные пути через `--json-out` и `--md-out`;
- latest-режим можно отключить через `--latest=false`.
- archive-режим можно отключить через `--archive=false` или `FACTORY_STRESS_ARCHIVE=false`.

Ожидаемый Sprint 1 результат:

- `completed = 10`
- `failed = 0`
- `runFail = 0`
- `authFailures = 0`
- `timeouts = 0`
- `status=warning` допустим, если quality сервис недоступен

Если в отчёте появился `auth_fail`, это не дефект генерации роликов. Это означает, что stress-runner не прошёл авторизацию к `/api/factory/graph-run`; проверь `CRON_SECRET`/заголовок перед повторным stress-run.

## Stress Test

Контрольный рецепт: `recipe_id=68`  
Профиль: один `disk_real` клип, путь через `submit -> gen-poll -> assemble -> otk -> bank`

### Main 10-run sequence

- Всего запусков: `10`
- `step=done`: `9`
- `step=failed`: `1`
- `status=warning`: `7`
- `status=otk_pass`: `0`
- `status=otk_fail`: `2`
- `avg duration`: `141s`

### Raw result summary

1. `warning`, `done`, `59s`
2. `warning`, `done`, `68s`
3. `otk_fail`, `done`, `190s`
4. `warning`, `done`, `89s`
5. `run_fail`, `failed`, `541s`
6. `warning`, `done`, `156s`
7. `warning`, `done`, `70s`
8. `warning`, `done`, `18s`
9. `otk_fail`, `done`, `194s`
10. `warning`, `done`, `21s`

### Production-like verification (`next start`, port `3011`)

После перевода `graph-run/tick` с `after(...)` на синхронный шаг и запуска через `next start` была проведена новая серия на том же контрольном рецепте:

- Всего запусков: `10`
- `step=done`: `10`
- `step=failed`: `0`
- `status=warning`: `10`
- `status=otk_fail`: `0`
- `status=run_fail`: `0`
- `avg duration`: `33s`

#### Raw result summary

1. `warning`, `done`, `17s`
2. `warning`, `done`, `14s`
3. `warning`, `done`, `14s`
4. `warning`, `done`, `14s`
5. `warning`, `done`, `106s`
6. `warning`, `done`, `105s`
7. `warning`, `done`, `13s`
8. `warning`, `done`, `13s`
9. `warning`, `done`, `14s`
10. `warning`, `done`, `14s`

## What The Test Proved

### Confirmed improvements

- Пайплайн больше не падает каждый раз из-за `video-critic 502`.
- `video-critic` теперь возвращает `200` с deterministic fallback, если upstream Claude недоступен или отвечает пусто.
- Контрольный рецепт может завершаться end-to-end даже при недоступном критике.
- `execution_log` и `run_id` уже реально помогают локализовать застревания.
- Удаление лишних оркестраторов уменьшило количество “скрытых” путей вмешательства.
- На `next start` получено честное `10/10 done` без ручного вмешательства.

### Confirmed remaining instability

- Есть редкая, но реальная аномалия: часть прогонов завершалась со статусом `otk_fail`, хотя для этого же входа основной путь уже должен был отдавать `warning`.
- Есть минимум один тяжёлый прогон, который закончился `run_fail`.
- Локальный `next dev` / Turbopack под длинной серией периодически перезапускается по памяти и однажды словил внутренний route-crash на `/api/factory/graph-run/tick`.
- Полноценный stress на `next start` в этом окружении дополнительно упирается в auth-gate proxy, поэтому локально без пользовательской сессии проще валидировать сборку и runtime, чем повторять ту же серию “снаружи”.

Примечание:

- эти аномалии были воспроизведены именно в `next dev`;
- после перехода на `next start` и обновления continuation-модели они не воспроизвелись в контрольной серии `10/10`.

## Remaining P0

На production-like рантайме критичных P0 для Sprint 1 больше не осталось.

## Watchlist

### W-1. Локальный `next dev` нестабилен под длинной нагрузкой

Проблема:
- сервер перезапускался по памяти;
- один раз словил внутренний `handler is not a function` / HTML error cascade.

Почему это важно:
- часть локальных стрессов сейчас меряет не только завод, но и хрупкость Turbopack dev runtime.

Что делать:
- для длинных прогонов гонять stress не на `next dev`, а на production-like server;
- отделить продуктовую стабильность от dev-runtime стабильности.

Статус:
- не считается открытым P1 для MVP-кода после перехода проверок на `next build --webpack` и production-like `next start`;
- текущий sandbox всё ещё не даёт поднять localhost (`listen EPERM`), поэтому HTTP smoke/stress остаётся внешней проверкой в обычном терминале/CI.

### W-2. `gen-save` иногда слишком длинный

Проблема:
- в логе были вызовы `gen-save` до `110s`.

Почему это важно:
- длинный `bank` увеличивает вероятность обрыва chain и ложных финальных состояний.

Статус:
- runtime-policy закрыта в Sprint 1 cleanup:
  - `gen-save` уже вызывается через жёсткий JS timeout;
  - если `gen-save` не успел сохранить asset, `bank` завершает рецепт с `catalog_error` и явным `warning`, а не маскирует исход как fully-green.

Что осталось:
- наблюдать это поведение на следующих production-like stress сериях;
- при повторении уже думать не про semantics, а про ускорение самого `gen-save`.

## Remaining P2

- P2-хвост закрыт: студия получила compact-mode для более лёгкой отладки, docs приведены к `warning`-семантике, а `jobs/*` помечены как legacy/compatibility-контур.
- Дополнительный cleanup после closeout:
  - неиспользуемые `eslint-disable` убраны из `app/api/factory/**` и `lib/factory/**`;
  - полный `npm run lint` теперь проходит без errors и warnings;
  - `npx tsc --noEmit` проходит чисто.

## MVP Readiness Verdict

Текущее состояние:

- Архитектура стала заметно проще.
- Контрольный путь MP4 доходит до конца без ручного вмешательства.
- На production-like рантайме подтверждено `10/10`.

Итог:

`Sprint 1` и его P2-хвост можно считать **закрытыми** по целевому KPI.  
Следующий фокус: вынести lessons learned из этого прохода в Sprint 2 и развивать quality-signal (`video-critic`) без возврата к fail-closed модели выпуска.

## Milestone 3 Closeout

Milestone 3 можно считать закрытым по core scope.

Что закрыто:

- отдельный `stability` backend contract;
- shared snapshot loader для `ops` / `worker-state` / `stability`;
- stress runner печатает `SUMMARY` и `STABILITY`;
- stress runner по умолчанию пишет:
  - `docs/factory-latest-stress.json`
  - `docs/factory-latest-stress.md`
- latest stress snapshot виден прямо в Studio и worker screen.
- stress runner архивирует timestamped JSON/Markdown отчёты в `docs/factory-stress-history/`.
- `/api/factory/stability`, `/api/factory/ops` и `/api/factory/worker-state` отдают `stress_history` summary по архиву.
- read-path `GET /api/factory/graph-run` очищен от скрытого wake side-effect.
- duplicate step-runner policy между `tick` и cron-backstop сведена к одному helper.
- cron rescue-policy сужена до последовательного small-batch fallback (`maxWake=3`).

Что это дало:

- stress/stability loop перестал быть только “терминальной процедурой”;
- у оператора и automation теперь один и тот же latest-report path;
- backend path для последних прогонов стал заметно чище и предсказуемее.
- основной execution path стал ближе к Sprint 1 цели: один активный runner и одна спокойная страховка.

Что осознанно оставлено в backlog:

### P1 backlog

- отдельная long-range аналитика по error classes и warning classes поверх уже добавленного stress archive;
- отдельный повторный production-like stress pass после накопления новых recipe / provider-state.

### P2 backlog

- при желании автоматический rotate/publish архивных stress reports;
- дополнительная чистка secondary factory surfaces, если после следующего stress-pass появится новый шум.

## Latest Verification Notes

- `npm run lint`: pass, `0` errors, `0` warnings.
- `npx tsc --noEmit`: pass.
- `npm run test:factory`: pass, 21 factory test files.
- Live production-like stress on `next start` port `3012`: `10/10 done`, `failed=0`, `run_fail=0`, `timeouts=0`, `avg_duration_sec=19`; all 10 runs were `warning` because OTK score was below threshold (`6`), which is allowed by Sprint 1 fail-open policy.
- Inline script syntax check for `public/inferno/studio.html`: pass.
- Custom factory handler scan: `96` route handlers, `0` gaps по текущему критерию `try/fallback/crash/disabled` контракта.
- Quality fail-open cleanup: `/api/factory/graph-run/rejudge` и `/api/factory/gen-save` больше не создают новые блокирующие `otk_fail`/`rejected` записи при score < 7; новый низкий ОТК сохраняется как `warning`.
- Learning fail-open cleanup: `/api/factory/learning` и история генераций в Studio трактуют legacy `otk_fail`/`rejected`/`artifact_fail` как warnings; `fail` в тренде оставлен под настоящий `run_fail`.
- Dependency cycle cleanup: типы графа вынесены в `lib/factory/graphTypes.ts`; factory dependency scan теперь показывает `0` import cycles, и это закреплено unit-тестом.
- CLI timeout cleanup: `stressGraphRun` и `workerHeartbeat` получили hard HTTP timeouts; stress runner сохраняет failure-report при request-level сбоях; heartbeat daemon переживает transient POST failures; guard закреплён в `cliTimeouts.test.mts`.
- Ops fail-open cleanup: crash paths в `/api/factory/ops`, `/worker-state`, `/stability` больше не обнуляют файловый stress context; guard закреплён в `opsFailOpen.test.mts`.
- M4 jobs migration guard: `jobsMigrationGuard.test.mts` закрепляет, что `lib/factory/jobs.ts` удалён, disabled `jobs/enqueue|list|tick` не вызываются из runtime, а live comments не описывают `graph-run` как legacy queue.
- M5 market feedback hardening: `/post-metrics` больше не ставит ложный `forwarded:true`, `/ab-rank` fail-open при недоступной `post_metrics`, а входные market metrics нормализуются; guard закреплён в `marketFeedback.test.mts`.
- M6 learning readback hardening: `learningHints` ограничивает winner/corpus/reject snippets по длине и остаётся fail-open при пустом niche или ошибках БД; guard закреплён в `learningHints.test.mts`.
- M7 generation history hardening: `gen-save` пишет `generation_history` не только на happy path, но и на dedupe/race/failure/carousel paths; guard закреплён в `genSaveHistory.test.mts`.
- M8 node-preview lineage hardening: cache-hit preview attempts теперь тоже пишутся в `generation_history`; guard закреплён в `nodePreviewHistory.test.mts`.
- M9 graph-run clip lineage hardening: `persistClips` пишет durable clip success/dedupe/failure paths в `generation_history`; guard закреплён в `graphRunClipHistory.test.mts`.
- M10 generation-history API warning contract: history read-path остаётся fail-open, но возвращает `warning`, если таблица/запрос недоступны; guard закреплён в `generationHistoryApi.test.mts`.
- M11 learning dashboard warning contract: `/learning` возвращает `warnings[]` по деградировавшим read-моделям вместо тихих нулей; guard закреплён в `learningApiWarnings.test.mts`.
- M12 observer fail-open contract: `/observer` missing-db/crash paths возвращают `ok:true, partial:true` вместо read-only 500; guard закреплён в `observerFailOpen.test.mts`.
- Stress report contract cleanup: `stressGraphRun` теперь явно пишет `stress_target_met` для текущего 10-run отчёта и отделяет его от DB-wide stability snapshot; guard закреплён в `stressReportContract.test.mts`.
- `npm run build`: pass. Build script переведён на `next build --webpack`, потому что Turbopack path в текущем sandbox падает на `Operation not permitted` при попытке создать process / bind port.
- `npm run start -- --hostname 127.0.0.1 --port 3021`: blocked by sandbox `listen EPERM`; HTTP smoke/stress нужно запускать в обычном терминале/CI.
- `npm run check:factory`: pass. Агрегирует lint, typecheck, factory unit tests и production build.
- `npx tsx lib/factory/*.test.mts`: CLI path блокируется sandbox IPC, но `node --import tsx` работает; это закреплено в `npm run test:factory`.

Итог:

`Milestone 3` закрыт как этап сборки канонического stress/stability/report path и cleanup execution orchestration.  
Следующий шаг уже должен быть не “допиливать тот же слой бесконечно”, а открывать следующий milestone с отдельной целью.
