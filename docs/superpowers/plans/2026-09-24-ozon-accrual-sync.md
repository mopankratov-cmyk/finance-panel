# Ozon Accrual Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Ozon's per-cabinet financial accruals (`/v1/finance/accrual/by-day`) and order postings (`ozonPostings()`) into Postgres via a new hourly sync job, so a future "Финансовый отчёт Ozon" page can read pre-aggregated history instead of calling Ozon live on every page load.

**Architecture:** One new `/api/sync/ozon-accruals` cron route processes exactly one most-lagging active Ozon cabinet per invocation. It walks one calendar day at a time — backward from yesterday to a 75-day floor on first run, then settling into refreshing yesterday every tick — fetching both `accrual/by-day` (flattened into `ozon_accrual_rows`) and `ozonPostings()` (upserted into `ozon_postings`) for that day, with progress tracked in the existing generic `wb_sync_state` table under `job = "ozon_accrual_report"`. This plan builds the data pipeline only; the report page that reads these tables is a separate follow-up plan (category-to-P&L-line mapping and UI are out of scope here).

**Tech Stack:** Next.js App Router route handler, Supabase (Postgres) via `getSupabaseAdmin()`, existing `lib/ozon/api.ts` fetch helpers, `node --test` for unit tests (`.test.mts` files, matching the rest of the repo).

**Spec:** This plan implements the design agreed in conversation with the user (finance-panel Ozon financial report project) — no separate spec file exists; the "Global Constraints" below are the agreed decisions, copied from that conversation.

## Global Constraints

- Backfill depth is 60–90 days; this plan uses 75 days (`OZON_ACCRUAL_BACKFILL_DAYS = 75`) as the concrete floor.
- Exactly one Ozon cabinet is processed per cron invocation (matches the existing `opiu-report` / `ozon-adverts` pattern already in this repo — never fan out to all cabinets in one call).
- Idempotent upsert keys: `(cabinet_id, accrual_id, sku, type_id)` for accrual rows, `(cabinet_id, posting_number)` for postings.
- A `429` from Ozon must not advance the day cursor — the next hourly tick retries the same day.
- `HTTP 502` is returned only for a genuine unrecoverable failure (DB error, non-429 Ozon error); a `429` that's about to be retried next tick is a normal `200`.
- Every new `/api/sync/*` route and every new `.sql` migration in this repo always goes to the repo owner for manual PR review (per `AGENTS.md`) — this plan produces a normal PR, nothing here is expected to auto-merge.
- Category-to-P&L-line mapping (which of the ~124 Ozon accrual `type_id`s maps to which line like Комиссия/Логистика/Реклама) is explicitly out of scope for this plan — it's aggregation/report-layer work, done later against the raw rows this plan stores.

## Review Focus

- A `NON_ITEM` accrual (no `sku` at all) must not violate the `ozon_accrual_rows` primary key or crash the flattening function — it must land as its own valid row.
- Re-running the sync for a day already synced (retry, or the "refresh yesterday every tick" live mode) must not create duplicate or double-counted rows — the upsert must genuinely overwrite, not insert-and-orphan.
- A `429` mid-run must leave `wb_sync_state.cursor`/`state` exactly as it was before the run — a partial page fetched before the 429 must not silently advance the day cursor.
- An Ozon posting with a `status` string this codebase's `describeOzonPostingStatus()` doesn't recognize must still be stored as a valid row (raw status, not rejected) — funnel-bucket mapping happens at report time, not at ingest time.
- `accrual/by-day` pagination via `last_id`: if Ozon ignores the `last_id` param (wrong field name) and echoes the same page back, the fetch loop must terminate instead of looping until the 20-page cap on every single call.

---

## File Structure

- **Create** `supabase/migrations/20260924_ozon_accrual_sync.sql` — the two new tables.
- **Create** `lib/ozon/accrualRows.ts` — pure flattening of one raw `by-day` accrual object into DB-ready rows. No I/O.
- **Create** `lib/ozon/accrualRows.test.mts` — unit tests against real captured Ozon response shapes.
- **Create** `lib/ozon/accrualSyncQueue.ts` — pure "which cabinet is most overdue" picker, same shape as the existing `lib/ozon/adSyncPlan.ts`.
- **Create** `lib/ozon/accrualSyncQueue.test.mts` — unit tests.
- **Modify** `lib/ozon/api.ts` — add `ozonAccrualTypes()` and `ozonAccrualByDay()` next to the other finance wrappers (after `ozonRealization`, before `ozonPostings`, around line 495).
- **Create** `app/api/sync/ozon-accruals/route.ts` — the cron route wiring everything together.
- **Modify** `vercel.json` — add the hourly cron entry.

`lib/auth/apiPermissions.ts` needs **no change**: `["/api/sync/", { open: "cron" }]` already prefix-matches `/api/sync/ozon-accruals` (confirmed by reading `apiAccessFor` — a rule ending in `/` matches by `pathname.startsWith(path)`). This is exactly the mistake from the earlier `/api/_debug/...` probe route (undescribed path *and* a Next.js-reserved folder name) — this time the path sits under an already-described prefix and the folder name (`ozon-accruals`) has no leading underscore, so neither failure mode applies.

