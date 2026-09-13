# Аудит: роли, авторизация, права — Finance Panel

Прочитаны: `proxy.ts`, `lib/auth/*` (permissions, roles, modules, session, server, apiGuard, apiPermissions, cabinetAccess, cabinetLevel, approvals, users, owner, tenantClaim, proxyAuth, proxySign, limitsStore), `app/api/auth/*`, `app/users/page.tsx`, `app/api/users/*`, `app/wb/team/page.tsx`, `app/api/wb/team/route.ts`, `app/audit/page.tsx`, `app/api/audit/route.ts`, смежные вызывающие места (`lib/adverts/cabinetGuard.ts`, `lib/ozon/cabinet.ts`, `lib/unit/groupScope.ts`, `lib/warehouse/operatorScope.ts`, `lib/sync/*`), миграции `supabase/migrations/2026091000*`, `20260613_auth_and_cabinet_infra.sql`, `202607310001_external_wb_seller_tenancy.sql`. Только чтение, ничего не менялось и не запускалось.

---

## 1. Роли и домашние экраны

Словарь ролей — единственный, в `lib/auth/permissions.ts:102-114`. Десять ролей, две оси контура:

| Роль | Метка | Домашний экран (`ROLE_HOME`, `lib/auth/roles.ts:6-17`) | Маркетплейсы (`ROLE_MARKETPLACES`, `permissions.ts:152-163`) | cabinet-scoped |
|---|---|---|---|---|
| `director` | Руководитель | `/` | wb+ozon | нет — доступ `["*"]` |
| `fin_director` | Финансовый директор | `/pnl` | wb+ozon | нет |
| `financier` | Финансист | `/pnl` | wb+ozon | нет |
| `hr` | HR | `/payroll` | — | нет |
| `wb_manager` | Менеджер WB | `/wb/rnp` | wb | да |
| `ozon_manager` | Менеджер Ozon | `/ozon` | ozon | да |
| `buyer` | Закупщик | `/supplies` | wb+ozon (см. п.4) | нет |
| `warehouse` | Фулфилмент | `/warehouse` | — | нет |
| `seller_owner` | Внешний, главный | `/wb/connect` или `/wb/rnp` | wb+ozon | да, tenant-жёстко |
| `seller` | Внешний | то же | wb+ozon | да, tenant-жёстко |

`roleHome()` (`roles.ts:28-36`) для внешнего контура смотрит не на статическую карту, а на `cabinet_ids`: без подключённого кабинета — `/wb/connect`, с подключённым — сразу `/wb/rnp`. У многоролевого сотрудника домашний экран берётся по **первой** роли в массиве (`roles.ts:31`) — здесь важен порядок при заведении учётки (см. п.4).

Путевой гейт `ACCESS` (`roles.ts:54-87`) — это грубый «куда пустить», отдельный от матрицы действий `ROLE_PERMISSIONS` (`permissions.ts:190-287`). Три независимые оси, все обязаны сойтись: **действие** (permissions.ts) × **маркетплейс** (ROLE_MARKETPLACES) × **область** (кабинеты/юрлицо/организация).

---

## 2. Порядок проверок в `proxy.ts`

Один `matcher`, исключающий `_next/`, `favicon.ico`, `login`, `privacy`, `api/auth`, `share` (`proxy.ts:9-11`). Сессия читается один раз, **оптимистично** — `verifySession()` по JWT, без похода в базу (`proxy.ts:205`, детали в п.3).

