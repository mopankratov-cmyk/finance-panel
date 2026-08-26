// Себестоимость поставок WB — по gi_id (номер поставки) + barcode. Приоритетный
// источник себестоимости/подготовки: закупочная цена товара у поставщика
// меняется от поставки к поставке, а этот лист хранит её именно так.
export interface DeliveryCostRow {
  gi_id: string;
  barcode: string;
  cost_rub: number;     // col H (idx 7)
  packaging_rub: number; // col I (idx 8)
}

const DELIVERY_SPREADSHEET_ID = "1LLo9jYSdXZMCvdtgFTN-e1S4FTwCM4YYyKxsrbZ6Oc4";

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
  const res = await fetch(url, { cache: "force-cache" } as RequestInit);
  if (!res.ok) throw new Error(`Google Sheets fetch failed: HTTP ${res.status} (id=${spreadsheetId})`);
  const text = await res.text();
  return text.split(/\r?\n/).map(parseCSVLine);
}

/** Себестоимость поставок WB: gi_id + barcode → {cost, packaging}. */
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
