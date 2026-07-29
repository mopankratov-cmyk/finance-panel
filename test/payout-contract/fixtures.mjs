export const ids = Object.freeze({
  finance: '91000000-0000-4000-8000-000000000001',
  director: '91000000-0000-4000-8000-000000000002',
  otherDirector: '91000000-0000-4000-8000-000000000003',
  cabinet: '92000000-0000-4000-8000-000000000001',
  cabinet2: '92000000-0000-4000-8000-000000000002',
  accountOwnerCompany: '93000000-0000-4000-8000-000000000001',
  company: '93000000-0000-4000-8000-000000000002',
  account: '94000000-0000-4000-8000-000000000001',
  account2: '94000000-0000-4000-8000-000000000002',
  receipt: '95000000-0000-4000-8000-000000000001',
});

let sequence = 0;
export function requestId() {
  sequence += 1;
  return `96000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}
export function line(overrides = {}) {
  return {
    lineKey: 'line-1',
    sourceKind: 'provider_report',
    providerReportId: 'synthetic-report-1',
    providerScheduleId: 'synthetic-schedule-1',
    periodFrom: '2026-07-01',
    periodTo: '2026-07-07',
    expectedReceiptDate: '2026-07-10',
    amount: '1000.00',
    currency: 'RUB',
    lifecycleState: 'report_confirmed',
    ...overrides,
  };
}
export function preview(overrides = {}) {
  return {
    requestId: requestId(),
    marketplace: 'wb',
    cabinetId: ids.cabinet,
    companyId: ids.company,
    receivingAccountId: ids.account,
    seriesKey: 'wb:2026-W28',
    expectedPublishedRevision: 0,
    sourceObservedAt: '2026-07-08T12:00:00.000Z',
    sourceDataStatus: 'available',
    unallocatedAmount: '0.00',
    unresolvedReceiptCount: 0,
    lines: [line()],
    ...overrides,
  };
}
export function identity(overrides = {}) {
  return {
    source: 'bank_import_structured',
    verified: true,
    payerInn: '9714053621',
    payerKpp: '507401001',
    payerLegalName: 'ООО «РВБ»',
    payerAccountNumber: 'SYNTHETIC-NON-BANK-ID',
    ...overrides,
  };
}
