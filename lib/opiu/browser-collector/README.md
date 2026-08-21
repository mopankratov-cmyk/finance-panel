# Marketplace payout collector for Mac mini

Отдельный видимый браузерный сборщик выплат WB/Ozon. Не использует профили других агентов и не пишет в календарь напрямую: он отправляет снимки в защищённый финансовый API, после чего пользователь проверяет их в панели и отдельно подтверждает перенос.

## Безопасная установка владельцем

1. Скопировать эту папку в `/Users/maxim/marketplace-payout-collector`.
2. Создать `.env` по `.env.example`, указав тот же `FINANCE_MONITOR_SECRET`, который настроен на сервере панели. Не присылать значение в переписку.
3. Создать `targets.json` по `targets.example.json`. Для WB добавить отдельную строку на каждый кабинет с точными `cabinetId`, `companyId`, `accountId`, главной страницей и URL раздела выплат.
4. Права: `chmod 700 . && chmod 600 .env targets.json`.
5. Один раз через VNC выполнить `/Users/maxim/opt/node/bin/node collector.mjs --login`, войти в каждый кабинет в открытых вкладках, затем остановить процесс `Ctrl+C`. Профиль останется в `chrome-profile`.
6. Проверить вручную: `/Users/maxim/opt/node/bin/node collector.mjs --collect`, затем `tail -50 logs/collector.log`.
7. Только после успешной проверки скопировать plist в `~/Library/LaunchAgents/` и выполнить `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ru.kreonopt.marketplace-payout-collector.plist`.

Сбор запускается раз в 6 часов. При CAPTCHA/блокировке он прекращает обход до следующего запуска. Скриншоты нераспознанных страниц остаются только локально на Mac mini.
