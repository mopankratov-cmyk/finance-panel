import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", msg);
  }
}

const doc = readFileSync("docs/factory-50-run-improvement-loop.md", "utf8");

ok(/Runbook: когда идти генерить видосы/.test(doc), "runbook states when production generation starts");
ok(/следующая пятёрка/.test(doc), "runbook uses the Studio next-five action");
ok(/auto-preflight \/ dry-run/.test(doc), "runbook requires auto-preflight dry run");
ok(/готово к полной пятёрке/.test(doc), "runbook names the full-batch readiness signal");
ok(/draft 5\/5/.test(doc), "runbook requires five draft recipes");
ok(/budget fit 5/.test(doc), "runbook requires budget fit for five runs");
ok(/selected_recipes/.test(doc), "runbook requires selected recipe visibility");
ok(/batch_run_id/.test(doc), "runbook requires traceable batch id");
ok(/не запускать неполную пятёрку/.test(doc), "runbook blocks partial next-five launches");
ok(/Проверить прогресс batch/.test(doc), "runbook includes batch progress verification");
ok(/views/.test(doc) && /winner/.test(doc) && /reject/.test(doc), "runbook closes the market feedback loop");
ok(/10 батчей по 5/.test(doc), "runbook defines the 50-run operating cadence");

if (failed) process.exit(1);
console.log(`seriesRunbookContract: ${passed} passed, ${failed} failed`);
