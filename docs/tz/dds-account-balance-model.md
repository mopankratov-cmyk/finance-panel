# ТЗ: Баланс счёта, который двигается платежами (и не складывает рубли с долларами)

> База кода: ветка от **gitea/main**. Читать до старта: `docs/DDS-RULES.md` (§1–§2), `lib/calculations.ts`, `lib/reducer.ts`, `lib/finance/dbServer.ts`.
> Статус: **ждёт решения владельца по §2** (миграция колонок `accounts` → ручное одобрение). Исполнитель начинает после «ок».

## 0. Инструкция исполнителю (читать первым)
Ты — исполнитель (Codex / cc-glm). Реализуешь ЭТОТ файл целиком и механически, двумя PR (§7).
- Только зона МОЖНО (§4). Всё остальное — СТОП и отчёт (§10).
- Сигнатуры — из §6 дословно. Развилки решены в §2, не переспрашивай.
- Гейт (§9) зелёный по baseline — иначе PR не открывать. Бюджет попыток: 3.

## 1. Цель и наблюдаемое поведение
Сейчас `accounts.balance` — ручное число: единственная ветка, которая двигала его платежом
(`MARK_PAYMENT_DONE` в `lib/reducer.ts:44`), никем не вызывается; импорт создаёт счета с
`balance: 0`. При этом прогноз остатка (`getDailyBalancesForMonth`, `getBalanceAtDate` в
`lib/calculations.ts`) построен так, будто баланс уже включает все прошлые платежи: для
прошлого он вычитает платежи из текущего остатка, для будущего прибавляет. Каждый новый факт
задним числом сдвигает всю историческую кривую; будущий платёж со статусом «оплачено»
считается дважды. И `getTotalBalance` складывает RUB и USD в одно число.

После задачи человек видит:
- У счёта — «Остаток на дату открытия» (вводится один раз) и «Текущий остаток» (считается: открытие + все `done`-платежи по счёту с даты открытия). Ручная правка текущего остатка исчезает; корректировка делается платежом «Корректировка остатка».
- В календаре остаток на день D = открытие + `done` с датой ≤ D + `planned` с датой в (сегодня, D]. Прошлое больше не «переписывается» новыми планами; будущий `done` не считается дважды.
- Итоги — по валютам; USD-счета в рублёвый прогноз не входят (прочерк и подпись «в USD: $N»), а не складываются как рубли.

## 2. Решения приняты за тебя — **ждут «ок» владельца**
- В `accounts` добавляются `opening_balance numeric not null default 0` и `opening_date date not null default current_date`. Колонка `balance` остаётся на переходный период и **больше не пишется** из UI (только читается как fallback при `opening_date is null`).
- Бэкфилл: `opening_balance = balance`, `opening_date = current_date` для всех существующих счетов (один раз, в миграции). С этого дня «текущий» = открытие + факты.
- Текущий остаток считается **на клиенте** из `state.payments` (они и так все в памяти) чистой функцией `accountBalance(account, payments, asOf?)` в `lib/finance/balance.ts`. Никакого RPC на этом шаге.
- `MARK_PAYMENT_DONE` удаляется из `FinanceAction`, `financeReducer`, `persistFinanceActionServer` — мёртвый код, который вводит в заблуждение.
- Мультивалютность: `getTotalBalance` возвращает только RUB-сумму; новая `getTotalBalanceByCurrency` (уже есть) — для подписи. Календарь и «Финансовый контроль» используют только RUB-счета. Конвертация курсом — вне этого ТЗ.
- Корректировка остатка = платёж со статьёй `Корректировка остатка` (добавить в `REGISTRY` справочника, раздел «Прочее», в свод ДДС не входит — как техническая; отдельная константа `ADJUSTMENT_CATEGORY`).

## 3. Инварианты (docs/DDS-RULES.md §2)
I3 (пересчёт не пишет в базу), I4 (счёт без `opening_date` показывает «не задан», а не 0), I6, I9, I10.

