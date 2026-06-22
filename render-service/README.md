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
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REMOTION_RENDER_TOKEN`, `PORT` (8080), `RENDER_CONCURRENCY` (1).

## Локально
```bash
node --env-file=.env.local render-service/server.mjs   # из корня репо
```

Файлы: `server.mjs` — сервис; `remotion-render.service` — systemd-юнит (скопировать в `/etc/systemd/system/`).