### Ветка `/api/*` (`proxy.ts:210-280`)
1. **Публичный allowlist** (`isPublicApi`, `proxy.ts:23-49`) — узкий, поштучно прокомментированный список медиа-прокси и вебхуков с собственным сторожем (HMAC-подпись/секрет). Проходит без сессии и без cron-секрета.
2. **Есть сессия** →
   a. Три **узких legacy-списка на одну роль** (`isSellerApiAllowed`, `isWarehouseApiAllowed`, `isOzonManagerApiAllowed`, `isManagerApiAllowed`) — но применяются, только если `roles.length === 1` и это ровно та роль (`proxy.ts:220-232`). У многоролевого сотрудника эти списки **не действуют вовсе** — комментарий на `proxy.ts:216-219` называет это осознанным решением («вторая роль обязана добавлять доступ»), но по факту это означает, что для человека с двумя ролями (например `seller`+ ещё что-то, случайно возможное сочетание) единственной защитой остаются шаги (b)-(d) ниже.
   b. **Модуль внешнего контура** (`allowsModulePath`, `proxy.ts:250-252`) — только для `seller`/`seller_owner`.
   c. **Маркетплейс** (`marketplaceOfPath` + `rolesAllowMarketplace`, `proxy.ts:258-261`).
   d. **Карта прав** (`apiPermissionFor`, `proxy.ts:262-268`) — единственная проверка, которая знает про permission-модель; `{open:...}` пропускает без проверки роли (см. находку 4.5), `{permission}` сверяется через `rolesCan`. **Неописанный роут закрывается** (`return 403`, `apiPermissions.ts` комментарий 13-15) — это фактически единственное по-настоящему fail-closed звено карты.
3. **Нет сессии** → Bearer `CRON_SECRET` (`proxy.ts:272-275`).
4. **Нет сессии и не прод** → пропуск (dev-skip, `proxy.ts:277`).
5. Иначе — **401 fail-closed** (`proxy.ts:279`).

### Ветка страниц (`proxy.ts:282-296`)
Нет сессии → редирект на `/login?from=...`. Есть сессия → `allowsModulePath` + `canAccess(sessionRoles, pathname)`, иначе редирект на `roleHome(session)`. Здесь `canAccess` смотрит **ту же карту `ACCESS`**, что и раздел 1, — путевой список, не матрицу действий.

Важно: **путевой список `ACCESS` (роли.ts) проверяется только для страниц**. Для API-ветки он не задействован вовсе — там свой более широкий пропуск через `marketplaceOfPath`/`ROLE_MARKETPLACES` (см. находку 4.6). Это два разных, не до конца синхронизированных механизма «куда пускать».

---

## 3. Модель сессии

- Кука `fp_session` (`session.ts:47`), опции: `httpOnly`, `secure`, `sameSite: "lax"`, `path: "/"`, `maxAge: 604800` (7 дней) — `session.ts:103-109`.
- JWT HS256 через `jose`, секрет `AUTH_SECRET` (в проде обязателен, иначе throw; в остальных окружениях небезопасный дефолт — `session.ts:50-57`). `setExpirationTime` = те же 7 дней (`session.ts:59-65`).
- **`verifySession()` (`session.ts:67-91`) — чисто по токену**, без обращения к БД: проверяет подпись и `exp` (автоматически в `jwtVerify`), достаёт `role/roles/modules/cabinet_ids/organization_id` **из самого JWT**. Истёкший/битый токен → `catch` → `null`.
- **`getServerSession()` (`server.ts:11-67`) — авторитетная версия**: сначала `verifySession`, затем перечитывает `app_users` из базы по `uid`, проверяет `is_active`, актуализирует `role/roles/modules/cabinet_ids/organization_id`. Кэшируется через React `cache()` на один HTTP-запрос (`server.ts:9-11`).

**Поведение при истечении:**
- Страницы: `verifySession` вернёт `null` → редирект на `/login?from=...` (`proxy.ts:283-287`).
- API: `null` → без `CRON_SECRET` и не в dev → `401 {"error":"Не авторизовано"}` (`proxy.ts:279`).

