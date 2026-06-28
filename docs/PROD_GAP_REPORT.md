# PROD GAP REPORT

Статус: `draft`

Дата: `2026-06-27`

Контекст: Week 1 из [`factory-month-plan.md`](/Users/maksimpankratov/.codex/worktrees/5522/finance-panel/docs/factory-month-plan.md) — зафиксировать разницу между тем, что уже стабилизировано в repo, и тем, что ещё может выглядеть деградировавшим или неполным в production/runtime.

## Executive Summary

Главная картина на сейчас:

- базовый Sprint 1 по factory reliability уже закрыт на уровне repo и production-like stress semantics;
- часть визуальной деградации в Studio шла не из реального execution failure, а из служебного worker heartbeat / queue fallback контура;
- operator UI уже существенно очищен, но production truth всё ещё зависит от деплоя последних cleanup-коммитов;
- главный незакрытый production-хвост не "архитектура завода снова сломана", а приведение живого worker heartbeat и runtime smoke к одному честному operational picture.

## What Is Already Closed In Repo

Это не gap, а уже закрытая база:

- fail-open модель для `OTK` / critic / artifact-sensitive paths;
- единый `ops` / `worker-state` / `stability` слой;
- stress archive и latest stress artifacts;
- `10/10 done` на production-like `next start` path в ранее зафиксированном отчёте;
- очистка worker/operator surfaces от legacy `jobs/*` и лишнего orchestration шума;
- raw run lineage, warning semantics и execution log visibility.

## Confirmed Current Gaps

### G1. Production UI truth may lag behind the latest cleanup branch

Симптом:

- production Studio может продолжать показывать перегруженный `worker` screen или ложный `OPS DEGRADED`, если не задеплоены последние cleanup-коммиты.

Источник:

- не runtime regression;
- просто production не обязан совпадать с текущей веткой до деплоя.

Приоритет: `P0`

Следующий шаг:

- выкатить ветку cleanup;
- повторно открыть live Studio;
- сверить `center`, `worker`, `assembly`.

### G2. Worker heartbeat path is still operationally weaker than the main factory path

Симптом:

- worker snapshot может идти из `queue_fallback`;
- `railway_worker_states` или sender path могут быть не доведены до полностью живого состояния.

Источник:

- сервисный heartbeat-контур Railway worker-а, а не основной path сборки MP4.

Приоритет: `P1`

Следующий шаг:

- поднять/проверить heartbeat sender;
- проверить миграцию и права для `railway_worker_states`;
- перевести fallback в реальный backup mode, а не в основной источник.

### G3. Production smoke still needs a fresh live pass after the latest operator cleanup

Симптом:

- repo уже чище, но production smoke по актуальному deploy state ещё нужно повторить.
- прямой shell smoke без browser session сейчас отвечает `401 Не авторизовано` для:
  - `/api/factory/ops`
  - `/api/factory/worker-state`
  - `/api/factory/stability`
  - `/api/factory/graph-run?recipe_id=68`

Источник:

- обычный gap между "изменили код" и "подтвердили поведение живого окружения".
- production read-path завода закрыт auth-gate, поэтому plain `curl` без `fp_session` не равен real operator smoke.

Приоритет: `P0`

Следующий шаг:

- пройти live smoke:
  - `/api/factory/ops`
  - `/api/factory/worker-state`
  - `/api/factory/stability`
  - `/api/factory/graph-run`
- использовать один repeatable runner, чтобы не собирать truth вручную из четырёх табов:
  ```bash
  CRON_SECRET=... node lib/factory/prodSmoke.mjs --base-url https://finance-panel-two.vercel.app --recipe 68
  ```
- если smoke запускается не через browser session, ожидать `auth` classification, а не трактовать это как runtime crash.
- если нужно подтвердить не только read-path, но и write-path запуска:
  ```bash
  CRON_SECRET=... node lib/factory/prodSmoke.mjs --base-url https://finance-panel-two.vercel.app --recipe 68 --trigger-run
  ```
- смотреть артефакты:
  - [`docs/factory-latest-prod-smoke.md`](/Users/maksimpankratov/.codex/worktrees/5522/finance-panel/docs/factory-latest-prod-smoke.md)
  - [`docs/factory-latest-prod-smoke.json`](/Users/maksimpankratov/.codex/worktrees/5522/finance-panel/docs/factory-latest-prod-smoke.json)

### G4. Local test harness in this worktree is weaker than repo semantics

Симптом:

- стандартный запуск `.test.mts` сейчас упирается в `tsx` resolution issue в этом конкретном worktree environment.

Источник:

- это gap окружения проверки;
- не признак новой поломки factory runtime.

Приоритет: `P2`

Следующий шаг:

- либо восстановить `tsx` path для worktree;
- либо запускать такие guards в CI/основном рабочем окружении.

## What Is No Longer A Real Production Blocker

Это важно, чтобы не чинить фантомы:

### N1. Worker-infra noise is not the same as factory runtime failure

Больше нельзя считать автоматом, что:

- `sender_missing`
- `queue_fallback`
- `table_missing`
- `db_permissions`

означают, что сам content factory не способен выпустить ролик.

Это отдельный operational class проблемы.

### N2. Old `jobs/*` queue is not the active execution contour

Это legacy/compat layer, а не живой execution path MVP.

### N3. Warning-only runs are not equal to release-blocking failures

Особенно когда warning идёт из fail-open quality semantics, а сам MP4 выпуск завершён.

## Production Truth Model

После последних cleanup-правок production truth должен читаться так:

1. `ops_status` отвечает за здоровье execution path.
2. `factory_alerts` отвечают за реальные заводские проблемы.
3. `worker_infra_alerts` отвечают за служебный контур worker heartbeat/storage.
4. `suggested_actions` не должны смешивать operator triage и worker infra triage в один шумный список.

## Immediate Week 1 Checklist

- [x] задеплоить cleanup branch
- [x] открыть live Studio после деплоя
- [x] проверить `OPS` на главном экране
- [ ] проверить экран `Пульс завода` / internal `worker`
- [x] убедиться, что `Очередь прогонов` показывает real runs
- [x] подтвердить, что служебная heartbeat-проблема не красит весь завод как degraded без причины
- [x] записать live findings в `docs/factory-railway-night-log.md`

Последняя live-проверка от 2026-06-27 через logged-in in-app browser подтвердила:

- `Пульс завода` в production открывается без route-level ошибок;
- верхний статус читается как `штатно`, а не как ложный `degraded`;
- `Очередь прогонов` показывает реальные recipe runs (`#59`, `#58`), а не legacy `jobs/*` queue;
- архивные инциденты вынесены отдельно и не смешиваются с живым execution path.

Открытым остаётся только отдельный live-проход именно по экрану `Пульс завода` из production UI, но код и shared data model уже разведены так, чтобы этот экран читал `recent_runs` отдельно от служебной очереди worker.

## Exit Condition For This Report

Этот report можно считать закрытым, когда:

- production задеплоен с последним cleanup;
- live Studio соответствует новому operator model;
- оставшиеся проблемы уже описываются как реальные runtime/provider issues, а не как смесь UI-шума и служебной телеметрии.
