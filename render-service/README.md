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

Каждый рендер пишет в лог `[timing] select=… render=… upload=… total=…` — видно, что душит.

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

⚠️ Горизонталь (несколько контейнеров за балансировщиком) сейчас НЕ заработает как есть: очередь джоб лежит
**в памяти процесса** (`jobs` Map в `server.mjs`), а контракт `submit → poll` опрашивает `/status/:id`. При round-robin
балансировке поллинг попадёт на чужой инстанс, который про джобу не знает. Перед автоскейлом нужно вынести
состояние джоб в общий стор (Redis / таблица Supabase) ИЛИ роутить sticky по job id. До этого — путь масштаба:
**одна бо́льшая VM с поднятыми кнобами**.

Файлы: `server.mjs` — сервис; `Dockerfile` + `docker-compose.yml` — контейнер; `remotion-render.service` — systemd-юнит; `bootstrap.sh` — установка на голую Ubuntu-VM.
