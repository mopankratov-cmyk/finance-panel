import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { audit } from "@/lib/audit/log";
import { readCompaniesCompat } from "@/lib/finance/companySchema";
import { parseCompanyTaxRate, parseCompanyTaxSystem, parseCompanyVatMode } from "@/lib/finance/companyTax";
import { buildOpiuCompanyScopes } from "@/lib/opiu/companyScope";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  parsePaymentVat,
  type UsnExpenseStatus,
  type VatDeductionStatus,
  type VatDocumentStatus,
} from "@/lib/finance/taxCalculation";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_KEY = /^\d{4}-Q[1-4]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOCUMENT_STATUSES = new Set<VatDocumentStatus>(["missing", "received", "not_required"]);
const DEDUCTION_STATUSES = new Set<VatDeductionStatus>(["pending", "eligible", "not_eligible"]);
const USN_STATUSES = new Set<UsnExpenseStatus>(["pending", "included", "excluded"]);
const TAX_PAYMENT_KINDS = new Set(["operating_expense", "insurance_contribution", "usn_tax_payment", "other_tax"] as const);
const MARKETPLACES = new Set(["wb", "ozon", "other"] as const);
const MISSING_TABLE = new Set(["42P01", "PGRST204", "PGRST205"]);

type PaymentRow = {
  id: string;
  date: string;
  name: string;
  amount: number | string;
  category: string;
  counterparty: string | null;
  comment: string | null;
  company_id: string | null;
  import_source: string | null;
};

type DetailRow = {
  payment_id: string;
  vat_rate: number | string | null;
  vat_amount: number | string;
  vat_document_status: VatDocumentStatus;
  vat_deduction_status: VatDeductionStatus;
  usn_expense_status: UsnExpenseStatus;
  note: string;
  tax_payment_kind?: TaxPaymentKind;
};

type TaxPaymentKind = "operating_expense" | "insurance_contribution" | "usn_tax_payment" | "other_tax";

type MarketplaceTaxDocumentRow = {
  id: string;
  marketplace: "wb" | "ozon" | "other";
  document_date: string;
  document_number: string;
  gross_expense_amount: number | string;
  vat_rate: number | string | null;
  vat_amount: number | string;
  vat_document_status: VatDocumentStatus;
  vat_deduction_status: VatDeductionStatus;
  usn_expense_status: UsnExpenseStatus;
  note: string;
};

type TaxYearSettingsRow = {
  fixed_insurance_contributions: number | string;
  insurance_reduction_limit_percent: number | string;
  prior_year_loss: number | string;
  recognized_cogs: number | string;
  output_vat_confirmed: number | string | null;
  has_employees: boolean;
  note: string;
};

type TaxPeriodRow = {
  period_key: string;
  marketplace_input_vat_confirmed: number | string;
  note: string;
};

async function authorize() {
  return requireApiSession(["director", "fin_director", "financier"]);
}

async function companies() {
  const db = getSupabaseAdmin()!;
  const [loaded, entities, links] = await Promise.all([
    readCompaniesCompat((columns) => db.from("companies").select(columns).order("group_name").order("name")),
    db.from("legal_entities").select("id,name"),
    db.from("legal_entity_cabinets").select("legal_entity_id,cabinet_id"),
  ]);
  const error = loaded.result.error ?? entities.error ?? links.error;
  if (error) throw new Error(error.message);
  return buildOpiuCompanyScopes((loaded.result.data ?? []).map((raw) => {
    const row = raw as unknown as Record<string, unknown>;
    return {
      id: String(row.id),
      name: String(row.name),
      groupName: String(row.group_name ?? ""),
      isActive: Boolean(row.is_active),
      ...(loaded.taxSettingsAvailable ? {
        taxSystem: parseCompanyTaxSystem(row.tax_system) ?? null,
        vatMode: parseCompanyVatMode(row.vat_mode) ?? null,
      } : {}),
      ...(loaded.taxRatesAvailable ? {
        taxRate: parseCompanyTaxRate(row.tax_rate) ?? null,
        taxAdditionalRate: parseCompanyTaxRate(row.tax_additional_rate) ?? null,
      } : {}),
    };
  }), (entities.data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
  })), (links.data ?? []).map((row) => ({
    legalEntityId: String(row.legal_entity_id),
    cabinetId: String(row.cabinet_id),
  })));
}

