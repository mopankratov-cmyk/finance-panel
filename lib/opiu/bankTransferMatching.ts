export interface TransferMatchRow {
  id: string;
  date: string;
  amount: number;
  bankAccountNumber: string;
  companyId: string;
  accountId: string;
  ownerInn: string;
  counterpartyAccount: string;
  counterpartyInn: string;
  category: string;
  purpose: string;
}

export interface TransferPair {
  outgoingId: string;
  incomingId: string;
}

const digits = (value: string) => value.replace(/\D/g, "");
const cents = (value: number) => Math.round(Math.abs(value) * 100);
const hasTransferSignal = (row: TransferMatchRow) =>
  /(перевод|собственн(?:ых|ые) средств|между своими сч[её]тами)/i.test(`${row.category} ${row.purpose}`);

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
  const sameMappedCompanyAccounts = Boolean(
    left.companyId
    && left.companyId === right.companyId
    && left.accountId
    && right.accountId
    && left.accountId !== right.accountId
    && left.date === right.date
    && hasTransferSignal(left)
    && hasTransferSignal(right)
  );
  return (leftCounterpartyAccount && leftCounterpartyAccount === rightAccount)
    || (rightCounterpartyAccount && rightCounterpartyAccount === leftAccount)
    || (leftInn && rightInn && leftInn === rightInn)
    || (leftCounterpartyInn && rightInn && leftCounterpartyInn === rightInn)
    || (rightCounterpartyInn && leftInn && rightCounterpartyInn === leftInn)
    || sameMappedCompanyAccounts;
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

  // Banks can contain several identical transfers between the same two
  // accounts on one day. Every row then has several equally valid matches,
  // so the one-to-one pass above intentionally skips the whole batch. If the
  // batch is closed (the same number of outgoing and incoming rows) and none
  // of its rows can match another account/date, any stable one-to-one pairing
  // represents the same transfers without inventing a missing side.
  const batches = new Map<string, { outgoing: Set<string>; incoming: Set<string> }>();
  for (const left of rows) {
    if (left.amount >= 0 || used.has(left.id)) continue;
    for (const rightId of candidates.get(left.id) ?? []) {
      if (used.has(rightId)) continue;
      const right = byId.get(rightId);
      if (!right || right.amount <= 0 || left.date !== right.date) continue;
      const key = [left.date, cents(left.amount), digits(left.bankAccountNumber), digits(right.bankAccountNumber)].join("|");
      const batch = batches.get(key) ?? { outgoing: new Set<string>(), incoming: new Set<string>() };
      batch.outgoing.add(left.id);
      batch.incoming.add(right.id);
      batches.set(key, batch);
    }
  }
  for (const key of [...batches.keys()].sort()) {
    const batch = batches.get(key)!;
    const outgoing = [...batch.outgoing].filter(id => !used.has(id)).sort();
    const incoming = [...batch.incoming].filter(id => !used.has(id)).sort();
    if (outgoing.length <= 1 || outgoing.length !== incoming.length) continue;
    const outgoingSet = new Set(outgoing);
    const incomingSet = new Set(incoming);
    const isClosed = outgoing.every(id => (candidates.get(id) ?? []).filter(other => !used.has(other)).every(other => incomingSet.has(other)))
      && incoming.every(id => (candidates.get(id) ?? []).filter(other => !used.has(other)).every(other => outgoingSet.has(other)));
    if (!isClosed) continue;
    for (let index = 0; index < outgoing.length; index += 1) {
      result.push({ outgoingId: outgoing[index], incomingId: incoming[index] });
      used.add(outgoing[index]);
      used.add(incoming[index]);
    }
  }
  return result;
}