**Важное следствие для отзыва доступа (мост к п.4):** `proxy.ts` в ОБЕИХ ветках использует `verifySession()` — то есть **все проверки на уровне гейта (модуль, маркетплейс, карта прав, путевой `ACCESS`) идут по данным из подписанного токена недельной давности, а не по свежей строке в базе**. Свежие данные подтягивает только `getServerSession()`, вызываемый уже *внутри* конкретных роутов (`requireApiSession`, `hasCabinetAccess`, `cabinetRights` и т. д.). Отсюда два разных по скорости отзыва сценария:
- **Деактивация (`is_active=false`)** — отзывается быстро, но только там, где код действительно доходит до `getServerSession()`. Сам гейт `proxy.ts` этого не проверяет и пустит уволенного человека на страницу (кука валидна), а вот любой запрос данных, использующий `getServerSession`/`hasCabinetAccess`, ответит 401/403 сразу.
- **Понижение роли/отзыв кабинета без деактивации** — не отзывается вовсе до перевыпуска куки (повторный вход) или естественного истечения через 7 дней: `proxy.ts` продолжит сверять модуль/маркетплейс/карту прав/путевой `ACCESS` по **старой** роли и **старому** списку `cabinet_ids` из токена. Это прямо противоречит комментарию `server.ts:16-18` («отзыв доступа/кабинета применяется сразу») — он верен только для кода, доходящего до `getServerSession()`, но не для самого гейта, который является первой линией обороны.

---

## 4. Системные слабые места