async function loadDetails(paymentIds: string[]): Promise<{ byId: Map<string, DetailRow>; available: boolean }> {
  const db = getSupabaseAdmin()!;
  const byId = new Map<string, DetailRow>();
  for (let index = 0; index < paymentIds.length; index += 200) {
    const result = await db
      .from("payment_tax_details")
      .select("payment_id,vat_rate,vat_amount,vat_document_status,vat_deduction_status,usn_expense_status,note,tax_payment_kind")
      .in("payment_id", paymentIds.slice(index, index + 200));
    if (result.error) {
      if (MISSING_TABLE.has(result.error.code ?? "") || /payment_tax_details.*(?:does not exist|schema cache)|tax_payment_kind.*(?:does not exist|schema cache|could not find)/i.test(result.error.message)) {
        return { byId: new Map(), available: false };
      }
      throw new Error(result.error.message);
    }
    for (const row of (result.data ?? []) as DetailRow[]) byId.set(row.payment_id, row);
  }
  return { byId, available: true };
}

async function loadLiveTaxSettings(companyId: string, year: number, from: string, to: string) {
  const db = getSupabaseAdmin()!;
  const [settings, documents] = await Promise.all([
    db.from("company_tax_year_settings")
      .select("fixed_insurance_contributions,insurance_reduction_limit_percent,prior_year_loss,recognized_cogs,output_vat_confirmed,has_employees,note")
      .eq("company_id", companyId).eq("tax_year", year).maybeSingle(),
    db.from("marketplace_tax_documents")
      .select("id,marketplace,document_date,document_number,gross_expense_amount,vat_rate,vat_amount,vat_document_status,vat_deduction_status,usn_expense_status,note")
      .eq("company_id", companyId).gte("document_date", from).lte("document_date", to)
      .order("document_date", { ascending: true }).order("id", { ascending: true }),
  ]);
  const error = settings.error ?? documents.error;
  if (error) {
    if (MISSING_TABLE.has(error.code ?? "") || /company_tax_year_settings|marketplace_tax_documents|tax_payment_kind.*(?:does not exist|schema cache)/i.test(error.message)) {
      return { available: false, yearSettings: null, documents: [] as MarketplaceTaxDocumentRow[] };
    }
    throw new Error(error.message);
  }
  return {
    available: true,
    yearSettings: settings.data as TaxYearSettingsRow | null,
    documents: (documents.data ?? []) as MarketplaceTaxDocumentRow[],
  };
}

async function loadWbReportedInputVat(cabinetIds: string[], from: string, to: string): Promise<number | null> {
  if (!cabinetIds.length) return 0;
  const db = getSupabaseAdmin()!;
  const result = await db.rpc("tax_wb_input_vat", { p_cabinet_ids: cabinetIds, p_from: from, p_to: to });
  if (result.error) {
    if (MISSING_TABLE.has(result.error.code ?? "") || /tax_wb_input_vat|ppvz_vw_nds.*(?:does not exist|schema cache|could not find)/i.test(result.error.message)) return null;
    throw new Error(result.error.message);
  }
  return Math.round(Math.max(0, Number(result.data) || 0) * 100) / 100;
}

