export interface EditableLoanScheduleRow {
  id: string;
  date: string;
  principal: number;
  interest: number;
  penalty: number;
  fine: number;
  status: "planned" | "done" | "cancelled";
}

export interface LoanScheduleCorrectionResult<T extends EditableLoanScheduleRow> {
  schedule: T[];
  actions: string[];
}

const MONTHS: Record<string, number> = {
  январ: 1, феврал: 2, март: 3, апрел: 4, ма: 5, июн: 6,
  июл: 7, август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12,
};
const MONTH_WORD = "(?:январ[ьяе]?|феврал[ьяе]?|март[ае]?|апрел[ьяе]?|ма[йяе]|июн[ьяе]?|июл[ьяе]?|август[ае]?|сентябр[ьяе]?|октябр[ьяе]?|ноябр[ьяе]?|декабр[ьяе]?)";
const DATE_OR_MONTH = `(\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}|${MONTH_WORD}(?:\\s+\\d{4})?)`;

function monthNumber(value: string) {
  const normalized = value.toLowerCase().replace(/ё/g, "е");
  return Object.entries(MONTHS).find(([stem]) => normalized.startsWith(stem))?.[1] ?? 0;
}

function isoExactDate(value: string) {
  const match = value.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (!match) return "";
  const year = match[3].length === 2 ? Number(`20${match[3]}`) : Number(match[3]);
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function contextualMonthYear(text: string, reference: string, after?: string) {
  const exact = isoExactDate(reference);
  if (exact) return exact;
  const month = monthNumber(reference);
  if (!month) return "";
  const explicitYear = Number(reference.match(/\b(20\d{2})\b/)?.[1] ?? 0);
  const mentions = [...text.matchAll(new RegExp(`(${MONTH_WORD})\\s+(20\\d{2})`, "gi"))];
  const mentionedYear = Number(mentions.find((match) => monthNumber(match[1]) === month)?.[2] ?? 0);
  let year = explicitYear || mentionedYear;
  if (!year && after) {
    const sourceYear = Number(after.slice(0, 4));
    const sourceMonth = Number(after.slice(5, 7));
    year = month > sourceMonth ? sourceYear : sourceYear + 1;
  }
  if (!year) return "";
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function amount(value: string | undefined) {
  if (!value) return 0;
  const normalized = value.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

function pastedScheduleRows<T extends EditableLoanScheduleRow>(text: string, makeRow: (row: Omit<T, "id">) => T) {
  const rows: T[] = [];
  for (const line of text.split(/\r?\n/)) {
    const date = isoExactDate(line);
    if (!date) continue;
    const afterDate = line.replace(/.*?\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/, "");
    const labeled = (label: RegExp) => amount(afterDate.match(label)?.[1]);
    let principal = labeled(/(?:тело|основн[а-яa-z]*\s+долг)\s*[:=-]?\s*([\d\s.,]+)/i);
    let interest = labeled(/процент[а-яa-z]*\s*[:=-]?\s*([\d\s.,]+)/i);
    let penalty = labeled(/пен[ия][а-яa-z]*\s*[:=-]?\s*([\d\s.,]+)/i);
    let fine = labeled(/штраф[а-яa-z]*\s*[:=-]?\s*([\d\s.,]+)/i);
    if (principal + interest + penalty + fine === 0) {
      const values = [...afterDate.matchAll(/(?:^|[;|\t])\s*([\d\s]+(?:[.,]\d+)?)\s*(?=$|[;|\t])/g)].map((match) => amount(match[1]));
      [principal = 0, interest = 0, penalty = 0, fine = 0] = values;
    }
    if (principal + interest + penalty + fine <= 0) continue;
    rows.push(makeRow({ date, principal, interest, penalty, fine, status: "planned" } as Omit<T, "id">));
  }
  return rows;
}

export function applyLoanScheduleCorrections<T extends EditableLoanScheduleRow>(
  source: T[],
  correctionText: string,
  makeRow: (row: Omit<T, "id">) => T,
): LoanScheduleCorrectionResult<T> {
  // Терпимо относимся к частой опечатке в названиях месяцев: «февральь».
  const text = correctionText.toLowerCase().replace(/ё/g, "е").replace(/ь{2,}/g, "ь");
  let schedule = source.map((row) => ({ ...row }));
  const actions: string[] = [];

  const unpaidRange = text.match(new RegExp(`с\\s+${DATE_OR_MONTH}\\s+по\\s+${DATE_OR_MONTH}[^.!?\\n]*(?:не\\s+платили|не\\s+оплачен)`, "i"));
  if (unpaidRange) {
    const from = contextualMonthYear(text, unpaidRange[1]);
    const to = contextualMonthYear(text, unpaidRange[2], from);
    if (from && to) {
      let changed = 0;
      schedule = schedule.map((row) => row.date.slice(0, 7) >= from.slice(0, 7) && row.date.slice(0, 7) <= to.slice(0, 7)
        ? (changed++, { ...row, status: "planned" })
        : row);
      if (changed) actions.push(`Платежи ${from.slice(0, 7)}–${to.slice(0, 7)} отмечены неоплаченными`);
    }
  }

  const move = text.match(new RegExp(`перенест[а-яa-z]*\\s+(?:плат[еe]ж[а-яa-z]*\\s+)?(?:с|за|от)?\\s*${DATE_OR_MONTH}\\s+(?:на|в)\\s+${DATE_OR_MONTH}`, "i"));
  if (move) {
    const from = contextualMonthYear(text, move[1]);
    const targetBase = contextualMonthYear(text, move[2], from);
    const sourceIndex = schedule.findIndex((row) => row.date.slice(0, 7) === from.slice(0, 7));
    if (sourceIndex >= 0 && targetBase) {
      const original = schedule[sourceIndex];
      const targetDate = `${targetBase.slice(0, 7)}-${original.date.slice(8, 10)}`;
      schedule[sourceIndex] = { ...original, date: targetDate, status: "planned" };
      actions.push(`Платёж ${original.date} перенесён на ${targetDate}`);
    }
  }

  if (/нов(?:ый|ого)\s+график|замен(?:ить|и)\s+график|добав(?:ить|ь)\s+(?:в\s+график\s+)?плат[еe]ж/i.test(text)) {
    const pasted = pastedScheduleRows(correctionText, makeRow);
    if (pasted.length) {
      const replace = /нов(?:ый|ого)\s+график|замен(?:ить|и)\s+график/i.test(text);
      schedule = replace ? pasted : [...schedule, ...pasted];
      actions.push(replace ? `График заменён: ${pasted.length} строк` : `Добавлено строк графика: ${pasted.length}`);
    }
  }

  return { schedule: schedule.sort((left, right) => left.date.localeCompare(right.date)), actions };
}
