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
  if (!leftAccount || !rightAccount) return false;
  // Known account numbers take precedence over INN: one company can own many accounts.
  if (leftCounterpartyAccount && leftCounterpartyAccount !== rightAccount) return false;
  if (rightCounterpartyAccount && rightCounterpartyAccount !== leftAccount) return false;
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
  const incomingByAmount = new Map<number, TransferMatchRow[]>();
  const byId = new Map(rows.map(row=>[row.id,row]));
  for (const row of rows) {
    if (!Number.isFinite(row.amount) || row.amount<=0) continue;
    const key=cents(row.amount);
    incomingByAmount.set(key,[...(incomingByAmount.get(key) ?? []),row]);
  }
  for (const left of rows) {
    if (!Number.isFinite(left.amount) || left.amount >= 0) continue;
    for (const right of incomingByAmount.get(cents(left.amount)) ?? []) {
      if (digits(left.bankAccountNumber) === digits(right.bankAccountNumber)) continue;
      const distance = daysBetween(left.date, right.date);
      if (!Number.isFinite(distance) || distance > 3) continue;
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
    const other = byId.get(otherId);
    if (!other) continue;
    const outgoing = row.amount < 0 ? row : other;
    const incoming = row.amount > 0 ? row : other;
    result.push({ outgoingId: outgoing.id, incomingId: incoming.id });
    used.add(row.id);
    used.add(otherId);
  }
  return result;
}
