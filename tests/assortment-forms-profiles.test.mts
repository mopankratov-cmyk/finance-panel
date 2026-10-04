import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormsReportView } from "../components/assortment/FormsView.tsx";
import { BRAND_DEFAULTS } from "../lib/assortment/brandProfiles.ts";
import { buildFormsReport } from "../lib/assortment/forms.ts";

const models = [
  ...Array.from({ length: 4 }, (_, i) => ({ sourceId: "S1", sourceName: "A", title: `Bomber jacket ${i}` })),
  ...Array.from({ length: 3 }, (_, i) => ({ sourceId: "S1", sourceName: "A", title: `Biker jacket ${i}` })),
];
const report = buildFormsReport("jackets", models);
const html = (profiles: unknown[]) => renderToStaticMarkup(createElement(FormsReportView, { report, profiles: profiles as never }));
const norvia = { ...BRAND_DEFAULTS[0], fitForms: ["bomber"], avoidForms: ["biker"], status: "confirmed" as const };
const heaton = { ...BRAND_DEFAULTS[1], fitForms: ["biker"] };

test("Формы: решения профилей видны у форм — «подходит» и «не подходит»; черновик помечен", () => {
  const out = html([norvia, heaton]);
  assert.match(out, /NORVIA: подходит/);
  assert.match(out, /NORVIA: не подходит/);
  assert.match(out, /HEATON: подходит \(черновик\)/, "черновик профиля не выдаётся за решение");
  assert.doesNotMatch(out, /NORVIA: подходит \(черновик\)/, "подтверждённый — без пометки");
});

test("Формы: пустой профиль ничего не показывает — «не решено» не рисуется ни как «подходит», ни как «не подходит»", () => {
  const out = html([BRAND_DEFAULTS[0]]);
  assert.doesNotMatch(out, /NORVIA:/);
  assert.doesNotMatch(out, /подходит/);
  assert.doesNotMatch(html([]), /подходит/);
});
