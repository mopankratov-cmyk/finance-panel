"use client";

import { sameCompanyAlias } from "@/lib/finance/companyAliases";
import {
  companyGroupLabel,
  companyLabel,
  isLegacySharedExpenseCompany,
  UNASSIGNED_COMPANY_LABEL,
} from "@/lib/finance/companyLabels";
import type { CompanyTaxSystem, CompanyVatMode } from "@/lib/finance/companyTax";

export { companyGroupLabel, companyLabel, UNASSIGNED_COMPANY_LABEL } from "@/lib/finance/companyLabels";

export interface DdsCompany {
  id: string;
  name: string;
  groupName: string;
  isActive: boolean;
  taxSystem?: CompanyTaxSystem | null;
  vatMode?: CompanyVatMode | null;
  taxSettingsAvailable?: boolean;
}

export interface DdsCompanyGroupOption {
  name: string;
  label: string;
}

export interface DdsCompanyScopeOptions {
  groups: DdsCompanyGroupOption[];
  companies: DdsCompany[];
  unassignedCompanyIds: string[];
}

/** Алиасы одного юрлица показываем одним пунктом, настоящие группы — отдельно. */
export function companyScopeOptions(companies: readonly DdsCompany[]): DdsCompanyScopeOptions {
  const active = companies.filter((company) => company.isActive);
  const grouped = new Map<string, DdsCompany[]>();
  const hiddenCompanyIds = new Set<string>();
  const unassignedCompanyIds = active.filter((company) => isLegacySharedExpenseCompany(company.name)).map((company) => company.id);
  unassignedCompanyIds.forEach((id) => hiddenCompanyIds.add(id));
  for (const company of companies) {
    const groupName = companyGroupLabel(company.groupName.trim());
    if (!company.isActive || !groupName) continue;
    const members = grouped.get(groupName) ?? [];
    members.push(company);
    grouped.set(groupName, members);
  }
  const groups = [...grouped]
    .filter(([, members]) => members.length > 1)
    .map(([name, members]) => {
      const aliasesOfOneCompany = members.every((member) => sameCompanyAlias(members[0].name, member.name));
      if (aliasesOfOneCompany) {
        members.forEach((member) => hiddenCompanyIds.add(member.id));
        const canonical = members.find((member) => /коровкин/i.test(member.name)) ?? members[0];
        return { name, label: canonical.name };
      }
      return { name, label: name === "Основная группа" ? "Основная группа" : `Группа «${name}» — все компании` };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  return { groups, companies: active.filter((company) => !hiddenCompanyIds.has(company.id)), unassignedCompanyIds };
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
  tax_settings_available?: boolean;
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
  return (body.companies ?? []).map((row) => companyFromRow(row, body.tax_settings_available));
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
  return companyFromRow(body.company, body.tax_settings_available);
}

function companyFromRow(row: CompanyRow, taxSettingsAvailable = true): DdsCompany {
  return {
    id: row.id,
    name: companyLabel(row.name),
    groupName: companyGroupLabel(row.group_name),
    isActive: row.is_active,
    taxSystem: row.tax_system ?? null,
    vatMode: row.vat_mode ?? null,
    taxSettingsAvailable,
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
      ...(company.taxSettingsAvailable === false ? {} : { tax_system: company.taxSystem ?? null, vat_mode: company.vatMode ?? null }),
    }),
  }).then(json<CompaniesResponse>);
  if (!body.company) throw new Error("Юрлицо не вернулось после сохранения");
  return companyFromRow(body.company, body.tax_settings_available);
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