---

### Task 1: Database tables

**Files:**
- Create: `supabase/migrations/20260924_ozon_accrual_sync.sql`

**Interfaces:**
- Produces: tables `public.ozon_accrual_rows` and `public.ozon_postings`, columns as below — Task 2/3/5 code must match these column names exactly.

- [ ] **Step 1: Write the migration**

```sql
-- Ozon: построчные начисления (/v1/finance/accrual/by-day) и отправления
-- (ozonPostings) — по образцу wb_report_rows/wb_sync_state у WB. Ozon 8
-- сентября 2026 отключил /v3/finance/transaction/{list,totals}; это —
-- хранилище под их официальную замену.
--
-- sku хранится как text: у части строк (NON_ITEM — платежи не по конкретному
-- товару, например инвентаризация взаиморасчётов) SKU нет вовсе, а составной
-- первичный ключ не терпит NULL. '-' — тот же приём, что OZON_AD_EMPTY_DAY_SKU
-- в lib/ozon/adDailyMarkers.ts, только локальный для этой таблицы.
create table if not exists public.ozon_accrual_rows (
  cabinet_id       uuid not null references public.wb_cabinets(id) on delete cascade,
  accrual_id       bigint not null,
  sku              text not null default '-',
  type_id          int not null,
  date             date not null,
  unit_number      text,
  -- Свободный text, не enum: Ozon может завтра прислать категорию, которой
  -- сегодня нет в четырёх известных нам значениях (ITEM/POSTING/NON_ITEM) —
  -- constraint на неизвестном значении уронил бы весь синк одной строкой.
  accrued_category text not null,
  amount           numeric not null,
  currency         text not null default 'RUB',
  quantity         int,
  -- Поля commission-блока (seller_price/sale_price/coinvestment/bonus/...),
  -- которые не сводятся к одному type_id — сохраняем как есть, разбор на
  -- отчётные строки решается на слое агрегации, не здесь.
  extra            jsonb,
  updated_at       timestamptz not null default now(),
  primary key (cabinet_id, accrual_id, sku, type_id)
);

create index if not exists ozon_accrual_rows_cabinet_date_idx
  on public.ozon_accrual_rows (cabinet_id, date);

alter table public.ozon_accrual_rows enable row level security;
drop policy if exists "service role manages ozon accrual rows" on public.ozon_accrual_rows;
create policy "service role manages ozon accrual rows"
  on public.ozon_accrual_rows for all using (true) with check (true);

-- Воронка заказов (Доставлено/Отменено/...). status хранится сырым
-- (английские значения Ozon) — перевод в бакет отчёта делает уже
-- существующий describeOzonPostingStatus() (lib/ozon/postingStatus.ts) на
-- слое чтения, а не здесь: так один новый статус Ozon чинится в одном месте.
create table if not exists public.ozon_postings (
  cabinet_id     uuid not null references public.wb_cabinets(id) on delete cascade,
  posting_number text not null,
  scheme         text not null,
  order_number   text,
  status         text not null,
  created_at     timestamptz not null,
  amount         numeric not null default 0,
  units          int not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (cabinet_id, posting_number)
);

create index if not exists ozon_postings_cabinet_created_idx
  on public.ozon_postings (cabinet_id, created_at);
create index if not exists ozon_postings_cabinet_status_idx
  on public.ozon_postings (cabinet_id, status);

alter table public.ozon_postings enable row level security;
drop policy if exists "service role manages ozon postings" on public.ozon_postings;
create policy "service role manages ozon postings"
  on public.ozon_postings for all using (true) with check (true);
```

- [ ] **Step 2: Verify SQL syntax without touching the real database**

Run: `node -e "require('fs').readFileSync('supabase/migrations/20260924_ozon_accrual_sync.sql','utf8')" && echo "file readable"`

