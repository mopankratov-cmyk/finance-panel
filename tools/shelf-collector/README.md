# Сборщик «Полок» — цены конкурентов из «Смотрите также»

Питает раздел **Полки** в панели (`/wb/shelf`). Основа — рабочие наработки автора идеи
(local-collector): Playwright открывает **реальный Chrome с постоянным профилем**,
снимает с карточки WB нашу цену «с WB Кошельком» и топ-30 блока «Смотрите также»,
и отправляет снимок в панель. Панель хранит историю и считает срезы Топ-3/6/12/30.

## Почему это запускается на Mac, а не на сервере

Проверено эмпирически (автор наработок, 10–11.08.2026):

- блок «Смотрите также» **не отдаётся** обычным HTTP-запросом и в headless-браузере
  появляется заметно реже — нужен видимый Chrome;
- антибот WB жёстко блокирует свежие браузерные профили — нужен постоянный
  профиль (`.chrome-profile/`, копится между запусками);
- блок подгружается нестабильно: помогает повторная навигация, а не долгое
  ожидание (логика перезаходов уже вшита в `src/scrape.js` — не менять без
  перепроверки).

Поэтому сборщик — локальный процесс на всегда включённом Mac (mini подходит),
а не Vercel-крон.

## Установка

```bash
cd tools/shelf-collector
npm install          # поставит и Chromium для Playwright (fallback)
cp env.example .env  # заполнить PANEL_URL и PANEL_CRON_SECRET
```

Проверка одним прогоном (окно Chrome откроется — не сворачивать):

```bash
npm run collect:now
```

В логе по каждому артикулу должно быть «собрано: наша цена=… конкурентов=…»,
затем «записано в панель». Артикулы для сбора берутся из реестра раздела
Полки — добавьте их там заранее.

## Расписание

Слоты сбора: **10:00 / 18:00 / 22:00 МСК** (те же, что у автора наработок; логика
слотов в `src/schedule.js` — пропущенный из-за выключенного Mac слот доберётся
при ближайшем запуске, лишних сборов не бывает). launchd дёргает сборщик каждые
15 минут, почти все запуски — мгновенный no-op.

`~/Library/LaunchAgents/com.financepanel.shelfcollector.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.financepanel.shelfcollector</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/npm</string>
    <string>run</string>
    <string>collect</string>
  </array>
  <key>WorkingDirectory</key><string>/ПУТЬ/ДО/finance-panel/tools/shelf-collector</string>
  <key>StartInterval</key><integer>900</integer>
  <key>StandardOutPath</key><string>/tmp/shelf-collector.log</string>
  <key>StandardErrorPath</key><string>/tmp/shelf-collector.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.financepanel.shelfcollector.plist
```

Путь к npm проверьте через `which npm` (на Apple Silicon обычно
`/opt/homebrew/bin/npm`).

## Контракт с панелью

- `GET  {PANEL_URL}/api/shelf/watchlist` — активные артикулы реестра;
- `POST {PANEL_URL}/api/shelf/ingest` — снимок одного артикула
  (`{article, collectedAt, our, competitors[]}` — формат `src/scrape.js` как есть);
- авторизация обоих — `Authorization: Bearer {PANEL_CRON_SECRET}`;
- повторная отправка того же сбора — идемпотентный no-op (панель дедуплицирует
  по времени сбора).

## Антибот — что уже учтено

Прогрев через главную страницу, случайные паузы между артикулами, длинный
бэкофф (3 мин) при челлендже и остановка всего прогона при повторной блокировке —
всё в `src/collector.js`. Если в логе «АНТИБОТ ЗАБЛОКИРОВАЛ повторно» — не
перезапускать вручную сразу, дать следующему слоту пройти самому.
