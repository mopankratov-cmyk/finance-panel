import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ensureCtrTestCampaignBinding, findCompetingShelfCampaigns, listCtrCampaignCandidates, resolveCtrSearchCampaign } from "../lib/ctrtest/campaignBinding.ts";
import { normalizeCtrCreatePayload } from "../lib/ctrtest/model.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Владелец 16.09.2026: помимо чистого поиска (Фаза A) он всегда тестировал и
 * на единой ставке (ЕРК) — показы 50/50 в поиске и на полках, агрегированный
 * CTR честнее, потому что на полках CTR всегда выше, чем в поиске с
 * ВЧ-ключом. Плюс ручной выбор конкретной кампании вместо только автоматики.
 */

function fakeDb(tables: Record<string, unknown[]>) {
  const calls: { table: string; op: string; payload?: unknown }[] = [];
  const builder = (table: string) => {
    let rows = [...(tables[table] ?? [])] as Record<string, unknown>[];
    const api = {
      select: () => api,
      eq: (field: string, value: unknown) => { rows = rows.filter((row) => row[field] === value); return api; },
      gte: () => api,
      contains: (field: string, values: unknown[]) => { rows = rows.filter((row) => Array.isArray(row[field]) && values.every((v) => (row[field] as unknown[]).includes(v))); return api; },
      in: (field: string, values: unknown[]) => { rows = rows.filter((row) => (values as unknown[]).includes(row[field])); return api; },
      is: (field: string, value: unknown) => { rows = rows.filter((row) => row[field] === value); return api; },
      order: () => api,
      update: (payload: unknown) => { calls.push({ table, op: "update", payload }); return { eq: () => Promise.resolve({ error: null }) }; },
      upsert: (payload: unknown) => { calls.push({ table, op: "upsert", payload }); return Promise.resolve({ error: null }); },
      insert: (payload: unknown) => { calls.push({ table, op: "insert", payload }); return Promise.resolve({ error: null }); },
      then: (resolve: (value: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
    };
    return api;
  };
  return { from: (table: string) => builder(table), calls };
}

test("режим unified резолвит ЕРК, а не поисковый/полочный блок", async () => {
  const db = fakeDb({
    wb_advert_nm_campaign_daily: [
      { cabinet_id: "cabinet", nm_id: 1, advert_id: 1, spent: 500 },
      { cabinet_id: "cabinet", nm_id: 1, advert_id: 3, spent: 500 },
    ],
    wb_adverts: [
      { advert_id: 1, name: "Поиск", bid_type: "manual", payment_type: "cpc", placement_search: true, placement_shelf: false },
      { advert_id: 3, name: "ЕРК", bid_type: "unified", payment_type: null, placement_search: null, placement_shelf: null },
    ],
  });
  const resolution = await resolveCtrSearchCampaign(db as never, "cabinet", 1, "unified");
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.advertId, 3);
});

test("режим search_only по умолчанию не меняется — тот же результат, что и раньше", async () => {
  const db = fakeDb({
    wb_advert_nm_campaign_daily: [{ cabinet_id: "cabinet", nm_id: 1, advert_id: 1, spent: 500 }],
    wb_adverts: [{ advert_id: 1, name: "Поиск", bid_type: "manual", payment_type: "cpc", placement_search: true, placement_shelf: false }],
  });
  const resolution = await resolveCtrSearchCampaign(db as never, "cabinet", 1);
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.advertId, 1);
});

test("вторая живая ЕРК-кампания на артикуле теперь тоже видна детектору конфликтов (раньше erk не входил в SHELF_BLOCKS)", async () => {
  const db = fakeDb({
    wb_adverts: [
      { advert_id: 2, cabinet_id: "cabinet", nm_ids: [1], name: "Чужая ЕРК", bid_type: "unified", payment_type: null, placement_search: null, placement_shelf: null, status: 9 },
    ],
  });
  const candidates = await findCompetingShelfCampaigns(db as never, "cabinet", 1, /* привязанная кампания */ 1);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].advertId, 2);
});

test("привязка не перезаписывает уже установленный advert_id (ручной выбор в мастере) даже без override", async () => {
  // Если бы функция резолвила заново, она бы нашла кампанию 2 (выше расход) —
  // но advert_id уже стоит на 1 (ручной выбор человека), и это должно победить.
  const db = fakeDb({
    wb_advert_nm_campaign_daily: [
      { cabinet_id: "c", nm_id: 1, advert_id: 1, spent: 100 },
      { cabinet_id: "c", nm_id: 1, advert_id: 2, spent: 900 },
    ],
    wb_adverts: [
      { advert_id: 1, name: "Ручной выбор", bid_type: "manual", payment_type: "cpc", placement_search: true, placement_shelf: false },
      { advert_id: 2, name: "Автоматика выбрала бы эту", bid_type: "manual", payment_type: "cpc", placement_search: true, placement_shelf: false },
    ],
  });
  const result = await ensureCtrTestCampaignBinding(db as never, {
    id: 1, cabinetId: "c", nmId: 1, testType: "ctr", roundNum: 0, advertId: 1, shelfConflictState: "unchecked",
  });
  assert.equal(result.advertId, 1, "ручной выбор не должен тихо перезаписаться авторезолюцией на следующем действии");
});