This repo has no local Postgres/migration-runner harness (confirmed: no other migration under `supabase/migrations/` has an accompanying test). Real verification happens when the repo owner applies it via Supabase during PR review, matching how every prior migration in this repo was verified — do not invent a test harness that doesn't exist elsewhere in the codebase.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260924_ozon_accrual_sync.sql
git commit -m "feat(ozon): add ozon_accrual_rows and ozon_postings tables"
```

---

### Task 2: Flatten one raw accrual into DB rows

**Files:**
- Create: `lib/ozon/accrualRows.ts`
- Test: `lib/ozon/accrualRows.test.mts`

**Interfaces:**
- Consumes: nothing from other tasks — pure function, only needs the raw JSON shape Ozon returns (captured live from `/v1/finance/accrual/by-day` during API recon).
- Produces: `OzonAccrualRow` type and `flattenOzonAccrual(raw: OzonRawAccrual): OzonAccrualRow[]`, plus `OZON_ACCRUAL_NO_SKU` and `OZON_ACCRUAL_SALE_COMMISSION_TYPE_ID` constants — Task 5 imports all four.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/ozon/accrualRows.test.mts
import assert from "node:assert/strict";
import test from "node:test";
import { flattenOzonAccrual, OZON_ACCRUAL_NO_SKU, OZON_ACCRUAL_SALE_COMMISSION_TYPE_ID } from "./accrualRows.ts";

test("ITEM accrual (no posting) becomes one row keyed by its single fee type_id", () => {
  const raw = {
    accrual_id: 59770995112,
    date: "2026-08-15",
    total_amount: { amount: "-4.13", currency: "RUB" },
    unit_number: "17300007-0240",
    accrued_category: "ITEM",
    posting: null,
    item_fees: { fees: [{ sku: 4822584943, fees: [{ type_id: 1, accrued: { amount: "-4.13", currency: "RUB" } }], quantity: 1 }] },
    non_item_fee: null,
    container_fees: null,
  };
  const rows = flattenOzonAccrual(raw);
  assert.deepEqual(rows, [{
    accrual_id: 59770995112,
    date: "2026-08-15",
    unit_number: "17300007-0240",
    accrued_category: "ITEM",
    currency: "RUB",
    sku: "4822584943",
    type_id: 1,
    amount: -4.13,
    quantity: 1,
    extra: null,
  }]);
});

test("NON_ITEM accrual has no sku and gets the sentinel", () => {
  const raw = {
    accrual_id: 59805156718,
    date: "2026-08-15",
    total_amount: { amount: "-547.8", currency: "RUB" },
    unit_number: "2000062782226",
    accrued_category: "NON_ITEM",
    posting: null,
    item_fees: null,
    non_item_fee: { type_id: 12, accrued: { amount: "-547.8", currency: "RUB" } },
    container_fees: null,
  };
  const rows = flattenOzonAccrual(raw);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sku, OZON_ACCRUAL_NO_SKU);
  assert.equal(rows[0].type_id, 12);
  assert.equal(rows[0].amount, -547.8);
});

test("POSTING accrual with delivery services only (no sale) produces one row per service", () => {
  const raw = {
    accrual_id: 59771331611,
    date: "2026-08-15",
    total_amount: { amount: "-17.28", currency: "RUB" },
    unit_number: "0182305566-0017-1",
    accrued_category: "POSTING",
    posting: {
      delivery_schema: "Fbo",
      products: [{
        sku: 4942088018,
        quantity: 1,
        delivery: { total_accrued: { amount: "-17.28", currency: "RUB" }, services: [{ type_id: 32, accrued: { amount: "-17.28", currency: "RUB" } }] },
        commission: null,
      }],
    },
    item_fees: null,
    non_item_fee: null,
    container_fees: null,
  };
  const rows = flattenOzonAccrual(raw);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sku, "4942088018");
  assert.equal(rows[0].type_id, 32);
  assert.equal(rows[0].amount, -17.28);
});

test("POSTING accrual with an actual sale produces service rows plus one synthetic commission row", () => {
  const raw = {
    accrual_id: 59787844001,
    date: "2026-08-15",
    total_amount: { amount: "702.86", currency: "RUB" },
    unit_number: "95159405-0066-1",
    accrued_category: "POSTING",
    posting: {
      delivery_schema: "Fbo",
      products: [{
        sku: 4004598018,
        quantity: 1,
        delivery: {
          total_accrued: { amount: "-64.14", currency: "RUB" },
          services: [
            { type_id: 32, accrued: { amount: "-56", currency: "RUB" } },
            { type_id: 29, accrued: { amount: "-8.14", currency: "RUB" } },
          ],
        },
        commission: {
          seller_price: { amount: "1300", currency: "RUB" },
          sale_price: { amount: "593.33", currency: "RUB" },
          sale_commission: { amount: "-533", currency: "RUB" },
          commission: { amount: "-533", currency: "RUB" },
          commission_ratio: 'value:"0.410000"',
          sale_amount: { amount: "1300", currency: "RUB" },
          coinvestment: { amount: "5.93", currency: "RUB" },
          bonus: { amount: "700.74", currency: "RUB" },
        },
      }],
    },
    item_fees: null,
    non_item_fee: null,
    container_fees: null,
  };
  const rows = flattenOzonAccrual(raw);
  assert.equal(rows.length, 3);
  const commissionRow = rows.find((row) => row.type_id === OZON_ACCRUAL_SALE_COMMISSION_TYPE_ID);
  assert.ok(commissionRow, "expected a synthetic SaleCommission row");
  assert.equal(commissionRow!.amount, -533);
  assert.equal(commissionRow!.sku, "4004598018");
  assert.deepEqual(commissionRow!.extra, {
    seller_price: 1300,
    sale_price: 593.33,
    sale_amount: 1300,
    coinvestment: 5.93,
    bonus: 700.74,
    commission_ratio: 'value:"0.410000"',
  });
});

test("a row with no amount field defaults to 0 instead of throwing", () => {
  const raw = {
    accrual_id: 1,
    date: "2026-08-15",
    total_amount: { amount: "0", currency: "RUB" },
    unit_number: null,
    accrued_category: "NON_ITEM",
    posting: null,
    item_fees: null,
    non_item_fee: { type_id: 5, accrued: undefined },
    container_fees: null,
  };
  const rows = flattenOzonAccrual(raw);
  assert.equal(rows[0].amount, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test lib/ozon/accrualRows.test.mts`
