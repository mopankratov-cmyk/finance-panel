// Google Drive через service account. JWT (RS256, jose) → access token → Drive REST API.
// Без зависимости googleapis. Креды: GOOGLE_SERVICE_ACCOUNT_B64 (base64 JSON ключа).
import { SignJWT, importPKCS8 } from "jose";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive";

interface SA { client_email: string; private_key: string; project_id?: string }

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

export async function getDriveToken(): Promise<string | null> {
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

export interface DriveFile { id: string; name: string; mimeType: string; thumbnailLink?: string; webContentLink?: string }

const API = "https://www.googleapis.com/drive/v3";

// Список файлов/папок внутри папки (опц. только изображения или только папки).
export async function driveList(folderId: string, opts: { foldersOnly?: boolean; imagesOnly?: boolean } = {}): Promise<DriveFile[]> {
  const token = await getDriveToken();
  if (!token) return [];
  let q = `'${folderId}' in parents and trashed=false`;
  if (opts.foldersOnly) q += " and mimeType='application/vnd.google-apps.folder'";
  if (opts.imagesOnly) q += " and mimeType contains 'image/'";
  const url = `${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,thumbnailLink,webContentLink)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const j = (await res.json()) as { files?: DriveFile[] };
    return j.files ?? [];
  } catch { return []; }
}

// Прямая ссылка на скачивание содержимого файла (через alt=media с токеном — для проксирования).
export async function driveDownload(fileId: string): Promise<{ buf: ArrayBuffer; type: string } | null> {
  const token = await getDriveToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API}/files/${fileId}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    return { buf: await res.arrayBuffer(), type: res.headers.get("content-type") ?? "image/jpeg" };
  } catch { return null; }
}
