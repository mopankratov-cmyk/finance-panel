# Финансовый отчёт Ozon («К выплате») Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the "Финансовый отчёт Ozon" report page (API + UI), replacing the current placeholder, reading from the already-shipped `ozon_accrual_rows` / `ozon_postings` sync (PR #1255) and the already-shipped `ozon_ad_daily` ad-spend sync.

**Architecture:** A pure, fully-tested report-building function (`buildOzonOpiuReport`) groups accrual rows into sections using structural rules verified against the shipped sync code (not names guessed from a reference spreadsheet), combines them with posting-derived order/sale figures and ad spend, and returns a flat section list an API route serializes and a client page renders in the same visual style as the WB ОПиУ report.

**Tech Stack:** Next.js App Router, Supabase (Postgres), TypeScript, `node:test` (`node --import tsx --test`), Tailwind (existing app conventions).

**Spec:** `docs/superpowers/specs/2026-09-25-ozon-opiu-report-design.md` — read it before starting; this plan implements it exactly, referencing section numbers (§N) throughout.

## Global Constraints

- No live network access to `api-seller.ozon.ru` from this environment (confirmed unreachable in an earlier session on this same task) — the accrual-types cache refresh (Task 2) cannot be exercised end-to-end here; verify it by reading the code against `ozonAccrualTypes()`'s already-tested contract, not by a live call.
- Never call the Ozon API directly from a report/screen route — always read from already-synced Supabase tables (`docs/PROJECT-KNOWLEDGE.md` §1). `/api/opiu/ozon` only ever reads `ozon_accrual_rows`, `ozon_postings`, `ozon_ad_daily`, `ozon_accrual_types`, `wb_cabinets`.
- Section boundaries are structural, not name-based (spec §3): `accrued_category = "POSTING" && type_id === OZON_ACCRUAL_SALE_COMMISSION_TYPE_ID` → commission; `accrued_category = "POSTING"` otherwise → logistics; `accrued_category` is `"ITEM"` or `"NON_ITEM"` → other. Never introduce a name-based or hardcoded-category-list mapping — that was the rejected first design (spec §2).
- Ad spend comes from `ozon_ad_daily` with `sku = OZON_AD_CABINET_TOTAL_SKU` (`'*'`) only — never sum per-SKU rows for a total (`lib/ozon/adDailyMarkers.ts`'s own documented rule: doing so double-counts).
- `Себестоимость` stays a stub (`kind: "stub"`, no amount, not in the total) — out of scope this round (spec §12).
- Single date-range period only (`dateFrom`/`dateTo`) — no rolling-weeks mode, unlike the WB report (spec §9).
- Every step that reads or writes Supabase in a route follows `getSupabaseAdmin()` (never a per-request RLS client) — matches `lib/opiu/reportRows.ts` and every existing sync route.
- New routes rely on existing `apiPermissions.ts` prefix rules (`/api/sync/` → `open: "cron"`; `/api/opiu/` → `finance.view`/`finance.edit`) rather than adding redundant specific entries — verify coverage with `tests/api-permission-map.test.mts` rather than assuming.

## Review Focus

- A cabinet with zero postings and zero accrual rows in the period (never synced yet, or genuinely idle) must render a report with all-zero sections, not throw or return an empty/error response — an empty period is a valid, common state (new cabinet, first day of backfill).
- `ozon_ad_daily` rows outside the cabinet's `client_id` (a different cabinet's ad spend) must never leak into the sum — the query must filter by the exact set of resolved `client_id`s, not just by date.
- A `type_id` that only ever appears with `accrued_category = "ITEM"` in one row and `"NON_ITEM"` in another (shouldn't happen per the sync's own design, but nothing enforces it at the DB level) must not silently pick one bucket and drop the other's amount — both rows must independently reach the total.
- `dateFrom > dateTo` or a malformed date string must return a 400 with a clear message, not a query that silently returns nothing and looks like "no data this period."
- The new-category banner (spec §6) must compare against `ozon_accrual_types`' actual cached `type_id`s, not against the section-mapping rule itself (which never fails to classify anything, per spec §3) — the two are different checks and the plan must not conflate "no section" (impossible) with "no cached name" (routine, e.g. right after Ozon adds a category and before the next cache refresh).

---

### Task 1: Accrual-types cache table and read/refresh helpers

**Files:**
- Create: `supabase/migrations/20260925_ozon_accrual_types.sql`
- Create: `lib/ozon/accrualTypesCache.ts`
- Test: `lib/ozon/accrualTypesCache.test.mts`

**Interfaces:**
- Consumes: `ozonAccrualTypes(c: OzonCreds): Promise<{ ok: true; types: OzonAccrualType[] } | { ok: false; error: string }>` and `OzonAccrualType { id: number; name: string; description: string }` from `lib/ozon/api.ts` (already exists, unchanged).
- Produces: `parseAccrualTypeRows(types: OzonAccrualType[]): { type_id: number; name: string; description: string; updated_at: string }[]` (pure, used by Task 2's route to build the upsert payload) and `readCachedAccrualTypeNames(db: SupabaseClient): Promise<Map<number, string>>` (used by Task 3's report route).

- [ ] **Step 1: Write the migration**

