// Юнит-тест стора джоб. Запуск: node render-service/jobStore.test.mjs
// Без фреймворка (как normalizeParams.test.mts) — простые ассерты, exit 1 при первом провале.
// Цель: доказать fail-safe контракт — нет клиента / нет таблицы / транзиент НИКОГДА не бросают,
// и корректный маппинг полей + троттл-выключение чистки.
import { createJobStore } from "./jobStore.mjs";

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; } else { fail++; console.error("✗", m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

// Фейковый Supabase-клиент: chainable + awaitable, записывает вызовы.
function fakeClient({ upsertError = null, selectData = null, selectError = null, deleteError = null, throwOn = null } = {}) {
  const rec = { upsert: [], select: [], delete: [] };
  const chain = (terminal) => {
    const o = {
      eq: () => o, neq: () => o, lt: () => o,
      maybeSingle: () => Promise.resolve(terminal),
      then: (res, rej) => Promise.resolve(terminal).then(res, rej),
    };
    return o;
  };
  const client = {
    from() {
      return {
        upsert: (payload, opts) => { if (throwOn === "upsert") throw new Error("boom"); rec.upsert.push({ payload, opts }); return chain({ error: upsertError }); },
        select: (cols) => { rec.select.push({ cols }); return chain({ data: selectData, error: selectError }); },
        delete: () => { rec.delete.push({}); return chain({ error: deleteError }); },
      };
    },
  };
  return { client, rec };
}

const run = async () => {
  // ── 1. Нет клиента → всё no-op, ничего не бросает ──
  {
    const s = createJobStore({ getClient: () => null });
    await s.persist("a", { status: "in_progress" });
    eq(await s.fetch("a"), null, "нет клиента: fetch→null");
    await s.cleanup("2020-01-01T00:00:00Z"); // не должно бросить
    eq(s.active(), false, "нет клиента: active()=false");
    eq(s._state(), null, "нет клиента: state остаётся null (не трогали)");
  }

  // ── 2. Нет таблицы (upsert вернул error) → tableOk=false, дальше короткое замыкание ──
  {
    const { client, rec } = fakeClient({ upsertError: { message: "relation render_jobs does not exist" } });
    const s = createJobStore({ getClient: () => client });
    await s.persist("a", { status: "in_progress" });
    eq(s._state(), false, "нет таблицы: первый upsert провалился → state=false");
    eq(rec.upsert.length, 1, "нет таблицы: была 1 попытка upsert");
    await s.persist("a", { progress: 50 });               // должно короткозамкнуться
    eq(rec.upsert.length, 1, "нет таблицы: второй persist НЕ дёргает БД");
    eq(await s.fetch("a"), null, "нет таблицы: fetch→null без select");
    eq(rec.select.length, 0, "нет таблицы: select не вызывался");
    eq(s.active(), false, "нет таблицы: active()=false");
  }

  // ── 3. Happy path: persist пишет id+поля+updated_at, onConflict=id, state=true ──
  {
    const { client, rec } = fakeClient({});
    const s = createJobStore({ getClient: () => client, now: () => "2026-06-22T00:00:00Z" });
    await s.persist("job1", { status: "done", progress: 100, video_url: "http://v/x.mp4" });
    eq(s._state(), true, "happy: state=true");
    eq(s.active(), true, "happy: active()=true");
    eq(rec.upsert[0].payload, { id: "job1", status: "done", progress: 100, video_url: "http://v/x.mp4", updated_at: "2026-06-22T00:00:00Z" }, "happy: payload собран верно");
    eq(rec.upsert[0].opts, { onConflict: "id" }, "happy: onConflict=id");
  }

  // ── 4. fetch маппит video_url→videoUrl, null-поля → undefined ──
  {
    const { client } = fakeClient({ selectData: { status: "done", progress: 100, video_url: "http://v/x.mp4", error: null } });
    const s = createJobStore({ getClient: () => client });
    await s.persist("j", { status: "in_progress" });      // прогреть tableOk=true
    eq(await s.fetch("j"), { status: "done", progress: 100, videoUrl: "http://v/x.mp4", error: undefined }, "fetch: маппинг video_url→videoUrl");
  }

  // ── 5. fetch без строки → null ──
  {
    const { client } = fakeClient({ selectData: null });
    const s = createJobStore({ getClient: () => client });
    await s.persist("j", { status: "in_progress" });
    eq(await s.fetch("missing"), null, "fetch: нет строки → null");
  }

  // ── 6. cleanup дёргает delete только когда tableOk===true ──
  {
    const { client, rec } = fakeClient({});
    const s = createJobStore({ getClient: () => client });
    await s.cleanup("2020-01-01T00:00:00Z");
    eq(rec.delete.length, 0, "cleanup: при state=null delete НЕ вызывается");
    await s.persist("j", { status: "done" });             // tableOk→true
    await s.cleanup("2020-01-01T00:00:00Z");
    eq(rec.delete.length, 1, "cleanup: при state=true delete вызывается");
  }

  // ── 7. persist глотает брошенное исключение (транзиент сети) ──
  {
    const { client } = fakeClient({ throwOn: "upsert" });
    const s = createJobStore({ getClient: () => client });
    let threw = false;
    try { await s.persist("j", { status: "in_progress" }); } catch { threw = true; }
    eq(threw, false, "persist: брошенное исключение проглочено (рендер не падает)");
  }

  console.log(`\njobStore: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
run();
