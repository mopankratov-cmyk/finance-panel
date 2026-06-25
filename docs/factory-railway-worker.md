# Railway worker: протокол работы по контент-заводу

Этот документ — операционный регламент для отдельного AI-worker на Railway, который дорабатывает контент-завод. Он дополняет мандат из `AGENTS.md`.

## 1. Рабочая зона

Разрешено менять только зону контент-завода:

- `app/inferno/`
- `app/agent/`
- `app/carousel/`
- `app/video-overlay/`
- `app/api/factory/`
- `lib/factory/`
- `components/factory/`, если компонент явно относится только к контент-заводу
- `docs/content-factory*.md`
- `docs/factory-*.md`
- `docs/inferno-*.md`

Запрещено без отдельного согласования владельца:

- вкладка «Финансы»
- общий код кабинетов, WB, Ozon, supplies
- auth, `middleware`, `proxy`
- `.env*`, секреты, токены, пароли
- миграции БД и `.sql`
- `package.json`, lock-файлы, зависимости
- CI (`.gitea/`, `.github/`)
- оплата и биллинг

Если задача требует выйти за эту зону, остановись и напиши: `это вне мандата Railway worker, нужно согласование с владельцем`.

## 2. Формат ночной работы

Источник задач на ночь: `docs/factory-railway-task-queue.md`.

Не делай один большой PR на всю ночь. Дроби работу на небольшие PR:

- один PR = одна законченная способность системы;
- ветки называй `feat/<коротко>` или `fix/<коротко>`;
- коммить после каждого завершённого блока;
- не пушь в `main`;
- не мержи PR сам.

Если задача большая, начинай с самого ценного минимального блока и доведи его до проверяемого состояния.

## 3. Журнал прогресса

Во время работы обновляй `docs/factory-railway-night-log.md`.

Статусы задач обновляй в `docs/factory-railway-task-queue.md`: `todo`, `doing`, `blocked`, `pr_open`, `done`.

Чтобы Studio видела, жив worker или уже молчит, шли heartbeat каждые 2-3 минуты в `POST /api/factory/worker-state`:

```json
{
  "worker_id": "railway-content-factory",
  "status": "working",
  "branch": "feat/factory-scenario-quality-gate",
  "current_task_id": "T-001",
  "current_task_title": "Scenario quality gate before render",
  "progress": "оцениваю сценарии",
  "blocker": "",
  "note": "делаю первый PR",
  "queue": []
}
```

Готовый sender уже лежит в репозитории:

```bash
BASE_URL=https://finance-panel-two.vercel.app \
CRON_SECRET=... \
node lib/factory/workerHeartbeat.mjs --every-sec=120
```

One-shot проверка:

```bash
BASE_URL=https://finance-panel-two.vercel.app \
CRON_SECRET=... \
WORKER_STATUS=working \
WORKER_TASK_ID=T-002 \
WORKER_TASK_TITLE="Taste pattern library" \
node lib/factory/workerHeartbeat.mjs --once
```

Как он работает:

- по умолчанию читает `docs/factory-railway-task-queue.md`;
- сам находит `doing`-задачу и подставляет её в heartbeat;
- может быть переопределён через `WORKER_*` env или `--task-id/--task-title/--status`;
- шлёт `queue[]` в Studio, чтобы worker screen не зависел только от одной БД-строки.

Если queue не нужна:

```bash
BASE_URL=https://finance-panel-two.vercel.app \
CRON_SECRET=... \
node lib/factory/workerHeartbeat.mjs --every-sec=120 --no-queue
```

Если heartbeat молчит дольше 5 минут, Studio помечает worker как `stale`. Дольше 15 минут — `dead`.

Каждая запись должна содержать:

- время;
- ветку;
- текущую цель;
- что изменено;
- какие файлы тронуты;
- какие проверки запущены;
- результат проверок;
- блокеры или риски;
- следующий шаг.

Журнал — не место для секретов, токенов, приватных URL с ключами или больших логов. Ошибки сокращай до сути.

## 4. PR description

В каждом PR укажи:

- цель;
- что изменено;
- список файлов/зон;
- acceptance criteria;
- проверки;
- что намеренно не трогал;
- риски;
- follow-up, если остался.

Минимальный шаблон:

```md
## Цель

...

## Что изменено

- ...

## Acceptance criteria

- [ ] ...
- [ ] ...

## Проверки

- [ ] npm run dev
- [ ] npx tsc --noEmit --pretty false
- [ ] eslint по затронутым файлам

## Не трогал

- ...

## Риски / follow-up

- ...
```

## 5. Проверки перед PR

Минимум перед PR:

```bash
npm run dev
npx tsc --noEmit --pretty false
```

Если менялся TypeScript/React/API-код, запусти eslint по затронутым файлам, например:

```bash
npx eslint app/api/factory/<route>/route.ts lib/factory/<file>.ts
```

Если проверка невозможна, напиши в журнал и PR почему именно.

## 6. Правила качества для контент-завода

Главный принцип: не ускорять выпуск мусора, а раньше отбрасывать слабое.

Для задач по промптингу и генерации держи фокус:

- сценарий проверяется до дорогого рендера;
- слабые варианты не идут в видео;
- промпты копируют структуру победителей, а не контент и не пиксели;
- i2v-промпт — motion script, не описание внешности/света/цвета;
- edit-промпт — короткая структура `Lock -> Change -> Scope -> Constraints`;
- каждое решение, оценка, rejection reason и winner должны по возможности становиться сигналом обучения.

## 7. Утренний отчёт

В конце ночи обнови верхний блок `docs/factory-railway-night-log.md`:

- какие PR открыты;
- какие ветки запушены;
- что готово к ревью;
- что не успел;
- где нужен владелец;
- какие проверки зелёные/красные;
- какие следующие задачи рекомендуешь.
