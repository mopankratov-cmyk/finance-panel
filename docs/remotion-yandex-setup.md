# Premium-рендер на Remotion (Yandex Cloud VM) — V23

Премиум-цепочка завода (`openreels`: ElevenLabs → Creatify lipsync → Seedance → **ReelV5** → ОТК) рендерится кодом на Remotion.
Shotstack так не умеет (нет кинетик-капшенов/обводки/грейда/бренд-эндкарда), поэтому финал собирает Remotion.

`@remotion/lambda` (AWS) **не нужен** — ядро `renderMedia()` крутится на любой Linux-машине с Chrome.
Берём **Yandex Cloud** (платится российской картой, нет санкционной трении, рендер в РФ-регионе).

Доказано локально: `node scripts/render-local.mjs ReelV5` рендерит 1080×1920@30, 614 кадров за ~37с;
render-сервис гоняет тот же код по HTTP и заливает результат в Supabase.

---

## Архитектура

```
Vercel-завод (graphRun)                 Yandex VM (render-service/server.mjs)
  assemble → reel_props  ── POST /render ──►  renderMedia(ReelV5, props)  ──► Supabase Storage
  render-poll            ── GET /status ───►  { done, videoUrl }              (factory-media/renders/)
  otk → bank ◄───────────────────────────── videoUrl
```

Контракт submit→poll — зеркало Shotstack, поэтому self-chaining очередь завода не переписывалась.
Движок выбирается переменной `FACTORY_RENDER_ENGINE` (по умолчанию `shotstack` — ничего не меняется).

---

## Что делает пользователь (ручное — аккаунт/деньги)

### 1. Аккаунт + VM
1. Завести **Yandex Cloud** (`console.yandex.cloud`), привязать карту, создать платёжный аккаунт.
2. **Compute Cloud → создать ВМ:**
   - ОС: **Ubuntu 22.04 LTS**
   - vCPU **2**, RAM **4 ГБ** (Chrome под рендер ест ~2 ГБ; 4 — с запасом), гарантия 100%
   - Диск: SSD **20 ГБ**
   - Сеть: **публичный IPv4** (можно статический — пригодится для DNS/HTTPS)
   - SSH-ключ свой (логин напр. `ubuntu`)
   - *Экономия:* можно **прерываемую** ВМ + гасить когда не гонишь батч; для всегда-доступного сервиса — обычную.
3. **Security Group / firewall:** разрешить входящий TCP на порт сервиса (`8080`) ИЛИ `443` (если ставишь HTTPS через Caddy — рекомендуется). SSH `22` — только со своего IP.

### 2. На Vercel (env завода)
- `REMOTION_RENDER_URL` = `https://<домен-или-ip>` (или `http://<ip>:8080` для MVP)
- `REMOTION_RENDER_TOKEN` = длинный случайный секрет (тот же, что на VM)
- `FACTORY_RENDER_ENGINE` = `remotion`  ← **это и переключает завод на премиум-рендер**

После — redeploy завода (env подхватятся).

---

## Что автоматизировано (выполнить на VM по SSH)

### 3. Зависимости
```bash
sudo apt update
# Node 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
# системные либы для Chrome Headless Shell (Remotion)
sudo apt install -y libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 \
  libxrandr2 libxkbcommon-dev libxfixes3 libxcomposite1 libxdamage1 \
  libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 fonts-liberation
node -v   # ждём v22+
```

### 4. Код + бандл
```bash
cd /opt && sudo git clone <repo-url> finance-panel && sudo chown -R $USER finance-panel
cd /opt/finance-panel
npm ci                       # ставит remotion + bundler + renderer + supabase
# первый прогон скачает Chrome Headless Shell (~93 МБ, кешируется)
node scripts/render-local.mjs ReelV5 out/smoke.mp4   # смоук: должен выдать mp4 ~20 МБ
```
> Альтернатива «без всего репо»: скопировать на VM только `remotion/`, `public/fonts/`, `render-service/`, `scripts/`
> + `package.json` и поставить узкий набор зависимостей. Клон репо проще и гарантирует совпадение версий.

