// Google Sheets через service account. JWT (RS256, jose) → access token → Sheets REST API.
// Тот же принцип, что и lib/google/drive.ts, но свой скоуп (spreadsheets) и свой токен-кэш —
// модули не связаны друг с другом.
import { SignJWT, importPKCS8 } from "jose";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

interface SA { client_email: string; private_key: string }

function loadSA(): SA | null {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  try {
    const json = b64 ? Buffer.from(b64, "base64").toString("utf8") : raw;
    if (!json) return null;
    const sa = JSON.parse(json) as SA;
    return sa.client_email && sa.private_key ? sa : null;
  } catch { return null; }
}

let _token: { value: string; exp: number } | null = null;

async function getSheetsToken(): Promise<string | null> {
  if (_token && Date.now() < _token.exp - 60000) return _token.value;
  const sa = loadSA();
  if (!sa) return null;
  try {
    const key = await importPKCS8(sa.private_key, "RS256");
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(sa.client_email).setSubject(sa.client_email)
      .setAudience(TOKEN_URL).setIssuedAt(now).setExpirationTime(now + 3600)
      .sign(key);
    const res = await fetch(TOKEN_URL, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) return null;
    _token = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return _token.value;
  } catch { return null; }
}

export type SheetCell = string | number;

// Убедиться, что в файле есть вкладка с этим названием — если нет, создать и
// сразу проставить заголовок первой строкой. Не трогает остальные вкладки файла.
export async function ensureSheetTab(spreadsheetId: string, title: string, header: SheetCell[]): Promise<void> {
  const token = await getSheetsToken();
  if (!token) throw new Error("GOOGLE_SERVICE_ACCOUNT_B64 не настроен или не даёт доступ к Sheets API");

  const metaRes = await fetch(`${API}/${spreadsheetId}?fields=sheets.properties.title`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!metaRes.ok) throw new Error(`Sheets API ${metaRes.status}: ${(await metaRes.text()).slice(0, 200)}`);
  const meta = (await metaRes.json()) as { sheets?: { properties?: { title?: string } }[] };
  const exists = (meta.sheets ?? []).some((s) => s.properties?.title === title);
  if (exists) return;

  const addRes = await fetch(`${API}/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!addRes.ok) throw new Error(`Sheets API ${addRes.status}: ${(await addRes.text()).slice(0, 200)}`);

  await appendSheetRows(spreadsheetId, `'${title}'!A:${String.fromCharCode(64 + header.length)}`, [header]);
}

// Значения диапазона (напр. "'Поставки'!A2:J") — нужны для дедупа перед append.
// null = сервис-аккаунт не настроен или нет доступа к таблице.
export async function getSheetValues(spreadsheetId: string, range: string): Promise<SheetCell[][] | null> {
  const token = await getSheetsToken();
  if (!token) return null;
  const url = `${API}/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { values?: SheetCell[][] };
    return j.values ?? [];
  } catch { return null; }
}

// Добавить строки в конец существующей таблицы (Sheets API сам находит последнюю
// заполненную строку в диапазоне) — существующие строки не трогает.
export async function appendSheetRows(spreadsheetId: string, range: string, rows: SheetCell[][]): Promise<void> {
  const token = await getSheetsToken();
  if (!token) throw new Error("GOOGLE_SERVICE_ACCOUNT_B64 не настроен или не даёт доступ к Sheets API");
  const url = `${API}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows }),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`Sheets API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
