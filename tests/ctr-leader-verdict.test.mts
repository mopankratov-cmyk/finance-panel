import assert from "node:assert/strict";
import test from "node:test";
import { ctrLeaderVerdict } from "../lib/ctrtest/model.ts";

// Чужие сервисы советуют «наберите 10 000 показов». Совет неверен по существу:
// нужный объём зависит от того, насколько варианты разошлись. Панель считает
// не «сколько набрать», а «различима ли уже полученная разница».

test("явный отрыв признаётся надёжным даже на скромной выборке", () => {
  // 4% против 2% — разница вдвое, на тысяче показов она уже вне погрешности.
  const v = ctrLeaderVerdict([
    { label: "B", impressions: 1000, clicks: 40 },
    { label: "A", impressions: 1000, clicks: 20 },
  ]);
  assert.ok(v?.decisive, "двукратный отрыв на тысяче показов обязан считаться надёжным");
  assert.match(v!.text, /можно решать/);
  assert.equal(v!.leaderLabel, "B");
});

test("мелкая разница на большой выборке решением не считается", () => {
  // 4,0% против 3,9% — отрыв 2,5%, на десяти тысячах он тонет в погрешности.
  const v = ctrLeaderVerdict([
    { label: "A", impressions: 10_000, clicks: 400 },
    { label: "B", impressions: 10_000, clicks: 390 },
  ]);
  assert.ok(v && !v.decisive, "2,5% отрыва на 10 000 показов — это шум, а не победа");
  assert.match(v!.text, /Решать рано/);
});

test("надёжность считается по слабой стороне сравнения", () => {
  // У лидера объём большой, у второго — крошечный. Сравнение не может быть
  // надёжнее того из двух, кто набрал меньше.
  const v = ctrLeaderVerdict([
    { label: "A", impressions: 50_000, clicks: 2000 },
    { label: "B", impressions: 200, clicks: 6 },
  ]);
  assert.equal(v?.sample, 200, "берём меньший объём из двух");
});

test("сравнивать нечего — молчим, а не выдумываем", () => {
  assert.equal(ctrLeaderVerdict([{ label: "A", impressions: 5000, clicks: 200 }]), null);
  assert.equal(ctrLeaderVerdict([
    { label: "A", impressions: 10, clicks: 1 },
    { label: "B", impressions: 12, clicks: 2 },
  ]), null, "ниже порога достоверности вывода нет");
});