```sql
-- Кэш справочника категорий начислений Ozon (/v1/finance/accrual/types).
--
-- Кабинето-независим: это категории Ozon вообще, не конкретного продавца.
-- Используется только для подписи строк детализации отчёта человекочитаемым
-- именем — раздел, в который попадает начисление, определяется структурно
-- (см. lib/ozon/opiuOzonReport.ts), а не по этому справочнику, так что
-- отсутствие свежей записи здесь не ломает сумму отчёта, только подпись
-- одной строки (см. docs/superpowers/specs/2026-09-25-ozon-opiu-report-design.md §5).
create table if not exists public.ozon_accrual_types (
  type_id     int not null primary key,
  name        text not null,
  description text not null default '',
  updated_at  timestamptz not null default now()
);

alter table public.ozon_accrual_types enable row level security;
drop policy if exists "service role manages ozon accrual types" on public.ozon_accrual_types;
create policy "service role manages ozon accrual types"
  on public.ozon_accrual_types for all using (true) with check (true);
```

- [ ] **Step 2: Verify the migration file is valid SQL by reading it back**

Run: `node -e "require('fs').readFileSync('supabase/migrations/20260925_ozon_accrual_types.sql','utf8'); console.log('file readable')"`
Expected: `file readable`

- [ ] **Step 3: Write the failing test for `parseAccrualTypeRows`**

```typescript
// lib/ozon/accrualTypesCache.test.mts
import assert from "node:assert/strict";
import test from "node:test";
import { parseAccrualTypeRows } from "./accrualTypesCache.ts";

test("maps Ozon's accrual-types response into upsert-ready rows", () => {
  const now = new Date("2026-09-25T00:00:00.000Z");
  const rows = parseAccrualTypeRows(
    [
      { id: 69, name: "SaleCommission", description: "Комиссия за продажу" },
      { id: 12, name: "SomeNonItemFee", description: "" },
    ],
    now,
  );
  assert.deepEqual(rows, [
    { type_id: 69, name: "SaleCommission", description: "Комиссия за продажу", updated_at: "2026-09-25T00:00:00.000Z" },
    { type_id: 12, name: "SomeNonItemFee", description: "", updated_at: "2026-09-25T00:00:00.000Z" },
  ]);
});

test("drops entries with a non-finite or missing id rather than writing a broken primary key", () => {
  const now = new Date("2026-09-25T00:00:00.000Z");
  const rows = parseAccrualTypeRows(
    [
      { id: 69, name: "SaleCommission", description: "" },
      { id: Number.NaN, name: "Broken", description: "" },
    ] as never,
    now,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type_id, 69);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --import tsx --test lib/ozon/accrualTypesCache.test.mts`
Expected: FAIL — `parseAccrualTypeRows` is not exported from a module that doesn't exist yet.

- [ ] **Step 5: Write `lib/ozon/accrualTypesCache.ts`**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OzonAccrualType } from "@/lib/ozon/api";

export interface OzonAccrualTypeRow {
  type_id: number;
  name: string;
  description: string;
  updated_at: string;
}

/** Кабинето-независимый справочник — только для подписи строк детализации, не для разбора по разделам (см. Task 3). */
export function parseAccrualTypeRows(types: OzonAccrualType[], now: Date): OzonAccrualTypeRow[] {
  const updatedAt = now.toISOString();
  return types
    .filter((t) => Number.isFinite(t.id))
    .map((t) => ({
      type_id: t.id,
      name: String(t.name ?? ""),
      description: String(t.description ?? ""),
      updated_at: updatedAt,
    }));
}

/** type_id → имя, для подписи строк детализации отчёта (lib/ozon/opiuOzonReport.ts). */
export async function readCachedAccrualTypeNames(db: SupabaseClient): Promise<Map<number, string>> {
  const { data } = await db.from("ozon_accrual_types").select("type_id, name");
  const names = new Map<number, string>();
  for (const row of data ?? []) {
    names.set(Number(row.type_id), String(row.name));
  }
  return names;
}

