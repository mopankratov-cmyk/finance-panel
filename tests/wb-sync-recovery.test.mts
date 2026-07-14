import assert from "node:assert/strict";
import test from "node:test";

import {
  historyPeriod,
  historyFirstActiveDate,
  historyReportPayload,
  initialStatisticsCursor,
  isUnavailableHistoryReportError,
  parseHistoryCsv,
  statisticsCursor,
  unzipCsvFiles,
} from "../lib/wb/syncRecovery";

function storedZip(fileName: string, content: string): Buffer {
  const name = Buffer.from(fileName);
  const data = Buffer.from(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);

  const centralOffset = local.length + name.length + data.length;
  const centralSize = central.length + name.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

test("statistics cursor advances by lastChangeDate, not business event date", () => {
  const cursor = statisticsCursor([
    { date: "2026-07-12T20:00:00", lastChangeDate: "2026-07-13T01:02:03" },
    { date: "2026-01-01T00:00:00", lastChangeDate: "2026-07-13T01:05:00" },
  ], "2026-04-01T00:00:00");
  assert.equal(cursor, "2026-07-13T01:05:00");
  assert.equal(initialStatisticsCursor(new Date("2026-07-13T00:00:00Z")), "2026-07-12T22:00:00");
});

test("history report requests exactly 365 days and exact scoped nmIDs", () => {
  const period = historyPeriod(new Date("2026-07-13T12:00:00Z"));
  assert.deepEqual(period, { start: "2025-07-13", end: "2026-07-12" });
  assert.deepEqual(historyPeriod(new Date("2026-07-12T22:30:00Z")), period);
  const payload = historyReportPayload("00000000-0000-4000-8000-000000000001", "cabinet-123", [11, 22], period);
  assert.deepEqual((payload.params as Record<string, unknown>).nmIDs, [11, 22]);
  assert.equal((payload.params as Record<string, unknown>).aggregationLevel, "day");
});

test("history report unavailable 403 is classified as a non-fatal cabinet skip", () => {
  const body = '{"title":"Authorization error","detail":"Report not available","origin":"analytics-open-api"}';
  assert.equal(isUnavailableHistoryReportError(403, body), true);
  assert.equal(isUnavailableHistoryReportError(401, body), false);
  assert.equal(isUnavailableHistoryReportError(403, '{"title":"Authorization error","detail":"bad token"}'), false);
});

test("history bootstrap starts detail sync from first relevant sale", () => {
  assert.equal(historyFirstActiveDate([
    { nm_id: 1, date: "2026-07-10", open_card: 2, add_to_cart: 1, orders: 0, orders_sum: 0, buyouts: 0, buyout_sum: 0 },
    { nm_id: 1, date: "2026-07-12", open_card: 2, add_to_cart: 1, orders: 1, orders_sum: 500, buyouts: 0, buyout_sum: 0 },
    { nm_id: 2, date: "2026-07-11", open_card: 2, add_to_cart: 1, orders: 0, orders_sum: 0, buyouts: 1, buyout_sum: 400 },
  ]), "2026-07-11");
});

test("unzips and parses the documented WB DETAIL_HISTORY_REPORT columns", () => {
  const csv = [
    "nmID,dt,openCardCount,addToCartCount,ordersCount,ordersSumRub,buyoutsCount,buyoutsSumRub,cancelCount,cancelSumRub,addToCartConversion,cartToOrderConversion,buyoutPercent,addToWishlist,currency",
    "1244157227,2026-07-12,10,5,3,1500.5,2,900,1,300,50,60,66.7,4,RUB",
  ].join("\n");
  const zip = storedZip("history.csv", csv);
  const input = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
  const files = unzipCsvFiles(input);
  assert.equal(files.length, 1);
  assert.deepEqual(parseHistoryCsv(files[0]), [{
    nm_id: 1244157227,
    date: "2026-07-12",
    open_card: 10,
    add_to_cart: 5,
    orders: 3,
    orders_sum: 1500.5,
    buyouts: 2,
    buyout_sum: 900,
  }]);
});