test("список кандидатов для пикера не фильтрует по расходу — свежая кампания без накрутки видна сразу", async () => {
  const db = fakeDb({
    wb_adverts: [
      { advert_id: 5, cabinet_id: "c", nm_ids: [1], name: "Только что создана", bid_type: "manual", payment_type: "cpc", placement_search: true, placement_shelf: false, status: 9 },
    ],
  });
  const candidates = await listCtrCampaignCandidates(db as never, "c", 1, "search_only");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].advertId, 5);
});

test("список кандидатов уважает режим — unified не предлагает чистый поиск и наоборот", async () => {
  const db = fakeDb({
    wb_adverts: [
      { advert_id: 5, cabinet_id: "c", nm_ids: [1], name: "Поиск", bid_type: "manual", payment_type: "cpc", placement_search: true, placement_shelf: false, status: 9 },
      { advert_id: 6, cabinet_id: "c", nm_ids: [1], name: "ЕРК", bid_type: "unified", payment_type: null, placement_search: null, placement_shelf: null, status: 9 },
    ],
  });
  const searchOnly = await listCtrCampaignCandidates(db as never, "c", 1, "search_only");
  assert.deepEqual(searchOnly.map((c) => c.advertId), [5]);
  const unified = await listCtrCampaignCandidates(db as never, "c", 1, "unified");
  assert.deepEqual(unified.map((c) => c.advertId), [6]);
});

test("normalizeCtrCreatePayload принимает campaignMode и advertId, по умолчанию search_only/null", () => {
  const base = { cabinetId: "c", nmId: 1, testType: "ctr", intervalMin: 60, impressionsPerRound: 1000, targetImpressions: 5000, spendCapRub: 1000, variants: [{ imageUrl: "https://a", source: "current" }, { imageUrl: "https://b", source: "link" }] };
  const withoutMode = normalizeCtrCreatePayload(base);
  assert.ok(withoutMode.ok);
  if (withoutMode.ok) { assert.equal(withoutMode.value.campaignMode, "search_only"); assert.equal(withoutMode.value.advertId, null); }

  const withUnified = normalizeCtrCreatePayload({ ...base, campaignMode: "unified", advertId: 42 });
  assert.ok(withUnified.ok);
  if (withUnified.ok) { assert.equal(withUnified.value.campaignMode, "unified"); assert.equal(withUnified.value.advertId, 42); }

  const badAdvertId = normalizeCtrCreatePayload({ ...base, advertId: "not-a-number" });
  assert.equal(badAdvertId.ok, false);
});

test("миграция объявляет campaign_mode с check-ограничением и дефолтом search_only", () => {
  const migration = read("../supabase/migrations/202609160002_ctr_test_campaign_mode.sql");
  assert.match(migration, /add column if not exists campaign_mode text not null default 'search_only'/);
  assert.match(migration, /check \(campaign_mode in \('search_only', 'unified'\)\)/);
});

test("ручной выбор кампании при создании сверяется с сервером, а не доверяется телу запроса как есть", () => {
  const route = read("../app/api/ctrtest/list/route.ts");
  assert.match(route, /listCtrCampaignCandidates\(db, cabinetId, normalized\.value\.nmId, normalized\.value\.campaignMode\)/);
  assert.match(route, /candidates\.some\(\(candidate\) => candidate\.advertId === normalized\.value\.advertId\)/);
});

test("новый роут кандидатов кампаний требует доступ к кабинету", () => {
  const route = read("../app/api/ctrtest/campaigns/route.ts");
  assert.match(route, /requireApiSession/);
  assert.match(route, /hasCabinetAccess\(cabinetId\)/);
  assert.match(route, /listCtrCampaignCandidates/);
});

test("мастер показывает выбор режима кампании и пикер конкретной кампании", () => {
  const wizard = read("../components/wb/ctr/CtrTestWizard.tsx");
  assert.match(wizard, /campaignMode/);
  assert.match(wizard, /pickedAdvertId/);
  assert.match(wizard, /\/api\/ctrtest\/campaigns\?/);
});

test("список select-колонок в GET /api/ctrtest/list переживает отсутствие campaign_mode (42703)", () => {
  const route = read("../app/api/ctrtest/list/route.ts");
  assert.match(route, /MODE_COLUMN = "campaign_mode"/);
  assert.match(route, /campaign_mode: "search_only"/);
});
