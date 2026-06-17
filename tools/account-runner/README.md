# Account Runner (пилот)

Локальный раннер сетки аккаунтов под контент-завод: **ProxyShard → ShardBrowser → Playwright**.
Открывает изолированный профиль браузера (свой отпечаток + sticky-прокси на аккаунт) и заходит в него
через CDP — фундамент антибана «1 аккаунт = 1 окружение».

Запускается **локально** на твоей машине (ShardBrowser отдаёт API только на `127.0.0.1`),
не на Vercel.

## Зачем именно так
- **ShardBrowser** — бесплатный опенсорс антидетект-браузер (изоляция отпечатка на уровне Chromium).
- **ProxyShard** — прокси (sticky residential по `sid` → постоянный IP на аккаунт).
- **Playwright** — рулит запущенным профилем по CDP (потом — автопостинг ролика из банка).

## Установка
```bash
cd tools/account-runner
cp .env.example .env          # вписать SHARDX_TOKEN и PROXYSHARD_TOKEN
pip install -r requirements.txt
python -m playwright install chromium
# (опц.) положить рядом официальный proxyshard.py из ProxyShard/proxyshard-api-examples-ru
```

Токены:
- `SHARDX_TOKEN` — ShardBrowser → Settings → Automation API (постоянный токен).
- `PROXYSHARD_TOKEN` — dashboard.proxyshard.com → profile → API key.

## Запуск (smoke-тест на 1 аккаунт)
```bash
python runner.py smoke --account acc1 --country ru
```
Что делает:
1. ProxyShard: собирает sticky-прокси `sid=acc1` (постоянный IP для этого аккаунта).
2. ShardBrowser: создаёт/находит профиль `acc:acc1` с этим прокси + свежим отпечатком, запускает.
3. Playwright: подключается по CDP, открывает `ipinfo.io/json` → печатает egress-IP (доказательство,
   что трафик идёт через прокси) и сохраняет `shot_acc1.png`.

Флаги: `--scheme http|socks5`, `--keep-open` (не закрывать профиль), `--country ru|us|...`.

## Заметки
- Это **прототип валидации связки**, не продакшен-постер. Постинг ролика добавим после пилота
  (выживаемость аккаунтов + заход контента).
- Если egress-IP в выводе совпадает с IP прокси (не твой домашний) — изоляция работает.
- `proxyshard.py` (инлайн-клиент здесь реконструирован по докам). Для 100% совпадения положи рядом
  официальный модуль из `ProxyShard/proxyshard-api-examples-ru` — раннер подхватит его автоматически.
