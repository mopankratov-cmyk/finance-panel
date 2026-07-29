<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Работа в команде (для всех, кто правит этот репозиторий)

- **Не пиши в `main` напрямую.** Каждая задача — отдельная ветка (`feat/...` или `fix/...`) и отдельный Pull Request. `main` защищён и вливается только владельцем.
- **Не коммить секреты.** `.env*` в `.gitignore` — оставь так. Никогда не вставляй ключи/токены/пароли в код или в сообщения коммитов.
- **Меняй только то, что относится к задаче.** Не делай попутных широких рефакторингов без запроса.
- Перед PR убедись, что `npm run dev` поднимается без ошибок.
- Каждый PR проходит AI-гейт (`.gitea/workflows/ai-gate.yml`): мелкие безопасные правки ИИ-ревьюер (`director-cockpit`) одобряет и вливает сам; рискованное (миграции, `.env`/секреты, зависимости, авторизация, оплата, CI, удаление файлов) уходит владельцу на ручное одобрение. Сомнение → эскалация.
- Новым участникам: см. `docs/ONBOARDING.md`. Владельцу: `docs/КОМАНДА-доступ.md`.

# Контрибьюторам вкладки «Финансы» (для Claude Code сотрудника)

> Этот раздел — для тех, кто дорабатывает вкладку «Финансы». Владельца репозитория он не касается.

**Если ты помогаешь дорабатывать вкладку «Финансы» — меняй файлы ТОЛЬКО в этих путях:**
- `app/{calendar,pnl,opiu,losses,summary,payments,loans}/` — страницы вкладки
- `components/{calendar,payments,loans,opiu}/` и `components/FinanceTabs.tsx` — UI-код разделов
- `app/api/opiu/` — финансовый бэкенд (ОПиУ)
- `lib/opiu/` — логика P&L

**НЕ трогай ничего вне этой зоны**, в том числе: общие `app/api/{wb,ozon,supplies}`, `components/CabinetSwitcher*`, `lib/useActiveCabinet*` и прочий общий код; AI-агент (`app/agent`, `components/agent`); авторизацию, `middleware`/`proxy`; миграции БД и `.sql`; `package.json`/lock-файлы/зависимости; `.env*`; конфиги (`vercel.json`, `next.config*`); CI (`.gitea/`, `.github/`).

**Если задача требует тронуть что-то вне зоны Финансы — ОСТАНОВИСЬ** и скажи пользователю: «это вне зоны Финансы, нужно согласование с владельцем» — и НЕ делай эту правку сам. Такой PR всё равно не вольётся автоматически: AI-гейт отправит его владельцу на ручное ревью.

**Порядок работы:** ветка `feat/<коротко>` → правки только в зоне Финансы → `npm run dev` без ошибок → коммит → push → Pull Request в `main`. Прямой push в `main` и мёрж в обход запрещены.

# Контент-завод переехал

Контент-завод (бывшие `app/inferno`, `app/carousel`, `app/video-overlay`, `app/api/factory`, `lib/factory`) выделен в отдельный репозиторий **content-factory** (2026-07-06) — аудит показал отсутствие общего кода и пересекающихся FK-связей с финансами/маркетплейс-операционкой. AI-агент (`app/agent`) остался здесь — он завязан на кабинеты/токены WB, а не на видеопайплайн завода.
