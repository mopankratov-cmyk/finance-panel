#!/usr/bin/env node

// Marketplace payout source gate and future runtime entrypoint.
// Normative matrix SHA-256:
// cd5c2e7a9cce73304418f080055b840bd8104cea31be8ac8f731325242d973df
// Implemented registry families: C-*, T-*, ACL-*, GATE-*.
// Deferred family: OP-* business RPC operations.
//
// This source gate never connects to PostgreSQL. It intentionally does not emit
// semantic PASS results for registry entries: a literal ID is traceability, not
// runtime evidence.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const MATRIX_SHA =
  "cd5c2e7a9cce73304418f080055b840bd8104cea31be8ac8f731325242d973df";
const ALLOWED_PROJECT_REF = "coqcswxloftvukczzcxn";
const ALLOWED_DATABASE = "postgres";

const EXPECTED_IDS = String.raw`
C-A-CK-01 C-A-FK-01 C-A-FK-02 C-A-NN-01 C-A-NN-02 C-A-NN-03
C-A-NN-04 C-A-NN-05 C-A-UQ-01 C-A-UQ-02 C-D-01 C-D-02
C-D-03 C-D-04 C-L-CK-01 C-L-CK-02 C-L-CK-03 C-L-CK-04
C-L-CK-05 C-L-CK-06 C-L-CK-07 C-L-CK-08 C-L-CK-09 C-L-CK-10
C-L-FK-01 C-L-FK-02 C-L-NN-01 C-L-NN-02 C-L-NN-03 C-L-NN-04
C-L-NN-05 C-L-NN-06 C-L-NN-07 C-L-NN-08 C-L-NN-09 C-L-UQ-01
C-L-UQ-02 C-L-UQ-03 C-L-UQ-04 C-OWN-01 C-OWN-02 C-Q-CK-01
C-Q-CK-02 C-Q-CK-03 C-Q-CK-04 C-Q-CK-05 C-Q-CK-06 C-Q-CK-07
C-Q-CK-08 C-Q-CK-09 C-Q-CK-10 C-Q-CK-11 C-Q-FK-01 C-Q-FK-02
C-Q-FK-03 C-Q-NN-01 C-Q-NN-02 C-Q-NN-03 C-Q-NN-04 C-Q-NN-05
C-Q-NN-06 C-Q-NN-07 C-Q-NN-08 C-Q-NN-09 C-Q-UQ-01 C-Q-UQ-02
C-R-CK-01 C-R-CK-02 C-R-CK-03 C-R-CK-04 C-R-CK-05 C-R-CK-06
C-R-CK-07 C-R-CK-08 C-R-FK-01 C-R-FK-02 C-R-FK-03 C-R-FK-04
C-R-NN-01 C-R-NN-02 C-R-NN-03 C-R-NN-04 C-R-NN-05 C-R-NN-06
C-R-NN-07 C-R-NN-08 C-R-NN-09 C-R-NN-10 C-R-NN-11 C-R-NN-12
C-R-NN-13 C-R-UQ-01 C-R-UQ-02 C-R-UQ-03 C-RLS-01 C-ROLE-01
C-ROLE-02 C-ROLE-03 C-ROLE-04 C-S-CK-01 C-S-CK-02 C-S-CK-03
C-S-CK-04 C-S-FK-01 C-S-FK-02 C-S-NN-01 C-S-NN-02 C-S-NN-03
C-S-NN-04 C-S-NN-05 C-S-NN-06 C-S-NN-07 C-S-NN-08 C-S-UQ-01
C-S-UQ-02 C-S-UQ-03 C-U-CK-01 C-U-CK-02 C-U-CK-03 C-U-CK-04
C-U-FK-01 C-U-FK-02 C-U-FK-03 C-U-FK-04 C-U-NN-01 C-U-NN-02
C-U-NN-03 C-U-NN-04 C-U-NN-05 C-U-NN-06 C-U-NN-07 C-U-NN-08
C-U-NN-09 C-U-UQ-01 C-U-UQ-02 C-U-UQ-03 C-V-CK-01 C-V-CK-02
C-V-CK-03 C-V-CK-04 C-V-CK-05 C-V-CK-06 C-V-CK-07 C-V-CK-08
C-V-CK-09 C-V-CK-10 C-V-CK-11 C-V-FK-01 C-V-FK-02 C-V-FK-03
C-V-FK-04 C-V-FK-05 C-V-NN-01 C-V-NN-02 C-V-NN-03 C-V-NN-04
C-V-NN-05 C-V-NN-06 C-V-NN-07 C-V-NN-08 C-V-NN-09 C-V-NN-10
C-V-NN-11 C-V-NN-12 C-V-NN-13 C-V-NN-14 C-V-NN-15 C-V-UQ-01
C-V-UQ-02 C-V-UQ-03 C-V-UQ-04 T-A-01 T-A-02 T-A-03
T-A-04 T-L-01 T-L-02 T-L-03 T-L-04 T-L-05
T-L-06 T-L-07 T-L-08 T-L-09 T-L-10 T-L-11
T-L-12 T-L-13 T-L-14 T-L-15 T-L-16 T-L-17
T-L-18 T-Q-01 T-Q-02 T-Q-03 T-Q-04 T-Q-05
T-Q-06 T-Q-07 T-R-01 T-R-02 T-R-03 T-R-04
T-R-05 T-R-06 T-R-07 T-S-01 T-S-02 T-S-03
T-S-04 T-S-05 T-S-06 T-S-07 T-S-08 T-S-09
T-S-10 T-S-11 T-U-01 T-U-02 T-U-03 T-U-04
T-V-01 T-V-02 T-V-03 T-V-04 T-V-05 T-V-06
T-V-07 T-V-08 T-V-09 T-V-10 T-V-11 T-V-12
T-V-13 T-V-14 T-V-15 T-V-16 T-V-17 T-V-18
T-V-19 T-V-20 T-V-21 T-V-22 T-V-23 T-V-24
T-V-25 T-V-26 T-V-27 ACL-T-01 ACL-T-02 ACL-T-03
ACL-T-04 ACL-T-05 ACL-T-06 ACL-T-07 ACL-T-08-R ACL-T-08-S
ACL-T-08-V ACL-T-08-L ACL-T-08-Q ACL-T-08-A ACL-T-08-U ACL-T-09-R
ACL-T-09-S ACL-T-09-V ACL-T-09-L ACL-T-09-Q ACL-T-09-A ACL-T-09-U
ACL-T-10-R ACL-T-10-S ACL-T-10-V ACL-T-10-L ACL-T-10-Q ACL-T-10-A
ACL-T-10-U ACL-T-11-R ACL-T-11-S ACL-T-11-V ACL-T-11-L ACL-T-11-Q
ACL-T-11-A ACL-T-11-U ACL-T-12-R ACL-T-12-S ACL-T-12-V ACL-T-12-L
ACL-T-12-Q ACL-T-12-A ACL-T-12-U ACL-SQ-01 ACL-SQ-02 ACL-SQ-03
ACL-SQ-04 ACL-SQ-05 ACL-SQ-06 ACL-F-01-R ACL-F-01-S ACL-F-01-V
ACL-F-01-L ACL-F-01-Q ACL-F-01-AO ACL-F-02-R ACL-F-02-S ACL-F-02-V
ACL-F-02-L ACL-F-02-Q ACL-F-02-AO ACL-F-03-R ACL-F-03-S ACL-F-03-V
ACL-F-03-L ACL-F-03-Q ACL-F-03-AO ACL-F-04-R ACL-F-04-S ACL-F-04-V
ACL-F-04-L ACL-F-04-Q ACL-F-04-AO ACL-F-05-R ACL-F-05-S ACL-F-05-V
ACL-F-05-L ACL-F-05-Q ACL-F-05-AO ACL-F-06-R ACL-F-06-S ACL-F-06-V
ACL-F-06-L ACL-F-06-Q ACL-F-06-AO ACL-SC-01 ACL-SC-02 ACL-SC-03
ACL-M-01 ACL-M-02 ACL-M-03 GATE-01 GATE-02 GATE-03
GATE-04 GATE-05 GATE-06 GATE-07 GATE-08 GATE-09
GATE-10
`
  .trim()
  .split(/\s+/);

