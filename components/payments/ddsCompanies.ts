"use client";

import { supabase } from "@/lib/supabase";

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

const PAGE_SIZE = 1000;

export async function loadDdsCompanies(): Promise<DdsCompany[]> {
  const { data, error } = await supabase
    .from("companies")
    .select("id,name,group_name,is_active")
    .order("group_name")
    .order("name");

  if (error) throw new Error(`Не удалось загрузить компании: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    groupName: row.group_name,
    isActive: row.is_active,
  }));
}

export async function loadPaymentCompanyLinks(): Promise<PaymentCompanyLink[]> {
  const rows: PaymentCompanyLink[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("payments")
      .select("id,company_id")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Не удалось загрузить компании платежей: ${error.message}`);

    const page = (data ?? []).map((row) => ({
      paymentId: row.id,
      companyId: row.company_id,
    }));
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

export async function createDdsCompany(name: string, groupName: string): Promise<DdsCompany> {
  const cleanName = name.trim();
  const cleanGroup = groupName.trim();
  if (!cleanName || !cleanGroup) throw new Error("Укажите название юрлица и группу");

  const { data: existing, error: lookupError } = await supabase
    .from("companies")
    .select("id")
    .ilike("name", cleanName)
    .limit(1);
  if (lookupError) throw new Error(`Не удалось проверить юрлицо: ${lookupError.message}`);
  if ((existing ?? []).length > 0) throw new Error("Юрлицо с таким названием уже существует");

  const { data, error } = await supabase
    .from("companies")
    .insert({ name: cleanName, group_name: cleanGroup, is_active: true })
    .select("id,name,group_name,is_active")
    .single();

  if (error) throw new Error(`Не удалось добавить юрлицо: ${error.message}`);

  return {
    id: data.id,
    name: data.name,
    groupName: data.group_name,
    isActive: data.is_active,
  };
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
  const { error } = await supabase.from("payments").upsert({
    id: payment.id,
    name: payment.name,
    amount: payment.amount,
    type: payment.amount >= 0 ? "income" : "expense",
    category: payment.category,
    account_id: payment.accountId,
    date: payment.date,
    status: payment.status,
    counterparty: payment.counterparty,
    comment: payment.comment ?? null,
    company_id: companyId,
  });

  if (error) throw new Error(`Не удалось сохранить платёж: ${error.message}`);
}

export async function updatePaymentCompany(
  paymentId: string,
  companyId: string | null,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from("payments")
      .update({ company_id: companyId })
      .eq("id", paymentId)
      .select("id");

    if (error) throw new Error(`Не удалось изменить компанию платежа: ${error.message}`);
    if ((data ?? []).length > 0) return;
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }
  throw new Error("Платёж сохранён, но компанию назначить не удалось. Обновите страницу и повторите.");
}
