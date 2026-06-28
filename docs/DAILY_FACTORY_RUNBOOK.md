# Daily Factory Runbook

Статус: `draft`

Цель: дать оператору короткий и повторяемый ритуал ежедневной работы с контент-заводом без необходимости лезть в код и логи раньше времени.

## Что считается нормой

Нормальный день завода выглядит так:

- `OPS` не кричит без причины;
- в `Командном центре` понятно, идёт ли живой прогон;
- `Пульс завода` показывает последние прогоны, а не только служебную очередь;
- `warning` не мешает выпуску MP4, если это fail-open quality warning;
- `run_fail` всегда требует triage.

## Утренний ритуал — 5 минут

Открыть:

1. `Командный центр`
2. `Пульс завода`
3. `Сборка / ОТК`

Если нужно быстро сверить production truth вне UI, запустить:

```bash
CRON_SECRET=... node lib/factory/prodSmoke.mjs --base-url https://finance-panel-two.vercel.app --recipe 68
```

Важно:

- plain `curl` без browser session / bearer token на production factory routes сейчас возвращает `401`;
- это надо читать как `auth-gate`, а не как автоматическую поломку execution path.

Артефакты после запуска:

- [`docs/factory-latest-prod-smoke.md`](/Users/maksimpankratov/.codex/worktrees/5522/finance-panel/docs/factory-latest-prod-smoke.md)
- [`docs/factory-latest-prod-smoke.json`](/Users/maksimpankratov/.codex/worktrees/5522/finance-panel/docs/factory-latest-prod-smoke.json)

Проверить в таком порядке:

### Шаг 1. Посмотреть `OPS`

Если `OPS HEALTHY`:
- идём дальше без вмешательства.

Если `OPS DEGRADED`:
- не паниковать;
- открыть `Пульс завода`;
- посмотреть, это factory-проблема или только worker-infra/service issue.

Если `OPS CRITICAL`:
- сначала проверить последние прогоны;
- потом balances;
- потом critic/render path.

## Как читать `Командный центр`

Главное:

- верхняя health-card — это короткая сводка;
- worker-card — это не сама фабрика, а контур исполнения/наблюдения;
- ниши и товары — не индикатор здоровья системы, а рабочая зона.

Что важно замечать:

- есть ли живой worker heartbeat;
- есть ли реальный активный прогон;
- не показываются ли одни и те же warning/fail изо дня в день.

Что можно игнорировать:

- служебные worker-infra сообщения, если execution path жив и последние прогоны успешны;
- warning-only сигналы, если MP4 дошёл до конца и это уже известный fail-open path.

## Как читать `Пульс завода`

Экран читается сверху вниз:

### 1. Состояние завода

Это главный краткий verdict по execution path.

### 2. Статус worker

Смотреть:

- `alive / stale / dead`
- `last_seen`
- источник snapshot

Важно:

- `service snapshot` или fallback-семантика не всегда значит, что сам завод не работает;
- это значит, что service telemetry неидеальна и надо отдельно проверить worker heartbeat.

### 3. Текущий прогон

Если есть:

- `RUNNING` — идёт живая работа;
- `WARNING` — выпуск завершён, но есть деградации;
- `FAILED` — нужен triage;
- `DONE` — последний прогон завершился без runtime failure.

### 4. Что делать дальше

Это операторский список действий.

Приоритеты:

- `P0` — сначала это
- `P1` — важно сегодня
- `P2` — можно не останавливать выпуск

### 5. Очередь прогонов

Смотреть:

- повторяется ли один и тот же класс ошибки;
- есть ли серия `run_fail`;
- растёт ли число warning-only завершений.

### 6. Служебная очередь worker

Это вторично.

Использовать только если:

- надо понять, что происходит с самим worker heartbeat / service contour;
- heartbeat или service contour явно деградировал.

## Как отличать типы проблем

### Тип A. Выпуск идёт, но есть warnings

Признаки:

- прогоны завершаются;
- `status = warning`;
- MP4 есть;
- нет серии `run_fail`.

Действие:

- выпуск не останавливать;
- записать recurring warning;
- разобрать позже как reliability/quality tail.

### Тип B. Выпуск реально сломан

Признаки:

- `run_fail`
- нет output
- repeated failure category
- `failed runs` растут

Действие:

1. открыть последние прогоны;
2. посмотреть `error_category`;
3. triage по классу:
   - `render`
   - `generation`
   - `db`
   - `quality`
   - `storage`
   - `timeout`

### Тип C. Сломана телеметрия, а не выпуск

Признаки:

- worker stale/fallback;
- `OPS` может быть degraded;
- но последние прогоны `done/warning`;
- MP4 путь живой.

Действие:

- не объявлять это аварией завода;
- чинить heartbeat/storage отдельно;
- продолжать следить за реальными прогонами.
- подтвердить это через `prodSmoke`, чтобы отделить `worker_infra` от `runtime`.

## Triage по классам ошибок

### `render`

Проверить:

- submit/poll path
- render VM/service
- upload path
- output URL

### `generation`

Проверить:

- upstream провайдер
- пустой ответ модели
- invalid JSON
- retry behavior

### `db`

Проверить:

- Supabase доступность
- schema cache
- права
- наличие нужной таблицы

### `quality`

Проверить:

- OTK path
- critic path
- frame extraction
- fail-open semantics

### `storage`

Проверить:

- bank/gen-save
- catalog save
- asset persistence

### `timeout`

Проверить:

- конкретный долгий шаг
- provider latency
- timeout budget

## Когда останавливать выпуск

Останавливать выпуск только если:

- пошла серия `run_fail`;
- нет output у реальных прогонов;
- сломан render path;
- сломан DB path;
- balances не дают продолжать работу.

Не останавливать выпуск, если:

- warnings известны и fail-open;
- worker service contour шумит, но execution path жив;
- critic path частично деградировал, но MP4 всё ещё выпускается.

## Когда открывать инженеру задачу сразу

Открывать задачу сразу, если:

- один и тот же `run_fail` повторился 2+ раза подряд;
- `OPS CRITICAL` держится после повторной проверки;
- output path сломан;
- появился новый неизвестный класс ошибки;
- production truth расходится с тем, что ожидает Studio.

## Артефакты дня

Каждый день желательно иметь:

- 1 короткую запись о состоянии завода;
- последние recurring warnings;
- список новых `run_fail`;
- что уже известно как harmless;
- что стало новым инцидентом.

Минимум фиксировать в:

- `docs/factory-railway-night-log.md`

## Короткий дневной цикл

### Утро

- посмотреть `OPS`
- посмотреть последние прогоны
- проверить balances

### Днём

- отслеживать `run_fail`
- не реагировать на harmless warning шум
- запускать triage только по реальным failure classes

### Вечером

- зафиксировать состояние дня
- отметить повторяющиеся warning/fail
- обновить backlog, если появился новый класс проблемы

## Что считать успехом дня

День хороший, если:

- MP4 выпуск шёл;
- нет незамеченных `run_fail`;
- оператор понимал картину без логов;
- новые проблемы были классифицированы, а не просто "что-то сломалось".
