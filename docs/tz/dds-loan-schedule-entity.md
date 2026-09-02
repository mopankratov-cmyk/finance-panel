# ТЗ: График кредита как сущность (остаток долга, капитализация, допвзносы)

> База кода: ветка от **gitea/main**. Читать до старта: `docs/DDS-RULES.md` (§1–§3), `docs/PROJECT-KNOWLEDGE.md` §4–§5.
> Статус: **ждёт решения владельца по §2** (модель данных = миграция → ручное одобрение по AGENTS.md). Исполнитель начинает только после «ок» по §2.

## 0. Инструкция исполнителю (читать первым)
Ты — исполнитель (Codex / cc-glm). Реализуешь ЭТОТ файл целиком и механически, тремя PR в указанном порядке (§7).
- Работай ТОЛЬКО в зоне МОЖНО (§4). Всё остальное — СТОП и отчёт (§10).
- Не изобретай сигнатуры — бери из §6 дословно. Не переспрашивай развилки — они решены в §2.
- Не финишируй PR, пока гейт (§9) не зелёный по baseline.
- Бюджет попыток на один красный гейт: 3. Исчерпал — СТОП и отчёт.
- Миграцию (`supabase/migrations/*.sql`) пишешь, но помнишь: её вливает только владелец. PR с миграцией — отдельный (§7, шаг 1).

