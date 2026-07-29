export const OZON_PAYER_INN = "7704217370";

export interface OzonPayoutMapping {
  cabinetId: string;
  cabinetName: string;
  companyId: string;
  companyName: string;
  accountId: string;
  accountName: string;
  accountIsOzonExclusive: boolean;
}

export const OZON_PAYOUT_MAPPINGS: readonly OzonPayoutMapping[] = [
  {
    cabinetId: "9142319b-34b7-4521-b80f-a2b303adbc17",
    cabinetName: "Ozon COSMOS",
    companyId: "f44db400-1374-42d8-9c71-78aed8978f95",
    companyName: "ИП Панкратов",
    accountId: "58819f26-bf1c-4fc8-9b4f-c608b0f70a4c",
    accountName: "Озон банк ИП Панкратов",
    accountIsOzonExclusive: true,
  },
  {
    cabinetId: "4ab2ed44-9a0a-4397-ab56-f613760f5616",
    cabinetName: "Ozon 1933484",
    companyId: "9f697ea3-e444-465f-a544-9e90cdfd0330",
    companyName: "ИП Кучеренко",
    accountId: "bc726415-0e05-442d-ab6d-7755f6505f2a",
    accountName: "ИП Кучеренко Точка",
    accountIsOzonExclusive: false,
  },
] as const;

export interface ReceiptForPreview {
  id: string;
  date: string;
  amount: number;
  status: string;
  category: string;
  accountId: string;
  name: string;
  counterparty: string;
  comment: string;
}

const normalized = (value: string) => value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ");

export function isMarketplaceIncomeCategory(category: string) {
  const value = normalized(category);
  return value === "продажи на мп" || value === "поступления от маркетплейсов";
}

export function classifyOzonReceipts(rows: ReceiptForPreview[], mapping: OzonPayoutMapping) {
  const marketplaceRows = rows.filter((row) => row.amount > 0 && row.status === "done" && isMarketplaceIncomeCategory(row.category));
  const confirmed = marketplaceRows.filter((row) => {
    const bankText = `${row.name} ${row.counterparty} ${row.comment}`;
    return (mapping.accountIsOzonExclusive && row.accountId === mapping.accountId)
      || bankText.includes(OZON_PAYER_INN);
  });
  const confirmedIds = new Set(confirmed.map((row) => row.id));
  return {
    confirmed,
    unresolved: marketplaceRows.filter((row) => !confirmedIds.has(row.id)),
  };
}

export function stableOzonReportKey(cabinetId: string, externalReportId: string) {
  return `ozon:${cabinetId}:${externalReportId}`;
}

export function buildOzonPayoutPreview<TSchedule>(input: {
  reports: Array<{ amount: number }>;
  confirmedReceipts: Array<{ amount: number }>;
  unresolvedReceipts: unknown[];
  schedule: TSchedule[];
}) {
  if (input.unresolvedReceipts.length > 0) {
    return { reportTotal: null, bankReceived: null, remaining: null, schedule: null };
  }
  const reportTotal = input.reports.reduce((sum, row) => sum + Math.max(0, row.amount), 0);
  const bankReceived = input.confirmedReceipts.reduce((sum, row) => sum + Math.max(0, row.amount), 0);
  return {
    reportTotal,
    bankReceived,
    remaining: Math.max(0, reportTotal - bankReceived),
    schedule: input.schedule,
  };
}
