const normalize = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export function resolveRegisterRow(
  stableId: string,
  legacyKey: string,
  rowsById: Map<string, number>,
  legacyRows: Map<string, number[]>,
): number | null {
  const byId = stableId ? rowsById.get(normalize(stableId)) : undefined;
  if (byId != null) return byId;
  const exactLegacy = legacyKey ? legacyRows.get(legacyKey) ?? [] : [];
  return exactLegacy.length === 1 ? exactLegacy[0] : null;
}

export function resolveLoanBlock(
  values: unknown[][],
  idColumn: number,
  identity: { loanId: string; company: string; creditor: string; contract: string; firstScheduleDate: string },
): number {
  if (identity.loanId) {
    const byId = values.findIndex((row) => normalize(row[idColumn]) === normalize(identity.loanId));
    if (byId >= 0) return byId;
  }
  const candidates: number[] = [];
  values.forEach((row, rowIndex) => {
    const matches = normalize(row[1]) === normalize(identity.creditor)
      && normalize(values[rowIndex + 2]?.[0]) === normalize(identity.company)
      && (identity.contract
        ? normalize(values[rowIndex + 3]?.[0]) === normalize(identity.contract)
        : normalize(values[rowIndex + 1]?.[0]) === normalize(identity.firstScheduleDate));
    if (matches) candidates.push(rowIndex);
  });
  return candidates.length === 1 ? candidates[0] : -1;
}
