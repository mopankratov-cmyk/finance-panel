# Контент-завод: карта данных и retention-политика

Дата: 2026-06-29

Цель документа: отделить настоящую память завода от временного мусора и не сломать выдачу роликов случайной чисткой Supabase.

## Короткий вывод

Да, Supabase сейчас хранит не только готовые ролики. Он хранит четыре слоя:

1. **Видео-банк** - готовые, подготовленные и исходные артефакты.
2. **Историю исполнения** - попытки генерации, рецепты, ноды, batch/run state.
3. **Reels Brain** - рыночные референсы, хуки, playbook, сигналы побед/провалов.
4. **Публикацию и метрики** - что ушло наружу и какой результат вернулся.

MP4-файлы в основном должны лежать в Supabase Storage bucket `factory-media`, а таблицы держат URL, lineage, статусы и обучающие сигналы. Поэтому нельзя чистить только таблицы или только Storage: сначала нужен read-only аудит ссылок.

Обновлённое целевое правило: Supabase больше не должен быть главным хранилищем тяжёлых файлов. Supabase остаётся индексом и оперативным staging-бакетом, а Яндекс.Диск становится холодным архивом для всего тяжёлого контента:

- финальные MP4 (`content_assets.kind = video`);
- промежуточные i2v/ugc клипы до склейки (`content_assets.kind = clip`);
- сгенерированные/подготовленные изображения (`content_assets.kind = image`);
- будущие voiceover/audio ассеты после подключения в архиватор.

Удалять файл из Supabase можно только после того, как у строки/ссылки есть подтверждённый `analysis.yandex_archive_path` и `analysis.yandex_archived_at`.

## Read-only audit

Добавлен endpoint:

```text
GET /api/factory/data-footprint
Authorization: Bearer $CRON_SECRET
```

Он ничего не удаляет и ничего не пишет. Ответ показывает:

- счётчики строк по ключевым таблицам;
- прирост за 24 часа и 7 дней, если у таблицы есть `created_at`;
- sample по Storage bucket `factory-media`;
- retention policy;
- предупреждения по недоступным таблицам/полям.

## Слои данных

### 1. Видео-банк

Таблицы:

- `content_assets`
- частично `generation_history`
- частично `factory_publications`

Что хранит:

- URL готовых MP4;
- prepared/product assets;
- winners/approved flags;
- ссылки на источники;
- `analysis` с OTK, memory labels, batch axis и другими метаданными.
- ссылку на Яндекс-архив: `analysis.yandex_archive_path`, `analysis.yandex_archived_at`, `analysis.yandex_archive_operation_href`.

Retention:

- победителей, опубликованные ролики и approved assets хранить долго;
- low-confidence/trash assets можно чистить из Supabase Storage только после проверки, что копия есть на Яндекс.Диске;
- orphan-файлы в Storage чистить только через dry-run.
- промежуточные клипы до склейки не считать мусором: они нужны для повторного монтажа и должны архивироваться вместе с финалами.

### 2. История исполнения

Таблицы:

- `generation_history`
- `node_recipes`
- `node_recipe_nodes`
- `node_previews`
- `batch_builds`
- `reel_variants`
- `factory_ugc_jobs`

Что хранит:

- попытки рендера;
- ошибки;
- run plan;
- текущую очередь;
- preview/cache;
- provider job ledger.

Retention:

- последние 30-90 дней оставить подробно;
- старые terminal rows сжимать в агрегаты по дню/нише/статусу/причине;
- preview/variant мусор удалять быстрее, если нет ссылки на финальный asset;
- active/running/queued rows не трогать.

### 3. Reels Brain

Таблицы:

- `viral_videos`
- `viral_hooks`
- `niche_playbooks`
- `cf_signals`
- `orbit_searches`
- `niche_monitors`
- `niche_visual_profiles`

Что хранит:

- референсы рынка;
- чистые паттерны;
- хуки;
- rejected/approved/warning feedback;
- нишевые summaries.

Retention:

- `viral_hooks`, `niche_playbooks`, `niche_visual_profiles` хранить долго;
- `cf_signals` старше 90 дней агрегировать;
- `orbit_searches` удалять после дистилляции;
- `viral_videos` чистить только после проверки, что они уже вошли в hooks/playbooks или не являются нужными reference rows.

### 4. Публикация и метрики

Таблицы:

- `factory_publications`
- `post_metrics`

Что хранит:

- куда ролик опубликован;
- внешний id поста;
- просмотры, удержание, hook/hold/completion rates;
- связь результата с рецептом/asset.

Retention:

- хранить долго;
- это источник market truth, его нельзя удалять как технический лог.

### 5. Конфигурация

Таблицы:

- `brand_kits`
- `factory_personas`
- `service_balances`
- `service_thresholds`
- `product_costs`

Retention:

- не чистить автоматически;
- менять только через явные действия оператора/владельца.

