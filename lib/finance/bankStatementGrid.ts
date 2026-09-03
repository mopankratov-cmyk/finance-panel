// Банковская выписка из табличной сетки — чистая логика без файлов и браузера.
// Раньше жила внутри `components/payments/bankStatement.ts` вместе с чтением
// XLSX через DOMParser; теперь её вызывает сервер (`bankStatementServer.ts`),
// а браузерный модуль только реэкспортирует типы.

export interface BankStatementRow {
  id: string;
  date: string;
  amount: number;
  counterparty: string;
  counterpartyInn: string;
  counterpartyAccount: string;
  purpose: string;
  documentNumber: string;
}

export interface BankStatement {
  documentHash: string;
  bank: string;
  owner: string;
  ownerInn: string;
  accountNumber: string;
  dateFrom: string;
  dateTo: string;
  openingBalance: number;
  closingBalance: number;
  declaredDebit: number;
  declaredCredit: number;
  rows: BankStatementRow[];
  warnings: string[];
  notes?: string[];
}

export function parseStatementNumber(value: string): number {
  const normalized = value.replace(/[\s  ]/g, "").replace(",", ".");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : 0;
}

export function statementIsoDate(value: string): string {
  const clean = value.trim();
  const ru = clean.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (ru) return `${ru[3]}-${ru[2].padStart(2, "0")}-${ru[1].padStart(2, "0")}`;
  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const serial = Number(clean);
  if (Number.isFinite(serial) && serial > 20_000 && serial < 100_000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  return "";
}

const normalize = (value: string) => value
  .toLowerCase()
  .replace(/ё/g, "е")
  .replace(/[^а-яa-z0-9]+/g, " ")
  .trim();

function valueAfterLabel(grid: string[][], pattern: RegExp) {
  for (const row of grid) {
    const labelIndex = row.findIndex((cell) => pattern.test(normalize(cell ?? "")));
    if (labelIndex < 0) continue;
    const label = row[labelIndex]?.trim();
    const value = row.slice(labelIndex + 1).find((cell) => {
      const clean = cell?.trim();
      return clean && clean !== label && !/^ооо\s+["«]?вб банк/i.test(clean);
    });
    if (value) return value.trim();
  }
  return "";
}

const aliases = {
  date: ["дата операции", "дата проводки", "дата платежа", "дата документа", "дата"],
  debit: ["списание", "сумма списания", "дебет", "расход"],
  credit: ["зачисление", "сумма зачисления", "кредит", "приход", "поступление"],
  amount: ["сумма операции", "сумма"],
  direction: ["тип операции", "направление", "приход расход", "дебет кредит"],
  document: ["номер документа", "документ", "номер платежа", "id операции"],
  account: ["счет", "номер счета", "расчетный счет", "банковский счет"],
  counterparty: ["контрагент", "наименование контрагента", "получатель", "плательщик"],
  inn: ["инн контрагента", "инн получателя", "инн плательщика", "инн"],
  counterpartyAccount: ["счет контрагента", "счет получателя", "счет плательщика"],
  purpose: ["назначение платежа", "назначение", "описание операции", "основание платежа"],
} as const;

/**
 * Собирает выписку из сетки первого листа и текста всей книги (для владельца/ИНН).
 * `documentHash` — SHA-256 файла; id строки = хеш + номер строки листа.
 */
export function statementFromGrid(grid: string[][], metadata: string, documentHash: string): BankStatement {
  const headerIndex = grid.findIndex((row) => {
    const headers = row.map(normalize);
    const hasDate = headers.some((cell) => aliases.date.includes(cell as never));
    const hasMoney = headers.some((cell) => [...aliases.debit, ...aliases.credit, ...aliases.amount].includes(cell as never));
    return hasDate && hasMoney;
  });
  if (headerIndex < 0) {
    const operationCount = parseStatementNumber(valueAfterLabel(grid, /^количество операций/));
    const looksLikeEmptyStatement = grid.some((row) => row.some((cell) => /выписка операций по счету/i.test(cell ?? "")))
      && operationCount === 0;
    if (looksLikeEmptyStatement) {
      const period = valueAfterLabel(grid, /^за период$/).match(/с\s+(\d{1,2}[./-]\d{1,2}[./-]\d{4})\s+по\s+(\d{1,2}[./-]\d{1,2}[./-]\d{4})/i);
      const owner = grid.flat().find((cell) => /^(?:индивидуальный предприниматель|ип)\s+/i.test(cell?.trim() ?? ""))?.trim() ?? "";
      return {
        documentHash,
        bank: grid[0]?.find((cell) => cell.trim())?.trim() || "Банковская выписка",
        owner,
        ownerInn: valueAfterLabel(grid, /^инн кио$/).replace(/\D/g, ""),
        accountNumber: valueAfterLabel(grid, /^выписка операций по счету$/).replace(/\D/g, ""),
        dateFrom: statementIsoDate(period?.[1] ?? ""),
        dateTo: statementIsoDate(period?.[2] ?? ""),
        openingBalance: parseStatementNumber(valueAfterLabel(grid, /^входящий остаток$/)),
        closingBalance: parseStatementNumber(valueAfterLabel(grid, /^исходящий остаток$/)),
        declaredDebit: parseStatementNumber(valueAfterLabel(grid, /^обороты по дебету$/)),
        declaredCredit: parseStatementNumber(valueAfterLabel(grid, /^обороты по кредиту$/)),
        rows: [],
        warnings: ["Выписка распознана корректно: банк указал 0 операций за выбранный период"],
      };
    }
    throw new Error("Не удалось определить заголовки банковской выписки. Нужны колонки с датой и суммой операции");
  }
  const headers = grid[headerIndex].map(normalize);
  const column = (names: readonly string[], forbidden: string[] = []) => {
    const exact = headers.findIndex((cell) => names.includes(cell));
    if (exact >= 0) return exact;
    return headers.findIndex((cell) => names.some((name) => cell.includes(name)) && !forbidden.some((word) => cell.includes(word)));
  };
  const dateColumn = column(aliases.date);
  const debitColumn = column(aliases.debit);
  const creditColumn = column(aliases.credit);
  const amountColumn = column(aliases.amount);
  const directionColumn = column(aliases.direction);
  const documentColumn = column(aliases.document);
  const accountColumn = column(aliases.account, ["контрагент", "получател", "плательщик", "корр", "банк"]);
  const counterpartyColumn = column(aliases.counterparty);
  const innColumn = column(aliases.inn);
  const counterpartyAccountColumn = column(aliases.counterpartyAccount);
  const purposeColumn = column(aliases.purpose);
  const operations: BankStatementRow[] = [];
  const accountCounts = new Map<string, number>();
  const warnings: string[] = [];

  // Одна колонка «Сумма» без списания/зачисления и без направления: знак
  // определить нечем. Раньше такие строки молча становились поступлениями.
  const signUnknown = debitColumn < 0 && creditColumn < 0 && directionColumn < 0;

  for (let index = headerIndex + 1; index < grid.length; index++) {
    const cells = grid[index];
    const date = statementIsoDate(cells[dateColumn] ?? "");
    if (!date) continue;
    const debit = debitColumn >= 0 ? parseStatementNumber(cells[debitColumn] ?? "") : 0;
    const credit = creditColumn >= 0 ? parseStatementNumber(cells[creditColumn] ?? "") : 0;
    const rawAmount = amountColumn >= 0 ? parseStatementNumber(cells[amountColumn] ?? "") : 0;
    const direction = directionColumn >= 0 ? normalize(cells[directionColumn] ?? "") : "";
    let amount = credit > 0 ? credit : debit > 0 ? -debit : rawAmount;
    if (rawAmount && direction) {
      if (/спис|расход|дебет|выбыт/.test(direction)) amount = -Math.abs(rawAmount);
      if (/зачис|приход|кредит|поступ/.test(direction)) amount = Math.abs(rawAmount);
    }
    if (!amount) continue;
    const documentNumber = documentColumn >= 0 ? cells[documentColumn]?.trim() ?? "" : String(index + 1);
    const account = accountColumn >= 0 ? (cells[accountColumn] ?? "").replace(/\D/g, "") : "";
    if (account.length >= 15) accountCounts.set(account, (accountCounts.get(account) ?? 0) + 1);
    operations.push({
      id: `${documentHash}:${index + 1}`,
      date,
      amount,
      counterparty: counterpartyColumn >= 0 ? cells[counterpartyColumn]?.trim() ?? "" : "",
      counterpartyInn: innColumn >= 0 ? cells[innColumn]?.trim() ?? "" : "",
      counterpartyAccount: counterpartyAccountColumn >= 0 ? cells[counterpartyAccountColumn]?.trim() ?? "" : "",
      purpose: purposeColumn >= 0 ? cells[purposeColumn]?.replace(/\s+/g, " ").trim() ?? "" : "",
      documentNumber,
    });
  }
  if (signUnknown && operations.length) {
    warnings.push("В выписке одна колонка «Сумма» без признака списания/зачисления — знак операций не определён, проверьте каждую строку вручную");
  }
  const actualDebit = operations.reduce((sum, row) => sum + Math.max(0, -row.amount), 0);
  const actualCredit = operations.reduce((sum, row) => sum + Math.max(0, row.amount), 0);
  const labeledTotal = (patterns: RegExp[]) => {
    for (const row of grid) {
      for (let index = 0; index < row.length; index++) {
        if (!patterns.some((pattern) => pattern.test(normalize(row[index] ?? "")))) continue;
        for (let offset = 1; offset <= 3; offset++) {
          const parsed = parseStatementNumber(row[index + offset] ?? "");
          if (parsed) return parsed;
        }
      }
    }
    return 0;
  };
  const controlDebit = labeledTotal([/итого.*спис/, /оборот.*дебет/, /всего.*расход/]);
  const controlCredit = labeledTotal([/итого.*зачис/, /оборот.*кредит/, /всего.*поступ/]);
  const declaredDebit = controlDebit || actualDebit;
  const declaredCredit = controlCredit || actualCredit;
  if (!operations.length) warnings.push("В выписке не найдено операций с датой и суммой");
  if (controlDebit && Math.abs(actualDebit - controlDebit) > 0.01) warnings.push("Сумма расходов не совпала с контрольной суммой банка");
  if (controlCredit && Math.abs(actualCredit - controlCredit) > 0.01) warnings.push("Сумма поступлений не совпала с контрольной суммой банка");
  const dates = operations.map((row) => row.date).sort();
  const accountNumber = [...accountCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

  const owner = metadata.match(/(?:Клиент|Владелец|Наименование\s+клиента|Наименование\s+организации)\s*:?\s*([^<]{3,160}?)(?=\s+ИНН\s*:|\s+Счет\s*:|\s+Счёт\s*:)/i)?.[1]?.trim() ?? "";
  const ownerInn = metadata.match(/ИНН\s*:?\s*(\d{10,12})/i)?.[1] ?? "";
  const bank = /банк точка/i.test(metadata) ? "Банк Точка" : /озон банк|ozon/i.test(metadata) ? "Ozon Банк" : /т[- ]?банк|тинькофф/i.test(metadata) ? "Т-Банк" : "Банковская выписка";
  return {
    documentHash,
    bank,
    owner,
    ownerInn,
    accountNumber,
    dateFrom: dates[0] ?? "",
    dateTo: dates.at(-1) ?? "",
    openingBalance: 0,
    closingBalance: 0,
    declaredDebit,
    declaredCredit,
    rows: operations,
    warnings,
  };
}
