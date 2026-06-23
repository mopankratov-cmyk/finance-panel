# Свой форж на Railway — Gitea вместо GitHub (контур без github.com)

Цель: сотрудники дорабатывают **вкладку Финансы** через свой Claude Code → PR в нашем Gitea →
тот же AI-гейт (финанс-зона + ассистент) → авто-мёрж/эскалация → деплой прода через Vercel CLI.
Ни github.com, ни статус GitHub-аккаунта больше не в контуре.

Что уже лежит в репо (Фаза 0, готово):
- `.gitea/workflows/ai-gate.yml` — гейт на Gitea API (порт GitHub-версии, без `uses:`/github.com).
- `.gitea/workflows/deploy.yml` — push в `main` → `vercel --prod`.
- `scripts/pr-gate.mjs` — логика гейта с **финанс-зоной** (общая для GitHub и Gitea, не меняется).
- `deploy/gitea/` — `docker-compose.yml`, `runner.Dockerfile`, `runner-entrypoint.sh`, этот runbook.

---

## Фаза 1 — поднять на Railway (делает владелец)

### 1. Сервис Postgres
Railway → New → Database → **PostgreSQL**. Запомни внутренние креды (Railway даёт их как переменные).

### 2. Сервис Gitea
New → **Docker Image** → `gitea/gitea:1.22`. Переменные окружения:
```
GITEA__database__DB_TYPE = postgres
GITEA__database__HOST    = <host:port из Postgres-сервиса>
GITEA__database__NAME    = railway        # имя БД из Postgres-сервиса
GITEA__database__USER    = postgres       # из Postgres-сервиса
GITEA__database__PASSWD  = <пароль из Postgres-сервиса>
GITEA__server__ROOT_URL  = https://<домен-который-выдаст-railway>/
GITEA__server__DISABLE_SSH = true
GITEA__service__DISABLE_REGISTRATION = true
GITEA__actions__ENABLED  = true
GITEA__actions__DEFAULT_ACTIONS_URL = https://gitea.com
```
- Привяжи **Volume** к `/data` (иначе репозитории и конфиг потеряются при рестарте).
- Networking → Generate Domain (порт 3000). Впиши этот домен в `ROOT_URL` и передеплой.
- Открой домен → пройди первичную установку (админ-аккаунт = ты). После — зайди и
  убедись, что регистрация выключена.

### 3. Сервис раннера (Gitea Actions)
Сначала в Gitea: **Site Admin → Actions → Runners → Create registration token** — скопируй токен.

New сервис из этого репозитория-папки **`deploy/gitea`** (Dockerfile = `runner.Dockerfile`),
либо собери образ и запушь — как удобнее. Переменные:
```
GITEA_INSTANCE_URL = https://<домен-gitea>/
GITEA_RUNNER_REGISTRATION_TOKEN = <токен из шага выше>
GITEA_RUNNER_LABELS = gate:host
```
- Привяжи **Volume** к `/data` (хранит регистрацию раннера).
- После старта в Gitea (Admin → Actions → Runners) появится раннер с меткой `gate`, статус online.

> Почему host-режим (`gate:host`): на Railway нет Docker-in-Docker, поэтому шаги выполняются
> прямо в контейнере раннера — у него на борту node/git/curl/jq (см. `runner.Dockerfile`).

### 4. Перенести репозиторий (со всеми ветками и историей)
В Gitea создай пустой репозиторий `finance-panel` (без init). Затем локально:
```bash
cd /Users/maksimpankratov/finance-panel
git remote add gitea https://<домен-gitea>/<owner>/finance-panel.git
git push gitea --all     # все ветки (логин/пароль или token админа Gitea)
git push gitea --tags
```
В Gitea: Settings → сделать **default branch = main**. Включи Actions для репо (Settings → Actions → Enabled).

> Это работает БЕЗ GitHub: пушим из локального клона (у нас есть полная история, вкл. `origin/main`).