## 1. Цель и наблюдаемое поведение
Сейчас графика кредита как сущности нет: он хранится как набор обычных платежей ДДС с метками
`[loan:<id>:schedule:<row>:<kind>]` в текстовом комментарии (`components/loans/LoansPage.tsx`,
`scheduleFromPayments`). Следствия: нет остатка долга на дату → нельзя выразить капитализацию
процентов и дополнительные взносы (договор Дзюбина); статусы «оплачено/отменено/просрочено»
перегружены на поле платежа; факт со строкой графика сопоставляется нечётким поиском по имени
кредитора; редактирование платежа в реестре ломало связь (починено в #864, но причина осталась).

После задачи человек видит:
- В карточке договора — таблицу строк графика с колонками «Дата · Остаток долга до · Тело · Проценты · Пени · Штраф · Остаток после · Статус · Чем закрыта».
- Для договора с капитализацией — проценты начисляются на остаток, невыплаченные проценты прибавляются к телу в дату капитализации; допвзнос увеличивает остаток с указанной даты; всё это видно в колонке «Остаток».
- В платёжном календаре — те же плановые строки, что и раньше (одна плановая запись на дату графика), с прежней меткой `[loan:…]` для обратной совместимости.
- Закрытие строки фактом ДДС — только через ручное подтверждение (I2) и только фактом, который никем не занят (I1).

## 2. Решения приняты за тебя (не переспрашивай) — **ждут «ок» владельца**
- Новая таблица `loan_schedule_rows` — источник правды графика. Плановые платежи в `payments` становятся **производными** от строк (генерируются/обновляются из них), а не наоборот.
- Колонки: `id uuid pk`, `loan_id uuid not null`, `due_date date not null`, `kind text check in ('principal','interest','penalty','fine','fee')`, `amount_rub numeric not null`, `amount_original numeric`, `currency text not null default 'RUB'`, `status text check in ('planned','paid','cancelled') default 'planned'`, `paid_by_payment_id uuid null references payments(id)`, `calendar_payment_id uuid null references payments(id)`, `original_due_date date null`, `balance_before numeric`, `balance_after numeric`, `created_at`, `updated_at`.
- Условия договора — в `loans`: `annual_rate numeric`, `interest_frequency text ('monthly','quarterly','at_maturity')`, `capitalize_interest boolean default false`, `capitalization_frequency text null`, `extra_contributions jsonb default '[]'` (массив `{date, amount}`), `tranches jsonb default '[]'`, `day_count_basis int default 365`.
- Генератор графика — чистая функция `buildLoanSchedule(terms)` в `lib/loans/schedule.ts`, без обращений к базе; покрыт тестами на трёх договорах: простой (как сейчас), с капитализацией, с допвзносами.
- Обратная совместимость: бэкфилл из существующих меток — один раз, скриптом в миграции (§6.3). После бэкфилла `scheduleFromPayments` остаётся только как fallback для строк без `loan_schedule_rows`.
- `paid_by_payment_id` — единственное место связи «строка ← факт». Метка `[paid-by:]` в `comment` продолжает ставиться **дополнительно** (её читают календарь и `consumedFactIds`), пока не переедут все потребители.
- Валюта: `amount_original` в валюте договора, `amount_rub` — по курсу; пересчёт курсом трогает только `planned`-строки с `due_date >= today` (I3).
- Сумма строки округляется `roundLoanMoney` из `lib/opiu/loanCurrency.ts` (как в #860).

## 3. Инварианты (docs/DDS-RULES.md §2)
I1, I2, I3, I4 (остаток «не рассчитан» ≠ 0), I6, I8, I9, I10.

## 4. Зона МОЖНО / НЕЛЬЗЯ
МОЖНО: `supabase/migrations/<date>_loan_schedule_rows.sql` (новый), `lib/loans/**` (новый каталог), `lib/finance/factLinks.ts`, `components/loans/LoansPage.tsx`, `components/loans/LoanForm.tsx`, `components/loans/loanInterest.ts`, `app/api/finance/loans/**` (новый роут), `lib/finance/dbServer.ts` (только чтение/запись новых полей `loans`), тесты в `lib/loans/*.test.mts`.
НЕЛЬЗЯ: `components/calendar/**` (кроме чтения), `components/payments/**`, `lib/opiu/**` (кроме импорта `roundLoanMoney`), `proxy.ts`, `package.json`, всё вне списка.

## 5. Источники правды
Статьи — `LOAN_CATEGORIES` из `lib/finance/categories.ts`. Занятые факты — `consumedFactIds` из `lib/finance/factLinks.ts`. Округление — `roundLoanMoney`. Ничего из этого не дублировать.

## 6. Точки правки

### 6.1 `lib/loans/schedule.ts` (новый)
```ts
export interface LoanTerms {
  principal: number;               // в валюте договора
  startDate: string;               // YYYY-MM-DD
  dueDate: string;
  annualRate: number;              // проценты годовых, 20 = 20%
  interestFrequency: "monthly" | "quarterly" | "at_maturity";
  paymentDay?: number;             // день месяца для начисления; по умолчанию день startDate
  capitalizeInterest: boolean;
  capitalizationFrequency?: "monthly" | "quarterly";
  extraContributions: Array<{ date: string; amount: number }>;
  tranches: Array<{ date: string; amount: number }>;
  dayCountBasis: 365 | 366 | 360;
}
export interface ScheduleRow {
  dueDate: string; kind: "principal" | "interest"; amount: number;
  balanceBefore: number; balanceAfter: number;
}
export function buildLoanSchedule(terms: LoanTerms): ScheduleRow[];
```
Правила расчёта: проценты за период = `balanceBefore * annualRate / 100 * days / dayCountBasis`; при `capitalizeInterest` невыплаченные проценты в дату капитализации прибавляются к `balanceAfter`; допвзнос/транш в дату `d` увеличивает остаток начиная с `d`; тело гасится в `dueDate` целиком, если в терминах нет иного (аннуитет — вне этого ТЗ).

### 6.2 `app/api/finance/loans/[id]/schedule/route.ts` (новый)
`GET` — строки графика; `PUT` — заменить строки (тело: `{ rows: ScheduleRow[] }`), пересоздать производные плановые платежи; `PATCH` — `{ rowId, paidByPaymentId }` закрыть строку фактом: проверка `consumedFactIds` (I1) и точной суммы или явного `confirmed: true` (I2). Гейт роли: `requireApiSession(["director","finance"])`.

### 6.3 Миграция
Создать таблицу; добавить колонки в `loans`; бэкфилл: для каждой `payments` с меткой `[loan:<id>:schedule:<row>:<kind>]` — строка `loan_schedule_rows` (`status` = `paid` если `[paid-by:]` или `status='done'`, `cancelled` если `cancelled` без `paid-by`, иначе `planned`; `paid_by_payment_id` из метки; `calendar_payment_id` = id платежа). Идемпотентно (`on conflict do nothing` по `(loan_id, due_date, kind)`).

### 6.4 `components/loans/LoansPage.tsx`
`scheduleFromPayments` → `scheduleFromRows(rows)` при наличии строк, fallback на старую функцию. `reconcileWithDds` → через `PATCH` роута (§6.2), а не прямой `UPDATE_PAYMENT`. `handleSubmit` → `PUT` строк, производные платежи создаёт сервер.

## 7. Порядок шагов (три PR)
1. **PR-A (к владельцу):** миграция §6.3 + `lib/loans/schedule.ts` + тесты. Ничего в UI. Гейт §9.
2. **PR-B:** роут §6.2 + чтение строк в `LoansPage` (карточка показывает остаток). Запись графика ещё через старый путь. Гейт.
3. **PR-C:** `handleSubmit` и `reconcileWithDds` через роут; форма договора получает поля капитализации и допвзносов. Гейт + ручная проверка на договоре с капитализацией (владелец даёт цифры).

## 8. Что НЕ делать
Не трогать календарь, не переписывать `LoanForm` целиком, не удалять метки из `comment`, не менять `payments` кроме производных строк, не вводить аннуитет, не «попутно» чинить распознавание документов.

## 9. Гейт
```
npm test                 # baseline на 03.09.2026: # pass 1485 / # fail 0 → вернуть ≥ 1485 + свои
npx tsc --noEmit         # без ошибок вне *.test.mts
npx eslint <изменённые>  # без ошибок
node --import tsx --test lib/loans/*.test.mts
```
Тесты обязательны: простой договор (совпадает с текущим генератором `monthlySchedule`), капитализация (сумма процентов растёт), допвзнос (остаток после даты взноса больше), бэкфилл-идемпотентность (двойной прогон не дублирует строки).

## 10. Стоп-условия и отчёт
Стоп: нужна правка вне §4; расчёт по §6.1 расходится с цифрами договора владельца более чем на 1 ₽; гейт красный после 3 попыток. Отчёт: что сделано, где расходится, какой файл вне зоны понадобился и зачем.