### 5. Переменные окружения (`/opt/finance-panel/.env.local`)
```ini
NEXT_PUBLIC_SUPABASE_URL=...        # тот же Supabase, что у завода
SUPABASE_SERVICE_ROLE_KEY=...       # service-role (заливка в Storage)
REMOTION_RENDER_TOKEN=<тот же секрет, что в Vercel>
PORT=8080
RENDER_CONCURRENCY=1                # маленькая VM → 1; 4+ ГБ и 4 vCPU → 2
```

### 6. systemd-сервис (автозапуск + рестарт)
`/etc/systemd/system/remotion-render.service`:
```ini
[Unit]
Description=Remotion render service (factory premium)
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/finance-panel
ExecStart=/usr/bin/node --env-file=.env.local render-service/server.mjs
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now remotion-render
curl -s localhost:8080/health     # {"ok":true,"bundled":true,...}
journalctl -u remotion-render -f  # логи
```

### 7. HTTPS (рекомендуется — Vercel должен ходить по TLS)
Caddy даёт авто-Let's Encrypt в 3 строки. Нужен домен (A-запись на IP VM):
```bash
sudo apt install -y caddy
# /etc/caddy/Caddyfile:
#   render.твойдомен.ру {
#       reverse_proxy localhost:8080
#   }
sudo systemctl restart caddy
```
Тогда `REMOTION_RENDER_URL=https://render.твойдомен.ру`.
MVP без домена: `http://<ip>:8080` + обязательно `REMOTION_RENDER_TOKEN` (иначе ручка открыта).

---

## Эксплуатация

- **Проверить:** `curl localhost:8080/health` → `bundled:true`.
- **Тест рендера:**
  ```bash
  curl -s -X POST localhost:8080/render -H 'Authorization: Bearer <TOKEN>' \
    -H 'Content-Type: application/json' -d '{"composition":"ReelV5"}'
  curl -s localhost:8080/status/<id> -H 'Authorization: Bearer <TOKEN>'
  ```
- **Обновил композицию (ReelV5.tsx и т.п.):** `git pull` → пере-бандл одним из:
  - `curl -X POST localhost:8080/reload -H 'Authorization: Bearer <TOKEN>'` (без рестарта), или
  - `sudo systemctl restart remotion-render`.
- **Цена:** маленькая всегда-включённая ВМ ≈ 500–1500 ₽/мес; прерываемая + гашение под батчи — дешевле.
  Сам рендер — копейки CPU; никакой per-minute SaaS-абонплаты, как у Shotstack.

---

## Откат на Shotstack (fallback)

Если VM недоступна — снять `FACTORY_RENDER_ENGINE` (или поставить `shotstack`) в Vercel и redeploy.
Завод вернётся к Shotstack-сборке (`lib/factory/shotstack.ts`) — НИЖЕ потолком (без премиум-слоя ReelV5),
но без AWS/VM. Это аварийный путь, не основной.

---

## Карта файлов (V23)

| Файл | Роль |
|---|---|
| `render-service/server.mjs` | HTTP render-сервис на VM (bundle+renderMedia, submit→poll, заливка в Supabase) |
| `scripts/render-local.mjs` | локальный рендер/смоук композиции |
| `remotion/ReelV5.tsx` | премиум-композиция, **параметризована пропсами** (дефолты = v9 водяной УЗИ) |
| `remotion/Root.tsx` | `defaultProps` + `calculateMetadata` (длительность из пропсов) |
| `lib/factory/remotionRender.ts` | клиент завода к сервису (submit/status), зеркало `shotstack.ts` |
| `lib/factory/graphRun.ts` | engine-свитч: `assemble`→`buildReelProps`, `render-submit/poll` ветвятся по движку |

> ⚠️ `buildReelProps` в graphRun — **v0-мэппинг** (клипы→overlays, hook/caption→капшены, sound→музыка, hook/арт→CTA).
> Память: рецепт в завод не зашивать, пока не идеален. Точные пропсы можно отдать явно через `node.params.reel_props`
> (приоритетнее эвристики) — это и есть путь дошлифовки рецепта.
