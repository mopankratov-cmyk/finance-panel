// ── Базовая себестоимость (по артикулу) ──────────────────────────────────────
export interface GoogleCostRow {
  article: string;
  cost_rub: number;     // Себестоимость — col N
  packaging_rub: number; // Подготовка — col S
}

const BASE_SPREADSHEET_ID = "1ioJqT8d4GjjSTrRjclbL0EsAxBXG8J7YybPQQ2-IRmc";
const BASE_GID = "428527662";

// Col B=1, Col N=13, Col S=18 (0-based)
const COL_ARTICLE   = 1;
const COL_COST      = 13;
const COL_PACKAGING = 18;

// ── Себестоимость поставок WB (по gi_id + barc ode) ──────────────────────────
export interface DeliveryCostRow {
  gi_id: string;
  barcode: string;
  cost_rub: number;     // col H (idx 7)
  packaging_rub: number; // col I (idx 8)
}

const DELIVERY_SPREADSHEET_ID = "1LLo9jYSdXZMCvdtgFTN-e1S4FTwCM4YYyKxsrbZ6Oc4";

// ── Общий парсер ─────────────────────────────────────────────────────────────
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === "," && !inQ) { result.push(cur); cur = ""; }
    else { cur += ch; }
  }
  result.push(cur);
  return result;
}

function parseNum(s: string | undefined): number {
  if (!s) return 0;
  return parseFloat(s.trim().replace(/\s/g, "").replace(",", ".")) || 0;
}

async function fetchCSV(spreadsheetId: string, gid?: string): Promise<string[][]> {
  const url = gid
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`
    : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`;
  const res = await fetch(url, { next: { revalidate: 3600 } } as RequestInit);
  if (!res.ok) throw new Error(`Google Sheets fetch failed: HTTP ${res.status} (id=${spreadsheetId})`);
  const text = await res.text();
  return text.split(/\r?\n/).map(parseCSVLine);
}

// ── Публичные функции ─────────────────────────────────────────────────────────

/** Базовая себестоимость: артикул → {cost, packaging} */
export async function fetchGoogleSheetCosts(): Promise<GoogleCostRow[]> {
  const lines = await fetchCSV(BASE_SPREADSHEET_ID, BASE_GID);
  const rows: GoogleCostRow[] = [];
  // Rows 0-1 informational, row 2 header → data from row 3
  for (let i = 3; i < lines.length; i++) {
    const cols = lines[i]!;
    const article = (cols[COL_ARTICLE] ?? "").trim().replace(/^"|"$/g, "");
    if (!article) continue;
    const cost_rub      = parseNum(cols[COL_COST]);
    const packaging_rub = parseNum(cols[COL_PACKAGING]);
    if (cost_rub === 0 && packaging_rub === 0) continue;
    rows.push({ article: article.toUpperCase(), cost_rub, packaging_rub });
  }
  return rows;
}

/** Себестоимость поставок WB: gi_id + barcode → {cost, packaging} */
export async function fetchDeliveryCosts(): Promise<DeliveryCostRow[]> {
  const lines = await fetchCSV(DELIVERY_SPREADSHEET_ID);
  const rows: DeliveryCostRow[] = [];
  // Row 0 = header, data from row 1; A=gi_id, C=barcode, H=cost, I=packaging
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!;
    const gi_id   = (cols[0] ?? "").trim();
    const barcode = (cols[2] ?? "").trim();
    if (!gi_id || !barcode) continue;
    const cost_rub      = parseNum(cols[7]);
    const packaging_rub = parseNum(cols[8]);
    if (cost_rub === 0 && packaging_rub === 0) continue;
    rows.push({ gi_id, barcode, cost_rub, packaging_rub });
  }
  return rows;
}
