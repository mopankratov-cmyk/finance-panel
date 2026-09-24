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
  const clean = raw.trim();
  const ru = clean.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (ru) return `${ru[3]}-${ru[2].padStart(2, "0")}-${ru[1].padStart(2, "0")}`;
  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // В XLSX дата часто хранится серийным числом, а формат ячейки живёт
  // отдельно. xlsxGrid возвращает значение, поэтому преобразуем его здесь.
  const serial = Number(clean);
  if (Number.isFinite(serial) && serial > 20_000 && serial < 100_000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
  }
  return null;
}

function findIndex(header: string[], ...names: string[]): number {
  const norm = (s: string) => s.trim().toLowerCase();
  for (const name of names) {
    const idx = header.findIndex((h) => norm(h) === norm(name));
    if (idx !== -1) return idx;
  }
  return -1;
}

export function parseDdsRows(rows: string[][]): DdsParseResult {
  // Выгрузки из разных систем отличаются регистром и написанием «ё».
  const headerIdx = rows.findIndex((row) => {
    const normalized = row.map((cell) => cell.trim().toLowerCase().replace(/ё/g, "е"));
    return normalized.includes("дата")
      && normalized.includes("сумма")
      && normalized.some((cell) => cell === "кошелек" || cell === "счет" || cell === "банковский счет");
  });

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
    wallet: findIndex(header, "Кошелек", "Кошелёк", "Счет", "Счёт", "Банковский счет", "Банковский счёт"),
    company: findIndex(header, "Направление бизнеса"),
    counterparty: findIndex(header, "Контрагент"),
    purpose: findIndex(header, "Назначение платежа", "Назначение", "Описание платежа"),
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
      // Назначение — это первичный текст факта. Оно может содержать имя
      // заёмщика, номер договора или пояснение бухгалтера. Сохраняем его и в
      // видимом названии, и полностью в комментарии: название ограничивается
      // 200 символами, а сверка кредитов ищет по обоим полям.
      comment: [activity ? `ДДС · ${activity}` : "ДДС", purpose ? `Назначение платежа: ${purpose.slice(0, 5_000)}` : ""]
        .filter(Boolean)
        .join(" · "),
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

export function parseDdsCsv(text: string): DdsParseResult {
  return parseDdsRows(parseCsv(text));
}

export { COMPANY_GROUP };
