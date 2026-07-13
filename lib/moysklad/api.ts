import type { TaraLine } from "@/lib/supplies/tara";

const BASE = "https://api.moysklad.ru/api/remap/1.2";
const TIMEOUT_MS = 20_000;

export interface MoySkladMeta { href: string; type: string; mediaType: string }
export interface MoySkladReference { name: string; meta: MoySkladMeta }
export interface MoySkladAssortment extends MoySkladReference {
  id: string;
  code: string;
  article: string;
  externalCode: string;
  barcodes: string[];
}

export type MoySkladValidation = { ok: true; accountName: string | null } | { ok: false; error: string };

function auth(token: string): HeadersInit {
  return { Authorization: `Bearer ${token.trim()}`, Accept: "application/json;charset=utf-8", "Content-Type": "application/json;charset=utf-8" };
}

function apiError(status: number, body: unknown): Error {
  const source = body as { errors?: { error?: string }[]; error?: string } | null;
  const message = source?.errors?.map((item) => item.error).filter(Boolean).join("; ") || source?.error || (typeof body === "string" ? body.slice(0, 300) : "");
  return new Error(`МойСклад ${status}${message ? `: ${message}` : ""}`);
}

async function request<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}/${path.replace(/^\/+/, "")}`, {
      ...init,
      headers: { ...auth(token), ...(init?.headers ?? {}) },
      cache: "no-store",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("json") ? await response.json().catch(() => null) : await response.text().catch(() => "");
    if (!response.ok) throw apiError(response.status, body);
    return body as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("МойСклад не ответил за 20 секунд");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function validateMoySkladToken(token: string): Promise<MoySkladValidation> {
  try {
    const employee = await request<{ name?: string }>(token, "context/employee");
    return { ok: true, accountName: employee.name ?? null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Ошибка сети" };
  }
}

function reference(row: { name?: string; meta?: Partial<MoySkladMeta> }): MoySkladReference | null {
  const href = String(row.meta?.href ?? "");
  const type = String(row.meta?.type ?? "");
  if (!href.startsWith(`${BASE}/entity/`) || !type) return null;
  return { name: String(row.name ?? "Без названия"), meta: { href, type, mediaType: String(row.meta?.mediaType ?? "application/json") } };
}

export async function getMoySkladContext(token: string): Promise<{ organizations: MoySkladReference[]; stores: MoySkladReference[] }> {
  const [organizations, stores] = await Promise.all([
    request<{ rows?: { name?: string; meta?: Partial<MoySkladMeta>; archived?: boolean }[] }>(token, "entity/organization?limit=100"),
    request<{ rows?: { name?: string; meta?: Partial<MoySkladMeta>; archived?: boolean }[] }>(token, "entity/store?limit=100"),
  ]);
  return {
    organizations: (organizations.rows ?? []).filter((row) => !row.archived).map(reference).filter((row): row is MoySkladReference => Boolean(row)),
    stores: (stores.rows ?? []).filter((row) => !row.archived).map(reference).filter((row): row is MoySkladReference => Boolean(row)),
  };
}

function barcodeValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => Object.values((entry ?? {}) as Record<string, unknown>).map(String)).filter(Boolean);
}

function assortmentRow(raw: { id?: string; name?: string; code?: string; article?: string; externalCode?: string; barcodes?: unknown; meta?: Partial<MoySkladMeta> }): MoySkladAssortment | null {
  const ref = reference(raw);
  if (!ref || !raw.id) return null;
  return { ...ref, id: raw.id, code: raw.code ?? "", article: raw.article ?? "", externalCode: raw.externalCode ?? "", barcodes: barcodeValues(raw.barcodes) };
}

export async function fetchMoySkladAssortmentForTara(token: string, lines: TaraLine[]): Promise<MoySkladAssortment[]> {
  const lookups = [...new Map(lines.map((line) => {
    const kind = line.barcode ? "barcode" : "search";
    const value = line.barcode || line.article;
    return [`${kind}:${identifier(value)}`, { kind, value }] as const;
  }).filter(([, lookup]) => Boolean(lookup.value))).values()];
  if (lookups.length > 500) throw new Error("В таре больше 500 уникальных SKU: разделите файл на партии");

  const found = new Map<string, MoySkladAssortment>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < lookups.length) {
      const lookup = lookups[cursor++];
      const filter = new URLSearchParams({ filter: `${lookup.kind}=${lookup.value}`, limit: "100" });
      const page = await request<{ rows?: { id?: string; name?: string; code?: string; article?: string; externalCode?: string; barcodes?: unknown; meta?: Partial<MoySkladMeta> }[] }>(token, `entity/assortment?${filter}`);
      for (const raw of page.rows ?? []) {
        const parsed = assortmentRow(raw);
        if (parsed) found.set(parsed.id, parsed);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, lookups.length) }, () => worker()));
  return [...found.values()];
}

const identifier = (value: unknown) => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ru-RU");

export function mapTaraToAssortment(lines: TaraLine[], assortment: MoySkladAssortment[]) {
  const barcodeMap = new Map<string, Set<MoySkladAssortment>>();
  const articleMap = new Map<string, Set<MoySkladAssortment>>();
  const add = (map: Map<string, Set<MoySkladAssortment>>, key: string, row: MoySkladAssortment) => {
    if (!key) return;
    const found = map.get(key) ?? new Set<MoySkladAssortment>();
    found.add(row);
    map.set(key, found);
  };
  for (const row of assortment) {
    row.barcodes.forEach((value) => add(barcodeMap, identifier(value), row));
    [row.article, row.code, row.externalCode, row.name].forEach((value) => add(articleMap, identifier(value), row));
  }

  const mapped: { line: TaraLine; assortment: MoySkladAssortment }[] = [];
  const errors: string[] = [];
  for (const line of lines) {
    const barcodeMatches = line.barcode ? [...(barcodeMap.get(identifier(line.barcode)) ?? [])] : [];
    const articleMatches = line.article ? [...(articleMap.get(identifier(line.article)) ?? [])] : [];
    const matches = barcodeMatches.length ? barcodeMatches : articleMatches;
    if (matches.length === 1) mapped.push({ line, assortment: matches[0] });
    else if (matches.length === 0) errors.push(`Короб ${line.container}: ${line.article || line.barcode || line.nmId} не найден в МойСклад`);
    else errors.push(`Короб ${line.container}: ${line.article || line.barcode} неоднозначно совпал с ${matches.length} позициями МойСклад`);
  }
  return { mapped, errors };
}

export interface MoySkladInternalOrderInput {
  syncId: string;
  name: string;
  description: string;
  organization: MoySkladMeta;
  store?: MoySkladMeta | null;
  positions: { quantity: number; assortment: MoySkladMeta }[];
}

export async function createMoySkladInternalOrder(token: string, input: MoySkladInternalOrderInput) {
  return request<{ id: string; name: string; syncId?: string; meta: MoySkladMeta }>(token, "entity/internalorder", {
    method: "POST",
    body: JSON.stringify({
      syncId: input.syncId,
      name: input.name.slice(0, 255),
      externalCode: `finance-panel-${input.syncId}`.slice(0, 255),
      description: input.description.slice(0, 4096),
      applicable: false,
      organization: { meta: input.organization },
      ...(input.store ? { store: { meta: input.store } } : {}),
      positions: input.positions.map((position) => ({ quantity: position.quantity, price: 0, discount: 0, vat: 0, assortment: { meta: position.assortment } })),
    }),
  });
}
