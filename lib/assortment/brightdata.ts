/**
 * Bright Data — платный источник для закрытых сайтов (Zara, Mango, Uniqlo) и
 * соцсетей (решение владельца 01.10.2026). Только готовые сборщики и наборы
 * данных Bright Data: сами защиту сайтов не обходим (граница ТЗ).
 *
 * Цены и деньги вырезаются здесь же, на входе, рекурсивно по названиям полей:
 * дальше этого модуля они не уходят ни в ответ, ни в базу.
 */

const API = "https://api.brightdata.com";

export class BrightDataError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export function hasBrightData(): boolean {
  return Boolean(process.env.BRIGHTDATA_API_TOKEN);
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  if (!token) throw new BrightDataError("Ключ Bright Data не задан в окружении панели.");
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new BrightDataError(`Bright Data ответил ${response.status}: ${text.slice(0, 300)}`, response.status);
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/** Поля с ценами и деньгами — не берём ни под каким названием. */
const MONEY_KEY = /price|currency|discount|cost|amount|sale_?value|msrp|budget|margin/i;

export function stripMoney(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMoney);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (MONEY_KEY.test(key)) continue;
      out[key] = stripMoney(inner);
    }
    return out;
  }
  return value;
}

export interface DatasetInfo {
  id: string;
  name: string;
  size: number | null;
}

/** Что из каталога Bright Data относится к модулю: сайты одежды, сумок и соцсети. */
export const RELEVANT_DATASET = /zara|mango|uniqlo|h&m|\bhm\b|cos\b|asos|farfetch|zalando|net-?a-?porter|shein|massimo|pull|bershka|instagram|tiktok|pinterest|vinted|vestiaire|lyst|nordstrom|ssense|mytheresa|lamoda|\blime\b|ozon|wildberries/i;

export function relevantDatasets(list: unknown): DatasetInfo[] {
  if (!Array.isArray(list)) return [];
  return (list as Array<Record<string, unknown>>)
    .map((d) => ({ id: String(d.id ?? ""), name: String(d.name ?? ""), size: typeof d.size === "number" ? d.size : null }))
    .filter((d) => d.id && RELEVANT_DATASET.test(d.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listDatasets(): Promise<DatasetInfo[]> {
  return relevantDatasets(await call<unknown>("/datasets/list"));
}

export interface TriggerInput {
  datasetId: string;
  inputs: Array<Record<string, string>>;
  discoverBy?: string | null;
  limitPerInput: number;
}

/** Запуск сборщика на небольшую пробу. Возвращает snapshot_id. */
export async function triggerCollection(input: TriggerInput): Promise<string> {
  if (!/^gd_[a-z0-9]+$/i.test(input.datasetId)) throw new BrightDataError("Неверный dataset_id.");
  const params = new URLSearchParams({ dataset_id: input.datasetId, include_errors: "true", limit_per_input: String(Math.min(Math.max(1, input.limitPerInput), 25)) });
  if (input.discoverBy) {
    params.set("type", "discover_new");
    params.set("discover_by", input.discoverBy);
  }
  const result = await call<{ snapshot_id?: string }>(`/datasets/v3/trigger?${params}`, { method: "POST", body: JSON.stringify(input.inputs.slice(0, 5)) });
  if (!result?.snapshot_id) throw new BrightDataError("Bright Data не вернул snapshot_id.");
  return result.snapshot_id;
}

/** Номер пробы Bright Data: s_… или sd_… (живая проверка 02.10 вернула sd_). */
export const SNAPSHOT_ID = /^sd?_[a-z0-9]+$/i;

export async function snapshotProgress(snapshotId: string): Promise<{ status: string; records: number | null; errors: number | null }> {
  if (!SNAPSHOT_ID.test(snapshotId)) throw new BrightDataError("Неверный snapshot_id.");
  const p = await call<Record<string, unknown>>(`/datasets/v3/progress/${snapshotId}`);
  return { status: String(p.status ?? "unknown"), records: typeof p.records === "number" ? p.records : null, errors: typeof p.errors === "number" ? p.errors : null };
}

/**
 * Готовые наборы Bright Data (marketplace): данные собраны ими, мы покупаем
 * выборку по фильтру — $2.5 за 1 000 записей, пустая выборка бесплатна.
 */
export async function datasetMetadata(datasetId: string): Promise<{ fields: string[]; raw: unknown }> {
  if (!/^gd_[a-z0-9]+$/i.test(datasetId)) throw new BrightDataError("Неверный dataset_id.");
  const meta = await call<Record<string, unknown>>(`/datasets/${datasetId}/metadata`);
  const fieldsObj = (meta?.fields ?? {}) as Record<string, unknown>;
  const fields = Array.isArray(meta?.fields) ? (meta.fields as unknown[]).map(String) : Object.keys(fieldsObj);
  return { fields: fields.filter((f) => !MONEY_KEY.test(f)).sort(), raw: stripMoney({ ...meta, fields: undefined }) };
}

export async function filterDataset(datasetId: string, filter: unknown, recordsLimit: number): Promise<string> {
  if (!/^gd_[a-z0-9]+$/i.test(datasetId)) throw new BrightDataError("Неверный dataset_id.");
  const result = await call<{ snapshot_id?: string }>("/datasets/filter", {
    method: "POST",
    body: JSON.stringify({ dataset_id: datasetId, filter, records_limit: Math.min(Math.max(1, recordsLimit), 100) }),
  });
  if (!result?.snapshot_id) throw new BrightDataError("Bright Data не вернул snapshot_id.");
  return result.snapshot_id;
}

/** Выборка набора: 202 — ещё собирается (вернём null). */
export async function datasetSnapshotRecords(snapshotId: string, limit = 20): Promise<{ fields: string[]; records: unknown[] } | null> {
  if (!SNAPSHOT_ID.test(snapshotId)) throw new BrightDataError("Неверный snapshot_id.");
  const token = process.env.BRIGHTDATA_API_TOKEN;
  if (!token) throw new BrightDataError("Ключ Bright Data не задан в окружении панели.");
  const response = await fetch(`${API}/datasets/snapshots/${snapshotId}/download?format=json`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (response.status === 202) return null;
  const text = await response.text();
  if (!response.ok) throw new BrightDataError(`Bright Data ответил ${response.status}: ${text.slice(0, 300)}`, response.status);
  let list: unknown[] = [];
  try {
    const parsed = JSON.parse(text);
    list = Array.isArray(parsed) ? parsed : [];
  } catch {
    list = text.split("\n").filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  }
  const records = list.slice(0, limit).map(stripMoney);
  const fields = [...new Set(records.flatMap((r) => (r && typeof r === "object" ? Object.keys(r as object) : [])))].sort();
  return { fields, records };
}

export async function snapshotRecords(snapshotId: string, limit = 20): Promise<{ fields: string[]; records: unknown[] }> {
  if (!SNAPSHOT_ID.test(snapshotId)) throw new BrightDataError("Неверный snapshot_id.");
  const raw = await call<unknown>(`/datasets/v3/snapshot/${snapshotId}?format=json`);
  const list = Array.isArray(raw) ? raw : [];
  const records = list.slice(0, limit).map(stripMoney);
  const fields = [...new Set(records.flatMap((r) => (r && typeof r === "object" ? Object.keys(r as object) : [])))].sort();
  return { fields, records };
}