const REQUIRED_OBJECT_NAMES = String.raw`
marketplace_payout_routes_marketplace_ck
marketplace_payout_routes_payer_inn_ck
marketplace_payout_routes_payer_kpp_ck
marketplace_payout_routes_payer_legal_name_ck
marketplace_payout_routes_account_kind_ck
marketplace_payout_routes_shared_exact_inn_ck
marketplace_payout_routes_active_retired_ck
marketplace_payout_routes_retired_after_valid_from_ck
marketplace_payout_series_marketplace_ck
marketplace_payout_series_series_key_ck
marketplace_payout_series_latest_revision_ck
marketplace_payout_series_current_revision_ck
marketplace_payout_forecast_revisions_revision_ck
marketplace_payout_forecast_revisions_state_ck
marketplace_payout_forecast_revisions_payload_hash_ck
marketplace_payout_forecast_revisions_source_status_ck
marketplace_payout_forecast_revisions_unallocated_ck
marketplace_payout_forecast_revisions_unresolved_count_ck
marketplace_payout_forecast_revisions_approval_pair_ck
marketplace_payout_forecast_revisions_publication_pair_ck
marketplace_payout_forecast_revisions_supersession_pair_ck
marketplace_payout_forecast_revisions_state_metadata_ck
marketplace_payout_forecast_revisions_not_self_superseded_ck
marketplace_payout_forecast_lines_line_key_ck
marketplace_payout_forecast_lines_source_kind_ck
marketplace_payout_forecast_lines_amount_ck
marketplace_payout_forecast_lines_currency_ck
marketplace_payout_forecast_lines_lifecycle_ck
marketplace_payout_forecast_lines_period_pair_ck
marketplace_payout_forecast_lines_period_order_ck
marketplace_payout_forecast_lines_report_identity_ck
marketplace_payout_forecast_lines_report_state_ck
marketplace_payout_forecast_lines_payment_state_ck
marketplace_payout_receipt_reconciliations_state_ck
marketplace_payout_receipt_reconciliations_amount_ck
marketplace_payout_receipt_reconciliations_payer_inn_ck
marketplace_payout_receipt_reconciliations_payer_kpp_ck
marketplace_payout_receipt_reconciliations_identity_source_ck
marketplace_payout_receipt_reconciliations_unresolved_amount_ck
marketplace_payout_receipt_reconciliations_unresolved_reason_ck
marketplace_payout_receipt_reconciliations_unresolved_pair_ck
marketplace_payout_receipt_reconciliations_reversal_triple_ck
marketplace_payout_receipt_reconciliations_state_metadata_ck
marketplace_payout_receipt_reconciliations_legacy_unverified_ck
marketplace_payout_receipt_allocations_amount_ck
marketplace_payout_audit_operation_ck
marketplace_payout_audit_request_hash_ck
marketplace_payout_audit_request_json_object_ck
marketplace_payout_audit_result_json_object_ck
marketplace_payout_routes_created_by_fk
marketplace_payout_routes_cabinet_fk
marketplace_payout_routes_company_fk
marketplace_payout_routes_account_fk
marketplace_payout_series_cabinet_fk
marketplace_payout_series_company_fk
marketplace_payout_forecast_revisions_approved_by_fk
marketplace_payout_forecast_revisions_published_by_fk
marketplace_payout_forecast_revisions_superseder_fk
marketplace_payout_forecast_revisions_series_scope_fk
marketplace_payout_forecast_revisions_route_scope_fk
marketplace_payout_forecast_lines_version_fk
marketplace_payout_forecast_lines_payment_fk
marketplace_payout_receipt_reconciliations_receipt_fk
marketplace_payout_receipt_reconciliations_created_by_fk
marketplace_payout_receipt_reconciliations_reversed_by_fk
marketplace_payout_receipt_allocations_reconciliation_fk
marketplace_payout_receipt_allocations_line_fk
marketplace_payout_audit_actor_fk
marketplace_payout_audit_series_fk
marketplace_payout_audit_version_fk
marketplace_payout_audit_reconciliation_fk
marketplace_payout_routes_pkey
marketplace_payout_routes_scope_uq
marketplace_payout_routes_one_active_per_cabinet_uq
marketplace_payout_series_pkey
marketplace_payout_series_scope_key_uq
marketplace_payout_series_scope_uq
marketplace_payout_forecast_revisions_pkey
marketplace_payout_forecast_revisions_series_revision_uq
marketplace_payout_versions_one_open_draft_uq
marketplace_payout_versions_one_published_uq
marketplace_payout_forecast_lines_pkey
marketplace_payout_forecast_lines_version_line_key_uq
marketplace_payout_lines_report_per_version_uq
marketplace_payout_lines_payment_uq
marketplace_payout_receipt_reconciliations_pkey
marketplace_payout_receipts_one_active_uq
marketplace_payout_receipt_allocations_pkey
marketplace_payout_receipt_allocations_reconciliation_line_uq
marketplace_payout_audit_pkey
marketplace_payout_audit_operation_id_uq
marketplace_payout_audit_actor_request_uq
marketplace_payout_audit_id_seq
`
  .trim()
  .split(/\s+/);

