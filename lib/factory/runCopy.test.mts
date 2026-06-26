import { equal, ok } from "node:assert/strict";
import { defaultFactoryCaption, defaultFactoryCtaButton, isPlaceholderNarrative, nodeLooksPlaceholder, normalizeContentMode } from "./runCopy";

equal(normalizeContentMode("sell"), "sell");
equal(normalizeContentMode("anything"), "audience");

equal(defaultFactoryCaption("sell", "HT-42-01"), "Ищи на WB: HT-42-01");
equal(defaultFactoryCaption("audience", "HT-42-01"), "Сохрани, чтобы не потерять");

equal(defaultFactoryCtaButton("sell", "HT-42-01"), "ищи на WB");
equal(defaultFactoryCtaButton("sell", ""), "подробнее");
equal(defaultFactoryCtaButton("audience", "HT-42-01"), null);

ok(isPlaceholderNarrative("Control clip"));
ok(isPlaceholderNarrative("placeholder"));
ok(!isPlaceholderNarrative("WB-куртка против бренда: что видно сразу"));
ok(nodeLooksPlaceholder({ prompt: "Control clip", params: { onscreen_text: "Control clip" } }));
ok(!nodeLooksPlaceholder({ prompt: "Control clip", params: { onscreen_text: "Сравнение куртки WB и бренда" } }));

console.log("runCopy: ok");
