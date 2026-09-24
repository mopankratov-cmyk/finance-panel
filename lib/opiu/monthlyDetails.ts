export type MonthlyOpiuDetailSource = "dds" | "payroll" | "loan" | "wb" | "ozon" | "calculation";

export interface MonthlyOpiuDetailItem {
  id: string;
  source: MonthlyOpiuDetailSource;
  date?: string | null;
  title: string;
  subtitle?: string | null;
  amount: number;
  href?: string | null;
}

export interface MonthlyOpiuDetailsResponse {
  articleId: string;
  source: MonthlyOpiuDetailSource;
  total: number;
  items: MonthlyOpiuDetailItem[];
  note?: string;
}

export const PAYROLL_DETAIL_ARTICLES = new Set(["admin_salary", "commercial_salary", "payroll_taxes"]);
export const LOAN_DETAIL_ARTICLES = new Set(["loan_interest"]);

export const MONTHLY_RESULT_COMPONENTS: Readonly<Record<string, readonly { id: string; sign: 1 | -1 }[]>> = {
  marginal_income: [{ id: "revenue_total", sign: 1 }, { id: "variable_total", sign: -1 }],
  direction_gross: [{ id: "marginal_income", sign: 1 }, { id: "direct_fixed_total", sign: -1 }],
  gross_profit: [{ id: "direction_gross", sign: 1 }, { id: "manufacturing_total", sign: -1 }],
  ebitda: [
    { id: "gross_profit", sign: 1 },
    { id: "administrative_total", sign: -1 },
    { id: "commercial_total", sign: -1 },
  ],
  net_profit: [
    { id: "ebitda", sign: 1 },
    { id: "below_income_total", sign: 1 },
    { id: "below_expense_total", sign: -1 },
  ],
  marginal_margin: [{ id: "marginal_income", sign: 1 }, { id: "revenue_total", sign: 1 }],
  direction_gross_margin: [{ id: "direction_gross", sign: 1 }, { id: "revenue_total", sign: 1 }],
  gross_margin: [{ id: "gross_profit", sign: 1 }, { id: "revenue_total", sign: 1 }],
  ebitda_margin: [{ id: "ebitda", sign: 1 }, { id: "revenue_total", sign: 1 }],
  net_margin: [{ id: "net_profit", sign: 1 }, { id: "revenue_total", sign: 1 }],
};

