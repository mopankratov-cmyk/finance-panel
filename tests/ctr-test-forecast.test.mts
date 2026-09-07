import assert from "node:assert/strict";
import test from "node:test";
import { ctrTestForecast } from "../lib/ctrtest/model.ts";

// Умолчания мастера CTR-тестов раньше стояли на 1000 показов на вариант.
// При среднем CTR кабинета около 4,3% это даёт ~43 клика, и доверительный
// интервал получается шире той разницы, ради которой тест затевают: отличить
// обложку, которая лучше на четверть, от той, что хуже, нельзя в принципе.
// Строка-оценка под полями существует, чтобы это было видно ДО запуска.
//
// Порог считается формулой для двух долей: n ≈ 16·p(1−p)/Δ².

test("на тысяче показов вывод честно назван случайным", () => {
  const weak = ctrTestForecast({ targetImpressions: 1000, variantCount: 2, ctrPercent: 4.3, viewsInWindow: null, windowDays: 7 });
  assert.ok(weak.detectableShare && weak.detectableShare > 0.5, "порог должен быть выше 50% относительной разницы");
  assert.match(weak.text, /почти любой итог будет случайным/);
  assert.match(weak.text, /поднимите/, "текст обязан говорить, что делать");
});

test("пять тысяч показов дают рабочий уровень", () => {
  const ok = ctrTestForecast({ targetImpressions: 5000, variantCount: 2, ctrPercent: 4.3, viewsInWindow: null, windowDays: 7 });
  assert.ok(ok.detectableShare && ok.detectableShare > 0.2 && ok.detectableShare < 0.32, `ожидали порог около 27%, получили ${ok.detectableShare}`);
  assert.match(ok.text, /обычный рабочий уровень/);
});

test("срок считается по трафику самого товара", () => {
  // 13 200 показов в сутки — медиана по кабинету; два варианта по 5000.
  const fast = ctrTestForecast({ targetImpressions: 5000, variantCount: 2, ctrPercent: 4.3, viewsInWindow: 13_200 * 7, windowDays: 7 });
  assert.ok(fast.days && fast.days > 0.6 && fast.days < 0.9, `ожидали меньше суток, получили ${fast.days}`);
  assert.match(fast.text, /около \d+ ч/);

  // Больше вариантов — дольше тест, и это должно быть видно.
  const slower = ctrTestForecast({ targetImpressions: 5000, variantCount: 4, ctrPercent: 4.3, viewsInWindow: 13_200 * 7, windowDays: 7 });
  assert.ok(slower.days! > fast.days!, "четыре варианта не могут пройти быстрее двух");
});

test("без трафика срок не выдумывается", () => {
  const unknown = ctrTestForecast({ targetImpressions: 5000, variantCount: 2, ctrPercent: null, viewsInWindow: null, windowDays: 7 });
  assert.equal(unknown.days, null);
  assert.match(unknown.text, /срок зависит от того, сколько реклама даст показов/);
});
