import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

// Сторожевые тесты по тексту миграций: редактор Supabase ломает plpgsql рядом
// с `create table`, а русские литералы внутри функций доезжают до базы битыми.
// Проверяем не «что применилось», а «что файл устроен так, чтобы примениться».

const schema = readFileSync(new URL("../supabase/migrations/202609040002_warehouse_flow.sql", import.meta.url), "utf8");
const functions = readFileSync(new URL("../supabase/migrations/202609040003_warehouse_flow_functions.sql", import.meta.url), "utf8");

/** Без строчных комментариев: в них и проза, и упоминания запретных слов. */
const withoutComments = (sql: string) => sql.replace(/--[^\n]*/g, "");

/** Тела функций между именованными долларовыми кавычками `$name$ … $name$`. */
function functionBodies(sql: string): { name: string; body: string }[] {
  const bodies: { name: string; body: string }[] = [];
  const re = /\$([a-z_]+)\$([\s\S]*?)\$\1\$/g;
  for (let match = re.exec(sql); match; match = re.exec(sql)) bodies.push({ name: match[1], body: match[2] });
  return bodies;
}

test("схема и процедуры лежат в разных файлах", () => {
  assert.doesNotMatch(withoutComments(schema), /create\s+(or\s+replace\s+)?function/i, "в файле схемы не должно быть функций");
  assert.doesNotMatch(withoutComments(schema), /create\s+(or\s+replace\s+)?trigger/i, "в файле схемы не должно быть триггеров");
  assert.doesNotMatch(withoutComments(functions), /create\s+table/i, "в файле функций не должно быть create table");
  assert.doesNotMatch(withoutComments(functions), /alter\s+table/i, "в файле функций не должно быть alter table");
});

test("старая сигнатура post_writeoff снимается раньше, чем создаётся новая", () => {
  // Иначе вызов с пятью аргументами станет неоднозначным между старой и новой
  // с умолчанием, и списание брака перестанет работать вовсе.
  const drop = functions.indexOf("drop function if exists public.post_writeoff(uuid, uuid, jsonb, text, text);");
  const create = functions.indexOf("create or replace function public.post_writeoff(");
  assert.ok(drop >= 0, "старая сигнатура post_writeoff не дропается");
  assert.ok(create >= 0, "новая post_writeoff не создаётся");
  assert.ok(drop < create, "drop должен идти до create");
  assert.match(functions, /p_occurred_at timestamptz default null/, "новая сигнатура без даты");
  assert.match(functions, /coalesce\(p_occurred_at, now\(\)\)/, "дата не подставляется в движение");
});

test("внутри функций нет кириллицы — русские литералы бьют кодировку", () => {
  const bodies = functionBodies(functions);
  assert.deepEqual(
    bodies.map((item) => item.name).sort(),
    ["correct_receipt_batch", "post_shipment_task", "post_writeoff", "warehouse_events_append_only"],
    "не все четыре функции найдены по долларовым кавычкам",
  );
  for (const { name, body } of bodies) {
    // Комментарии `--` внутри тела не становятся ни строкой, ни сообщением —
    // для кодировки они безопасны, как и в уже выложенных функциях регистра.
    // Проверяем код и литералы.
    const code = withoutComments(body);
    assert.doesNotMatch(code, /[Ѐ-ӿ]/, `${name}: кириллица в теле функции`);
  }
  // Каждая функция открывается и закрывается своим именованным тегом.
  assert.doesNotMatch(functions, /as \$\$/, "безымянные долларовые кавычки");
});

test("products_view пересоздаётся с явным перечнем колонок, включая модель, цвет, imtID и новинку", () => {
  assert.match(schema, /drop view if exists public\.products_view;/);
  const start = schema.indexOf("create view public.products_view as");
  assert.ok(start >= 0, "products_view не пересоздаётся");
  const view = schema.slice(start, schema.indexOf(";", start));
  assert.doesNotMatch(view, /select\s+\*|p\.\*/, "представление обязано перечислять колонки явно");
  for (const column of ["p.model", "p.color", "p.imt_id", "p.is_novelty", "p.article", "p.factory_price", "volume_liters"]) {
    assert.ok(view.includes(column), `products_view без колонки ${column}`);
  }
  assert.match(schema, /add column if not exists model text/);
  assert.match(schema, /add column if not exists color text/);
  assert.match(schema, /add column if not exists imt_id bigint/);
  assert.match(schema, /add column if not exists is_novelty boolean not null default false/);
});

