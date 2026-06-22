# render-service

Remotion render-микросервис премиум-цепочки завода. Крутится на Yandex Cloud VM (или любой Linux+Chrome),
рендерит композиции из `../remotion/` через `renderMedia()` и заливает mp4 в Supabase Storage.

**Полная инструкция по развёртыванию:** [`../docs/remotion-yandex-setup.md`](../docs/remotion-yandex-setup.md)

## API

| Метод | Путь | Тело / ответ |
|---|---|---|
| `POST` | `/render` | `{ composition, inputProps?, durationInFrames? }` → `{ id }` |
| `GET`  | `/status/:id` | → `{ status: in_progress\|done\|error, progress?, videoUrl?, error? }` |
| `POST` | `/reload` | пере-бандл после `git pull` (без рестарта) |
| `GET`  | `/health` | `{ ok, bundled, busy, queued }` |

Авторизация: `Authorization: Bearer $REMOTION_RENDER_TOKEN` на `/render`, `/status`, `/reload`.

## ENV
Секреты: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REMOTION_RENDER_TOKEN`, `PORT` (8080), `RENDER_CONCURRENCY` (1 — сколько джоб параллельно).

**Тюнинг скорости одного рендера** (подбирать по логу `[timing]`):
| ENV | дефолт | что делает |
|---|---|---|
| `RENDER_FRAME_CONCURRENCY` | `min(6, ядра)` | сколько кадров рендерить параллельно |
| `RENDER_OFFTHREAD_THREADS` | `min(6, ядра)` | потоков извлечения видео-кадров (Remotion-дефолт 2 — это и был затык на 6 OffthreadVideo-слоях ReelV5). Держать ≳ frame-concurrency |
| `RENDER_OFFTHREAD_CACHE_MB` | `0` (дефолт Remotion) | кэш декодированных кадров |
| `RENDER_SCALE` | `1` | масштаб (0.66 ≈ 720p — кратно быстрее, ниже качество) |
| `RENDER_X264_PRESET` | `faster` | `veryfast`/`ultrafast` — быстрее/хуже |
| `RENDER_TIMEOUT_MS` | `120000` | таймаут кадра |
| `RENDER_REUSE_BROWSER` | `1` | один Chrome на `selectComposition`+`renderMedia` (вместо двух запусков); `0` — выключить. Эффект виден по падению `select=` в `[timing]` |

Каждый рендер пишет в лог `[timing] select=… render=… upload=… total=…` — видно, что душит.

## Производительность: рендер I/O-bound (не CPU!)
Замер на боевой ВМ (8 vCPU / 16 ГБ, 2026-06-22): **полный ReelV5 = 1306с ≈ 21.8 мин** против ~31с на dev-Mac (~42×).
`top` во время рендера: `%Cpu 0.8 us … 60 id … 38 wa` — **CPU простаивает, 38% = ожидание диска**. Облачный SSD
20 ГБ (у Yandex IOPS растёт с размером диска → маленький диск = мало IOPS) не успевает кормить извлечение кадров
OffthreadVideo + запись temp. Поэтому кнобы потоков/concurrency тут **бесполезны** — упор в диск, а не в ядра.

**Направление фикса верное (temp/чтения в RAM ускоряли ~5×), но наивный `TMPDIR=/dev/shm` ОПАСЕН:**
на 1080×1920 он уронил рендер на ~10% (процесс убит — tmpfs ест ту же RAM, что Chrome+node → OOM на 16 ГБ).
Поэтому в дефолт деплоя НЕ зашиваем. Безопасные пути (по убыванию надёжности):

1. **Диск с бо́льшим IOPS** — ресайз 20 ГБ → 100 ГБ+ SSD (или тип «нереплицируемый SSD»). Лечит корень, без риска RAM,
   без правок кода. Рекомендуемый путь.
2. **tmpfs аккуратно** (opt-in, нужен тест): ОТДЕЛЬНЫЙ ограниченный tmpfs под Remotion-temp (не общий `/dev/shm`!),
   Chrome-флаг `--disable-dev-shm-usage`, и `RENDER_SCALE=0.5–0.66` чтобы ограничить размер кадров/temp и запас RAM.
3. **`RENDER_SCALE=0.5`** сам по себе — вчетверо меньше пикселей → меньше I/O и быстрее, ценой качества.

Только ПОСЛЕ устранения iowait имеет смысл крутить `RENDER_FRAME_CONCURRENCY` — иначе больше параллельных кадров
= больше конкуренции за диск = хуже.

## Локально
```bash
node --env-file=.env.local render-service/server.mjs   # из корня репо
```

## Docker
```bash
# сборка ИЗ КОРНЯ репо (контекст нужен из-за remotion/ и public/)
docker build -f render-service/Dockerfile -t factory-render .
docker run --rm -p 8080:8080 --shm-size=1g --env-file .env.local factory-render
# или одной командой:
docker compose -f render-service/docker-compose.yml up -d --build
```
`--shm-size` обязателен: Chrome пишет кадры в `/dev/shm`, дефолтные 64MB роняют рендер на 1080×1920.
Chrome Headless Shell вшит в образ на этапе сборки → холодный старт без докачки.

## Масштаб «в массы»
Финальная пропускная способность = **скорость одного рендера** (кнобы выше + бо́льшая VM) **×** **число воркеров**.

**Горизонталь готова.** Статус джоб вынесен в общий стор (таблица `render_jobs`, см. `jobStore.mjs`): любой
инстанс отвечает на любой `/status/:id`, поэтому можно лить ФЛОТ контейнеров за обычным round-robin
балансировщиком — sticky-сессии не нужны. Рендер по-прежнему идёт на той инстанс, что приняла `/render`;
в таблицу пишется только статус/прогресс/результат. `/health` показывает `store: supabase+memory|memory`.

Включение: примени миграцию `supabase/migrations/20260622_render_jobs.sql`. **Без неё ничего не ломается** —
сервис тихо работает только in-memory (как одиночная VM), стор сам выключается после первой неудачной записи.

Известное ограничение v1: если инстанс умрёт посреди рендера, строка зависнет в `in_progress` — поллинг
завода добьёт по своему таймауту (`MAX_POLLS`). Heartbeat/lease — следующий шаг, если понадобится work-stealing.

Файлы: `server.mjs` — сервис; `jobStore.mjs` (+`.test.mjs`) — кросс-инстанс стор; `Dockerfile` + `docker-compose.yml` — контейнер; `remotion-render.service` — systemd-юнит; `bootstrap.sh` — установка на голую Ubuntu-VM.