Expected: FAIL — `Cannot find module './accrualRows.ts'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// lib/ozon/accrualRows.ts

/**
 * Плоские строки под таблицу ozon_accrual_rows — из ответа
 * /v1/finance/accrual/by-day. Чистая функция: никакого I/O, весь разбор из
 * реально захваченного во время разведки API JSON (см. docs/superpowers/plans
 * /2026-09-24-ozon-accrual-sync.md).
 */

/** Нет SKU у строки (NON_ITEM — платёж не по конкретному товару). */
export const OZON_ACCRUAL_NO_SKU = "-";

/**
 * У блока `commission` внутри posting.products[] нет своего type_id — это не
 * список услуг, а экономика продажи одной строкой. sale_commission по смыслу
 * — ровно категория "SaleCommission" (id 69) из /v1/finance/accrual/types.
 */
export const OZON_ACCRUAL_SALE_COMMISSION_TYPE_ID = 69;

interface RawMoney {
  amount?: string | number;
  currency?: string;
}

interface RawService {
  type_id: number;
  accrued?: RawMoney;
}

interface RawItemFeeEntry {
  sku?: number | string;
  quantity?: number;
  fees?: { type_id: number; accrued?: RawMoney }[];
}

interface RawCommission {
  seller_price?: RawMoney;
  sale_price?: RawMoney;
  sale_commission?: RawMoney;
  commission?: RawMoney;
  commission_ratio?: string;
  sale_amount?: RawMoney;
  coinvestment?: RawMoney;
  bonus?: RawMoney;
}

interface RawProduct {
  sku?: number | string;
  quantity?: number;
  delivery?: { total_accrued?: RawMoney; services?: RawService[] };
  commission?: RawCommission | null;
}

export interface OzonRawAccrual {
  accrual_id: number;
  date: string;
  total_amount?: RawMoney;
  unit_number?: string | null;
  accrued_category: string;
  posting?: { delivery_schema?: string; products?: RawProduct[] } | null;
  item_fees?: { fees?: RawItemFeeEntry[] } | null;
  non_item_fee?: { type_id: number; accrued?: RawMoney } | null;
  container_fees?: unknown;
}

export interface OzonAccrualRow {
  accrual_id: number;
  date: string;
  unit_number: string | null;
  accrued_category: string;
  currency: string;
  sku: string;
  type_id: number;
  amount: number;
  quantity: number | null;
  extra: Record<string, number | string | null> | null;
}

function moneyAmount(money: RawMoney | undefined): number {
  const value = Number(money?.amount ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function skuText(sku: number | string | undefined): string {
  return sku !== undefined && sku !== null && sku !== "" ? String(sku) : OZON_ACCRUAL_NO_SKU;
}

export function flattenOzonAccrual(raw: OzonRawAccrual): OzonAccrualRow[] {
  const rows: OzonAccrualRow[] = [];
  const base = {
    accrual_id: raw.accrual_id,
    date: raw.date,
    unit_number: raw.unit_number ?? null,
    accrued_category: raw.accrued_category,
    currency: raw.total_amount?.currency ?? "RUB",
  };

  for (const product of raw.posting?.products ?? []) {
    const sku = skuText(product.sku);
    for (const service of product.delivery?.services ?? []) {
      rows.push({
        ...base,
        sku,
        type_id: service.type_id,
        amount: moneyAmount(service.accrued),
        quantity: product.quantity ?? null,
        extra: null,
      });
    }
    if (product.commission) {
      const commission = product.commission;
      rows.push({
        ...base,
        sku,
        type_id: OZON_ACCRUAL_SALE_COMMISSION_TYPE_ID,
        amount: moneyAmount(commission.sale_commission ?? commission.commission),
        quantity: product.quantity ?? null,
        extra: {
          seller_price: moneyAmount(commission.seller_price),
          sale_price: moneyAmount(commission.sale_price),
          sale_amount: moneyAmount(commission.sale_amount),
          coinvestment: moneyAmount(commission.coinvestment),
          bonus: moneyAmount(commission.bonus),
          commission_ratio: commission.commission_ratio ?? null,
        },
      });
    }
  }

  for (const entry of raw.item_fees?.fees ?? []) {
    const sku = skuText(entry.sku);
    for (const fee of entry.fees ?? []) {
      rows.push({
        ...base,
        sku,
        type_id: fee.type_id,
        amount: moneyAmount(fee.accrued),
        quantity: entry.quantity ?? null,
        extra: null,
      });
    }
  }

  if (raw.non_item_fee) {
    rows.push({
      ...base,
      sku: OZON_ACCRUAL_NO_SKU,
      type_id: raw.non_item_fee.type_id,
      amount: moneyAmount(raw.non_item_fee.accrued),
      quantity: null,
      extra: null,
    });
  }

  return rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test lib/ozon/accrualRows.test.mts`