test("stock_docs получает статус cancelled и вид adjustment", () => {
  assert.match(schema, /drop constraint if exists stock_docs_status_check/);
  assert.match(schema, /check \(status in \('draft', 'posted', 'reversed', 'cancelled'\)\)/);
  assert.match(schema, /drop constraint if exists stock_docs_kind_check/);
  assert.match(schema, /check \(kind in \('shipment', 'transfer', 'writeoff', 'return', 'receipt', 'adjustment'\)\)/);
  assert.match(schema, /add column if not exists confirmed_at timestamptz/);
  assert.match(schema, /add column if not exists confirmed_by text/);
});

test("ручного ввода времени нет: у событий нет колонки minutes, у документа нет destination", () => {
  // Решения владельца 04.09: ФФ время не засекает, склады назначения не ведём.
  // Конец блока — `);` в начале строки: внутри комментариев тоже бывают скобки.
  const events = schema.match(/create table if not exists public\.warehouse_events \([\s\S]*?\n\);/)?.[0] ?? "";
  assert.ok(events, "warehouse_events не создаётся");
  assert.doesNotMatch(withoutComments(events), /\b(minutes|duration)\b/i, "у событий появился ввод времени");
  const code = withoutComments(schema);
  assert.doesNotMatch(code, /\bminutes\b/i, "колонка minutes где-то в схеме");
  assert.doesNotMatch(code, /\bdestination\b/i, "у документа появился склад назначения");
  // Тайминг считается из отметок — они обязаны быть.
  assert.match(events, /occurred_at\s+timestamptz not null default now\(\)/);
  assert.match(schema, /counted_at\s+timestamptz/, "у партии нет отметки пересчёта");
});

test("новые таблицы закрыты от anon/authenticated и задание хранит строки со ссылкой на документ", () => {
  for (const table of ["stock_receipt_batches", "stock_doc_lines", "warehouse_events"]) {
    assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`), `${table}: RLS не включён`);
    assert.match(schema, new RegExp(`revoke all on public\\.${table} from anon, authenticated`), `${table}: доступ не отозван`);
  }
  assert.match(schema, /doc_id\s+uuid not null references public\.stock_docs\(id\) on delete cascade/);
  assert.match(schema, /create unique index if not exists stock_doc_lines_doc_variant_unique/);
  assert.match(schema, /qty\s+integer not null check \(qty > 0\)/);
});

test("лента событий только для вставки: триггер на update и delete", () => {
  assert.match(functions, /create trigger warehouse_events_append_only_trigger/);
  assert.match(functions, /before update or delete on public\.warehouse_events/);
  assert.match(functions, /raise exception 'warehouse_events is append-only'/);
});

test("коррекция прихода пишет дельты в регистр, а не правит остаток", () => {
  const body = functionBodies(functions).find((item) => item.name === "correct_receipt_batch")?.body ?? "";
  assert.match(body, /'adjustment', 'receipt_correction'/, "принятое не пишется движением adjustment");
  assert.match(body, /'writeoff', 'receipt_correction', v_doc_id::text, 'defect_on_receipt'/, "брак не пишется движением writeoff");
  assert.match(body, /raise exception 'reason required'/);
  assert.match(body, /raise exception 'defect exceeds received'/);
  assert.match(body, /raise exception 'not enough stock for % : have %, need %'/);
  assert.doesNotMatch(body, /update public\.stock_moves/, "регистр append-only — движения не правятся");
  assert.match(body, /update public\.stock_batches/, "итог партии обязан сойтись с регистром");
});

test("подтверждение задания проводит отгрузку тем же документом", () => {
  const body = functionBodies(functions).find((item) => item.name === "post_shipment_task")?.body ?? "";
  assert.match(body, /raise exception 'task is not a draft'/);
  assert.match(body, /raise exception 'nothing to ship'/);
  assert.match(body, /public\.post_shipment\(v_doc\.legal_entity_id, v_doc\.warehouse_id, v_lines, v_doc\.note, p_actor\)/);
  assert.match(body, /set status = 'posted'/);
  assert.match(body, /movement_doc_id = v_shipment_id/);
  assert.match(body, /confirmed_by = p_actor/);
  assert.match(body, /'docId', p_doc_id, 'number', v_doc\.number/);
});

test("доступ к новым функциям — только service_role", () => {
  for (const signature of [
    "correct_receipt_batch(uuid, jsonb, text, text)",
    "post_shipment_task(uuid, text, jsonb)",
    "post_writeoff(uuid, uuid, jsonb, text, text, timestamptz)",
  ]) {
    const escaped = signature.replace(/[()]/g, (char) => `\\${char}`);
    assert.match(functions, new RegExp(`revoke all on function public\\.${escaped} from public`), `${signature}: не отозван доступ`);
    assert.match(functions, new RegExp(`grant execute on function public\\.${escaped} to service_role`), `${signature}: нет grant`);
  }
});
