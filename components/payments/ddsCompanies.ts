"use client";

import type { CompanyTaxSystem, CompanyVatMode } from "@/lib/finance/companyTax";

export interface DdsCompany {
  id: string;
  name: string;
  groupName: string;
  isActive: boolean;
  taxSystem?: CompanyTaxSystem | null;
  vatMode?: CompanyVatMode | null;
}

// До применения миграции в старых данных могла остаться техническая запись
// «Общая группа РИО». Для пользователя это одна и та же «Основная группа»;
// нормализуем подпись сразу, чтобы интерфейс не зависел от времени деплоя БД.
export function companyLabel(name: string): string {
  return name === "Общая группа РИО" ? "Основная группа" : name;
}

export interface PaymentCompanyLink {
  paymentId: string;
  companyId: string | null;
}

interface CompanyRow {
  id: string;
  name: string;
  group_name: string;
  is_active: boolean;
  tax_system: CompanyTaxSystem | null;
  vat_mode: CompanyVatMode | null;
}

interface CompaniesResponse {
  companies?: CompanyRow[];
  payment_links?: Array<{ id: string; company_id: string | null }>;
  company?: CompanyRow;
  error?: string;
}

async function json<T extends { error?: string }>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T;
  if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
  return body;
}

async function load(): Promise<CompaniesResponse> {
  return fetch("/api/finance/companies", { cache: "no-store" }).then(json<CompaniesResponse>);
}

export async function loadDdsCompanies(): Promise<DdsCompany[]> {
  const body = await load();
  return (body.companies ?? []).map(companyFromRow);
}

export async function loadPaymentCompanyLinks(): Promise<PaymentCompanyLink[]> {
  const body = await load();
  return (body.payment_links ?? []).map((row) => ({ paymentId: row.id, companyId: row.company_id }));
}

export async function createDdsCompany(name: string, groupName: string): Promise<DdsCompany> {
  const body = await fetch("/api/finance/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create", name, group_name: groupName }),
  }).then(json<CompaniesResponse>);
  if (!body.company) throw new Error("Юрлицо не вернулось после сохранения");
  return companyFromRow(body.company);
}

function companyFromRow(row: CompanyRow): DdsCompany {
  return {
    id: row.id,
    name: companyLabel(row.name),
    groupName: row.group_name,
    isActive: row.is_active,
    taxSystem: row.tax_system ?? null,
    vatMode: row.vat_mode ?? null,
  };
}

export async function updateDdsCompany(company: DdsCompany): Promise<DdsCompany> {
  const body = await fetch("/api/finance/companies", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "company",
      company_id: company.id,
      is_active: company.isActive,
      tax_system: company.taxSystem,
      vat_mode: company.vatMode,
    }),
  }).then(json<CompaniesResponse>);
  if (!body.company) throw new Error("Юрлицо не вернулось после сохранения");
  return companyFromRow(body.company);
}

export async function savePaymentWithCompany(
  payment: {
    id: string;
    name: string;
    amount: number;
    category: string;
    accountId: string;
    date: string;
    status: string;
    counterparty: string;
    comment?: string;
  },
  companyId: string,
): Promise<void> {
  await fetch("/api/finance/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "payment", payment, company_id: companyId }),
  }).then(json<{ error?: string; ok?: boolean }>);
}

export async function updatePaymentCompany(paymentId: string, companyId: string | null): Promise<void> {
  await fetch("/api/finance/companies", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payment_id: paymentId, company_id: companyId }),
  }).then(json<{ error?: string; ok?: boolean }>);
}
