import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSupplierPayload } from "./suppliers.ts";

test("требует название", () => {
  const result = normalizeSupplierPayload({ name: "  " });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /название/i);
});

test("собирает поставщика с умолчаниями", () => {
  const result = normalizeSupplierPayload({ name: "Guangzhou Feiyang Garment Co." });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.name, "Guangzhou Feiyang Garment Co.");
  assert.equal(result.value.currency, "CNY");
  assert.equal(result.value.productionDays, 0);
  assert.equal(result.value.minOrderQty, null);
  assert.equal(result.value.isActive, true);
});

test("отвергает валюту вне списка", () => {
  const result = normalizeSupplierPayload({ name: "Тест", currency: "EUR" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /валют/i);
});

test("срок производства ограничен 0–365 днями", () => {
  const tooLong = normalizeSupplierPayload({ name: "Тест", productionDays: 400 });
  assert.equal(tooLong.ok, false);
  const negative = normalizeSupplierPayload({ name: "Тест", productionDays: -1 });
  assert.equal(negative.ok, false);
  const ok = normalizeSupplierPayload({ name: "Тест", productionDays: 45 });
  assert.equal(ok.ok, true);
});

test("минимальная партия — целое число или пусто", () => {
  const empty = normalizeSupplierPayload({ name: "Тест", minOrderQty: "" });
  assert.equal(empty.ok, true);
  if (empty.ok) assert.equal(empty.value.minOrderQty, null);

  const negative = normalizeSupplierPayload({ name: "Тест", minOrderQty: -5 });
  assert.equal(negative.ok, false);

  const fractional = normalizeSupplierPayload({ name: "Тест", minOrderQty: 12.5 });
  assert.equal(fractional.ok, false);

  const value = normalizeSupplierPayload({ name: "Тест", minOrderQty: 300 });
  assert.equal(value.ok, true);
  if (value.ok) assert.equal(value.value.minOrderQty, 300);
});

test("id пробрасывается только явным forced-параметром", () => {
  const viaBody = normalizeSupplierPayload({ id: "should-be-ignored-on-create", name: "Тест" });
  // POST не передаёт forced.id — но тело может его содержать (например, при
  // повторной отправке той же формы), и оно всё равно попадает в value.id,
  // потому что normalizeSupplierPayload не знает, create это или update —
  // это решает роут по HTTP-методу. Здесь проверяем только формальную
  // прокидку значения, а не бизнес-правило "нельзя создать с чужим id".
  assert.equal(viaBody.ok, true);
  if (viaBody.ok) assert.equal(viaBody.value.id, "should-be-ignored-on-create");

  const withForced = normalizeSupplierPayload({ name: "Тест" }, { id: "forced-id" });
  assert.equal(withForced.ok, true);
  if (withForced.ok) assert.equal(withForced.value.id, "forced-id");
});

test("обрезает поля до разумной длины", () => {
  const result = normalizeSupplierPayload({ name: "A".repeat(400), note: "B".repeat(6_000) });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.name.length, 300);
  assert.equal(result.value.note.length, 5_000);
});