async function loadWbAdvertisingExpense(cabinetIds: string[], from: string, to: string): Promise<number | null> {
  if (!cabinetIds.length) return 0;
  const db = getSupabaseAdmin()!;
  const result = await db.rpc("tax_wb_advert_expense", { p_cabinet_ids: cabinetIds, p_from: from, p_to: to });
  if (result.error) {
    if (MISSING_TABLE.has(result.error.code ?? "") || /tax_wb_advert_expense|wb_advert_spend_history.*(?:does not exist|schema cache|could not find)/i.test(result.error.message)) return null;
    throw new Error(result.error.message);
  }
  return Math.round(Math.max(0, Number(result.data) || 0) * 100) / 100;
}

async function loadWbAdvertisingCoverageStart(cabinetIds: string[]): Promise<string | null> {
  if (!cabinetIds.length) return null;
  const db = getSupabaseAdmin()!;
  const result = await db.rpc("tax_wb_advert_coverage_start", { p_cabinet_ids: cabinetIds });
  if (result.error) {
    if (MISSING_TABLE.has(result.error.code ?? "") || /tax_wb_advert_coverage_start|wb_advert_spend_history.*(?:does not exist|schema cache|could not find)/i.test(result.error.message)) return null;
    throw new Error(result.error.message);
  }
  return typeof result.data === "string" ? result.data : null;
}

async function loadCompanyTaxSettings(companyId: string, from: string, to: string) {
  const db = getSupabaseAdmin()!;
  const profile = await db.from("company_tax_profiles").select("vat_effective_from").eq("company_id", companyId).maybeSingle();
  if (profile.error && !(MISSING_TABLE.has(profile.error.code ?? "") || /company_tax_profiles.*(?:does not exist|schema cache)/i.test(profile.error.message))) {
    throw new Error(profile.error.message);
  }
  if (profile.error) return { available: false, vatEffectiveFrom: null, periods: [] as TaxPeriodRow[] };
  const firstYear = Number(from.slice(0, 4));
  const lastYear = Number(to.slice(0, 4));
  const periods = await db.from("company_tax_periods")
    .select("period_key,marketplace_input_vat_confirmed,note")
    .eq("company_id", companyId)
    .gte("period_key", `${firstYear}-Q1`)
    .lte("period_key", `${lastYear}-Q4`)
    .order("period_key");
  if (periods.error) {
    if (MISSING_TABLE.has(periods.error.code ?? "") || /company_tax_periods.*(?:does not exist|schema cache)/i.test(periods.error.message)) {
      return { available: false, vatEffectiveFrom: profile.data?.vat_effective_from ?? null, periods: [] as TaxPeriodRow[] };
    }
    throw new Error(periods.error.message);
  }
  return {
    available: true,
    vatEffectiveFrom: profile.data?.vat_effective_from ?? null,
    periods: (periods.data ?? []) as TaxPeriodRow[],
  };
}

