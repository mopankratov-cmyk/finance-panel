import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Вторая редакция миграции — после адверсариального разбора первой (27
// находок) на локальном Postgres с фикстурами, до применения в бою.
// Тест фиксирует ключевые исправления текстово (структурная регрессия);
// логика проверена живым прогоном на реальном Postgres — сценарии из
// находок описаны в docs/DDS-BANK-LEDGER-MIGRATION.md.

const load = () => readFile(new URL("../supabase/migrations/202609180001_dds_bank_ledger_model.sql", import.meta.url), "utf8");

test("regex на import_source заякорен на все три исторических формата bank-review", async () => {
  const sql = await load();
  // '^bank-review:<uuid>(:|$)' ловит целиком, ':split:N' и старый ':<n>' одним якорем —
  // раньше '^bank-review:...{36}$' пропускал суффикс, а CASE давал NULL.
  const matches = sql.match(/\^bank-review:\[0-9a-f-\]\{36\}\(:\|\$\)/g) ?? [];
  assert.ok(matches.length >= 2, "якорь нужен и в триггере sync_bank_payment_allocation, и в бэкфилле allocations");
  assert.doesNotMatch(sql, /\^bank-review:\[0-9a-f-\]\{36\}\$'\s*\n\s*\?\s*candidatesByIdentity/, "это уже не относится к SQL, но регресс формата не должен возвращаться сюда");
});

test("finance_bank_transactions и finance_bank_allocations не строже источника", async () => {
  const sql = await load();
  // Точный DDL старой редакции — "amount numeric not null check (amount <> 0)"
  // — не должен вернуться; пояснительные комментарии рядом со словом
  // "check (amount <> 0)" (почему constraint убрали) — это ожидаемо, не баг.
  assert.doesNotMatch(sql, /amount numeric not null check \(amount <> 0\)/, "amount без check(<>0) — bank_review_items.amount такого ограничения не несёт");
  assert.match(sql, /account_id uuid not null references public\.accounts\(id\) on delete cascade/, "account_id должен каскадиться вместе с payments.account_id, а не restrict — иначе падает DELETE_ACCOUNT");
  assert.match(sql, /company_id uuid references public\.companies\(id\) on delete set null/, "company_id — nullable, set null, не restrict: у payments нет гарантии, что company_id существует");
});

test("ON CONFLICT без явной цели покрывает и review_item_id, и частичный индекс по identity", async () => {
  const sql = await load();
  const bare = sql.match(/on conflict do nothing/g) ?? [];
  assert.ok(bare.length >= 2, "и триггер, и историческая вставка finance_bank_transactions должны использовать безадресный ON CONFLICT");
});

test("сплиты и дубли identity не ссылаются на несуществующую транзакцию (finance_bank_statement_rows)", async () => {
  const sql = await load();
  // После on conflict do nothing нельзя слепо брать new.id — если конфликт был
  // по identity, транзакции с id=new.id не существует.
  assert.match(sql, /select id into v_transaction_id from public\.finance_bank_transactions where review_item_id=new\.id;/);
  assert.match(sql, /if v_transaction_id is null and v_identity is not null then/);
});

test("план не пишется в канонический слой как факт", async () => {
  const sql = await load();
  assert.match(sql, /v_status := case when new\.status='done' then 'done' when new\.status='cancelled' then 'cancelled' end;/);
  assert.doesNotMatch(sql, /case when new\.status='cancelled' then 'cancelled' else 'done' end/, "старая формула писала любой не-cancelled статус как done — план смешивался с фактом");
});

test("DELETE платежа возвращает approved review item в ready", async () => {
  const sql = await load();
  assert.match(sql, /create trigger release_bank_review_item_on_payment_delete\s*\nafter delete on public\.payments/);
});

test("Очистить импорт чистит и платежи-разбивки цепочки, не только bank-review:%", async () => {
  const sql = await load();
  assert.match(sql, /select coalesce\(array_agg\(payment_id\), '\{\}'\) into v_chain_payment_ids\s*\n\s*from public\.finance_payment_chain_entries where chain_id = any\(p_review_ids\);/);
  assert.match(sql, /delete from public\.payments where id = any\(p_payment_ids\) or id = any\(v_chain_payment_ids\);/);
});

test("operation_count/declared_* выписки не пишутся построчным триггером — только через register_finance_bank_statement", async () => {
  const sql = await load();
  const triggerFn = sql.split("create or replace function public.sync_bank_review_item_to_ledger")[1]!.split("create trigger sync_bank_review_item_to_ledger")[0]!;
  // Комментарий внутри функции объясняет, ПОЧЕМУ operation_count не пишется —
  // само слово там законно встречается; проверяем отсутствие присвоения/вставки значения.
  assert.doesNotMatch(triggerFn, /operation_count\s*[,=]/, "operation_count не должен заполняться из построчного триггера — только заявленные даты периода");
  assert.match(sql, /registered_at timestamptz/);
  assert.match(sql, /jsonb_array_length\(p_transactions\), now\(\)/, "operation_count в register_finance_bank_statement — по факту зарегистрированных транзакций, не по сырым строкам файла");
});

test("контроль переноса — покрытие с учётом дублей identity, не count(*) в лоб", async () => {
  const sql = await load();
  assert.doesNotMatch(sql, /select count\(\*\) into v_review_count from public\.bank_review_items;/, "сравнение count(*) с count(*) — тавтология и ломается на легитимном дубле по identity");
  assert.match(sql, /select count\(\*\) into v_uncovered_count from public\.bank_review_items r\s*\n\s*where not exists \(/);
});

test("контроль денег стоит ПОСЛЕ переноса allocations, а не сравнивает очередь с её копией", async () => {
  const sql = await load();
  const moneyControlIdx = sql.indexOf("Настоящий контроль денег");
  const allocationsInsertIdx = sql.indexOf("insert into public.finance_bank_allocations(");
  assert.ok(moneyControlIdx > allocationsInsertIdx, "контроль денег должен идти после вставки в finance_bank_allocations");
});

test("reconciliation: денежный знаменатель — только банковская сторона (ordinary/source), excluded-часть цепочки — partial, не mismatch", async () => {
  const sql = await load();
  assert.match(sql, /role in\('ordinary','source'\)/);
  assert.match(sql, /then 'partial'/);
  // excluded не должен быть в том же left join, что и sum(a.amount) — иначе
  // jsonb_array_elements размножает строки и удваивает сумму по цепочке.
  assert.doesNotMatch(sql, /left join lateral jsonb_array_elements/, "детект excluded должен быть отдельным exists(), не join'ом в основной агрегации");
  assert.match(sql, /exists\(\s*\n\s*select 1 from public\.finance_bank_allocations a2/);
});

test("миграцию можно применять во время активной работы панели: lock_timeout выставлен явно", async () => {
  const sql = await load();
  const lockIdx = sql.indexOf("set lock_timeout = '5s';");
  const firstTableIdx = sql.indexOf("create table");
  assert.ok(lockIdx >= 0, "lock_timeout должен быть выставлен явно — CREATE TRIGGER на payments/bank_review_items берёт ACCESS EXCLUSIVE на весь прогон");
  assert.ok(lockIdx < firstTableIdx, "lock_timeout должен стоять раньше первого DDL-оператора файла");
});
