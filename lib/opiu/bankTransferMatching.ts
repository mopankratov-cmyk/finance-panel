export interface TransferMatchRow {
  id: string;
  date: string;
  amount: number;
  bankAccountNumber: string;
  ownerInn: string;
  counterpartyAccount: string;
  counterpartyInn: string;
}

export interface TransferPair {
  outgoingId: string;
  incomingId: string;
}

const digits = (value: string) => value.replace(/\D/g, "");
const cents = (value: number) => Math.round(Math.abs(value) * 100);

function evidence(left: TransferMatchRow, right: TransferMatchRow) {
  const leftAccount = digits(left.bankAccountNumber);
  const rightAccount = digits(right.bankAccountNumber);
  const leftCounterpartyAccount = digits(left.counterpartyAccount);
  const rightCounterpartyAccount = digits(right.counterpartyAccount);
  const leftInn = digits(left.ownerInn);
  const rightInn = digits(right.ownerInn);
  const leftCounterpartyInn = digits(left.counterpartyInn);
  const rightCounterpartyInn = digits(right.counterpartyInn);
  return (leftCounterpartyAccount && leftCounterpartyAccount === rightAccount)
    || (rightCounterpartyAccount && rightCounterpartyAccount === leftAccount)
    || (leftCounterpartyInn && rightInn && leftCounterpartyInn === rightInn)
    || (rightCounterpartyInn && leftInn && rightCounterpartyInn === leftInn);
}

function daysBetween(left: string, right: string) {
  return Math.abs(Date.parse(left) - Date.parse(right)) / 86_400_000;
}

export function findCertainTransferPairs(rows: TransferMatchRow[]): TransferPair[] {
  const candidates = new Map<string, string[]>();
  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    const left = rows[leftIndex];
    if (!Number.isFinite(left.amount) || left.amount === 0) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const right = rows[rightIndex];
      if (Math.sign(left.amount) === Math.sign(right.amount)) continue;
      if (cents(left.amount) !== cents(right.amount)) continue;
      if (digits(left.bankAccountNumber) === digits(right.bankAccountNumber)) continue;
      if (daysBetween(left.date, right.date) > 3) continue;
      if (!evidence(left, right)) continue;
      candidates.set(left.id, [...(candidates.get(left.id) ?? []), right.id]);
      candidates.set(right.id, [...(candidates.get(right.id) ?? []), left.id]);
    }
  }
  const result: TransferPair[] = [];
  const used = new Set<string>();
  for (const row of rows) {
    const matches = candidates.get(row.id) ?? [];
    if (matches.length !== 1 || used.has(row.id)) continue;
    const otherId = matches[0];
    if ((candidates.get(otherId) ?? []).length !== 1 || used.has(otherId)) continue;
    const other = rows.find((candidate) => candidate.id === otherId);
    if (!other) continue;
    const outgoing = row.amount < 0 ? row : other;
    const incoming = row.amount > 0 ? row : other;
    result.push({ outgoingId: outgoing.id, incomingId: incoming.id });
    used.add(row.id);
    used.add(otherId);
  }
  return result;
}
