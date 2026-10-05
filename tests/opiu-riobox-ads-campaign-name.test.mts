import assert from "node:assert/strict";
import test from "node:test";
import { OPIU_BRANDS } from "../lib/opiu/constants";
import { matchesVendorPrefix } from "../lib/opiu/adsSpendBySource";

const brand = (id: string) => OPIU_BRANDS.find((b) => b.id === id)!;

test("Riobox ad campaigns are matched by the brand word, not by the ESC article", () => {
  const riobox = brand("optima-riobox");
  assert.equal(
    matchesVendorPrefix("RIOBOX 1239272678 пенал черн. (рс ключи)", riobox.articlePrefixes, riobox.campaignKeywords),
    true,
  );
  assert.equal(
    matchesVendorPrefix("RIOBOX 1239272675 пенал роз ЕС", riobox.articlePrefixes, riobox.campaignKeywords),
    true,
  );
});

test("Riobox does not pick up Heaton, Norvia or other sellers' campaigns", () => {
  const riobox = brand("optima-riobox");
  for (const name of ["NORVIA (рс ключи)HT-80-11. 1244157225", "GIRL&DRAGON Платья полки", null]) {
    assert.equal(matchesVendorPrefix(name, riobox.articlePrefixes, riobox.campaignKeywords), false, String(name));
  }
});

test("Heaton and Norvia are still matched by article only", () => {
  const heaton = brand("optima-heaton");
  assert.equal(matchesVendorPrefix("NORVIA (рс ключи)HT-80-11. 1244157225", heaton.articlePrefixes, heaton.campaignKeywords), true);
  assert.equal(matchesVendorPrefix("RIOBOX 1239272678 пенал черн. (рс ключи)", heaton.articlePrefixes, heaton.campaignKeywords), false);
});
