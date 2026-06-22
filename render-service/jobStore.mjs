// Кросс-инстанс стор СТАТУСА рендер-джоб поверх Supabase (для ФЛОТА воркеров за балансировщиком).
// Рендер идёт на той инстанс, что приняла /render; сюда пишется только статус/прогресс/результат,
// чтобы /status/:id отвечал с ЛЮБОЙ инстанс. Нет таблицы/клиента → авто-выключение (тихо только in-memory).
//
// КОНТРАКТ НАДЁЖНОСТИ: это телеметрия — она НИКОГДА не валит рендер. Все ошибки глотаются.
// Зависимости внедряются (getClient/log/now) → модуль тестируется без живого Supabase. Миграция: 20260622_render_jobs.sql.

export function createJobStore({ getClient, log = () => {}, table = "render_jobs", now = () => new Date().toISOString() }) {
  let tableOk = null; // null=ещё не пробовали; false=нет таблицы → больше не дёргаем; true=работает

  return {
    // активен ли общий стор (для /health и решения чистить ли строки)
    active() { return tableOk === true; },
    // только для тестов/диагностики
    _state() { return tableOk; },

    // upsert статуса джобы (частичный — обновляются только переданные поля; created_at не затирается)
    async persist(id, fields) {
      const db = getClient();
      if (!db || tableOk === false) return;
      try {
        const { error } = await db.from(table).upsert({ id, ...fields, updated_at: now() }, { onConflict: "id" });
        if (error) {
          if (tableOk === null) { tableOk = false; log(`[jobstore] ${table} недоступна (миграция не применена?) — только in-memory: ${error.message}`); }
          return;
        }
        tableOk = true;
      } catch { /* транзиент сети — не валим рендер из-за телеметрии */ }
    },

    // чтение статуса (когда /status попал на инстанс, что НЕ рендерила джобу). Маппинг video_url→videoUrl.
    async fetch(id) {
      const db = getClient();
      if (!db || tableOk === false) return null;
      try {
        const { data, error } = await db.from(table).select("status,progress,video_url,error").eq("id", id).maybeSingle();
        if (error || !data) return null;
        return { status: data.status, progress: data.progress, videoUrl: data.video_url || undefined, error: data.error || undefined };
      } catch { return null; }
    },

    // чистка завершённых старше cutoff (идемпотентно — несколько инстансов не мешают друг другу)
    async cleanup(cutoffISO) {
      const db = getClient();
      if (!db || tableOk !== true) return;
      try { await db.from(table).delete().neq("status", "in_progress").lt("created_at", cutoffISO); } catch { /* идемпотентно */ }
    },
  };
}