const MIGRATION_URL = new URL(
  "../../supabase/migrations/202607300002_marketplace_payout_ddl_invariants_v6.sql",
  import.meta.url,
);

function exactCount(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

function rawAuthorityHost(rawUrl) {
  const withoutProtocol = rawUrl.slice("postgresql://".length);
  const authority = withoutProtocol.split("/", 1)[0];
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  if (hostPort.startsWith("[")) return hostPort;
  return hostPort.split(":", 1)[0];
}

export function normalizeDisposableTarget(
  rawUrl,
  {
    allowedProjectRef = ALLOWED_PROJECT_REF,
    allowedDatabase = ALLOWED_DATABASE,
  } = {},
) {
  assert.equal(typeof rawUrl, "string", "target must be a string");
  assert.ok(rawUrl.startsWith("postgresql://"), "protocol must be postgresql:");
  assert.ok(!rawUrl.includes("#"), "URL fragments are forbidden");

  const rawHost = rawAuthorityHost(rawUrl);
  assert.match(rawHost, /^[a-z0-9.-]+$/, "host must be lowercase ASCII");
  assert.ok(!rawHost.endsWith("."), "trailing-dot hosts are forbidden");

  const parsed = new URL(rawUrl);
  assert.equal(parsed.protocol, "postgresql:", "protocol must be postgresql:");
  assert.ok(parsed.username, "username is required");
  assert.ok(parsed.password, "password is required");
  assert.equal([...parsed.searchParams].length, 0, "query parameters are forbidden");

  const database = decodeURIComponent(parsed.pathname.slice(1));
  assert.equal(database, allowedDatabase, "database mismatch");
  assert.ok(!database.includes("/"), "database path must contain one segment");

  const directMatch = parsed.hostname.match(
    /^db\.([a-z0-9]{20})\.supabase\.co$/,
  );
  const poolerMatch = parsed.hostname.match(
    /^[a-z0-9-]+\.pooler\.supabase\.com$/,
  );

  let kind;
  let projectRef;
  if (directMatch) {
    kind = "direct";
    projectRef = directMatch[1];
    assert.equal(
      decodeURIComponent(parsed.username),
      "postgres",
      "direct username mismatch",
    );
    assert.ok(
      parsed.port === "" || parsed.port === "5432",
      "direct port mismatch",
    );
  } else if (poolerMatch) {
    kind = "pooler";
    const usernameMatch = decodeURIComponent(parsed.username).match(
      /^postgres\.([a-z0-9]{20})$/,
    );
    assert.ok(usernameMatch, "pooler username must carry project ref");
    projectRef = usernameMatch[1];
    assert.ok(
      parsed.port === "5432" || parsed.port === "6543",
      "pooler port mismatch",
    );
  } else {
    assert.fail("host is not an official Supabase database endpoint");
  }

  assert.equal(projectRef, allowedProjectRef, "project ref mismatch");

  return Object.freeze({
    kind,
    projectRef,
    database,
    hostname: parsed.hostname,
    port: parsed.port || "5432",
    username: decodeURIComponent(parsed.username),
    // The password-bearing value is opaque and must never be logged.
    connectionString: rawUrl,
  });
}

export function assertExactResultSet(expectedIds, results) {
  const expected = [...expectedIds];
  const actual = results.map((result) => result.id);
  assert.equal(new Set(expected).size, expected.length, "duplicate expected ID");
  assert.equal(new Set(actual).size, actual.length, "duplicate result ID");
  assert.deepEqual([...actual].sort(), [...expected].sort(), "result set mismatch");
  for (const result of results) {
    assert.equal(result.status, "PASS", `${result.id} did not pass`);
    assert.equal(result.asserted, true, `${result.id} lacks concrete assertion`);
  }
}

function assertRegistry() {
  assert.equal(new Set(EXPECTED_IDS).size, EXPECTED_IDS.length);
  const counts = {
    C: EXPECTED_IDS.filter((id) => id.startsWith("C-")).length,
    T: EXPECTED_IDS.filter((id) => id.startsWith("T-")).length,
    ACL: EXPECTED_IDS.filter((id) => id.startsWith("ACL-")).length,
    GATE: EXPECTED_IDS.filter((id) => id.startsWith("GATE-")).length,
  };
  assert.deepEqual(counts, { C: 171, T: 78, ACL: 90, GATE: 10 });
  assert.equal(EXPECTED_IDS.length, 349);
  return counts;
}

function assertMigrationSource(source) {
  assert.ok(source.includes(MATRIX_SHA), "matrix SHA comment is missing");
  assert.equal(
    exactCount(source, /^create table public\.marketplace_payout_/gm),
    7,
    "exactly seven payout tables are required",
  );
  assert.equal(
    exactCount(
      source,
      /^create function public\._marketplace_payout_guard_/gm,
    ),
    6,
    "exactly six guard helpers are required",
  );
  assert.equal(
    exactCount(source, /^create policy marketplace_payout_/gm),
    19,
    "exactly nineteen policies are required",
  );

  for (const objectName of REQUIRED_OBJECT_NAMES) {
    assert.ok(source.includes(objectName), `missing object: ${objectName}`);
  }

  assert.doesNotMatch(
    source,
    /alter\s+table\s+public\.(?:payments|accounts|companies|app_users|wb_cabinets)\b/i,
    "existing business tables must not be altered",
  );
  assert.doesNotMatch(
    source,
    /grant\s+(?:all|execute|select|insert|update|delete|truncate)[\s\S]{0,160}\bto\s+service_role\b/i,
    "service_role must not receive payout capability",
  );
  assert.doesNotMatch(
    source,
    /create\s+(?:or\s+replace\s+)?function\s+public\.(?!_marketplace_payout_guard_)/i,
    "business RPC or unrelated functions are forbidden",
  );
  assert.doesNotMatch(source, /\bcommit\b/i, "migration must not contain COMMIT");
  assert.doesNotMatch(
    source,
    /\bset_config\s*\(|\bcurrent_setting\s*\(\s*['"][^'"]*(?:test|bypass|cleanup|corrupt)/i,
    "test or bypass GUCs are forbidden",
  );
  assert.equal(
    exactCount(source, /^create role payout_rpc_/gm),
    2,
    "exactly two payout roles are required",
  );
  assert.equal(
    exactCount(
      source,
      /^alter table public\.marketplace_payout_[^\n;]+(?:\n\s*)?enable row level security;/gm,
    ),
    7,
    "RLS must be enabled on all seven payout tables",
  );
  assert.match(
    source,
    /payout_membership_count not in \(0, 2\)/,
    "role postcondition must reject partial hosted-role state",
  );
  assert.match(
    source,
    /grantor_role\.rolname = 'supabase_admin'/,
    "hosted PostgreSQL role edge must require the Supabase admin grantor",
  );
  assert.match(
    source,
    /membership\.admin_option[\s\S]{0,120}not membership\.inherit_option[\s\S]{0,120}not membership\.set_option/,
    "hosted PostgreSQL role edge must be ADMIN-only and non-effective",
  );

  return {
    tables: 7,
    helpers: 6,
    policies: 19,
    requiredObjects: REQUIRED_OBJECT_NAMES.length,
    hostedPg17RoleEdges: "zero-or-exact-admin-only-pair",
  };
}

function assertTargetGuard() {
  const password = encodeURIComponent("not-a-real-secret");
  const direct =
    `postgresql://postgres:${password}@` +
    `db.${ALLOWED_PROJECT_REF}.supabase.co:5432/postgres`;
  const pooler =
    `postgresql://postgres.${ALLOWED_PROJECT_REF}:${password}@` +
    "aws-0-eu-central-1.pooler.supabase.com:6543/postgres";

  const normalizedDirect = normalizeDisposableTarget(direct);
  const normalizedPooler = normalizeDisposableTarget(pooler);
  assert.equal(normalizedDirect.kind, "direct");
  assert.equal(normalizedPooler.kind, "pooler");
  assert.equal(normalizedDirect.projectRef, ALLOWED_PROJECT_REF);
  assert.equal(normalizedPooler.projectRef, ALLOWED_PROJECT_REF);

  const rejected = [
    direct.replace("postgresql:", "postgres:"),
    direct.replace(ALLOWED_PROJECT_REF, "jwjobmdihddytqfgymus"),
    direct.replace(ALLOWED_PROJECT_REF, "aaaaaaaaaaaaaaaaaaaa"),
    `${direct}?host=evil.example`,
    `${direct}?%68ost=evil.example`,
    `${direct}?host=evil.example&host=db.${ALLOWED_PROJECT_REF}.supabase.co`,
    `${direct}?sslmode=require`,
    `${direct}#fragment`,
    direct.replace("/postgres", "/other"),
    direct.replace("db.", "DB."),
    direct.replace(".supabase.co", ".supabase.co."),
    direct.replace("postgres:", "other:"),
    direct.replace(`postgres:${password}`, "postgres:"),
    pooler.replace(`postgres.${ALLOWED_PROJECT_REF}`, "postgres"),
    pooler.replace(ALLOWED_PROJECT_REF, "aaaaaaaaaaaaaaaaaaaa"),
    pooler.replace(":6543/", ":9999/"),
    `postgresql://postgres:${password}@evil.example:5432/postgres`,
  ];

  for (const candidate of rejected) {
    assert.throws(() => normalizeDisposableTarget(candidate));
  }

  return { accepted: 2, rejected: rejected.length };
}

export async function runSourceGate() {
  const registry = assertRegistry();
  const source = await readFile(MIGRATION_URL, "utf8");
  const migration = assertMigrationSource(source);
  const targetGuard = assertTargetGuard();

  return {
    mode: "SOURCE_ONLY",
    matrixSha: MATRIX_SHA,
    registry,
    registryTotal: EXPECTED_IDS.length,
    migration,
    targetGuard,
    dbConnections: 0,
    networkCalls: 0,
    semanticRuntimeResults: 0,
  };
}

async function main() {
  const mode = process.argv[2] ?? "--source-check";
  assert.equal(
    mode,
    "--source-check",
    "runtime execution is intentionally unavailable until source review",
  );
  const result = await runSourceGate();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`payout source gate failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
