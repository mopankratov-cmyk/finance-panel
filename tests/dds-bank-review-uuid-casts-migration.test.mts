import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL("../supabase/migrations/202609230002_dds_bank_review_uuid_casts.sql", import.meta.url);

test("bank review confirmation compares legacy text ids with payment UUIDs safely", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /account_id::text,company_id::text/);
  assert.match(sql, /a\.id::text=r\.account_id/);
  assert.match(sql, /c\.id::text=r\.company_id/);
  assert.doesNotMatch(sql, /row\(amount,account_id,company_id,date,category,status\)/);
});

test("validated legacy ids are explicitly cast when a payment is inserted", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /r\.category,r\.account_id::uuid,r\.company_id::uuid/);
  assert.match(sql, /компания или кошелёк не найдены в справочнике/);
});