## Главные риски раздувания

1. `generation_history` растёт на каждую попытку, включая fail/cache/dedupe.
2. `cf_signals` растёт на каждый approved/rejected/warning.
3. `node_recipes.run_plan` может хранить большие JSON-снапшоты.
4. Storage `factory-media/gen/*` может содержать MP4, которые уже не видны в UI.
5. Один и тот же URL может жить сразу в `content_assets`, `generation_history`, `node_recipes`, `factory_publications`.

## Что нельзя удалять без отдельного backup/dry-run

- winner/approved assets;
- опубликованные assets;
- `factory_publications`;
- `post_metrics`;
- `brand_kits`;
- `factory_personas`;
- active/running/queued recipes;
- любые Storage files, на которые есть ссылка из DB.

## План безопасной чистки

### Шаг 1. Inventory

Вызвать `/api/factory/data-footprint` и сохранить JSON-ответ в `docs/`.

### Шаг 2. Reference graph

Построить список всех URL из:

- `content_assets.url`;
- `content_assets.analysis.source_url`;
- `generation_history.video_url`;
- `node_recipes.output_url` и `run_plan`;
- `factory_publications.source_url`;
- `factory_publications.published_url`;
- `factory_ugc_jobs.output_url`.

### Шаг 3. Storage dry-run

Просканировать `factory-media/gen`, `factory-media/clips`, `factory-media/prepared`.

Кандидат на удаление:

- файл старше N дней;
- файл уже скопирован на Яндекс.Диск;
- нет ссылки ни в одной таблице;
- не winner;
- не publication;
- не active recipe output.

### Шаг 4. DB compaction dry-run

Кандидаты:

- `generation_history` старше 90 дней, если не winner/published;
- terminal `node_recipes/node_recipe_nodes` старше 90 дней;
- failed `node_previews` старше 14 дней;
- старые `reel_variants`, не связанные с winner;
- `orbit_searches`, уже дистиллированные в `viral_videos/hooks`.

### Шаг 5. Apply only after report

Сначала dry-run report:

```text
would_delete_storage_files
would_delete_db_rows
would_compact_rows
protected_references
estimated_bytes_saved
```

Только после этого можно делать apply.

## Яндекс-архив

Endpoint:

```text
GET /api/factory/yandex-archive
POST /api/factory/yandex-archive { apply: true, limit: N }
Authorization: Bearer $CRON_SECRET или авторизованная Studio-сессия
```

Назначение:

- копировать тяжёлые ассеты из `content_assets` на Яндекс.Диск;
- поддерживать `video`, `clip`, `image`;
- не удалять Supabase;
- писать в `analysis` путь и timestamp архивации;
- пропускать уже архивированные или ранее упавшие строки, если не включён `includeArchived`.

Studio показывает только ссылку в папку Яндекс.Диска. Копирование и чистка остаются операторскими/backend задачами, а не пользовательским UI действием.

## MVP-решение

На ближайший этап не удалять данные автоматически. Сделать:

1. read-only data footprint;
2. dry-run cleanup report;
3. ручное подтверждение владельца;
4. только потом apply-cleanup.

Это сохранит память завода и одновременно покажет, где реально сгорает Supabase quota.

## Яндекс.Диск как холодный архив MP4

Добавлен backend-контур копирования видео на Яндекс.Диск:

```text
GET  /api/factory/yandex-archive?limit=10
GET  /api/factory/yandex-archive?apply=1&confirm=copy-to-yandex&limit=5
POST /api/factory/yandex-archive
Authorization: Bearer $CRON_SECRET
```

`GET` без `apply=1&confirm=copy-to-yandex` всегда dry-run. Он показывает кандидатов из `content_assets disk='gen' kind='video'` и целевой путь на Яндекс.Диске. Operator GET copy mode нужен для запуска из браузера с залогиненной Studio-сессией, когда JS POST недоступен.

`POST` копирует только если тело содержит:

```json
{ "apply": true, "limit": 5 }
```

Нужные env:

```text
YANDEX_DISK_OAUTH_TOKEN=...
YANDEX_DISK_FACTORY_ARCHIVE_PATH=/content-factory/archive
YANDEX_DISK_ARCHIVE_MAX_BYTES=262144000
```

Минимальная проверка подключения:

```bash
node --import tsx lib/factory/yandexArchiveWorker.mjs --apply false --limit 3 --env-file /path/to/.env.local
```

Worker сам пробует загрузить `.env.local`, `.env.production.local`, `.env.vercel.local`, `.env.vercel.production.local` и основные env-файлы проекта. Для записи отчёта и обновления `content_assets.analysis` нужны одновременно:

- `NEXT_PUBLIC_SUPABASE_URL` или `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `YANDEX_DISK_OAUTH_TOKEN`.

В UI кнопка `Яндекс.Диск` ведёт в папку `https://disk.yandex.ru/client/disk/content-factory/archive`, соответствующую дефолтному `YANDEX_DISK_FACTORY_ARCHIVE_PATH`.

