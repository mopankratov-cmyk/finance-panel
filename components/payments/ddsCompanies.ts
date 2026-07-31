"use client";

export interface DdsCompany {
  id: string;
  name: string;
  groupName: string;
  isActive: boolean;
}

export interface PaymentCompanyLink {
  paymentId: string;
  companyId: string | null;
}

interface CompaniesResponse {
  companies?: Array<{ id: string; name: string; group_name: string; is_active: boolean }>;
  payment_links?: Array<{ id: string; company_id: string | null }>;
  company?: { id: string; name: string; group_name: string; is_active: boolean };
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
  return (body.companies ?? []).map((row) => ({ id: row.id, name: row.name, groupName: row.group_name, isActive: row.is_active }));
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
  return { id: body.company.id, name: body.company.name, groupName: body.company.group_name, isActive: body.company.is_active };
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