### 4.1 Критический баг: гейт рекламы всегда возвращает 403 (comma-operator)
`lib/adverts/cabinetGuard.ts:75`:
```ts
if (session.role !== "director" && session.role !== "wb_manager", "ozon_manager") {
```
Из-за оператора запятой (приоритет `&&` выше `,`) всё выражение вычисляется как `(...) , "ozon_manager"` → результат всегда строка `"ozon_manager"` → `if` **всегда истинен**, независимо от роли. `resolveAdvertCabinetAccess()` возвращает 403 «Недостаточно прав для управления рекламой» **для любого пользователя, включая `director`**. Функция используется в 9 роутах (`bid`, `create`, `bulk`, `deposit`, `minus`, `action`, `rules`, `rename`, `journal`, `config`, `clusters`, `token` — `app/api/adverts/*`). Подтверждено `git blame`: баг внесён коммитом `9be1808f` («Роли и права: словарь действий», #959, 09.09.2026) при замене старой роли `"manager"` на новые — правка не была докручена до конца. Направление безопасное (fail-closed, не дыра), но это полный отказ работоспособности модуля управления рекламой для всех ролей.

### 4.2 Слишком широкое право: запись во множестве WB/Ozon-эндпоинтов защищена только `analytics.view`
Карта `apiPermissions.ts` использует пару `{ read: READ_ANALYTICS, write: READ_ANALYTICS }` (запись = то же право, что просмотр) не только там, где это оправдано (кнопка «обновить кэш» — `REFRESH`, `apiPermissions.ts:39-46`), но и там, где эндпоинт пишет содержательные пользовательские данные:

- `/api/rnp/` (`apiPermissions.ts:197`) — покрывает `app/api/rnp/[shop]/operations/route.ts` (создание/переименование/удаление тегов, назначение тегов на товары, добавление записей в журнал РНП — реальная запись в `wb_rnp_tags`, `wb_rnp_sku_tags`, `wb_rnp_journal`) и `app/api/rnp/[shop]/plan/route.ts` (upsert плановых значений в `rnp_plan`). Ни один из этих POST-обработчиков не проверяет permission сам — `operations/route.ts` вызывает только `requireApiSession()` **без списка ролей** (`app/api/rnp/[shop]/operations/route.ts:122,156`), а `plan/route.ts` вообще не вызывает `requireApiSession` (только `hasCabinetAccess`, `app/api/rnp/[shop]/plan/route.ts:36-38`). Итог: писать теги/журнал/план РНП может **любая** роль с `analytics.view` — то есть все, кроме `hr` и `warehouse`, — были бы доступны кабинету.
- Тот же паттерн для `/api/shelf/` (`apiPermissions.ts:202`, реальная мутация watch-листа конкурентов — `POST/PATCH/DELETE /api/shelf/watch`, см. комментарий `proxy.ts:125-134`), `/api/wb/` (`apiPermissions.ts:208`, покрывает `rk-notes`, `ctr-notes` — персональные заметки/задачи менеджера, см. `proxy.ts:143-149`), `/api/sku-order` (`apiPermissions.ts:200`), `/api/ozon/` (`apiPermissions.ts:219`), `/api/trends`, `/api/signals`, `/api/shops`, `/api/market/` (`apiPermissions.ts:195-201`).

Пример конкретного превышения (см. также п.4.6): роль `buyer` по ТЗ (§10) — закупки/себестоимость/приёмка, у неё **нет** ни одной страницы `/wb` или `/ozon` в путевом `ACCESS` (`roles.ts:70`). Но `buyer` числится допущенным в оба маркетплейса в `ROLE_MARKETPLACES` (`permissions.ts:159`, нужно для `/costs`,`/planning`, которые тянут кросс-маркетплейсные SKU) и имеет `analytics.view` (`permissions.ts:253`). Итог: закупщик прямым запросом (без единого пункта меню) может писать теги/журнал РНП, заметки `rk-notes`/`ctr-notes`, watch-лист «Полок» — то, что ТЗ ему не выдавало и чего он никогда не увидит в интерфейсе.

### 4.3 Запись, защищённая фактически только интерфейсом
Помимо 4.2 (где формальная проверка есть, но неоправданно широкая), есть случай без вообще какого-либо контроля со стороны запрашивающей роли:
- `app/api/rnp/[shop]/plan/route.ts` (POST, сохранение ячейки плана) — **нет вызова `requireApiSession` вообще**; единственная преграда — `hasCabinetAccess(cabinetId)`, которая для активной сессии сведётся к «залогинен и кабинет в списке доступных». Кнопка/форма может быть скрыта в UI для «неподходящих» ролей, но сервер этого не проверяет никак — ни через `apiPermissions` (там всё равно `analytics.view`), ни в самом роуте.

### 4.4 `session.role` вместо всех ролей (`sessionRoles`) — системный паттерн
Многоролевость (`session.roles[]`) введена как основной механизм (`session.ts:41-45`, `sessionRoles()`), но заметная часть проверок продолжает читать одиночное поле `session.role` (первую/основную роль), а не сумму ролей:

- `lib/auth/cabinetAccess.ts:16,24,47` — `sessionHasCabinetAccess`/`hasCabinetAccess` смотрят `session.role`, а не `rolesAreCabinetScoped(sessionRoles(session))` из `permissions.ts:361-364`. У сотрудника с ролями `["warehouse","buyer"]` или `["hr","wb_manager"]` результат зависит от того, какая роль оказалась **первой** в массиве при заведении учётки в `app/api/users/route.ts:131` (`const role = roles[0]`) — то же кабинет-ограничение может как излишне сузить, так и излишне расширить доступ по сравнению с задуманным правилом «одна нескоупленная роль — открывает всё» (`permissions.ts:355-360`).
- `lib/ozon/cabinet.ts:103,205`, `lib/unit/groupScope.ts:116,132`, `lib/unit/groupListing.ts:37` — та же проверка `isCabinetScopedRole(session.role)` по одиночной роли.
- `lib/warehouse/operatorScope.ts:18-20` (`canManageStock`, deny-list `role !== "warehouse"`) — вызывается с `session.role` в `app/api/warehouse/tasks/route.ts:95`, `[id]/route.ts:50`, `[id]/cancel/route.ts:39` — тот же порядко-зависимый эффект для сочетания `warehouse`+другая роль.
- `lib/adverts/cabinetGuard.ts:75` (см. 4.1), `lib/sync/helpers.ts:16` (`canRunSyncManually(session.role)`, см. 4.5).
- Director-only гейты: `app/api/users/route.ts:12` (`requireDirector`), `app/api/users/cabinet-access/route.ts:18`, `app/api/wb/team/route.ts:46` — все проверяют `session.role === "director"` буквально. Поскольку `role` всегда равен `roles[0]` (по коду создания), это самосогласовано **пока порядок ролей не меняют руками** — но нет ни одной проверки, что `director` всегда ставится первым при выдаче нескольких ролей; UI/API это не гарантируют явно.
- `app/api/cabinets/route.ts:63,69`, `app/api/cabinets/self-service/route.ts:56,85`, `app/api/costs/categories/route.ts:32`, `app/api/content/library/route.ts:103`, `app/api/unit/table/route.ts:278` — везде сравнение с `session.role`, не с `sessionRoles(session)`.

Единичные корректные образцы — `app/api/audit/route.ts:27` (`rolesCan(sessionRoles(session), "audit.view")`) и сам `proxy.ts` (`sessionRoles(session)` перед `rolesAllowMarketplace`/`rolesCan`) — показывают, что «правильный» путь в кодовой базе есть и используется непоследовательно.

### 4.5 `apiPermissions`: тип `OpenReason` различает «cron» и «any-session», но `proxy.ts` их не различает
`apiPermissions.ts:22-28` документирует три причины открытости: `self-guarded`, `cron` (только машина), `any-session` (достаточно быть залогиненным). Но в `proxy.ts:262-269` обработка одна на все три: если `apiPermissionFor` вернул `{open: ...}`, код просто делает `NextResponse.next()` для **любой** активной сессии, не проверяя её роль вообще — разница между `cron` и `any-session` учитывается только для запросов **без** сессии (там `cron` ожидает Bearer `CRON_SECRET`, `proxy.ts:272-275`). Практическое следствие: `["/api/sync/", { open: "cron" }]` (`apiPermissions.ts:53`) покрывает ~22 незанесённых в явные правила подпути (`/api/sync/all`, `/orders`, `/stocks`, `/kiz-codes`, `/rk-autotask`, `/feedbacks` и т.д.) — маркированных как «только машина», но **любой залогиненный сотрудник любой роли** формально проходит гейт для ручного вызова этих ресинков. На практике каждый такой роут вызывает собственный `checkCronAuth()` (`lib/sync/helpers.ts:8-19`), который заново требует либо Bearer-секрет, либо `canRunSyncManually(session.role)` — так что фактическая защита есть, но она держится только на том, что разработчик не забыл вставить `checkCronAuth` в каждый новый файл под `/api/sync/*`; сам гейт по `apiPermissions`-карте это не гарантирует.

### 4.6 Устаревшее имя роли в списке ручного запуска синка
`lib/sync/manualRunRoles.ts:16`: `MANUAL_RUN_ROLES = ["director", "finance"]`. Роли `"finance"` в текущем словаре (`permissions.ts:102-114`) **не существует** — до рефакторинга ролей (#959, 09.09.2026) она называлась `finance`, затем её разделили на `fin_director`/`financier`. Файл `manualRunRoles.ts` создан раньше (#900, 04.09.2026, коммит `336239c1`) и не обновлён после рефакторинга. Итог: `canRunSyncManually()` сейчас пропускает **только `director`** — комментарий в самом файле (`manualRunRoles.ts:1-14`) объясняет, что кнопка «Прогнать РК» должна работать и для «менеджера МП», и это же используется в `components/wb/WbRkJournalPage.tsx:204` для показа кнопки, — но фактически ни `wb_manager`, ни `ozon_manager`, ни `financier`/`fin_director` в список не входят: они снова получат «Unauthorized», ровно ту регрессию, которую PR #900 был призван исправить.

### 4.7 Отсутствие DB-уровневого ограничения на значения ролей
`app_users.role` создана как `text not null default 'manager'` без `check`/enum (`20260613_auth_and_cabinet_infra.sql`, столбец `role`); `roles` добавлена как `text[]` без ограничений (`202609100001_app_users_roles.sql`). Единственный барьер — прикладная проверка `isRole()` в `app/api/users/route.ts:120-124` и в `app/api/wb/team/route.ts` (роль жёстко `"seller"`). Если в базе окажется строка со значением из старого набора (`'manager'`, `'finance'` — они же дефолт и историческое значение в комментарии миграции) или введённым напрямую SQL-запросом — `isRole()` вернёт `false`, `getServerSession()` отработает как «не авторизован» (`server.ts:53`, fail-closed по эффекту, но как отказ в обслуживании конкретному человеку, а не дыра).

---

## 5. Какие роли реально заведены в базе

Прямого доступа к продовой БД у меня нет (аудит без вызовов API/БД), поэтому фактические строки `app_users` подтвердить не могу — это может дать только запрос к самой базе. Что подтверждается кодом и миграциями:

- Единственный источник истины для допустимых значений — словарь из 10 ролей в `lib/auth/permissions.ts:102-114`; всё остальное (`ROLE_HOME`, `ACCESS`, `ROLE_PERMISSIONS`, `ROLE_MARKETPLACES`) построено поверх него.
- Колонка `role`/`roles` в БД **не ограничена** на уровне схемы (п. 4.7) — значит, теоретически возможен дрейф от словаря (старые роли `'manager'`/`'finance'`, встречающиеся в комментариях миграций и в `lib/sync/manualRunRoles.ts`).
- Бутстрап (`lib/auth/users.ts:39-66`): при нуле пользователей первый вход с паролем ≥10 символов создаёт `director` — это единственный «сеятель» ролей в коде, дальше роли выдаются только через `app/api/users/route.ts` (внутренний контур, только `director`) и `app/api/wb/team/route.ts` (внешний контур, всегда `seller`).
- `PANEL_OWNER_EMAIL` (`lib/auth/owner.ts:13-15`) — единственная учётка, которую нельзя понизить/выключить через `app/wb/team` (`app/api/wb/team/route.ts:172,204`); это email из `.env`, не роль как таковая.

Если нужен точный список реально существующих ролей/пользователей — это отдельный (не read-only-по-коду) шаг: `select role, roles, is_active, count(*) from app_users group by 1,2,3` силами владельца.

---

## Итог по критичности

1. **`lib/adverts/cabinetGuard.ts:75`** — синтаксическая ошибка (comma operator) полностью блокирует модуль управления рекламой для всех ролей, включая `director`. Это подтверждённая регрессия PR #959 (09.09.2026), а не гипотеза.
2. **`apiPermissions.ts` — запись под `analytics.view`** — теги/журнал/план РНП (`/api/rnp/`), watch-лист «Полок» (`/api/shelf/`), заметки менеджера (`/api/wb/` → `rk-notes`, `ctr-notes`) фактически открыты на запись всем ролям с правом «смотреть аналитику» — не только предполагаемым авторам этих действий.
3. **`lib/sync/manualRunRoles.ts:16`** — стухшая роль `"finance"`, кнопка ручного синка недоступна `wb_manager`/`ozon_manager`/`financier`/`fin_director` вопреки собственному комментарию файла.
4. **Гейт `proxy.ts` держит роль/кабинеты/модули по подписанному токену**, а не по свежей строке БД — понижение роли или отзыв кабинета не действует до повторного входа или истечения 7-дневной куки; мгновенно отзывается только деактивация (`is_active=false`), и то лишь для кода, доходящего до `getServerSession()`.
5. Системный паттерн **`session.role` вместо `sessionRoles(session)`** в десятке мест — для многоролевых сотрудников результат проверки кабинета/уровня доступа зависит от порядка ролей в массиве, а не от объявленного в `permissions.ts` правила «сумма прав, а не пересечение».