/** Все type_id, когда-либо закэшированные — для баннера новых категорий (спека §6), отдельно от readCachedAccrualTypeNames чтобы не тянуть name, когда он не нужен. */
export async function readCachedAccrualTypeIds(db: SupabaseClient): Promise<Set<number>> {
  const { data } = await db.from("ozon_accrual_types").select("type_id");
  return new Set((data ?? []).map((row) => Number(row.type_id)));
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --import tsx --test lib/ozon/accrualTypesCache.test.mts`
Expected: PASS, 2/2

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260925_ozon_accrual_types.sql lib/ozon/accrualTypesCache.ts lib/ozon/accrualTypesCache.test.mts
git commit -m "feat(ozon): add accrual-types cache table and helpers"
```

---

### Task 2: Daily cron route to refresh the accrual-types cache

**Files:**
- Create: `app/api/sync/ozon-accrual-types/route.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `ozonAccrualTypes` from `lib/ozon/api.ts`; `parseAccrualTypeRows` from Task 1's `lib/ozon/accrualTypesCache.ts`; `checkCronAuth`, `writeSyncLog` from `lib/sync/helpers.ts`; `getSupabaseAdmin` from `lib/supabaseAdmin.ts`.
- Produces: nothing consumed by later tasks — this route only keeps `ozon_accrual_types` warm. Task 4 reads that table directly via Task 1's `readCachedAccrualTypeNames`/`readCachedAccrualTypeIds`.

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { ozonAccrualTypes } from "@/lib/ozon/api";
import { parseAccrualTypeRows } from "@/lib/ozon/accrualTypesCache";

export const maxDuration = 30;

/**
 * Справочник категорий Ozon кабинето-независим — годится любой активный
 * Ozon-кабинет только для авторизации запроса, сами данные от него не
 * зависят. Раз в сутки достаточно (справочник у Ozon меняется редко).
 */
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const { data: cabinets, error: cabinetsError } = await db
    .from("wb_cabinets")
    .select("client_id, token")
    .eq("marketplace", "ozon")
    .eq("is_active", true)
    .limit(1);
  if (cabinetsError) {
    await writeSyncLog("ozon_accrual_types", "error", null, cabinetsError.message, startedAt);
    return NextResponse.json({ error: cabinetsError.message }, { status: 502 });
  }
  const cabinet = cabinets?.[0];
  if (!cabinet) {
    return NextResponse.json({ error: "Нет активных кабинетов Ozon" }, { status: 503 });
  }

  const result = await ozonAccrualTypes({ clientId: String(cabinet.client_id), apiKey: String(cabinet.token) });
  if (!result.ok) {
    await writeSyncLog("ozon_accrual_types", "error", null, result.error, startedAt);
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  const rows = parseAccrualTypeRows(result.types, startedAt);
  if (rows.length) {
    const { error } = await db.from("ozon_accrual_types").upsert(rows, { onConflict: "type_id" });
    if (error) {
      await writeSyncLog("ozon_accrual_types", "error", rows.length, error.message, startedAt);
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
  }

  await writeSyncLog("ozon_accrual_types", "ok", rows.length, null, startedAt);
  return NextResponse.json({ types: rows.length });
}
```

- [ ] **Step 2: Add the cron schedule**

In `vercel.json`, inside `"crons"`, next to the other Ozon entries:

```json
    {
      "path": "/api/sync/ozon-accrual-types",
      "schedule": "30 5 * * *"
    },
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 3b: Confirm the route answers GET (the cron scheduler only ever calls GET — a route that only exports POST gets a silent 405, see the test's own comment for the real incident this caught before)**

Run: `node --import tsx --test tests/cron-routes-answer-get.test.mts`
Expected: PASS

- [ ] **Step 4: Confirm the existing permission map already covers this route (no new entry needed)**

Run: `node --import tsx --test tests/api-permission-map.test.mts`
Expected: PASS — `/api/sync/ozon-accrual-types` falls under the existing `["/api/sync/", { open: "cron" }]` prefix rule (`lib/auth/apiPermissions.ts:53`). If this fails, read the test's failure message before adding an entry — it will say exactly what's missing.

- [ ] **Step 5: Typecheck the new route file**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "app/api/sync/ozon-accrual-types"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add app/api/sync/ozon-accrual-types/route.ts vercel.json
git commit -m "feat(ozon): schedule daily accrual-types cache refresh"
```

---

### Task 3: Pure report builder (`buildOzonOpiuReport`)

This is the core business logic — the structural rules from spec §3/§4, fully unit-tested, no I/O.

**Files:**
- Create: `lib/ozon/opiuOzonReport.ts`
- Test: `lib/ozon/opiuOzonReport.test.mts`

**Interfaces:**
- Consumes: `OZON_ACCRUAL_SALE_COMMISSION_TYPE_ID` from `lib/ozon/accrualRows.ts` (already exists); `describeOzonPostingStatus`, `OzonPostingStage` from `lib/ozon/postingStatus.ts` (already exists).
- Produces: `buildOzonOpiuReport(input: OzonOpiuReportInput): OzonOpiuReport`, `OzonOpiuReportInput`, `OzonOpiuReport`, `OzonOpiuSection`, `OzonOpiuChildRow`, `OzonOpiuNewCategory`, `OzonOpiuSectionKey` — all consumed by Task 4's route to shape the JSON response.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/ozon/opiuOzonReport.test.mts
import assert from "node:assert/strict";
import test from "node:test";
import { buildOzonOpiuReport } from "./opiuOzonReport.ts";

function baseInput(overrides: Partial<Parameters<typeof buildOzonOpiuReport>[0]> = {}) {
  return {
    accrualRows: [],
    postings: [],
    adSpend: 0,
    typeNames: new Map<number, string>(),
    knownTypeIds: new Set<number>(),
    ...overrides,
  };
}

test("an empty period (no postings, no accruals) reports all-zero sections, not an error", () => {
  const report = buildOzonOpiuReport(baseInput());
  assert.equal(report.total, 0);
  const cogs = report.sections.find((s) => s.key === "cogs")!;
  assert.equal(cogs.kind, "stub");
  assert.equal(cogs.amount, null);
  for (const section of report.sections) {
    if (section.key === "cogs") continue;
    assert.equal(section.amount, 0, `expected ${section.key} to be 0`);
  }
});

test("type_id 69 on a POSTING row is always commission, never logistics", () => {
  const report = buildOzonOpiuReport(
    baseInput({ accrualRows: [{ accrued_category: "POSTING", type_id: 69, amount: -533 }] }),
  );
  const commission = report.sections.find((s) => s.key === "commission")!;
  const logistics = report.sections.find((s) => s.key === "logistics")!;
  assert.equal(commission.amount, -533);
  assert.equal(logistics.amount, 0);
});

test("any other POSTING type_id is logistics, with a per-type_id child row", () => {
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [
        { accrued_category: "POSTING", type_id: 32, amount: -56 },
        { accrued_category: "POSTING", type_id: 29, amount: -8.14 },
      ],
      typeNames: new Map([[32, "Последняя миля"]]),
    }),
  );
  const logistics = report.sections.find((s) => s.key === "logistics")!;
  assert.equal(logistics.amount, -64.14);
  assert.equal(logistics.children.length, 2);
  const known = logistics.children.find((c) => c.label === "Последняя миля")!;
  assert.equal(known.amount, -56);
  const unknown = logistics.children.find((c) => c.label === "Категория #29")!;
  assert.equal(unknown.amount, -8.14);
});