Expected: PASS, 5/5 tests green.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep accrualRows` — expect no output.
Run: `npx eslint lib/ozon/accrualRows.ts lib/ozon/accrualRows.test.mts` — expect no output.

- [ ] **Step 6: Commit**

```bash
git add lib/ozon/accrualRows.ts lib/ozon/accrualRows.test.mts
git commit -m "feat(ozon): flatten raw accrual/by-day entries into DB rows"
```

---

### Task 3: Pick the most-lagging Ozon cabinet

**Files:**
- Create: `lib/ozon/accrualSyncQueue.ts`
- Test: `lib/ozon/accrualSyncQueue.test.mts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `OzonAccrualQueueState` type and `selectOzonAccrualQueueCabinet(cabinetIds, states): string | null` — Task 5 imports both.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/ozon/accrualSyncQueue.test.mts
import assert from "node:assert/strict";
import test from "node:test";
import { selectOzonAccrualQueueCabinet, type OzonAccrualQueueState } from "./accrualSyncQueue.ts";

test("a cabinet with no state at all (never synced) wins over one synced recently", () => {
  const states: OzonAccrualQueueState[] = [
    { cabinetId: "a", status: "ok", updatedAt: new Date().toISOString() },
  ];
  const picked = selectOzonAccrualQueueCabinet(["a", "b"], states);
  assert.equal(picked, "b");
});

test("the cabinet with the oldest updatedAt wins", () => {
  const states: OzonAccrualQueueState[] = [
    { cabinetId: "a", status: "ok", updatedAt: "2026-09-24T10:00:00.000Z" },
    { cabinetId: "b", status: "ok", updatedAt: "2026-09-20T10:00:00.000Z" },
  ];
  const picked = selectOzonAccrualQueueCabinet(["a", "b"], states);
  assert.equal(picked, "b");
});

test("ties break by input order", () => {
  const states: OzonAccrualQueueState[] = [
    { cabinetId: "a", status: "ok", updatedAt: "2026-09-24T10:00:00.000Z" },
    { cabinetId: "b", status: "ok", updatedAt: "2026-09-24T10:00:00.000Z" },
  ];
  const picked = selectOzonAccrualQueueCabinet(["a", "b"], states);
  assert.equal(picked, "a");
});

test("an empty cabinet list returns null instead of throwing", () => {
  assert.equal(selectOzonAccrualQueueCabinet([], []), null);
});

