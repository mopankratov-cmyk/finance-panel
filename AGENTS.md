<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Работа в команде (для всех, кто правит этот репозиторий)

- **Не пиши в `main` напрямую.** Каждая задача — отдельная ветка (`feat/...` или `fix/...`) и отдельный Pull Request. `main` защищён и вливается только владельцем.
- **Не коммить секреты.** `.env*` в `.gitignore` — оставь так. Никогда не вставляй ключи/токены/пароли в код или в сообщения коммитов.
- **Меняй только то, что относится к задаче.** Не делай попутных широких рефакторингов без запроса.
- Перед PR убедись, что `npm run dev` поднимается без ошибок.
- Каждый PR проходит AI-гейт (`.github/workflows/ai-gate.yml`): мелкие безопасные правки ИИ-ревьюер (`director-cockpit`) одобряет и вливает сам; рискованное (миграции, `.env`/секреты, зависимости, авторизация, оплата, CI, удаление файлов) уходит владельцу на ручное одобрение. Сомнение → эскалация.
- Новым участникам: см. `docs/ONBOARDING.md`. Владельцу: `docs/КОМАНДА-доступ.md`.