## 4. Зона МОЖНО / НЕЛЬЗЯ
МОЖНО: `supabase/migrations/<date>_accounts_opening_balance.sql` (новый), `lib/finance/balance.ts` (новый) + `lib/finance/balance.test.mts`, `lib/calculations.ts`, `lib/reducer.ts`, `lib/types.ts` (поля `Account`), `lib/finance/dbServer.ts`, `lib/finance/categories.ts` (одна строка REGISTRY), `components/accounts/**`, `components/calendar/CalendarPage.tsx` (только вызов `getTotalBalance` → новая функция), `components/calendar/WeekSummaryCell.tsx`, `components/dashboard/DashboardPage.tsx`, `lib/opiu/financialIntelligence.ts` (строка `currentBalance`).
НЕЛЬЗЯ: `components/payments/**`, `components/loans/**`, `app/api/opiu/**`, всё вне списка.

## 5. Источники правды
`lib/finance/balance.ts` — единственное место, где считается остаток. `getDailyBalancesForMonth`/`getBalanceAtDate` переписываются поверх него, а не рядом.

## 6. Точки правки

### 6.1 `lib/finance/balance.ts` (новый)
```ts
import type { Account, Payment } from "@/lib/types";
/** Остаток счёта на конец дня asOf: открытие + факты с opening_date по asOf включительно. */
export function accountBalance(account: Account, payments: readonly Payment[], asOf: string): number;
/** Прогноз на день D: факты ≤ min(D, today) + планы в (today, D]. Только RUB-счета. */
export function projectedBalance(accounts: readonly Account[], payments: readonly Payment[], today: string, day: string): number;
export function rubAccounts(accounts: readonly Account[]): Account[];
```
Платёж относится к счёту по `accountId`; учитываются `status === "done"` для фактов и `status === "planned"` для планов; `cancelled` — никогда.

### 6.2 `lib/types.ts`
```ts
export interface Account { id: string; name: string; type: AccountType; currency: Currency; balance: number; openingBalance: number; openingDate: string | null; }
```
### 6.3 `lib/calculations.ts`
`getDailyBalancesForMonth(year, month, accounts, payments, today)` и `getBalanceAtDate(day, accounts, payments, today)` — сигнатуры меняются: вместо `totalBalance: number` принимают `accounts`. Внутри — `projectedBalance`. `getTotalBalance` → сумма `accountBalance(a, payments, today)` по `rubAccounts`.
### 6.4 `lib/finance/dbServer.ts`
`accountToRow` пишет `opening_balance`, `opening_date`; `loadFinanceStateServer` читает их; `balance` — не пишется. Ветка `MARK_PAYMENT_DONE` удаляется.
### 6.5 `components/accounts/AccountForm.tsx`
Поле «Текущий баланс» → «Остаток на дату» + поле даты. Подсказка: «Дальше остаток считается по платежам».

## 7. Порядок шагов (два PR)
1. **PR-A (к владельцу):** миграция + `lib/finance/balance.ts` + тесты + типы + `dbServer`. UI не трогать. Гейт.
2. **PR-B:** `calculations.ts` поверх `balance.ts`, формы счёта, вызовы в календаре/дашборде/контроле, удаление `MARK_PAYMENT_DONE`. Гейт + ручная проверка: создать счёт с открытием 100 000 на вчера, провести факт −30 000 сегодня — «Текущий» = 70 000; план −50 000 на завтра — прогноз на завтра 20 000; USD-счёт не попадает в рублёвый итог.

## 8. Что НЕ делать
Не конвертировать валюты, не трогать прогнозы WB/Ozon, не менять `payments`, не «улучшать» календарь сверх замены функции остатка.

## 9. Гейт
```
npm test                 # baseline 03.09.2026: # pass 1485 / # fail 0 → ≥ 1485 + свои
npx tsc --noEmit
npx eslint <изменённые>
```
Тесты обязательны: `accountBalance` (факт до/после `openingDate`, `cancelled` не считается), `projectedBalance` (будущий `done` не удваивается; прошлое не меняется от плана), `rubAccounts` (USD исключён).

## 10. Стоп-условия и отчёт
Стоп: правка вне §4; расхождение ручной проверки §7.2; гейт красный после 3 попыток. Отчёт — что, где, почему.