test("ITEM and NON_ITEM rows both land in Прочие удержания, neither one dropping the other", () => {
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [
        { accrued_category: "ITEM", type_id: 1, amount: -4.13 },
        { accrued_category: "NON_ITEM", type_id: 12, amount: -547.8 },
      ],
    }),
  );
  const other = report.sections.find((s) => s.key === "other")!;
  assert.equal(other.amount, -551.93);
  assert.equal(other.children.length, 2);
});

test("ad spend is a positive input but shows as a negative amount and subtracts from the total", () => {
  const report = buildOzonOpiuReport(baseInput({ adSpend: 281524 }));
  const ads = report.sections.find((s) => s.key === "ads")!;
  assert.equal(ads.amount, -281524);
  assert.equal(report.total, -281524);
});

test("orders section buckets posting amounts by stage; Продажи nets out cancelled", () => {
  const report = buildOzonOpiuReport(
    baseInput({
      postings: [
        { status: "delivered", amount: 1000 },
        { status: "cancelled", amount: 200 },
        { status: "delivering", amount: 50 },
      ],
    }),
  );
  const orders = report.sections.find((s) => s.key === "orders")!;
  assert.equal(orders.amount, 1250);
  const sales = report.sections.find((s) => s.key === "sales")!;
  assert.equal(sales.amount, 1050);
  const cancelledChild = sales.children.find((c) => c.label === "Возвраты и отмены")!;
  assert.equal(cancelledChild.amount, -200);
});

test("total sums Продажи + Комиссия + Логистика + Реклама + Прочие удержания, excluding Себестоимость", () => {
  const report = buildOzonOpiuReport(
    baseInput({
      postings: [{ status: "delivered", amount: 1000 }],
      accrualRows: [
        { accrued_category: "POSTING", type_id: 69, amount: -100 },
        { accrued_category: "POSTING", type_id: 32, amount: -50 },
        { accrued_category: "NON_ITEM", type_id: 12, amount: -20 },
      ],
      adSpend: 30,
    }),
  );
  assert.equal(report.total, 1000 - 100 - 50 - 30 - 20);
});

test("a type_id absent from the cache is surfaced as a new category exactly once", () => {
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [
        { accrued_category: "POSTING", type_id: 32, amount: -10 },
        { accrued_category: "POSTING", type_id: 32, amount: -5 },
        { accrued_category: "NON_ITEM", type_id: 12, amount: -3 },
      ],
      knownTypeIds: new Set([32]),
    }),
  );
  assert.deepEqual(
    report.newCategories.map((c) => c.typeId),
    [12],
  );
});

test("the same type_id under ITEM and under NON_ITEM contributes both amounts, neither one dropping the other", () => {
  // Nothing at the DB level stops the same numeric type_id from showing up
  // under two different accrued_category values — sumByType groups by
  // type_id alone once a row has been sorted into "other", so this pins that
  // both amounts still reach the total rather than the second write
  // silently overwriting the first.
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [
        { accrued_category: "ITEM", type_id: 12, amount: -10 },
        { accrued_category: "NON_ITEM", type_id: 12, amount: -5 },
      ],
    }),
  );
  const other = report.sections.find((s) => s.key === "other")!;
  assert.equal(other.amount, -15);
  assert.equal(other.children.length, 1);
  assert.equal(other.children[0].amount, -15);
});

