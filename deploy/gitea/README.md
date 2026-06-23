# Свой форж на Yandex Cloud — Gitea вместо GitHub (контур без github.com)

Цель: сотрудники дорабатывают **вкладку Финансы** через свой Claude Code → PR в нашем Gitea →
тот же AI-гейт (финанс-зона + ассистент) → авто-мёрж/эскалация → деплой прода через Vercel CLI.
Ни github.com, ни статус GitHub-аккаунта больше не в контуре. Хостинг — Compute VM в Yandex Cloud
(🇷🇺 юрисдикция, рубли, доступ из РФ без VPN).

Что уже лежит в репо (Фаза 0, готово):
- `.gitea/workflows/ai-gate.yml` — гейт на Gitea API (порт GitHub-версии, без `uses:`/github.com).
- `.gitea/workflows/deploy.yml` — push в `main` → `vercel --prod`.
- `scripts/pr-gate.mjs` — логика гейта с **финанс-зоной** (общая для GitHub и Gitea, не меняется).
- `deploy/gitea/` — `docker-compose.yml` (Caddy+Gitea+Postgres+runner), `Caddyfile`, `setup-vm.sh`,
  `runner.Dockerfile`, `runner-entrypoint.sh`, `env.sample`, этот runbook.

---

## Фаза 1 — поднять на Yandex Cloud VM (делает владелец)

### 1. Создать VM (Compute Cloud)
Yandex Cloud Console → Compute Cloud → **Создать ВМ**:
- ОС: **Ubuntu 22.04**.
- Тип: 2 vCPU (можно 20–50% «прерываемая»/burstable для экономии) / **2–4 ГБ RAM** / 20+ ГБ SSD.
  Gitea лёгкий; раннер собирает next/vercel — потому 4 ГБ комфортнее.
- Сеть: **публичный IP** (нужен для домена и Let's Encrypt).
- Доступ: добавь свой **SSH-ключ** (логин, напр., `yc-user`).
- Создай → запиши **публичный IP**.

### 2. Открыть порты (Security Group)
В сетевом интерфейсе ВМ → Security Group → входящие правила: разреши **TCP 22, 80, 443**
(80 нужен Caddy для ACME-проверки, 443 — сам HTTPS).

### 3. Домен
- Свой домен → создай **A-запись** `gitea.твойдомен` → публичный IP ВМ.
- Нет домена → используем **sslip.io**: `GITEA_DOMAIN=gitea.<IP-через-дефис>.sslip.io`
  (напр. IP `51.250.1.2` → `gitea.51-250-1-2.sslip.io`). Резолвится на IP, Caddy выдаст настоящий cert.

### 4. Залить стек и поднять
Репо ещё не на форже — копируем папку стека с локальной машины:
```bash
scp -r deploy/gitea  yc-user@<IP-ВМ>:~/gitea-stack
ssh yc-user@<IP-ВМ>
cd ~/gitea-stack
cp env.sample .env && nano .env     # GITEA_DOMAIN, ACME_EMAIL, GITEA_DB_PASSWORD
bash setup-vm.sh                    # ставит Docker и поднимает caddy+gitea+db
```
Открой `https://<GITEA_DOMAIN>` → пройди установку (админ = ты) → проверь, что регистрация выключена.

### 5. Раннер (Gitea Actions)
В Gitea: **Site Admin → Actions → Runners → Create registration token** — скопируй токен,
впиши `RUNNER_TOKEN=...` в `~/gitea-stack/.env` на ВМ, затем:
```bash
cd ~/gitea-stack && docker compose up -d runner
```
В Gitea (Admin → Actions → Runners) появится раннер с меткой `gate`, статус online.

> Host-режим (`gate:host`): шаги workflow идут прямо в контейнере раннера (без Docker-in-Docker),
> у него на борту node/git/curl/jq (см. `runner.Dockerfile`).
>
> Бэкап: делай снапшот диска ВМ (или дамп тома `gitea-data`) — это весь форж.

### 6. Перенести репозиторий (со всеми ветками и историей)
В Gitea создай пустой репозиторий `finance-panel` (без init). Затем локально:
```bash
cd /Users/maksimpankratov/finance-panel
git remote add gitea https://<домен-gitea>/<owner>/finance-panel.git
git push gitea --all     # все ветки (логин/пароль или token админа Gitea)
git push gitea --tags
```
В Gitea: Settings → сделать **default branch = main**. Включи Actions для репо (Settings → Actions → Enabled).

> Это работает БЕЗ GitHub: пушим из локального клона (у нас есть полная история, вкл. `origin/main`).

### 7. Секреты репозитория (Settings → Actions → Secrets)
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

### 8. Защита main (branch protection)
Settings → Branches → Protect `main`:
- ✅ Enable status check, обязательный чек: **`ai-gate`** (появится после первого прогона).
- ✅ Block on official review requests / запретить прямой push (мёрж только через PR).
- В **Whitelist / bypass** добавь СЕБЯ (владельца) — чтобы вливать эскалированное вручную.
- (Опц., второй бортик к гейту) **Protected file patterns** — пути вне зоны Финансы, чтобы Gitea
  сам блокировал их правку не-владельцем. Зона гейта (для справки) задана в `scripts/pr-gate.mjs`
  → `FINANCE_SCOPE`.

### 9. Включить авто-мёрж в репо
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
