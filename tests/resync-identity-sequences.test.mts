import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * 202609150003 синхронизировала serial/bigserial sequence после переезда
 * базы 15.09, но фильтровала deptype = 'a' — это пропускает
 * `generated always as identity` колонки (deptype = 'i'), которых в схеме
 * большинство. Регрессия дала duplicate-key на ctr_variants 16.09.
 */

test("резинк identity-колонок ловит оба типа зависимости sequence, не только serial", () => {
  const migration = read("../supabase/migrations/202609160001_resync_identity_sequences.sql");
  assert.match(migration, /dep\.deptype IN \('a', 'i'\)/);
});

test("старая миграция всё ещё фильтрует только deptype = 'a' — задокументированная причина регрессии", () => {
  const migration = read("../supabase/migrations/202609150003_resync_sequences_after_db_migration.sql");
  assert.match(migration, /dep\.deptype = 'a'/);
});