test("the commission sentinel type_id never appears as a new category, even when uncached", () => {
  const report = buildOzonOpiuReport(
    baseInput({ accrualRows: [{ accrued_category: "POSTING", type_id: 69, amount: -100 }] }),
  );
  assert.deepEqual(report.newCategories, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test lib/ozon/opiuOzonReport.test.mts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write `lib/ozon/opiuOzonReport.ts`**

```typescript
import { OZON_ACCRUAL_SALE_COMMISSION_TYPE_ID } from "@/lib/ozon/accrualRows";
import { describeOzonPostingStatus, type OzonPostingStage } from "@/lib/ozon/postingStatus";

export interface OzonOpiuAccrualInput {
  accrued_category: string;
  type_id: number;
  amount: number;
}

export interface OzonOpiuPostingInput {
  status: string;
  amount: number;
}

export type OzonOpiuSectionKey = "orders" | "sales" | "cogs" | "commission" | "logistics" | "ads" | "other";

export interface OzonOpiuChildRow {
  key: string;
  label: string;
  amount: number;
}

export interface OzonOpiuSection {
  key: OzonOpiuSectionKey;
  label: string;
  kind: "metric" | "stub";
  amount: number | null;
  children: OzonOpiuChildRow[];
}

export interface OzonOpiuNewCategory {
  typeId: number;
  label: string;
}

export interface OzonOpiuReport {
  sections: OzonOpiuSection[];
  total: number;
  newCategories: OzonOpiuNewCategory[];
}

export interface OzonOpiuReportInput {
  accrualRows: OzonOpiuAccrualInput[];
  postings: OzonOpiuPostingInput[];
  /** Положительная сумма расхода на рекламу (сырой SUM(spent) из ozon_ad_daily) — знак меняется внутри. */
  adSpend: number;
  /** type_id → имя, из кэша ozon_accrual_types (Task 1). Отсутствие имени не блокирует сумму — только подпись строки. */
  typeNames: Map<number, string>;
  /** Все type_id, когда-либо закэшированные — для баннера новых категорий (спека §6). */
  knownTypeIds: Set<number>;
}

const STAGE_LABELS: Record<OzonPostingStage, string> = {
  delivered: "Доставлено",
  cancelled: "Отменено",
  transit: "Доставляется",
  shipping: "Ожидает отгрузки/упаковки",
  problem: "Спор/арбитраж",
  unknown: "Без статуса",
};

/** Порядок показа — доставленное и отменённое первыми, как в исходной таблице. */
const STAGE_ORDER: OzonPostingStage[] = ["delivered", "cancelled", "transit", "shipping", "problem", "unknown"];

function labelForType(typeId: number, typeNames: Map<number, string>): string {
  return typeNames.get(typeId) ?? `Категория #${typeId}`;
}

function sumByType(rows: OzonOpiuAccrualInput[]): Map<number, number> {
  const byType = new Map<number, number>();
  for (const row of rows) {
    byType.set(row.type_id, (byType.get(row.type_id) ?? 0) + row.amount);
  }
  return byType;
}

function toChildren(byType: Map<number, number>, typeNames: Map<number, string>): OzonOpiuChildRow[] {
  return [...byType.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([typeId, amount]) => ({ key: String(typeId), label: labelForType(typeId, typeNames), amount }));
}

/**
 * Разбивка по разделам — структурная, проверена по коду синка
 * (docs/superpowers/specs/2026-09-25-ozon-opiu-report-design.md §3), не по
 * названиям категорий: POSTING+69 — всегда синтетическая комиссия
 * (OZON_ACCRUAL_SALE_COMMISSION_TYPE_ID, см. lib/ozon/accrualRows.ts), любая
 * другая POSTING-строка — всегда услуга доставки (по построению
 * flattenOzonAccrual), ITEM/NON_ITEM — «Прочие удержания». Ни одна строка не
 * может остаться без раздела.
 */
export function buildOzonOpiuReport(input: OzonOpiuReportInput): OzonOpiuReport {
  const byStage = new Map<OzonPostingStage, number>();
  for (const posting of input.postings) {
    const { stage } = describeOzonPostingStatus(posting.status);
    byStage.set(stage, (byStage.get(stage) ?? 0) + posting.amount);
  }
  const ordersChildren: OzonOpiuChildRow[] = STAGE_ORDER.filter((stage) => byStage.has(stage)).map((stage) => ({
    key: stage,
    label: STAGE_LABELS[stage],
    amount: byStage.get(stage) ?? 0,
  }));
  const ordersTotal = ordersChildren.reduce((sum, c) => sum + c.amount, 0);

  // Продажи = заказы за вычетом отменённых — не копия оригинальной таблицы
  // (там сломана формула, см. спека §7), а честное определение "нетто" из
  // уже надёжных данных по отправлениям.
  const cancelledAmount = byStage.get("cancelled") ?? 0;
  const salesOrdersAmount = ordersTotal - cancelledAmount;
  const salesTotal = salesOrdersAmount - cancelledAmount;
  const salesChildren: OzonOpiuChildRow[] = [
    { key: "orders", label: "Заказы", amount: salesOrdersAmount },
    { key: "cancelled", label: "Возвраты и отмены", amount: -cancelledAmount },
  ];

  let commissionTotal = 0;
  const logisticsByType = new Map<number, number>();
  const otherRows: OzonOpiuAccrualInput[] = [];
  for (const row of input.accrualRows) {
    if (row.accrued_category === "POSTING" && row.type_id === OZON_ACCRUAL_SALE_COMMISSION_TYPE_ID) {
      commissionTotal += row.amount;
    } else if (row.accrued_category === "POSTING") {
      logisticsByType.set(row.type_id, (logisticsByType.get(row.type_id) ?? 0) + row.amount);
    } else {
      otherRows.push(row);
    }
  }
  const otherByType = sumByType(otherRows);
  const logisticsChildren = toChildren(logisticsByType, input.typeNames);
  const otherChildren = toChildren(otherByType, input.typeNames);
  const logisticsTotal = logisticsChildren.reduce((sum, c) => sum + c.amount, 0);
  const otherTotal = otherChildren.reduce((sum, c) => sum + c.amount, 0);

  const adsAmount = -input.adSpend;

  const newCategories: OzonOpiuNewCategory[] = [...new Set([...logisticsByType.keys(), ...otherByType.keys()])]
    .filter((typeId) => !input.knownTypeIds.has(typeId))
    .sort((a, b) => a - b)
    .map((typeId) => ({ typeId, label: labelForType(typeId, input.typeNames) }));

  const total = salesTotal + commissionTotal + logisticsTotal + adsAmount + otherTotal;

  const sections: OzonOpiuSection[] = [
    { key: "orders", label: "Заказы", kind: "metric", amount: ordersTotal, children: ordersChildren },
    { key: "sales", label: "Продажи", kind: "metric", amount: salesTotal, children: salesChildren },
    { key: "cogs", label: "Себестоимость", kind: "stub", amount: null, children: [] },
    { key: "commission", label: "Комиссия за продажу", kind: "metric", amount: commissionTotal, children: [] },
    { key: "logistics", label: "Логистика", kind: "metric", amount: logisticsTotal, children: logisticsChildren },
    { key: "ads", label: "Реклама", kind: "metric", amount: adsAmount, children: [] },
    { key: "other", label: "Прочие удержания", kind: "metric", amount: otherTotal, children: otherChildren },
  ];

  return { sections, total, newCategories };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test lib/ozon/opiuOzonReport.test.mts`
Expected: PASS, 11/11

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "lib/ozon/opiuOzonReport"`
Expected: no output (a `TS5097` on the `.test.mts` file's own `.ts`-extension import is expected repo-wide noise, already ruled on in the accrual-sync plan — ignore it, don't chase it).

- [ ] **Step 6: Commit**

```bash
git add lib/ozon/opiuOzonReport.ts lib/ozon/opiuOzonReport.test.mts
git commit -m "feat(ozon): build К выплате report rows from structural accrual rules"
```

---

### Task 4: API route `GET /api/opiu/ozon`

**Files:**
- Create: `app/api/opiu/ozon/route.ts`

**Interfaces:**
- Consumes: `isValidDateParam` from `lib/opiu/weeks.ts`; `getSupabaseAdmin` from `lib/supabaseAdmin.ts`; `OZON_AD_CABINET_TOTAL_SKU` from `lib/ozon/adDailyMarkers.ts`; `readCachedAccrualTypeNames`, `readCachedAccrualTypeIds` from Task 1; `buildOzonOpiuReport`, `OzonOpiuReportInput` from Task 3.
- Produces: JSON response `{ report: OzonOpiuReport, cabinetIds: string[] }` (or `{ error }`), consumed by Task 5's page.

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isValidDateParam } from "@/lib/opiu/weeks";
import { OZON_AD_CABINET_TOTAL_SKU } from "@/lib/ozon/adDailyMarkers";
import { readCachedAccrualTypeIds, readCachedAccrualTypeNames } from "@/lib/ozon/accrualTypesCache";
import { buildOzonOpiuReport } from "@/lib/ozon/opiuOzonReport";

export const maxDuration = 60;

function resolveCabinetIds(request: NextRequest): string[] {
  return request.nextUrl.searchParams.getAll("cabinetId").filter(Boolean);
}

export async function GET(request: NextRequest) {
  const dateFrom = request.nextUrl.searchParams.get("dateFrom") ?? "";
  const dateTo = request.nextUrl.searchParams.get("dateTo") ?? "";
  if (!isValidDateParam(dateFrom) || !isValidDateParam(dateTo) || dateFrom > dateTo) {
    return NextResponse.json({ error: "Некорректный диапазон дат" }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const { data: allCabinets, error: cabinetsError } = await db
    .from("wb_cabinets")
    .select("id, client_id")
    .eq("marketplace", "ozon")
    .eq("is_active", true);
  if (cabinetsError) return NextResponse.json({ error: cabinetsError.message }, { status: 502 });

  const requested = new Set(resolveCabinetIds(request));
  const cabinets = (allCabinets ?? []).filter((c) => requested.size === 0 || requested.has(String(c.id)));
  const cabinetIds = cabinets.map((c) => String(c.id));
  const clientIds = cabinets.map((c) => String(c.client_id));

  if (!cabinetIds.length) {
    return NextResponse.json({ report: null, cabinetIds: [], error: "Нет доступных кабинетов Ozon" }, { status: 200 });
  }

  const [accrualRes, postingsRes, adRes, typeNames, knownTypeIds] = await Promise.all([
    db
      .from("ozon_accrual_rows")
      .select("accrued_category, type_id, amount")
      .in("cabinet_id", cabinetIds)
      .gte("date", dateFrom)
      .lte("date", dateTo),
    db
      .from("ozon_postings")
      .select("status, amount")
      .in("cabinet_id", cabinetIds)
      .gte("created_at", `${dateFrom}T00:00:00.000Z`)
      .lte("created_at", `${dateTo}T23:59:59.999Z`),
    db
      .from("ozon_ad_daily")
      .select("spent")
      .in("client_id", clientIds)
      .eq("sku", OZON_AD_CABINET_TOTAL_SKU)
      .gte("date", dateFrom)
      .lte("date", dateTo),
    readCachedAccrualTypeNames(db),
    readCachedAccrualTypeIds(db),
  ]);

  if (accrualRes.error) return NextResponse.json({ error: accrualRes.error.message }, { status: 502 });
  if (postingsRes.error) return NextResponse.json({ error: postingsRes.error.message }, { status: 502 });
  if (adRes.error) return NextResponse.json({ error: adRes.error.message }, { status: 502 });

  const input = {
    accrualRows: (accrualRes.data ?? []).map((r) => ({
      accrued_category: String(r.accrued_category),
      type_id: Number(r.type_id),
      amount: Number(r.amount),
    })),
    postings: (postingsRes.data ?? []).map((r) => ({ status: String(r.status), amount: Number(r.amount) })),
    adSpend: (adRes.data ?? []).reduce((sum, r) => sum + Number(r.spent), 0),
    typeNames,
    knownTypeIds,
  };

  const report = buildOzonOpiuReport(input);
  return NextResponse.json({ report, cabinetIds });
}
```

- [ ] **Step 1b: Note on what this step cannot test**

The `date` validation (`isValidDateParam`/`dateFrom > dateTo` → 400) and the `client_id`-scoped
`ozon_ad_daily` filter are both plain code, not covered by an automated test in this task — this
repo has no live-DB integration tests for any sync/report route (same limitation documented in the
accrual-sync plan's Task 5). Verify both by reading the route above: the 400 branch runs before any
DB call, and the ad-spend query's `.in("client_id", clientIds)` uses only the resolved cabinets'
`client_id`s, never all of `ozon_ad_daily`.

- [ ] **Step 2: Confirm the permission map already covers this route**

Run: `node --import tsx --test tests/api-permission-map.test.mts`
Expected: PASS — `/api/opiu/ozon` falls under the existing `["/api/opiu/", { read: "finance.view", write: "finance.edit" }]` prefix rule (`lib/auth/apiPermissions.ts:67`).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "app/api/opiu/ozon"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add app/api/opiu/ozon/route.ts
git commit -m "feat(ozon): add /api/opiu/ozon report route"
```

---

### Task 5: `OzonOpiuPage.tsx` — full report UI

**Files:**
- Modify: `components/opiu/OzonOpiuPage.tsx` (replace placeholder body, keep the file)
- Test: `tests/ozon-opiu-page.test.mts`

**Interfaces:**
- Consumes: `GET /api/opiu/ozon` (Task 4) response shape `{ report: OzonOpiuReport, cabinetIds: string[] }`; `GET /api/cabinets` (already exists) response shape (each cabinet has `id`, `name`, `marketplace`).
- Produces: nothing consumed by other tasks — this is the terminal UI.

- [ ] **Step 1: Write the failing test**

Following this codebase's established convention for UI "tests" (source-content assertions — see `tests/unit-margin-safety.regression.test.mts` reading `components/opiu/OpiuPage.tsx` as text):

```typescript
// tests/ozon-opiu-page.test.mts
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("OzonOpiuPage fetches the report route and renders date inputs, a cabinet filter and the total row", async () => {
  const source = await readFile(new URL("../components/opiu/OzonOpiuPage.tsx", import.meta.url), "utf8");
  assert.match(source, /\/api\/opiu\/ozon/, "must call the report API route");
  assert.match(source, /marketplace\s*===\s*["']ozon["']/, "must filter cabinets to Ozon on the client");
  assert.match(source, /type="date"/, "must render a date range picker");
  assert.match(source, /К выплате/, "must render the total row label");
  assert.match(source, /не подключено/, "must render the Себестоимость stub label");
});

test("OzonOpiuPage renders the new-category banner conditionally, not unconditionally", async () => {
  const source = await readFile(new URL("../components/opiu/OzonOpiuPage.tsx", import.meta.url), "utf8");
  assert.match(source, /newCategories/, "must reference the report's newCategories field");
  assert.match(
    source,
    /newCategories\.length\s*>\s*0|newCategories\.length\s*\?/,
    "the banner must be gated on newCategories being non-empty, not always shown",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/ozon-opiu-page.test.mts`
Expected: FAIL — the placeholder component doesn't reference `/api/opiu/ozon`, date inputs, or `newCategories`.

- [ ] **Step 3: Write the full component**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Sigma, Table2 } from "lucide-react";

interface OzonOpiuChildRow {
  key: string;
  label: string;
  amount: number;
}

interface OzonOpiuSection {
  key: string;
  label: string;
  kind: "metric" | "stub";
  amount: number | null;
  children: OzonOpiuChildRow[];
}

interface OzonOpiuNewCategory {
  typeId: number;
  label: string;
}

interface OzonOpiuReport {
  sections: OzonOpiuSection[];
  total: number;
  newCategories: OzonOpiuNewCategory[];
}

interface Cabinet {
  id: string;
  name: string;
  marketplace: string;
}

const REVENUE_SECTIONS = new Set(["orders", "sales", "cogs"]);
const ALWAYS_OPEN_SECTIONS = new Set(["sales"]);

function formatRub(value: number | null): string {
  if (value === null) return "—";
  const abs = Math.abs(value).toLocaleString("ru-RU");
  return (value < 0 ? "−" : "") + abs + " ₽";
}

function valueColorClass(value: number | null): string {
  if (value === null) return "text-slate-400";
  if (value < 0) return "text-red-600";
  if (value > 0) return "text-emerald-700";
  return "text-slate-400";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthAgoIso(): string {
  return new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
}

function CabinetMultiSelect({
  cabinets,
  selected,
  onToggle,
}: {
  cabinets: Cabinet[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const buttonLabel =
    selected.length === 0 || selected.length === cabinets.length
      ? `Все кабинеты (${cabinets.length})`
      : `Кабинеты (${selected.length})`;

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-500">Кабинеты</label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-11 min-w-[180px] items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
      >
        <span className="truncate">{buttonLabel}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute left-0 top-full z-20 mt-1 min-w-[220px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {cabinets.map((cabinet) => {
            const checked = selected.includes(cabinet.id);
            return (
              <button
                key={cabinet.id}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => onToggle(cabinet.id)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    checked ? "border-sky-600 bg-sky-600" : "border-slate-300 bg-white"
                  }`}
                >
                  {checked && <span className="h-1.5 w-1.5 rounded-sm bg-white" />}
                </span>
                {cabinet.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function OzonOpiuPage() {
  const [dateFrom, setDateFrom] = useState(monthAgoIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [cabinets, setCabinets] = useState<Cabinet[]>([]);
  const [selectedCabinets, setSelectedCabinets] = useState<string[]>([]);
  const [report, setReport] = useState<OzonOpiuReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/cabinets")
      .then((res) => res.json())
      .then((data: { cabinets?: Cabinet[] }) => {
        setCabinets((data.cabinets ?? []).filter((c) => c.marketplace === "ozon"));
      })
      .catch(() => setCabinets([]));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ dateFrom, dateTo });
    for (const id of selectedCabinets) params.append("cabinetId", id);
    fetch(`/api/opiu/ozon?${params.toString()}`)
      .then((res) => res.json())
      .then((data: { report: OzonOpiuReport | null; error?: string }) => {
        if (data.error && !data.report) setError(data.error);
        setReport(data.report);
      })
      .catch(() => setError("Не удалось загрузить отчёт"))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, selectedCabinets]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleCabinet = (id: string) => {
    setSelectedCabinets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSection = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const rowsHaveNewCategories = useMemo(() => (report?.newCategories.length ?? 0) > 0, [report]);

  return (
    <div className="bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-[110rem] flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
            <Table2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">Финансовый отчёт Ozon</h1>
            <p className="text-xs text-gray-500">По факту начислений Ozon, в разбивке по кабинетам</p>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[110rem] flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-500">Период с</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-11 rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-500">по</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-11 rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
            />
          </div>
          <CabinetMultiSelect cabinets={cabinets} selected={selectedCabinets} onToggle={toggleCabinet} />
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="ml-auto h-11 rounded-lg bg-sky-700 px-5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? "Загрузка…" : "Обновить"}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {rowsHaveNewCategories && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Ozon прислал начисления по {report!.newCategories.length === 1 ? "новой категории" : "новым категориям"}:{" "}
              {report!.newCategories.map((c) => c.label).join(", ")}. Учтено в «Прочих удержаниях» и в итоге
              полностью — просто ещё нет в справочнике имён.
            </div>
          </div>
        )}

        {report && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center bg-slate-900 px-5 py-3 text-sm font-semibold text-white">
              <div className="flex flex-grow items-center gap-2">
                <Sigma className="h-4 w-4" />
                Статья
              </div>
              <div className="w-40 text-right">Период, ₽</div>
            </div>

            {report.sections.map((section) => {
              const isRevenue = REVENUE_SECTIONS.has(section.key);
              const bg = section.kind === "stub" ? "bg-white" : isRevenue ? "bg-sky-50" : "bg-rose-50";
              const hasChildren = section.children.length > 0;
              const alwaysOpen = ALWAYS_OPEN_SECTIONS.has(section.key);
              const isOpen = alwaysOpen || !!expanded[section.key];
              const canToggle = hasChildren && !alwaysOpen;

              return (
                <div key={section.key}>
                  {canToggle ? (
                    <button
                      type="button"
                      onClick={() => toggleSection(section.key)}
                      aria-expanded={isOpen}
                      className={`flex w-full items-center border-b border-slate-100 px-5 py-2.5 text-left ${bg}`}
                    >
                      <div className="flex flex-grow items-center gap-2 text-sm font-bold text-slate-900">
                        <span className="inline-block w-3 text-slate-400">{isOpen ? "▾" : "▸"}</span>
                        {section.label}
                      </div>
                      <div className={`w-40 text-right text-sm font-bold tabular-nums ${valueColorClass(section.amount)}`}>
                        {formatRub(section.amount)}
                      </div>
                    </button>
                  ) : (
                    <div className={`flex w-full items-center border-b border-slate-100 px-5 py-2.5 ${bg}`}>
                      <div className="flex-grow text-sm font-bold text-slate-900">
                        {section.label}
                        {section.kind === "stub" && (
                          <span className="ml-2 text-xs font-normal italic text-slate-400">не подключено</span>
                        )}
                      </div>
                      <div className={`w-40 text-right text-sm font-bold tabular-nums ${valueColorClass(section.amount)}`}>
                        {section.kind === "stub" ? "—" : formatRub(section.amount)}
                      </div>
                    </div>
                  )}
                  {isOpen &&
                    section.children.map((child) => (
                      <div
                        key={child.key}
                        className="flex w-full items-center border-b border-slate-100 bg-white px-5 py-2 pl-10"
                      >
                        <div className="flex-grow text-xs italic text-slate-500">{child.label}</div>
                        <div className={`w-40 text-right text-xs tabular-nums ${valueColorClass(child.amount)}`}>
                          {formatRub(child.amount)}
                        </div>
                      </div>
                    ))}
                </div>
              );
            })}

            <div className="flex items-center border-t-2 border-emerald-200 bg-emerald-50 px-5 py-3.5">
              <div className="flex-grow text-[15px] font-extrabold text-slate-900">К выплате</div>
              <div className="w-40 text-right text-[15px] font-extrabold tabular-nums text-slate-900">
                {formatRub(report.total)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/ozon-opiu-page.test.mts`
Expected: PASS, 2/2

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "components/opiu/OzonOpiuPage"`
Expected: no output.

Run: `npx eslint components/opiu/OzonOpiuPage.tsx`
Expected: no output.

- [ ] **Step 6: Manual verification in the browser**

Start the dev server (`npm run dev` via the project's own preview tooling), sign in as a `director`/`fin_director`/`financier` role, open `/opiu/ozon`. Confirm: date inputs default to the last 30 days and are editable; the cabinet dropdown lists only Ozon cabinets; clicking "Логистика" or "Прочие удержания" expands/collapses their detail rows; "Себестоимость" shows "не подключено" and no crash; the total row renders. An empty period (no data yet) should render zeroed sections, not a blank page or a thrown error — confirms the Task 3 "Review Focus" item didn't regress at the UI layer.

- [ ] **Step 7: Commit**

```bash
git add components/opiu/OzonOpiuPage.tsx tests/ozon-opiu-page.test.mts
git commit -m "feat(ozon): build the full Финансовый отчёт Ozon page"
```
