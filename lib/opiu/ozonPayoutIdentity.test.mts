import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyOzonReceipt,
  getOzonPayoutMapping,
  ozonCabinetDisplayName,
  OZON_PAYER_INN,
} from "./ozonPayoutIdentity";

const cosmos = getOzonPayoutMapping("9142319b-34b7-4521-b80f-a2b303adbc17")!;
const kucherenko = getOzonPayoutMapping("4ab2ed44-9a0a-4397-ab56-f613760f5616")!;
const payment = {
  status: "done",
  amount: 100,
  category: "Продажи на МП",
  accountId: kucherenko.receivingAccountId,
  companyId: kucherenko.companyId,
  rawText: "",
};

test("owner-confirmed cabinet mappings are exact", () => {
  assert.deepEqual(
    [cosmos.companyId, cosmos.receivingAccountId, cosmos.accountKind],
    ["f44db400-1374-42d8-9c71-78aed8978f95", "58819f26-bf1c-4fc8-9b4f-c608b0f70a4c", "dedicated_ozon"],
  );
  assert.deepEqual(
    [kucherenko.companyId, kucherenko.receivingAccountId, kucherenko.accountKind],
    ["9f697ea3-e444-465f-a544-9e90cdfd0330", "bc726415-0e05-442d-ab6d-7755f6505f2a", "shared"],
  );
});

test("Ozon cabinet technical identifiers are replaced with shop names", () => {
  assert.equal(ozonCabinetDisplayName("9142319b-34b7-4521-b80f-a2b303adbc17", "Ozon COSMOS"), "Cosmos Shop");
  assert.equal(ozonCabinetDisplayName("4ab2ed44-9a0a-4397-ab56-f613760f5616", "Ozon 1933484"), "Clerin");
  assert.equal(ozonCabinetDisplayName("new-shop", "Ozon New Shop"), "New Shop");
});

test("dedicated COSMOS account confirms marketplace income without name matching", () => {
  assert.equal(classifyOzonReceipt({
    ...payment,
    accountId: cosmos.receivingAccountId,
    companyId: null,
    rawText: "без названия маркетплейса",
  }, cosmos).kind, "confirmed");
});

test("shared Kucherенко account requires exact Ozon payer INN", () => {
  assert.equal(classifyOzonReceipt({
    ...payment,
    rawText: `ООО Интернет Решения ИНН ${OZON_PAYER_INN}`,
  }, kucherenko).kind, "confirmed");
  for (const rawText of ["Ozon", "Озон", "ООО Интернет Решения", `x${OZON_PAYER_INN}7`]) {
    assert.equal(
      classifyOzonReceipt({ ...payment, rawText }, kucherenko).kind,
      "unresolved",
    );
  }
});

test("wrong account, category or status never confirms money", () => {
  for (const patch of [
    { accountId: "wrong" },
    { category: "Прочее" },
    { status: "planned" },
    { amount: 0 },
  ]) {
    assert.equal(
      classifyOzonReceipt({
        ...payment,
        rawText: OZON_PAYER_INN,
        ...patch,
      }, kucherenko).kind,
      "ignored",
    );
  }
});

test("conflicting persisted company fails closed and another marketplace is ignored", () => {
  assert.equal(classifyOzonReceipt({
    ...payment,
    companyId: cosmos.companyId,
    rawText: OZON_PAYER_INN,
  }, kucherenko).kind, "unresolved");
  assert.equal(classifyOzonReceipt({
    ...payment,
    rawText: "Перечисление Wildberries",
  }, kucherenko).kind, "ignored");
});
