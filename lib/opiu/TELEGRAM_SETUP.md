# Финансовый Telegram-помощник: настройка владельцем

Код помощника находится только в разрешённой зоне «Финансы». Перед публикацией владелец выполняет SQL ниже в Supabase SQL Editor и настраивает серверные секреты.

## 1. SQL

```sql
create table if not exists public.finance_accounts (
  id text primary key,
  name text not null,
  type text not null check (type in ('marketplace', 'bank', 'cash')),
  currency text not null default 'RUB',
  balance numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_payments (
  id text primary key,
  date date not null,
  name text not null,
  amount numeric not null,
  category text not null,
  account_id text not null references public.finance_accounts(id),
  status text not null check (status in ('planned', 'done', 'cancelled')),
  counterparty text not null default '',
  comment text,
  updated_at timestamptz not null default now()
);
create index if not exists finance_payments_date_idx on public.finance_payments(date);
create index if not exists finance_payments_status_idx on public.finance_payments(status);

create table if not exists public.finance_alerts (
  id bigint generated always as identity primary key,
  alert_key text not null unique,
  severity text not null check (severity in ('critical', 'warning', 'info')),
  title text not null,
  message text not null,
  action text not null,
  amount numeric,
  alert_date date,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.finance_tasks (
  id bigint generated always as identity primary key,
  text text not null,
  status text not null default 'new' check (status in ('new', 'in_progress', 'done', 'cancelled')),
  source text not null default 'telegram',
  telegram_user_id bigint,
  author_name text,
  result_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_forecast_versions (
  id bigint generated always as identity primary key,
  year integer not null,
  month integer not null check (month between 1 and 12),
  snapshot_date date not null,
  plan_revenue numeric not null default 0,
  actual_revenue numeric not null default 0,
  projected_revenue numeric not null default 0,
  adaptive_revenue numeric not null default 0,
  forecast_payout numeric not null default 0,
  actual_payout numeric not null default 0,
  remaining_payout numeric not null default 0,
  details jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (year, month, snapshot_date)
);

create table if not exists public.finance_seasonal_products (
  id bigint generated always as identity primary key,
  article text not null unique,
  weather_mode text not null check (weather_mode in ('hot', 'cold', 'rain', 'snow')),
  threshold numeric not null,
  impact_percent_per_unit numeric not null default 0,
  max_adjustment_percent numeric not null default 30,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.finance_accounts enable row level security;
alter table public.finance_payments enable row level security;
alter table public.finance_alerts enable row level security;
alter table public.finance_tasks enable row level security;
alter table public.finance_forecast_versions enable row level security;
alter table public.finance_seasonal_products enable row level security;
```

Доступ выполняется только сервером через `SUPABASE_SERVICE_ROLE_KEY`; публичные RLS-политики создавать не нужно.

## 2. Серверные переменные

```text
FINANCE_TELEGRAM_BOT_TOKEN=токен от BotFather
FINANCE_TELEGRAM_CHAT_ID=числовой id чата руководителя
FINANCE_TELEGRAM_WEBHOOK_SECRET=случайная длинная строка
FINANCE_MONITOR_SECRET=случайная длинная строка
FINANCE_GOOGLE_SHEETS_WEBHOOK_URL=URL опубликованного Google Apps Script
FINANCE_GOOGLE_SHEETS_SECRET=случайная длинная строка
SUPABASE_SERVICE_ROLE_KEY=существующий серверный ключ Supabase
```

Секреты добавляются в окружение хостинга. Их нельзя коммитить в `.env` или отправлять в чат.

## 3. Одна правка владельца вне зоны «Финансы»

В `proxy.ts` добавить Telegram webhook в `PUBLIC_API`:

```ts
{ prefix: "/api/opiu/telegram", methods: ["POST"] },
```

Без этого production-прокси остановит запрос Telegram до проверки webhook-секрета.

## 4. Подключить webhook

После деплоя владелец выполняет у себя, не публикуя токен:

```bash
curl -X POST "https://api.telegram.org/bot<ТОКЕН>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<ДОМЕН>/api/opiu/telegram","secret_token":"<FINANCE_TELEGRAM_WEBHOOK_SECRET>","allowed_updates":["message"]}'
```

## 5. Фоновая проверка

В планировщике хостинга создать POST-запрос один раз в день, например в 08:00:

```text
POST https://<ДОМЕН>/api/opiu/monitor
Authorization: Bearer <FINANCE_MONITOR_SECRET>
```

Если общий `proxy.ts` требует `CRON_SECRET`, владелец должен использовать одинаковое значение для `CRON_SECRET` и `FINANCE_MONITOR_SECRET` либо адаптировать проверку в инфраструктуре.

Проверка раз в день сохраняет фактическое отклонение. Автоматический пересчёт по динамике продаж применяется только после трёх последовательных дней отклонения не менее 10% в одну сторону. Команда `/recalculate` применяет пересчёт немедленно.

## 6. Сезонные товары и погода

В `finance_seasonal_products` владелец добавляет только действительно сезонные артикулы. Пример:

```sql
insert into public.finance_seasonal_products
  (article, weather_mode, threshold, impact_percent_per_unit, max_adjustment_percent)
values
  ('АРТИКУЛ-ЗОНТ', 'rain', 2, 1.5, 25),
  ('АРТИКУЛ-КУРТКА', 'cold', 5, 2, 30)
on conflict (article) do update set
  weather_mode = excluded.weather_mode,
  threshold = excluded.threshold,
  impact_percent_per_unit = excluded.impact_percent_per_unit,
  max_adjustment_percent = excluded.max_adjustment_percent,
  updated_at = now();
```

Регионы определяются автоматически по фактическим заказам конкретного артикула за последние 28 дней. Регион учитывается только при доле не менее 5% заказов; влияние погоды взвешивается по доле заказов. Прогноз берётся из Open-Meteo на 16 дней. Корректировка ограничивается `max_adjustment_percent`, отображается в панели и отправляется в Telegram один раз при появлении сигнала.

## 7. Google Таблица

Создать Google Таблицу и открыть **Расширения → Apps Script**. Вставить код:

```javascript
const SECRET = 'тот же FINANCE_GOOGLE_SHEETS_SECRET';

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.secret !== SECRET) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = book.getSheetByName(body.sheet) || book.insertSheet(body.sheet);
  sheet.clearContents();
  if (body.rows && body.rows.length) {
    sheet.getRange(1, 1, body.rows.length, body.rows[0].length).setValues(body.rows);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, body.rows[0].length).setFontWeight('bold').setBackground('#ede9fe');
    sheet.autoResizeColumns(1, body.rows[0].length);
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Опубликовать как Web App с доступом для всех, кто знает URL. URL записать в `FINANCE_GOOGLE_SHEETS_WEBHOOK_URL`. Секрет проверяется внутри скрипта. Панель автоматически обновляет лист после изменения календаря; кнопка «Google Таблица» позволяет выполнить выгрузку вручную.

## 8. Команды

- `/status` — состояние плана, минимальный остаток и отклонения;
- `/alerts` — список серьёзных предупреждений;
- `/recalculate` — принудительный пересчёт;
- `/tasks` — последние задачи;
- любой обычный текст — новая задача руководителя.

Бот не применяет опасные финансовые изменения по свободному тексту автоматически. Такие команды сохраняются как задачи и требуют подтверждения в панели.
