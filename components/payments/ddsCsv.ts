// Разбор экспорта Google-таблицы «ДДС» в черновики платежей.
// Формат: первые строки — сводка балансов, строка-заголовок содержит
// «Дата»/«Сумма»/«Кошелек», дальше идут платежи. Источник истины по
// приходу/расходу — ЗНАК суммы (колонка «Платеж/поступл» бывает рассогласована).

const COMPANY_GROUP = "Группа (общее)";

export interface DdsDraft {
  date: string; // ISO yyyy-mm-dd
  amount: number; // со знаком: + приход, − расход
  name: string;
  category: string; // Статья
  wallet: string; // Кошелёк → счёт
  counterparty: string;
  activity: string; // Вид деятельности (операционная/финансовая/…)
  company: string; // Направление бизнеса (для Этапа 2)
  /** Компания по id — приоритетнее имени. Очередь выписок передаёт именно его: имя могло измениться. */
  companyId?: string | null;
  comment?: string;
  importSource?: string; // устойчивый ключ для идемпотентного импорта из внешней очереди
}

export interface DdsParseResult {
  drafts: DdsDraft[];
  wallets: string[]; // кошельки, встретившиеся в сделках
  walletDirectory: string[]; // полный справочник кошельков из верхней панели
  categories: string[]; // уникальные статьи
  totalIncome: number;
  totalExpense: number; // положительное число
  skipped: number; // строки без корректной даты/суммы
  warnings: string[];
}

// Ячейка — это «число» (баланс), а не имя кошелька?
function looksNumeric(v: string): boolean {
  const c = v.replace(/[\s  ,.\-]/g, "");
  return c === "" || /^\d+$/.test(c);
}

// CSV-парсер с поддержкой кавычек, экранированных кавычек и переводов строк внутри ячеек.
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // пропускаем — перевод строки обработаем по \n
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// "-5 000,00" (пробелы могут быть неразрывными) → -5000
export function parseRussianAmount(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[\s  ]/g, "") // обычный + неразрывный + узкий неразрывный пробел
    .replace("−", "-") // типографский минус
    .replace(",", ".");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// "01.02.2026" → "2026-02-01"
export function parseRussianDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function findIndex(header: string[], ...names: string[]): number {
  const norm = (s: string) => s.trim().toLowerCase();
  for (const name of names) {
    const idx = header.findIndex((h) => norm(h) === norm(name));
    if (idx !== -1) return idx;
  }
  return -1;
}

export function parseDdsCsv(text: string): DdsParseResult {
  const rows = parseCsv(text);

  // строка-заголовок: содержит «Дата» и «Сумма» и «Кошелек»
  const headerIdx = rows.findIndex(
    (r) =>
      r.some((c) => c.trim() === "Дата") &&
      r.some((c) => c.trim() === "Сумма") &&
      r.some((c) => c.trim().toLowerCase().startsWith("кошел")),
  );

  const warnings: string[] = [];
  if (headerIdx === -1) {
    return {
      drafts: [],
      wallets: [],
      walletDirectory: [],
      categories: [],
      totalIncome: 0,
      totalExpense: 0,
      skipped: 0,
      warnings: [
        "Не найдена строка-заголовок (с колонками «Дата», «Сумма», «Кошелек»). Это точно экспорт ДДС в CSV?",
      ],
    };
  }

  // Справочник кошельков — из верхней панели балансов (строки до заголовка):
  // непустые текстовые ячейки, кроме «ИТОГО» и чисел-балансов.
  const walletDir = new Set<string>();
  for (let i = 0; i < headerIdx; i++) {
    for (const cell of rows[i]) {
      const v = cell.trim();
      if (v && v !== "ИТОГО" && !looksNumeric(v)) walletDir.add(v);
    }
  }

  const header = rows[headerIdx];
  const col = {
    date: findIndex(header, "Дата"),
    amount: findIndex(header, "Сумма"),
    wallet: findIndex(header, "Кошелек", "Кошелёк"),
    company: findIndex(header, "Направление бизнеса"),
    counterparty: findIndex(header, "Контрагент"),
    purpose: findIndex(header, "Назначение платежа"),
    category: findIndex(header, "Статья"),
    activity: findIndex(header, "Вид д-ти", "Вид деятельности"),
  };

  const drafts: DdsDraft[] = [];
  const wallets = new Set<string>();
  const categories = new Set<string>();
  let totalIncome = 0;
  let totalExpense = 0;
  let skipped = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const date = parseRussianDate(r[col.date] ?? "");
    const amount = parseRussianAmount(r[col.amount] ?? "");
    if (!date || amount === null || amount === 0) {
      // строки без даты/суммы — это разделители, итоги, битые формулы (#REF!)
      if ((r[col.date] ?? "").trim() || (r[col.amount] ?? "").trim()) skipped++;
      continue;
    }

    const wallet = (r[col.wallet] ?? "").trim() || "Без кошелька";
    const category = (r[col.category] ?? "").trim() || "Без статьи";
    const counterparty = (r[col.counterparty] ?? "").trim();
    const activity = (r[col.activity] ?? "").trim();
    const companyRaw = (r[col.company] ?? "").trim();
    const company = !companyRaw || companyRaw === "Общее" ? COMPANY_GROUP : companyRaw;
    const purpose = (r[col.purpose] ?? "").replace(/\s+/g, " ").trim();

    const name = purpose || category || counterparty || "Платёж";

    wallets.add(wallet);
    categories.add(category);
    if (amount > 0) totalIncome += amount;
    else totalExpense += -amount;

    drafts.push({
      date,
      amount,
      name: name.slice(0, 200),
      category,
      wallet,
      counterparty,
      activity,
      company,
      comment: activity ? `ДДС · ${activity}` : "ДДС",
    });
  }

  if (drafts.length === 0) {
    warnings.push("В файле не найдено ни одной строки с корректной датой и суммой.");
  }

  // полный справочник = панель ∪ кошельки из сделок
  const fullDir = new Set<string>(walletDir);
  for (const w of wallets) fullDir.add(w);

  return {
    drafts,
    wallets: [...wallets].sort(),
    walletDirectory: [...fullDir].sort(),
    categories: [...categories].sort(),
    totalIncome,
    totalExpense,
    skipped,
    warnings,
  };
}

export { COMPANY_GROUP };