Поведение:

- если токена нет, endpoint возвращает `status: "missing_token"` и ничего не делает;
- ролики копируются, а не переносятся;
- копирование запускается через URL-import Яндекс.Диска: backend не скачивает MP4 в память, а передаёт Яндексу публичный Supabase URL;
- Supabase rows и Storage files не удаляются;
- битые/недоступные MP4 помечаются `yandex_archive_failed_at` и дальше пропускаются, чтобы один плохой URL не блокировал весь архив;
- результат пишется в `content_assets.analysis`:
  - `yandex_archive_url`;
  - `yandex_archive_path`;
  - `yandex_archived_at`;
  - `yandex_archive_operation_href`;
  - `yandex_archive_source`.

Важно: Яндекс.Диск API загружает файл в приватный диск. Для публичного просмотра нужно отдельно расшарить папку архива или добавить отдельный шаг публикации ссылок. До этого `yandex_archive_url` хранится как внутренний указатель вида `yandex-disk:/content-factory/archive/...`.

## Storage cleanup dry-run

Добавлен read-only endpoint:

```text
GET /api/factory/storage-cleanup/dry-run?limit=500&storage_limit=1000
Authorization: Bearer $CRON_SECRET
```

Он строит reference graph по последним строкам:

- `content_assets.url`;
- `content_assets.analysis`;
- `generation_history.input_url/output_url/video_url`;
- `node_recipes.output_url/run_plan/graph_doc`;
- `factory_publications.source_url/published_url`;
- `factory_ugc_jobs.output_url`.

Затем сканирует sample Storage prefixes:

- `factory-media/gen`;
- `factory-media/clips`;
- `factory-media/prepared`;
- `factory-media/covers`;
- `factory-media/voiceover`.

Классы файлов:

- `protected` - есть winner/posted/approved/active reference;
- `referenced_review` - ссылка есть, но не protected;
- `orphan_candidate` - файл найден в Storage, но reference graph его не видит.

Отдельный блок `yandex_archived_release` показывает не сироты, а файлы, которые всё ещё лежат в Supabase Storage, но у строки `content_assets` уже есть `analysis.yandex_archive_path` и `analysis.yandex_archived_at`. Именно этот блок должен быть источником для будущего apply-cleanup, если цель - освободить Supabase после подтверждённой выгрузки в Яндекс.Диск.

Endpoint не имеет `POST`, не удаляет DB rows и не удаляет Storage files. Его цель - дать список кандидатов.

## Supabase Storage release после Яндекс-архива

После успешной выгрузки в Яндекс.Диск можно освобождать Supabase Storage, не удаляя строки БД:

```text
GET /api/factory/storage-cleanup/release?apply=1&confirm=release-yandex-archived&limit=25
POST /api/factory/storage-cleanup/release { "apply": true, "confirm": "release-yandex-archived", "limit": 25 }
```

Правила безопасности:

- endpoint берёт только `yandex_archived_release.candidates` из dry-run;
- у кандидата должны быть `analysis.yandex_archive_path` и `analysis.yandex_archived_at`;
- кандидат должен существовать в Supabase Storage listing;
- строки с `analysis.supabase_storage_released_at` повторно не берутся;
- удаляется только объект из bucket `factory-media`;
- строки `content_assets`, `generation_history`, `node_recipes` не удаляются;
- в `content_assets.analysis` ставится `supabase_storage_released_at`.

## Long-running Yandex archive worker

Для массовой выгрузки можно использовать долгоживущий worker/CLI. Он тоже ставит URL-import задачи в Яндекс.Диске, поэтому не тащит MP4 через память процесса:

```bash
node --import tsx lib/factory/yandexArchiveWorker.mjs --apply true --limit 5 --batches 50
```

Нужные env в окружении worker:

```text
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
YANDEX_DISK_OAUTH_TOKEN=...
YANDEX_DISK_FACTORY_ARCHIVE_PATH=/content-factory/archive
```

Worker:

- копирует финальные MP4, промежуточные клипы и сгенерированные изображения в Яндекс.Диск;
- пишет `yandex_archive_url/path/at/source` в `content_assets.analysis`;
- пишет отчёты:
  - `docs/factory-yandex-archive-report.json`;
  - `docs/factory-yandex-archive-report.md`;
- не удаляет строки и файлы из Supabase.

Порядок освобождения места:

1. Запустить worker до `remaining_candidates: 0` или до понятных failed items.
2. Проверить `factory-yandex-archive-report.md`.
3. Запустить `/api/factory/storage-cleanup/dry-run`.
4. Для освобождения Supabase рассматривать только `yandex_archived_release.candidates`.
5. `orphan_candidate` удалять только отдельным ручным решением, потому что это другой класс риска.
