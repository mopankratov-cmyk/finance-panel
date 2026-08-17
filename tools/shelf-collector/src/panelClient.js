/**
 * Тонкий клиент к finance-panel (раздел «Полки»). Замена webAppClient.js из
 * исходных наработок: вместо Apps Script Web App снимки уходят в панель
 * (Supabase за ней), авторизация — CRON_SECRET панели в заголовке Bearer.
 * Контракт снимка не менялся — scrape.js передаётся как есть.
 */

/**
 * @returns {{articles: number[], pending: number[]}} — все активные артикулы и
 * подмножество «без единого снимка» (новички для внепланового доскока).
 */
export async function fetchActiveArticles(panelUrl, secret) {
  const res = await fetch(`${panelUrl}/api/shelf/watchlist`, {
    headers: { Authorization: `Bearer ${secret}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(`GET активных артикулов не удался: ${data.error || `HTTP ${res.status}`}`);
  }
  return { articles: data.articles ?? [], pending: data.pending ?? [] };
}

export async function pushSnapshot(panelUrl, secret, snapshot) {
  const res = await fetch(`${panelUrl}/api/shelf/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`
    },
    body: JSON.stringify(snapshot)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(`Запись снимка не удалась: ${data.error || `HTTP ${res.status}`}`);
  }
  return data;
}
