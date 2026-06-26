import { draftPromptFromTemplateNode } from "./recipeDraft";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", msg);
  }
}

const preset = draftPromptFromTemplateNode({ prompt: "exact winner prompt" }, "SKU-1", "Product");
ok(preset === "exact winner prompt", "winner presets keep their production prompt");

const draft = draftPromptFromTemplateNode({
  role: "problem",
  visual_desc: "модель показывает, что сумка не закрывается",
  voiceover: "эта сумка бесит меня каждый день",
}, "BAG-42", "Сумка");

ok(/Черновик сцены problem под Сумка \/ BAG-42/.test(draft), "decompose transfer creates a product-scoped draft skeleton");
ok(/Референс смысла конкурента/.test(draft), "draft keeps competitor meaning as reference only");
ok(/не копировать дословно/.test(draft), "draft explicitly forbids literal cloning");
ok(!draft.startsWith("эта сумка бесит"), "draft does not use competitor voiceover as the whole prompt");

if (failed) process.exit(1);
console.log(`recipeDraft: ${passed} passed, ${failed} failed`);
