import { evaluateHookPolicy } from "./hookPolicy";

function ok(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const strong = evaluateHookPolicy({ text: "Не покупай SPF, пока не увидишь тест через 8 часов", source: "strong_prompt", locked: true });
ok(strong.ok, "specific tension hook passes");
ok(strong.locked, "hook is locked");
ok(strong.source === "strong_prompt", "hook source is preserved");

const weak = evaluateHookPolicy({ text: "Привет, сегодня расскажу про лучший товар", source: "generated", locked: false });
ok(!weak.ok, "generic unlocked hook is rejected");
ok(weak.issues.includes("hook_not_locked"), "unlocked hook is a policy issue");

console.log("hookPolicy: passed");
