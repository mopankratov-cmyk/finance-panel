import assert from "node:assert/strict";
import test from "node:test";
import { allocateCampaignSpend } from "./advertSpendAllocation.ts";

const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;

test("полная разбивка WB не трогается", () => {
  const rows = [{ spent: 300, views: 100, clicks: 5 }, { spent: 200, views: 50, clicks: 3 }];
  assert.deepEqual(allocateCampaignSpend(rows, 500), [0, 0]);
});

test("нераспределённый остаток делится по показам и сходится с расходом кампании", () => {
  // Кампания 38617401, 22.08: 569,74 ₽ и ноль по артикулу в разбивке.
  const rows = [
    { spent: 0, views: 700, clicks: 10 },
    { spent: 0, views: 300, clicks: 2 },
  ];
  const shares = allocateCampaignSpend(rows, 569.74);
  assert.equal(sum(shares), 569.74);
  assert.equal(shares[0], 398.82);
  assert.equal(shares[1], 170.92);
});

test("остаток достаётся тем, чей расход WB не посчитал", () => {
  // У первой строки расход измерен — досыпать ей значило бы завысить факт,
  // хотя показов у неё вчетверо больше.
  const rows = [{ spent: 400, views: 800, clicks: 20 }, { spent: 0, views: 200, clicks: 4 }];
  const shares = allocateCampaignSpend(rows, 500);
  assert.deepEqual(shares, [0, 100]);
});

test("если нулевых строк нет, остаток делится по всем пропорционально показам", () => {
  // WB занизил всем сразу — тогда «нетронутых» артикулов не существует.
  const rows = [{ spent: 40, views: 800, clicks: 20 }, { spent: 10, views: 200, clicks: 4 }];
  const shares = allocateCampaignSpend(rows, 150);
  assert.equal(sum(shares), 100);
  assert.equal(shares[0], 80);
  assert.equal(shares[1], 20);
});

test("без показов база — клики", () => {
  const rows = [{ spent: 0, views: 0, clicks: 3 }, { spent: 0, views: 0, clicks: 1 }];
  const shares = allocateCampaignSpend(rows, 100);
  assert.deepEqual(shares, [75, 25]);
});

test("без показов и кликов остаток делится поровну", () => {
  const rows = [{ spent: 0, views: 0, clicks: 0 }, { spent: 0, views: 0, clicks: 0 }];
  assert.deepEqual(allocateCampaignSpend(rows, 50), [25, 25]);
});

test("расход по артикулам больше расхода кампании не рождает отрицательных долей", () => {
  const rows = [{ spent: 600, views: 100, clicks: 5 }];
  assert.deepEqual(allocateCampaignSpend(rows, 500), [0]);
});

test("копеечный зазор округления не считается потерей", () => {
  const rows = [{ spent: 499.995, views: 100, clicks: 5 }];
  assert.deepEqual(allocateCampaignSpend(rows, 500), [0]);
});

test("нулевой и отрицательный расход кампании ничего не раскладывают", () => {
  const rows = [{ spent: 0, views: 100, clicks: 5 }];
  assert.deepEqual(allocateCampaignSpend(rows, 0), [0]);
  assert.deepEqual(allocateCampaignSpend(rows, -10), [0]);
});

test("сумма долей сходится до копейки на неделящихся числах", () => {
  const rows = [
    { spent: 0, views: 1, clicks: 0 },
    { spent: 0, views: 1, clicks: 0 },
    { spent: 0, views: 1, clicks: 0 },
  ];
  const shares = allocateCampaignSpend(rows, 100);
  assert.equal(sum(shares), 100);
});

test("пустая кампания не ломается", () => {
  assert.deepEqual(allocateCampaignSpend([], 100), []);
});
