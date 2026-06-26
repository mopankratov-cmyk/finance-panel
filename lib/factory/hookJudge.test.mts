import { judgeHooks } from "./hookJudge";

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) { if (cond) pass += 1; else { fail += 1; console.error("FAIL", msg); } }
function eq(a: unknown, b: unknown, msg: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`); }

{
  const r = judgeHooks({
    hooks: [
      "привет сегодня расскажу про крем",
      "SPF 50 через 8 часов: кожа правда защищена?",
      "купите лучший крем на WB",
    ],
    corpus: [{ hook_text: "SPF 50 через 8 часов тест на коже", viability_score: 5 }],
  });
  ok(r.ok, "judge accepts hook arrays");
  eq(r.winner?.hook, "SPF 50 через 8 часов: кожа правда защищена?", "specific test hook wins");
  ok((r.winner?.score || 0) >= 7, "winner is strong enough");
  ok(r.ranked[2].hook.includes("купите") || r.ranked[2].hook.includes("привет"), "generic/commercial hooks fall down");
}

{
  const r = judgeHooks({ candidates: [{ id: "a", hook: "Почему эта сумка держит форму после перелёта?" }, { id: "b", hook_text: "Сумка хорошая" }] });
  eq(r.ranked[0].id, "a", "object candidates keep ids and rank by quality");
}

{
  const r = judgeHooks({});
  ok(!r.ok && /нужны hooks/.test(String(r.error)), "missing hooks fail with JSON error");
}

console.log(`hookJudge: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