export async function GET(request: NextRequest) {
  const gate = await authorize();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  const companyId = request.nextUrl.searchParams.get("company") ?? "";
  if (!DATE.test(from) || !DATE.test(to) || from > to) return NextResponse.json({ error: "Некорректный период" }, { status: 400 });

  try {
    const scopes = await companies();
    const selected = scopes.find((company) => company.id === companyId || company.companyIds.includes(companyId));
    if (!selected) {
      return NextResponse.json({
        companies: scopes.map(({ companyIds: _companyIds, cabinetIds: _cabinetIds, ...company }) => company),
        selectedCompany: null,
        payments: [],
        taxRegisterAvailable: true,
        taxSettingsAvailable: true,
        vatEffectiveFrom: null,
        marketplaceVatPeriods: [],
        wbReportedInputVat: 0,
        wbAdvertisingExpense: 0,
        wbAdvertisingCoverageStart: null,
        taxPaid: 0,
      });
    }
    const rows = await loadAllSupabasePages<PaymentRow>((pageFrom, pageTo) => db
      .from("payments")
      .select("id,date,name,amount,category,counterparty,comment,company_id,import_source")
      .in("company_id", selected.companyIds)
      .eq("status", "done")
      .gte("date", from)
      .lte("date", to)
      .lt("amount", 0)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(pageFrom, pageTo), { label: "Налоговый регистр ДДС", maxPages: 100 });
    const year = Number(from.slice(0, 4));
    const [details, taxSettings, liveSettings, wbReportedInputVat, wbAdvertisingExpense, wbAdvertisingCoverageStart] = await Promise.all([
      loadDetails(rows.map((row) => row.id)),
      loadCompanyTaxSettings(selected.id, from, to),
      loadLiveTaxSettings(selected.id, year, from, to),
      loadWbReportedInputVat(selected.cabinetIds, from, to),
      loadWbAdvertisingExpense(selected.cabinetIds, from, to),
      loadWbAdvertisingCoverageStart(selected.cabinetIds),
    ]);
    // ЕНП и обычный платёж «налог» нельзя автоматически отнести к УСН:
    // внутри ЕНС он может погашать НДС, страховые взносы и другие обязанности.
    const taxPattern = /(?:^|[^а-яё])усн(?:[^а-яё]|$)|упрощ[её]нн|единый\s+налог[^а-яё]+.*упрощ/i;
    const payments = rows
      .map((row) => {
        const saved = details.byId.get(row.id);
        const parsed = parsePaymentVat(`${row.name} ${row.comment ?? ""}`, Number(row.amount));
        const paymentText = `${row.category} ${row.name} ${row.counterparty ?? ""}`;
        const suggestedTaxKind: TaxPaymentKind = taxPattern.test(paymentText)
          ? "usn_tax_payment"
          : /страхов.*взнос|взнос.*(?:опс|омс|сфр)/i.test(paymentText)
            ? "insurance_contribution"
            : "operating_expense";
        return {
          id: row.id,
          date: row.date,
          name: row.name,
          grossAmount: Math.abs(Number(row.amount) || 0),
          category: row.category,
          counterparty: row.counterparty ?? "",
          source: row.import_source?.startsWith("bank-review:") ? "Банк" : "ДДС",
          suggestedVatRate: parsed.rate,
          suggestedVatAmount: parsed.amount,
          suggestedVatKind: parsed.kind,
          vatRate: saved?.vat_rate == null ? parsed.rate : Number(saved.vat_rate),
          vatAmount: saved ? Number(saved.vat_amount) : parsed.amount,
          vatDocumentStatus: saved?.vat_document_status ?? "missing",
          vatDeductionStatus: saved?.vat_deduction_status ?? "pending",
          usnExpenseStatus: saved?.usn_expense_status ?? "pending",
          taxPaymentKind: saved?.tax_payment_kind ?? "operating_expense",
          suggestedTaxKind,
          note: saved?.note ?? "",
          saved: Boolean(saved),
        };
      });
    return NextResponse.json({
      companies: scopes.map(({ companyIds: _companyIds, cabinetIds: _cabinetIds, ...company }) => company),
      selectedCompany: {
        id: selected.id, name: selected.name, groupName: selected.groupName,
        taxSystem: selected.taxSystem ?? null, vatMode: selected.vatMode ?? null,
        taxRate: selected.taxRate ?? null, taxAdditionalRate: selected.taxAdditionalRate ?? null,
      },
      payments,
      taxRegisterAvailable: details.available,
      taxSettingsAvailable: taxSettings.available && liveSettings.available,
      vatEffectiveFrom: taxSettings.vatEffectiveFrom,
      marketplaceVatPeriods: taxSettings.periods.map((period) => ({
        periodKey: period.period_key,
        confirmedInputVat: Number(period.marketplace_input_vat_confirmed) || 0,
        note: period.note ?? "",
      })),
      yearSettings: {
        fixedInsuranceContributions: Number(liveSettings.yearSettings?.fixed_insurance_contributions) || 0,
        insuranceReductionLimitPercent: Number(liveSettings.yearSettings?.insurance_reduction_limit_percent) || 0,
        priorYearLoss: Number(liveSettings.yearSettings?.prior_year_loss) || 0,
        recognizedCogs: Number(liveSettings.yearSettings?.recognized_cogs) || 0,
        outputVatConfirmed: liveSettings.yearSettings?.output_vat_confirmed == null ? null : Number(liveSettings.yearSettings.output_vat_confirmed),
        hasEmployees: Boolean(liveSettings.yearSettings?.has_employees),
        note: liveSettings.yearSettings?.note ?? "",
      },
      marketplaceTaxDocuments: liveSettings.documents.map((document) => ({
        id: document.id,
        marketplace: document.marketplace,
        documentDate: document.document_date,
        documentNumber: document.document_number,
        grossExpenseAmount: Number(document.gross_expense_amount) || 0,
        vatRate: document.vat_rate == null ? null : Number(document.vat_rate),
        vatAmount: Number(document.vat_amount) || 0,
        vatDocumentStatus: document.vat_document_status,
        vatDeductionStatus: document.vat_deduction_status,
        usnExpenseStatus: document.usn_expense_status,
        note: document.note ?? "",
        saved: true,
      })),
      wbReportedInputVat,
      wbAdvertisingExpense,
      wbAdvertisingCoverageStart,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить налоговый регистр" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const gate = await authorize();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const body = await request.json().catch(() => null) as null | {
    action?: "payment" | "profile" | "period" | "year_settings" | "marketplace_document";
    companyId?: string;
    vatEffectiveFrom?: string | null;
    periodKey?: string;
    marketplaceInputVatConfirmed?: number;
    paymentId?: string;
    vatRate?: number | null;
    vatAmount?: number;
    vatDocumentStatus?: VatDocumentStatus;
    vatDeductionStatus?: VatDeductionStatus;
    usnExpenseStatus?: UsnExpenseStatus;
    note?: string;
    taxYear?: number;
    fixedInsuranceContributions?: number;
    insuranceReductionLimitPercent?: number;
    priorYearLoss?: number;
    recognizedCogs?: number;
    outputVatConfirmed?: number | null;
    hasEmployees?: boolean;
    taxPaymentKind?: TaxPaymentKind;
    documentId?: string;
    marketplace?: "wb" | "ozon" | "other";
    documentDate?: string;
    documentNumber?: string;
    grossExpenseAmount?: number;
  };
  if (body?.action === "profile") {
    const effectiveFrom = body.vatEffectiveFrom == null || body.vatEffectiveFrom === "" ? null : body.vatEffectiveFrom;
    if (!UUID.test(body.companyId ?? "") || (effectiveFrom != null && (!DATE.test(effectiveFrom) || !effectiveFrom.endsWith("-01")))) {
      return NextResponse.json({ error: "Некорректная дата начала НДС" }, { status: 400 });
    }
    const row = { company_id: body.companyId, vat_effective_from: effectiveFrom, updated_at: new Date().toISOString() };
    const saved = await db.from("company_tax_profiles").upsert(row, { onConflict: "company_id" });
    if (saved.error) return NextResponse.json({ error: MISSING_TABLE.has(saved.error.code ?? "") ? "Сначала примените миграцию налогового регистра" : saved.error.message }, { status: MISSING_TABLE.has(saved.error.code ?? "") ? 409 : 500 });
    await audit(request, await getServerSession(), { action: "payment.update", subject: `tax-profile:${body.companyId}`, after: row });
    return NextResponse.json({ ok: true });
  }
  if (body?.action === "period") {
    const amount = Number(body.marketplaceInputVatConfirmed ?? 0);
    if (!UUID.test(body.companyId ?? "") || !PERIOD_KEY.test(body.periodKey ?? "") || !Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: "Некорректные данные входящего НДС маркетплейса" }, { status: 400 });
    }
    const row = {
      company_id: body.companyId,
      period_key: body.periodKey,
      marketplace_input_vat_confirmed: Math.round(amount * 100) / 100,
      note: String(body.note ?? "").slice(0, 2_000),
      updated_at: new Date().toISOString(),
    };
    const saved = await db.from("company_tax_periods").upsert(row, { onConflict: "company_id,period_key" });
    if (saved.error) return NextResponse.json({ error: MISSING_TABLE.has(saved.error.code ?? "") ? "Сначала примените миграцию налогового регистра" : saved.error.message }, { status: MISSING_TABLE.has(saved.error.code ?? "") ? 409 : 500 });
    await audit(request, await getServerSession(), { action: "payment.update", subject: `tax-period:${body.companyId}:${body.periodKey}`, after: row });
    return NextResponse.json({ ok: true });
  }
  if (body?.action === "year_settings") {
    const taxYear = Number(body.taxYear);
    const fixed = Number(body.fixedInsuranceContributions ?? 0);
    const limit = Number(body.insuranceReductionLimitPercent ?? 0);
    const loss = Number(body.priorYearLoss ?? 0);
    const recognizedCogs = Number(body.recognizedCogs ?? 0);
    const outputVatConfirmed = body.outputVatConfirmed == null ? null : Number(body.outputVatConfirmed);
    if (!UUID.test(body.companyId ?? "") || !Number.isInteger(taxYear) || taxYear < 2020 || taxYear > 2100
      || !Number.isFinite(fixed) || fixed < 0 || ![0, 50, 100].includes(limit) || !Number.isFinite(loss) || loss < 0
      || !Number.isFinite(recognizedCogs) || recognizedCogs < 0 || (outputVatConfirmed != null && (!Number.isFinite(outputVatConfirmed) || outputVatConfirmed < 0))) {
      return NextResponse.json({ error: "Некорректные годовые параметры УСН" }, { status: 400 });
    }
    const row = {
      company_id: body.companyId, tax_year: taxYear,
      fixed_insurance_contributions: Math.round(fixed * 100) / 100,
      insurance_reduction_limit_percent: limit,
      prior_year_loss: Math.round(loss * 100) / 100,
      recognized_cogs: Math.round(recognizedCogs * 100) / 100,
      output_vat_confirmed: outputVatConfirmed == null ? null : Math.round(outputVatConfirmed * 100) / 100,
      has_employees: Boolean(body.hasEmployees),
      note: String(body.note ?? "").slice(0, 2_000), updated_at: new Date().toISOString(),
    };
    const saved = await db.from("company_tax_year_settings").upsert(row, { onConflict: "company_id,tax_year" });
    if (saved.error) return NextResponse.json({ error: MISSING_TABLE.has(saved.error.code ?? "") ? "Примените миграцию live-регистра налогов" : saved.error.message }, { status: MISSING_TABLE.has(saved.error.code ?? "") ? 409 : 500 });
    await audit(request, await getServerSession(), { action: "payment.update", subject: `tax-year:${body.companyId}:${taxYear}`, after: row });
    return NextResponse.json({ ok: true });
  }
  if (body?.action === "marketplace_document") {
    const vatRate = body.vatRate == null ? null : Number(body.vatRate);
    const gross = Number(body.grossExpenseAmount ?? 0);
    const vat = Number(body.vatAmount ?? 0);
    if (!UUID.test(body.companyId ?? "") || !UUID.test(body.documentId ?? "") || !MARKETPLACES.has(body.marketplace as "wb" | "ozon" | "other")
      || !DATE.test(body.documentDate ?? "") || !Number.isFinite(gross) || gross < 0 || !Number.isFinite(vat) || vat < 0 || vat > gross
      || (vatRate != null && ![0, 5, 7, 10, 20, 22].includes(vatRate))
      || !DOCUMENT_STATUSES.has(body.vatDocumentStatus as VatDocumentStatus) || !DEDUCTION_STATUSES.has(body.vatDeductionStatus as VatDeductionStatus)
      || !USN_STATUSES.has(body.usnExpenseStatus as UsnExpenseStatus)) {
      return NextResponse.json({ error: "Некорректный документ маркетплейса" }, { status: 400 });
    }
    const row = {
      id: body.documentId, company_id: body.companyId, marketplace: body.marketplace,
      document_date: body.documentDate, document_number: String(body.documentNumber ?? "").slice(0, 200),
      gross_expense_amount: Math.round(gross * 100) / 100, vat_rate: vatRate,
      vat_amount: Math.round(vat * 100) / 100, vat_document_status: body.vatDocumentStatus,
      vat_deduction_status: body.vatDeductionStatus, usn_expense_status: body.usnExpenseStatus,
      note: String(body.note ?? "").slice(0, 2_000), updated_at: new Date().toISOString(),
    };
    const saved = await db.from("marketplace_tax_documents").upsert(row, { onConflict: "id" });
    if (saved.error) return NextResponse.json({ error: MISSING_TABLE.has(saved.error.code ?? "") ? "Примените миграцию live-регистра налогов" : saved.error.message }, { status: MISSING_TABLE.has(saved.error.code ?? "") ? 409 : 500 });
    await audit(request, await getServerSession(), { action: "payment.update", subject: `marketplace-tax-document:${body.documentId}`, after: row });
    return NextResponse.json({ ok: true });
  }
  if (!body || !UUID.test(body.paymentId ?? "") || !DOCUMENT_STATUSES.has(body.vatDocumentStatus as VatDocumentStatus)
    || !DEDUCTION_STATUSES.has(body.vatDeductionStatus as VatDeductionStatus) || !USN_STATUSES.has(body.usnExpenseStatus as UsnExpenseStatus)) {
    return NextResponse.json({ error: "Некорректные данные налогового регистра" }, { status: 400 });
  }
  const vatRate = body.vatRate == null ? null : Number(body.vatRate);
  const vatAmount = Number(body.vatAmount ?? 0);
  if ((vatRate != null && ![0, 5, 7, 10, 20, 22].includes(vatRate)) || !Number.isFinite(vatAmount) || vatAmount < 0) {
    return NextResponse.json({ error: "Некорректная ставка или сумма НДС" }, { status: 400 });
  }
  const payment = await db.from("payments").select("id,amount").eq("id", body.paymentId).eq("status", "done").maybeSingle();
  if (payment.error) return NextResponse.json({ error: payment.error.message }, { status: 500 });
  if (!payment.data || Number(payment.data.amount) >= 0 || vatAmount > Math.abs(Number(payment.data.amount))) {
    return NextResponse.json({ error: "Налоговый регистр можно сохранить только для фактического расхода; НДС не может быть больше платежа" }, { status: 400 });
  }
  const taxPaymentKind = body.taxPaymentKind ?? "operating_expense";
  if (!TAX_PAYMENT_KINDS.has(taxPaymentKind)) return NextResponse.json({ error: "Некорректное назначение платежа" }, { status: 400 });
  const row = {
    payment_id: body.paymentId,
    vat_rate: vatRate,
    vat_amount: Math.round(vatAmount * 100) / 100,
    vat_document_status: body.vatDocumentStatus,
    vat_deduction_status: body.vatDeductionStatus,
    usn_expense_status: body.usnExpenseStatus,
    tax_payment_kind: taxPaymentKind,
    note: String(body.note ?? "").slice(0, 2_000),
    updated_at: new Date().toISOString(),
  };
  const saved = await db.from("payment_tax_details").upsert(row, { onConflict: "payment_id" });
  if (saved.error) {
    const status = MISSING_TABLE.has(saved.error.code ?? "") ? 409 : 500;
    return NextResponse.json({ error: status === 409 ? "Сначала примените миграцию налогового регистра" : saved.error.message }, { status });
  }
  await audit(request, await getServerSession(), { action: "payment.update", subject: `tax-detail:${body.paymentId}`, after: row });
  return NextResponse.json({ ok: true });
}
