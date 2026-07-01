// §17 Ф2 · контракт-тест извлечения плейбука из строки niche_playbooks. Запуск: npx tsx lib/factory/nichePlaybook.test.mts
// Регрессия reels-brain: в autofill в грундинг уходила строка БД {playbook, updated_at} вместо самого плейбука —
// winning_formats/anti_patterns молча пустели, а grounded.playbook ложно рапортовал true.
import { playbookFromRow } from "./nichePlaybook";

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) { if (cond) { pass++; } else { fail++; console.error("✗ " + msg); } }

// ── строка БД → возвращается ВНУТРЕННИЙ плейбук, а не обёртка ──
{
  const playbook = { winning_formats: [{ name: "unboxing", engagement: "high" }], anti_patterns: ["длинное интро"] };
  const row = { playbook, updated_at: "2026-07-01T00:00:00Z" };
  const pb = playbookFromRow(row);
  ok(pb === playbook, "из строки БД извлекается сам объект playbook");
  ok(Array.isArray(pb?.winning_formats) && (pb!.winning_formats as unknown[]).length === 1, "winning_formats видны грундингу");
  ok(pb !== null && !("updated_at" in pb), "обёртка БД (updated_at) не протекает в грундинг");
  // сама регрессия: у строки БД нет winning_formats — грундинг от неё пуст
  ok((row as Record<string, unknown>).winning_formats === undefined, "строка БД без извлечения не содержит winning_formats (суть бага)");
}
// ── нет строки / нет плейбука → null (grounded.playbook обязан быть false) ──
{
  ok(playbookFromRow(null) === null, "null-строка → null");
  ok(playbookFromRow(undefined) === null, "undefined-строка → null");
  ok(playbookFromRow({ updated_at: "2026-07-01" }) === null, "строка без поля playbook → null");
  ok(playbookFromRow({ playbook: null, updated_at: "x" }) === null, "playbook=null → null");
}
// ── битые данные в колонке → null, не мусор в промпт ──
{
  ok(playbookFromRow({ playbook: "{\"winning_formats\":[]}" }) === null, "playbook-строка (не распарсенный jsonb) → null");
  ok(playbookFromRow({ playbook: 42 }) === null, "playbook-число → null");
  ok(playbookFromRow({ playbook: [1, 2] }) === null, "playbook-массив → null");
}

console.log(`nichePlaybook: ${pass} ok, ${fail} fail`);
if (fail) process.exit(1);