test("duplicate cabinet ids in the input are de-duplicated", () => {
  const picked = selectOzonAccrualQueueCabinet(["a", "a", "b"], []);
  assert.equal(picked, "a");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test lib/ozon/accrualSyncQueue.test.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/ozon/accrualSyncQueue.ts

/**
 * Один прогон крона тянет ровно один кабинет (см. app/api/sync/opiu-report и
 * app/api/sync/ozon-adverts — тот же принцип: не запускать все кабинеты
 * параллельно). Выбираем того, кого дольше всех не трогали — тот же приём,
 * что selectOzonAdSyncCabinets в lib/ozon/adSyncPlan.ts, но возвращает один
 * id вместо списка, как selectOpiuReportQueueCabinet.
 */
export interface OzonAccrualQueueState {
  cabinetId: string;
  status: string;
  updatedAt: string | null;
}

export function selectOzonAccrualQueueCabinet(
  cabinetIds: readonly string[],
  states: readonly OzonAccrualQueueState[],
): string | null {
  const uniqueIds = [...new Set(cabinetIds.filter(Boolean))];
  if (!uniqueIds.length) return null;

  const byCabinet = new Map(states.map((state) => [state.cabinetId, state]));
  const ranked = uniqueIds.map((cabinetId, index) => {
    const updatedAt = Date.parse(byCabinet.get(cabinetId)?.updatedAt ?? "");
    return { cabinetId, index, updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0 };
  });

  ranked.sort((left, right) => left.updatedAt - right.updatedAt || left.index - right.index);
  return ranked[0]?.cabinetId ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test lib/ozon/accrualSyncQueue.test.mts`
Expected: PASS, 5/5 tests green.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep accrualSyncQueue` — expect no output.
Run: `npx eslint lib/ozon/accrualSyncQueue.ts lib/ozon/accrualSyncQueue.test.mts` — expect no output.

- [ ] **Step 6: Commit**

```bash
git add lib/ozon/accrualSyncQueue.ts lib/ozon/accrualSyncQueue.test.mts
git commit -m "feat(ozon): pick the most overdue cabinet for accrual sync"
```

---

### Task 4: Ozon API wrappers for accrual/types and accrual/by-day

**Files:**
- Modify: `lib/ozon/api.ts` (insert after the closing brace of `ozonRealization`, i.e. after the block that currently ends the finance-report section and before `// Отправления FBO и FBS...` / `export async function ozonPostings`, roughly line 495 on `main` at the time this plan was written — search for that comment to place it precisely, since concurrent work in this repo may have shifted line numbers)

**Interfaces:**
- Consumes: `OzonCreds`, `tfetch`, `headers`, `BASE` (all already module-private in `lib/ozon/api.ts`, used the same way every other function in that file uses them).
- Produces: `OzonAccrualType`, `ozonAccrualTypes(c): Promise<{ok:true; types: OzonAccrualType[]} | {ok:false; error:string}>`, `OzonAccrualByDayResult`, `ozonAccrualByDay(c, date): Promise<OzonAccrualByDayResult>` — Task 5 imports `ozonAccrualByDay` and its result type; `ozonAccrualTypes` is exported for later use by the (separate, future) category-mapping work.

This task has no automated test: every other live-fetch wrapper in `lib/ozon/api.ts` (`ozonRealizationByDay`, `ozonPrices`, `ozonPostings`, etc.) is unverified by a unit test in this codebase — there's no `fetch`-mocking harness here, and introducing one for just this function would be inconsistent with the file's established pattern. Verification is type-checking plus the manual live check in Step 3 below (this repo already proved live-API access works during the earlier API recon in this same session).

- [ ] **Step 1: Write the implementation**

```typescript
export interface OzonAccrualType {
  id: number;
  name: string;
  description: string;
}

/** Справочник категорий начислений — ~124 строки, меняется редко. */
export async function ozonAccrualTypes(
  c: OzonCreds,
): Promise<{ ok: true; types: OzonAccrualType[] } | { ok: false; error: string }> {
  try {
    const res = await tfetch(c, `${BASE}/v1/finance/accrual/types`, {
      method: "POST",
      headers: headers(c),
      body: JSON.stringify({}),
      next: { revalidate: 86400 },
    });
    if (!res.ok) return { ok: false, error: `Ozon ${res.status}: ${(await res.text()).slice(0, 120)}` };
    const json = (await res.json()) as { accrual_types?: OzonAccrualType[] };
    return { ok: true, types: json.accrual_types ?? [] };
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 120) };
  }
}

export type OzonAccrualByDayResult =
  | { ok: true; accruals: unknown[] }
  | { ok: false; error: string; rateLimited: boolean };

/**
 * Построчные начисления за один календарный день.
 *
 * Пагинация не документирована официально: ответ несёт `last_id`, и мы
 * пробуем продолжить, подставляя его в следующий запрос тем же именем поля.
 * Если Ozon имя не примет и вернёт тот же `last_id` второй раз — не зависаем
 * до потолка страниц, а останавливаемся: лучше неполный день, чем зависший
 * крон-вызов.
 */
export async function ozonAccrualByDay(c: OzonCreds, date: string): Promise<OzonAccrualByDayResult> {
  const accruals: unknown[] = [];
  let lastId: string | undefined;
  let previousLastId: string | undefined;

  for (let page = 0; page < 20; page += 1) {
    const body: Record<string, unknown> = lastId ? { date, last_id: lastId } : { date };
    let res: Response;
    try {
      res = await tfetch(c, `${BASE}/v1/finance/accrual/by-day`, {
        method: "POST",
        headers: headers(c),
        body: JSON.stringify(body),
        cache: "no-store",
      });
    } catch (error) {
      return { ok: false, error: String(error).slice(0, 120), rateLimited: false };
    }
    if (res.status === 429) return { ok: false, error: "rate limited", rateLimited: true };
    if (!res.ok) return { ok: false, error: `Ozon ${res.status}: ${(await res.text()).slice(0, 120)}`, rateLimited: false };

    const json = (await res.json()) as { accruals?: unknown[]; last_id?: string };
    const batch = json.accruals ?? [];
    accruals.push(...batch);
    if (!batch.length || !json.last_id || json.last_id === previousLastId) break;
    previousLastId = lastId;
    lastId = json.last_id;
  }

  return { ok: true, accruals };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "lib/ozon/api"` — expect no output.

- [ ] **Step 3: Manual live smoke check (one call, not automated)**

This mirrors how the API recon in this same conversation was verified — a single real call against a real cabinet, read the response by eye, not left in the codebase as a script:

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data } = await db.from('wb_cabinets').select('client_id, token').eq('marketplace','ozon').eq('is_active', true).limit(1).single();
  const res = await fetch('https://api-seller.ozon.ru/v1/finance/accrual/by-day', {
    method: 'POST',
    headers: { 'Client-Id': data.client_id, 'Api-Key': data.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10) }),
  });
  console.log(res.status, (await res.text()).slice(0, 300));
})();
"
```
Expected: `200` and a JSON body starting with `{"accruals":[...`. If it 429s, wait a minute and retry — this project's own `lib/ozon/sellerGate.ts` already throttles per-cabinet in production; a bare manual call like this one doesn't go through that gate, so a single manual retry is normal here, not a sign of a bug.

- [ ] **Step 4: Commit**

```bash
git add lib/ozon/api.ts
git commit -m "feat(ozon): add accrual/types and accrual/by-day API wrappers"
```

---

### Task 5: The sync route

**Files:**
- Create: `app/api/sync/ozon-accruals/route.ts`

**Interfaces:**
- Consumes: `getSupabaseAdmin` (`@/lib/supabaseAdmin`), `checkCronAuth` (`@/lib/sync/helpers`), `readWbSyncState`/`writeWbSyncState` (`@/lib/wb/syncState`), `flattenOzonAccrual`/`OzonAccrualRow` (`@/lib/ozon/accrualRows`), `selectOzonAccrualQueueCabinet`/`OzonAccrualQueueState` (`@/lib/ozon/accrualSyncQueue`), `ozonAccrualByDay` (`@/lib/ozon/api`), `ozonPostings` (`@/lib/ozon/api`).
- Produces: `GET` handler at `/api/sync/ozon-accruals`, already covered by the existing `["/api/sync/", { open: "cron" }]` permission-map rule — no `lib/auth/apiPermissions.ts` change needed (verify this claim in Step 4, don't just trust the plan).

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { readWbSyncState, writeWbSyncState } from "@/lib/wb/syncState";
import { flattenOzonAccrual } from "@/lib/ozon/accrualRows";
import { selectOzonAccrualQueueCabinet, type OzonAccrualQueueState } from "@/lib/ozon/accrualSyncQueue";
import { ozonAccrualByDay, ozonPostings } from "@/lib/ozon/api";

export const maxDuration = 60;

const JOB = "ozon_accrual_report";
const BACKFILL_DAYS = 75;

interface OzonAccrualSyncState extends Record<string, unknown> {
  cursorDate?: string;
  backfillFloor?: string;
  backfillComplete?: boolean;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

/**
 * Одна дата на прогон, один кабинет на прогон — намеренно консервативно.
 * Ozon лимитирует по секундам (см. 429 при параллельных вызовах в разведке
 * API), и WB-аналог (opiu-report) держится того же принципа: лучше медленный
 * бэкфилл, чем оборванная на середине сеть.
 */
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const { data: cabinets, error: cabinetsError } = await db
    .from("wb_cabinets")
    .select("id, name, client_id, token")
    .eq("marketplace", "ozon")
    .eq("is_active", true);
  if (cabinetsError) return NextResponse.json({ error: cabinetsError.message }, { status: 502 });
  if (!cabinets?.length) return NextResponse.json({ error: "Нет активных кабинетов Ozon" }, { status: 503 });

  const cabinetIds = cabinets.map((row) => String(row.id));
  const { data: syncRows, error: syncStateError } = await db
    .from("wb_sync_state")
    .select("cabinet_id, status, updated_at")
    .in("cabinet_id", cabinetIds)
    .eq("job", JOB);
  if (syncStateError) return NextResponse.json({ error: syncStateError.message }, { status: 502 });

  const queueStates: OzonAccrualQueueState[] = (syncRows ?? []).map((row) => ({
    cabinetId: String(row.cabinet_id),
    status: String(row.status ?? "pending"),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  }));
  const cabinetId = selectOzonAccrualQueueCabinet(cabinetIds, queueStates);
  if (!cabinetId) return NextResponse.json({ error: "Не удалось выбрать кабинет" }, { status: 503 });

  const cabinet = cabinets.find((row) => String(row.id) === cabinetId)!;
  const creds = { clientId: String(cabinet.client_id), apiKey: String(cabinet.token) };

  const previous = await readWbSyncState<OzonAccrualSyncState>(db, cabinetId, JOB);
  const backfillFloor = previous?.state.backfillFloor ?? isoDate(daysAgo(BACKFILL_DAYS));
  const backfillComplete = previous?.state.backfillComplete ?? false;
  const syncDate = backfillComplete
    ? isoDate(daysAgo(1))
    : (previous?.state.cursorDate ?? isoDate(daysAgo(1)));

  const accrualResult = await ozonAccrualByDay(creds, syncDate);
  if (!accrualResult.ok) {
    await writeWbSyncState(db, cabinetId, JOB, {
      cursor: previous?.cursor ?? null,
      status: accrualResult.rateLimited ? "rate_limited" : "error",
      attempts: (previous?.attempts ?? 0) + 1,
      lastError: accrualResult.error,
      state: previous?.state ?? { backfillFloor, backfillComplete },
    });
    // 429 не двигает курсор — следующий часовой тик повторит тот же день, и
    // это не сбой синка, а нормальный бэк-офф. Настоящий сбой (не 429)
    // тоже не двигает курсор, но помечается 502, чтобы Vercel не считал
    // прогон зелёным при неподвижных данных.
    return NextResponse.json(
      { cabinetId, date: syncDate, error: accrualResult.error },
      { status: accrualResult.rateLimited ? 200 : 502 },
    );
  }

  const accrualRows = accrualResult.accruals.flatMap((raw) => {
    try {
      return flattenOzonAccrual(raw as Parameters<typeof flattenOzonAccrual>[0]).map((row) => ({
        cabinet_id: cabinetId,
        ...row,
        updated_at: new Date().toISOString(),
      }));
    } catch {
      return [];
    }
  });

  if (accrualRows.length) {
    const { error } = await db
      .from("ozon_accrual_rows")
      .upsert(accrualRows, { onConflict: "cabinet_id,accrual_id,sku,type_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const { postings, errors: postingErrors } = await ozonPostings(
    creds,
    `${syncDate}T00:00:00.000Z`,
    `${syncDate}T23:59:59.999Z`,
  );
  const postingRows = postings.map((posting) => ({
    cabinet_id: cabinetId,
    posting_number: posting.postingNumber,
    scheme: posting.scheme,
    order_number: posting.orderNumber,
    status: posting.status,
    created_at: posting.createdAt,
    amount: posting.amount,
    units: posting.units,
    updated_at: new Date().toISOString(),
  }));
  if (postingRows.length) {
    const { error } = await db
      .from("ozon_postings")
      .upsert(postingRows, { onConflict: "cabinet_id,posting_number" });
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const nextCursorDate = isoDate(new Date(Date.parse(`${syncDate}T00:00:00.000Z`) - 86_400_000));
  const nowComplete = backfillComplete || nextCursorDate < backfillFloor;

  await writeWbSyncState(db, cabinetId, JOB, {
    cursor: syncDate,
    status: "ok",
    attempts: 0,
    lastError: postingErrors.length ? postingErrors.join("; ").slice(0, 500) : null,
    state: {
      backfillFloor,
      backfillComplete: nowComplete,
      cursorDate: nowComplete ? isoDate(daysAgo(1)) : nextCursorDate,
    },
  });

  return NextResponse.json({
    cabinetId,
    date: syncDate,
    accrualRows: accrualRows.length,
    postingRows: postingRows.length,
    backfillComplete: nowComplete,
    postingErrors,
  });
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "sync/ozon-accruals"` — expect no output.
Run: `npx eslint app/api/sync/ozon-accruals/route.ts` — expect no output.

- [ ] **Step 3: Confirm the route is covered by the existing permission map (don't skip — this is exactly the mistake from the earlier `_debug` probe route)**

Run: `node --import tsx --test tests/api-permission-map.test.mts`
Expected: all tests still pass, including "каждый эндпоинт назван в карте прав" (this new route must appear in `ROUTES` via the file-scanner and resolve via the existing `/api/sync/` prefix rule — if this test fails, the folder name or a typo broke the match, fix it before moving on).

- [ ] **Step 4: Confirm the folder name has no leading underscore**

Run: `ls app/api/sync/ozon-accruals/route.ts` — must succeed; the folder is `ozon-accruals`, not `_ozon-accruals` (Next.js excludes underscore-prefixed folders from routing entirely — this is the exact bug that broke the earlier diagnostic route in this same project).

- [ ] **Step 5: Commit**

```bash
git add app/api/sync/ozon-accruals/route.ts
git commit -m "feat(ozon): add /api/sync/ozon-accruals cron route"
```

---

### Task 6: Register the cron schedule

**Files:**
- Modify: `vercel.json`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by other tasks — this is Vercel's own cron config, read at deploy time.

- [ ] **Step 1: Add the cron entry**

In `vercel.json`, inside the `"crons"` array, add (matching the existing entries' style exactly):

```json
    {
      "path": "/api/sync/ozon-accruals",
      "schedule": "18 * * * *"
    },
```

Place it near the other Ozon entries (next to `"/api/sync/ozon-adverts"`) for readability — order in the array has no functional effect on Vercel.

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat(ozon): schedule ozon-accruals sync hourly"
```

---

## Self-Review

**1. Spec coverage** — every agreed decision from the conversation has a task: two tables (Task 1), flattening (Task 2), cabinet queue (Task 3), API wrappers (Task 4), the route with 429-safe cursor and 502-on-real-failure (Task 5), cron registration (Task 6).

**2. Placeholder scan** — no TBD/TODO; every code block is complete and runnable against the real captured Ozon response shapes from this session's own API recon.

**3. Type consistency** — `OzonAccrualRow` (Task 2) fields (`accrual_id, sku, type_id, date, unit_number, accrued_category, amount, currency, quantity, extra`) are exactly what Task 5 spreads into its upsert payload. `OzonAccrualQueueState` (Task 3) fields (`cabinetId, status, updatedAt`) match what Task 5 builds from `wb_sync_state` rows. `OzonAccrualByDayResult`'s `rateLimited` field (Task 4) is exactly what Task 5 branches on.

**4. Review Focus** — all five items now have an owning test or an explicit code path: NON_ITEM sentinel (Task 2, test 2), duplicate-row upsert safety (the `onConflict` keys in Task 5 match the exact primary keys from Task 1 — no separate test possible without a live DB, flagged in Task 1's verification step as owner-side), 429 not advancing the cursor (Task 5's early-return branch, verified by reading the code — no live DB in this repo's test suite to assert against, same limitation as every other sync route in this codebase), unknown posting status stored as-is (Task 5 stores `posting.status` raw, never calls `describeOzonPostingStatus` at ingest time — by construction, nothing to reject), `last_id` pagination loop termination (Task 4's `json.last_id === previousLastId` check).

---

Plan complete and saved to `docs/superpowers/plans/2026-09-24-ozon-accrual-sync.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** — A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** — I implement every task myself in this session, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end.

For this plan I recommend **Native**, because the six tasks are short, mostly sequential (each later task imports the previous one's exact exports), and a shipped mistake here costs nothing worse than a re-run of an idempotent sync job — not worth a fresh subagent context per task. Does the plan capture what you want, and which approach should we use?