### 5. Секреты репозитория (Settings → Actions → Secrets)
| Секрет | Откуда |
|---|---|
| `TELEGRAM_BOT_TOKEN` | как в GitHub-гейте (тот же бот) |
| `TELEGRAM_ALERT_CHAT_ID` | как в GitHub-гейте |
| `REVIEW_TOKEN` | == токен ревьюера в director-cockpit (`/api/review`) |
| `DIRECTOR_COCKPIT_URL` | напр. `https://director-cockpit.vercel.app` (опц., есть дефолт) |
| `VERCEL_TOKEN` | vercel.com → Account → Tokens |
| `VERCEL_ORG_ID` | `vercel link` в репо → `.vercel/project.json` |
| `VERCEL_PROJECT_ID` | там же |

`GITHUB_TOKEN` создавать НЕ нужно — Gitea выдаёт его раннеру автоматически (scope репо).

Линк Vercel (один раз, локально, чтобы получить ORG/PROJECT id):
```bash
npm i -g vercel
vercel link          # выбрать существующий проект finance-panel
cat .vercel/project.json   # → orgId, projectId
```

### 6. Защита main (branch protection)
Settings → Branches → Protect `main`:
- ✅ Enable status check, обязательный чек: **`ai-gate`** (появится после первого прогона).
- ✅ Block on official review requests / запретить прямой push (мёрж только через PR).
- В **Whitelist / bypass** добавь СЕБЯ (владельца) — чтобы вливать эскалированное вручную.
- (Опц., второй бортик к гейту) **Protected file patterns** — пути вне зоны Финансы, чтобы Gitea
  сам блокировал их правку не-владельцем. Зона гейта (для справки) задана в `scripts/pr-gate.mjs`
  → `FINANCE_SCOPE`.

### 7. Включить авто-мёрж в репо
Settings → убедись, что разрешён squash-merge и авто-мёрж (Gitea: «Enable merge style: squash»,
auto-merge включается API-вызовом из гейта — `merge_when_checks_succeed`).

---

## Фаза 2 — валидация (вместе) и приёмка

Тест-матрица (создавай PR от тестового НЕ-владельца):
1. **Док-PR** (`*.md`) → ожидаем: `ai-gate` зелёный → авто-мёрж + «✅ влил» в Telegram.
2. **Финанс-PR** (правка `components/opiu/OpiuPage.tsx`) → ассистент low → авто-мёрж.
3. **Платежи** (правка `components/payments/PaymentForm.tsx`) → авто-мёрж (планирование ДДС, входит в зону).
4. **Биллинг/авторизация** (файл со `stripe/checkout/payout` или `token/secret`) → escalate (deny-флаг).
5. **Вне зоны** (правка `app/api/wb/route.ts` или завода) → escalate.
6. **Деплой**: после мёржа в `main` сработал `deploy` → `vercel --prod` → прод обновился.

Чек-лист «живой проверки» (то, что зависит от версии Gitea — проверить на стенде):
- [ ] `pull_request_target` поддержан и берёт workflow/скрипт из БАЗЫ (не из PR).
- [ ] Эндпоинт `GET /api/v1/repos/{o}/{r}/pulls/{n}/files` отдаёт `status`+`filename` (есть в свежих Gitea).
- [ ] `POST /pulls/{n}/merge` принимает `merge_when_checks_succeed` (иначе: сделать чек обязательным
      и мёржить без флага, либо обновить Gitea).
- [ ] Раннер `gate:host` видит `node -v` ≥18, `jq`, `curl`, `git`.
- [ ] `secrets.GITHUB_TOKEN` имеет права на merge/comment (обычно да; иначе завести PAT-секрет).

---

## Что меняется для сотрудников
Онбординг переключается с GitHub на Gitea: ссылка на репозиторий, аккаунт в нашем Gitea
(заводит владелец — саморегистрация выключена), remote = наш домен. AI-гейт, финанс-зона и
правила ревью — те же. См. правку `docs/ONBOARDING.md` (делается после того, как домен Gitea известен).

## Откат / сосуществование
GitHub-контур (`.github/workflows/ai-gate.yml`) остаётся в репо и не мешает: на Gitea он просто
не исполняется. Когда/если GitHub-аккаунт вернут — оба контура могут жить параллельно, но
источником правды делаем Gitea.
