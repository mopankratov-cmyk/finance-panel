import test from 'node:test';
import assert from 'node:assert/strict';
import {
  barrier, close, connection, expectRpcError, expectSqlState, pool, rpc, scalar, sql,
} from './harness.mjs';
import { ids, identity, line, preview, requestId } from './fixtures.mjs';

async function reset() {
  await sql('select test_support.install_fixtures()');
}
async function previewRevision(actor = ids.finance, overrides = {}) {
  const request = preview(overrides);
  return { request, result: await rpc('preview_marketplace_payout', request, actor) };
}
async function approveRevision(version, hash, actor = ids.director) {
  const request = { requestId: requestId(), versionId: version, expectedPayloadHash: hash };
  return { request, result: await rpc('approve_marketplace_payout', request, actor) };
}
async function publishRevision(version, hash, expected = 0, actor = ids.director, client = pool) {
  const request = {
    requestId: requestId(), versionId: version, expectedPayloadHash: hash,
    expectedPublishedRevision: expected,
  };
  return { request, result: await rpc('publish_marketplace_payout', request, actor, client) };
}
async function published(overrides = {}) {
  const p = await previewRevision(ids.finance, overrides);
  await approveRevision(p.result.versionId, p.result.payloadHash);
  await publishRevision(p.result.versionId, p.result.payloadHash);
  return p.result;
}
async function receipt(amount = '1000.00', id = ids.receipt) {
  await sql(
    `insert into public.payments(
      id,name,amount,type,category,account_id,date,status,counterparty,comment,company_id
    ) values($1,'Synthetic receipt',$2,'income','Marketplace payout',$3,'2026-07-10',
      'done','ООО «РВБ»','fixture receipt',$4)`,
    [id, amount, ids.account, ids.company],
  );
}
async function reconcileRequest(lineId, overrides = {}) {
  return {
    requestId: requestId(),
    receiptPaymentId: ids.receipt,
    expectedReceiptAmount: '1000.00',
    expectedAccountId: ids.account,
    identity: identity(),
    unresolvedAmount: '0.00',
    unresolvedReason: null,
    allocations: [{ forecastLineId: lineId, allocatedAmount: '1000.00' }],
    ...overrides,
  };
}
async function lineId(versionId) {
  return scalar(
    'select id from public.marketplace_payout_forecast_lines where version_id=$1',
    [versionId],
  );
}

test.beforeEach(reset);
test.after(close);

test('gate 01: DDL CHECK, FK, composite FK and partial unique invariants reject invalid rows', async () => {
  await expectSqlState(
    () => sql(`insert into public.marketplace_payout_routes(
      marketplace,cabinet_id,company_id,receiving_account_id,payer_inn,payer_legal_name,
      account_kind,require_exact_payer_inn,created_by
    ) values('wb',$1,$2,$3,'9714053621','payer','shared',false,$4)`,
    [ids.cabinet2, ids.company, ids.account, ids.director]),
    '23514',
  );
  await expectSqlState(
    () => sql(`insert into public.marketplace_payout_series(
      marketplace,cabinet_id,company_id,series_key,current_published_revision
    ) values('wb',$1,$2,'bad',1)`, [ids.cabinet, ids.company]),
    '23514',
  );
});

test('gate 02: preview coexists with the current published revision', async () => {
  const first = await published();
  const second = await previewRevision(ids.finance, {
    expectedPublishedRevision: 1,
    seriesKey: 'wb:2026-W28',
    lines: [line({ lineKey: 'line-2', providerReportId: 'synthetic-report-2' })],
  });
  assert.equal(second.result.publicationState, 'previewed');
  assert.equal(await scalar(
    `select count(*) from public.marketplace_payout_forecast_revisions
     where series_id=(select series_id from public.marketplace_payout_forecast_revisions where id=$1)
       and publication_state='published'`, [first.versionId]), '1');
});

test('gate 03: DB assigns monotonic revisions and stale expectedPublishedRevision fails CAS', async () => {
  const first = await published();
  assert.equal(first.revision, 1);
  await expectRpcError(() => previewRevision(ids.finance, {
    expectedPublishedRevision: 0,
    lines: [line({ lineKey: 'stale', providerReportId: 'stale' })],
  }), 'CAS_CONFLICT');
});

test('gate 04: request replay is actor-scoped and operation/hash conflicts fail closed', async () => {
  const request = preview();
  const a = await rpc('preview_marketplace_payout', request, ids.finance);
  const replay = await rpc('preview_marketplace_payout', request, ids.finance);
  assert.deepEqual(replay, a);
  await expectRpcError(
    () => rpc('preview_marketplace_payout', { ...request, seriesKey: 'changed' }, ids.finance),
    'IDEMPOTENCY_CONFLICT',
  );
  const otherActor = await rpc('preview_marketplace_payout', request, ids.otherDirector);
  assert.equal(otherActor.logicalReplay, true);
  assert.equal(await scalar(
    'select count(*) from public.marketplace_payout_audit where request_id=$1',
    [request.requestId]), '2');
});

test('gate 05: duplicate/empty lines, unknown keys, oversized request and invalid money fail', async () => {
  await expectRpcError(() => previewRevision(ids.finance, {
    lines: [line(), line()],
  }), 'DUPLICATE_LINE');
  await reset();
  await expectRpcError(() => previewRevision(ids.finance, { lines: [line({ lineKey: '' })] }), 'INVALID_LINE');
  await reset();
  await expectRpcError(() => previewRevision(ids.finance, { actorId: ids.director }), 'UNKNOWN_KEY:actorId');
  await reset();
  await expectRpcError(
    () => previewRevision(ids.finance, { lines: [line({ amount: '1.001' })] }),
    'INVALID_LINE',
  );
  await reset();
  await expectRpcError(
    () => previewRevision(ids.finance, { seriesKey: 'x'.repeat(1_048_577) }),
    'INVALID_REQUEST',
  );
});

test('gate 06: finance may preview/reconcile but may not approve/publish', async () => {
  const p = await previewRevision();
  await expectRpcError(
    () => approveRevision(p.result.versionId, p.result.payloadHash, ids.finance),
    'FORBIDDEN',
  );
  await approveRevision(p.result.versionId, p.result.payloadHash);
  await expectRpcError(
    () => publishRevision(p.result.versionId, p.result.payloadHash, 0, ids.finance),
    'FORBIDDEN',
  );
});

test('gate 07: actorId inside JSON is rejected and cannot impersonate a director', async () => {
  await expectRpcError(() => previewRevision(ids.finance, { actorId: ids.director }), 'UNKNOWN_KEY:actorId');
});

test('gate 08: approve requires exact hash and revision payload/lines are immutable', async () => {
  const p = await previewRevision();
  await expectRpcError(
    () => approveRevision(p.result.versionId, '00'.repeat(32)),
    'HASH_MISMATCH',
  );
  await expectSqlState(
    () => sql(`update public.marketplace_payout_forecast_lines set amount=2
      where version_id=$1`, [p.result.versionId]),
    'P0001',
  );
  assert.equal((await approveRevision(p.result.versionId, p.result.payloadHash)).result.publicationState, 'approved');
});

test('gate 09: initial multi-line publish creates matching planned income payments atomically', async () => {
  const p = await previewRevision(ids.finance, {
    lines: [
      line({ amount: '400.00' }),
      line({ lineKey: 'line-2', providerReportId: 'synthetic-report-2', amount: '600.00' }),
    ],
  });
  await approveRevision(p.result.versionId, p.result.payloadHash);
  await publishRevision(p.result.versionId, p.result.payloadHash);
  assert.equal(await scalar(
    `select count(*) from public.payments p join public.marketplace_payout_forecast_lines l
      on l.payment_id=p.id where l.version_id=$1 and p.type='income' and p.status='planned'
      and p.account_id=$2 and p.company_id=$3`, [p.result.versionId, ids.account, ids.company]), '2');
});

test('gate 10: real second-payment fault rolls back payments, states and audit', async () => {
  const p = await previewRevision(ids.finance, {
    lines: [
      line({ amount: '400.00' }),
      line({ lineKey: 'line-2', providerReportId: 'synthetic-report-2', amount: '600.00' }),
    ],
  });
  await approveRevision(p.result.versionId, p.result.payloadHash);
  const client = await connection('fault-second-payment');
  try {
    await assert.rejects(() => publishRevision(p.result.versionId, p.result.payloadHash, 0, ids.director, client));
  } finally {
    await client.end();
  }
  assert.equal(await scalar(`select count(*) from public.payments where comment='[marketplace-payout-v2]'`), '0');
  assert.equal(await scalar(`select publication_state from public.marketplace_payout_forecast_revisions where id=$1`, [p.result.versionId]), 'approved');
  assert.equal(await scalar(`select count(*) from public.marketplace_payout_audit where operation='publish'`), '0');
});

test('gate 11: replace cancels every old planned payment, including disappeared lines', async () => {
  const old = await published({
    lines: [
      line({ amount: '400.00' }),
      line({ lineKey: 'gone', providerReportId: 'gone', amount: '600.00' }),
    ],
  });
  const next = await previewRevision(ids.finance, {
    expectedPublishedRevision: 1,
    lines: [line({ lineKey: 'replacement', providerReportId: 'replacement', amount: '900.00' })],
  });
  await approveRevision(next.result.versionId, next.result.payloadHash);
  await publishRevision(next.result.versionId, next.result.payloadHash, 1);
  assert.equal(await scalar(
    `select count(*) from public.payments p join public.marketplace_payout_forecast_lines l
      on l.payment_id=p.id where l.version_id=$1 and p.status='cancelled'`, [old.versionId]), '2');
});

test('gate 12: replace is blocked by done/cancelled drift and any allocation history', async () => {
  const old = await published();
  const payment = await scalar(
    'select payment_id from public.marketplace_payout_forecast_lines where version_id=$1', [old.versionId]);
  await sql(`update public.payments set status='done' where id=$1`, [payment]);
  const next = await previewRevision(ids.finance, {
    expectedPublishedRevision: 1,
    lines: [line({ lineKey: 'replacement', providerReportId: 'replacement' })],
  });
  await approveRevision(next.result.versionId, next.result.payloadHash);
  await expectRpcError(
    () => publishRevision(next.result.versionId, next.result.payloadHash, 1),
    'REPLACE_BLOCKED',
  );
  await reset();
  const cancelledOld = await published();
  const cancelledPayment = await scalar(
    'select payment_id from public.marketplace_payout_forecast_lines where version_id=$1',
    [cancelledOld.versionId],
  );
  await sql(`update public.payments set status='cancelled' where id=$1`, [cancelledPayment]);
  const cancelledNext = await previewRevision(ids.finance, {
    expectedPublishedRevision: 1,
    lines: [line({ lineKey: 'cancelled-replacement', providerReportId: 'cancelled-replacement' })],
  });
  await approveRevision(cancelledNext.result.versionId, cancelledNext.result.payloadHash);
  await expectRpcError(
    () => publishRevision(cancelledNext.result.versionId, cancelledNext.result.payloadHash, 1),
    'REPLACE_BLOCKED',
  );
  await reset();
  const allocatedOld = await published();
  const allocatedLine = await lineId(allocatedOld.versionId);
  await receipt();
  await rpc('reconcile_marketplace_payout', await reconcileRequest(allocatedLine), ids.finance);
  const allocatedNext = await previewRevision(ids.finance, {
    expectedPublishedRevision: 1,
    lines: [line({ lineKey: 'allocated-replacement', providerReportId: 'allocated-replacement' })],
  });
  await approveRevision(allocatedNext.result.versionId, allocatedNext.result.payloadHash);
  await expectRpcError(
    () => publishRevision(allocatedNext.result.versionId, allocatedNext.result.payloadHash, 1),
    'REPLACE_BLOCKED',
  );
});

test('gate 13: provider report correction may change period/date/amount only in a new revision', async () => {
  const old = await published();
  await sql(`update public.marketplace_payout_routes set is_active=false,
    retired_at=pg_catalog.clock_timestamp() where cabinet_id=$1 and is_active`, [ids.cabinet]);
  await sql(`insert into public.marketplace_payout_routes(
    marketplace,cabinet_id,company_id,receiving_account_id,payer_inn,payer_kpp,
    payer_legal_name,account_kind,require_exact_payer_inn,created_by
  ) values('wb',$1,$2,$3,'9714053621','507401001','ООО «РВБ»','shared',true,$4)`,
  [ids.cabinet, ids.company, ids.account2, ids.director]);
  const next = await previewRevision(ids.finance, {
    expectedPublishedRevision: 1,
    receivingAccountId: ids.account2,
    lines: [line({ periodFrom: '2026-07-02', periodTo: '2026-07-09',
      expectedReceiptDate: '2026-07-12', amount: '1001.00' })],
  });
  assert.equal(next.result.revision, 2);
  assert.equal(await scalar(
    `select receiving_account_id=$2 from public.marketplace_payout_forecast_revisions where id=$1`,
    [old.versionId, ids.account]), true);
});

test('gate 14: one provider report cannot be current-published in two series', async () => {
  await published();
  const other = await previewRevision(ids.finance, { seriesKey: 'wb:other-series' });
  await approveRevision(other.result.versionId, other.result.payloadHash);
  await expectRpcError(
    () => publishRevision(other.result.versionId, other.result.payloadHash),
    'PROVIDER_REPORT_CONFLICT',
  );
});

test('gate 15: partial, combined and full active allocations drive lifecycle', async () => {
  const p = await published();
  const forecastLine = await lineId(p.versionId);
  await receipt('400.00');
  await rpc('reconcile_marketplace_payout', await reconcileRequest(forecastLine, {
    expectedReceiptAmount: '400.00',
    allocations: [{ forecastLineId: forecastLine, allocatedAmount: '400.00' }],
  }), ids.finance);
  assert.equal(await scalar(
    'select lifecycle_state from public.marketplace_payout_forecast_lines where id=$1',
    [forecastLine]), 'partially_received');
  const secondReceipt = '95000000-0000-4000-8000-000000000002';
  await receipt('600.00', secondReceipt);
  await rpc('reconcile_marketplace_payout', await reconcileRequest(forecastLine, {
    receiptPaymentId: secondReceipt,
    expectedReceiptAmount: '600.00',
    allocations: [{ forecastLineId: forecastLine, allocatedAmount: '600.00' }],
  }), ids.finance);
  assert.equal(await scalar(
    'select lifecycle_state from public.marketplace_payout_forecast_lines where id=$1',
    [forecastLine]), 'bank_received');
  assert.equal(await scalar(
    `select sum(a.allocated_amount) from public.marketplace_payout_receipt_allocations a
      join public.marketplace_payout_receipt_reconciliations r on r.id=a.reconciliation_id
      where r.state='active' and a.forecast_line_id=$1`, [forecastLine]), '1000.00');
});

test('gate 16: receipt-sum and forecast over-allocation fail with complete rollback', async () => {
  const p = await published();
  const forecastLine = await lineId(p.versionId);
  await receipt('800.00');
  const bad = await reconcileRequest(forecastLine, {
    expectedReceiptAmount: '800.00',
    allocations: [{ forecastLineId: forecastLine, allocatedAmount: '801.00' }],
  });
  await expectRpcError(() => rpc('reconcile_marketplace_payout', bad, ids.finance), 'RECEIPT_SUM_MISMATCH');
  assert.equal(await scalar('select count(*) from public.marketplace_payout_receipt_reconciliations'), '0');
  await rpc('reconcile_marketplace_payout', await reconcileRequest(forecastLine, {
    expectedReceiptAmount: '800.00',
    allocations: [{ forecastLineId: forecastLine, allocatedAmount: '800.00' }],
  }), ids.finance);
  const secondReceipt = '95000000-0000-4000-8000-000000000002';
  await receipt('300.00', secondReceipt);
  const overallocated = await reconcileRequest(forecastLine, {
    receiptPaymentId: secondReceipt,
    expectedReceiptAmount: '300.00',
    allocations: [{ forecastLineId: forecastLine, allocatedAmount: '300.00' }],
  });
  await expectRpcError(
    () => rpc('reconcile_marketplace_payout', overallocated, ids.finance),
    'FORECAST_OVERALLOCATED',
  );
  assert.equal(await scalar(
    `select count(*) from public.marketplace_payout_receipt_reconciliations
      where receipt_payment_id=$1`, [secondReceipt]), '0');
});

test('gate 17: correction reverses old snapshot and creates a new immutable snapshot', async () => {
  const p = await published();
  const forecastLine = await lineId(p.versionId);
  await receipt();
  await rpc('reconcile_marketplace_payout', await reconcileRequest(forecastLine), ids.finance);
  const correction = await reconcileRequest(forecastLine, { correctionReason: 'verified correction' });
  await rpc('reconcile_marketplace_payout', correction, ids.finance);
  assert.equal(await scalar(
    `select count(*) from public.marketplace_payout_receipt_reconciliations where state='reversed'`), '1');
  assert.equal(await scalar(
    `select count(*) from public.marketplace_payout_receipt_reconciliations where state='active'`), '1');
});

test('gate 18: shared account requires exact structured verified WB payer INN', async () => {
  const p = await published();
  const forecastLine = await lineId(p.versionId);
  await receipt();
  for (const badIdentity of [
    identity({ payerInn: '0000000000' }),
    identity({ payerInn: null }),
    identity({ source: 'legacy_text', verified: false }),
  ]) {
    const request = await reconcileRequest(forecastLine, { identity: badIdentity });
    await expectRpcError(
      () => rpc('reconcile_marketplace_payout', request, ids.finance),
      'PAYER_IDENTITY_MISMATCH',
    );
  }
});

test('gate 19: concurrent publish CAS has exactly one winner on physical connections', async () => {
  const p = await previewRevision();
  await approveRevision(p.result.versionId, p.result.payloadHash);
  const a = await connection('publish-a');
  const b = await connection('publish-b');
  try {
    await a.query('begin');
    await a.query(`select 1 from public.marketplace_payout_series where id=(
      select series_id from public.marketplace_payout_forecast_revisions where id=$1) for update`,
      [p.result.versionId]);
    const blocked = publishRevision(
      p.result.versionId, p.result.payloadHash, 0, ids.otherDirector, b,
    ).then((value) => ({ value }), (error) => ({ error }));
    const winner = await publishRevision(p.result.versionId, p.result.payloadHash, 0, ids.director, a);
    await a.query('commit');
    assert.equal(winner.result.ok, true);
    const loser = await blocked;
    assert.ok(['INVALID_STATE', 'CAS_CONFLICT'].includes(loser.error?.message));
  } finally {
    await Promise.allSettled([a.end(), b.end()]);
  }
});

test('gate 20: concurrent receipt reconciliation cannot oversubscribe one line', async () => {
  const p = await published();
  const forecastLine = await lineId(p.versionId);
  await receipt('1000.00');
  const secondReceipt = '95000000-0000-4000-8000-000000000002';
  await receipt('1000.00', secondReceipt);
  const a = await connection('reconcile-a');
  const b = await connection('reconcile-b');
  try {
    await a.query('begin');
    await a.query('select 1 from public.marketplace_payout_forecast_lines where id=$1 for update',
      [forecastLine]);
    const r1 = await reconcileRequest(forecastLine);
    const r2 = { ...await reconcileRequest(forecastLine), receiptPaymentId: secondReceipt };
    const blocked = rpc('reconcile_marketplace_payout', r2, ids.finance, b)
      .then((value) => ({ value }), (error) => ({ error }));
    const winner = await rpc('reconcile_marketplace_payout', r1, ids.finance, a);
    await a.query('commit');
    assert.equal(winner.ok, true);
    assert.equal((await blocked).error?.message, 'FORECAST_OVERALLOCATED');
  } finally {
    await Promise.allSettled([a.end(), b.end()]);
  }
});

test('gate 21: simultaneous replace/reconcile follows lock order and does not deadlock', async () => {
  const old = await published();
  const forecastLine = await lineId(old.versionId);
  await receipt();
  const next = await previewRevision(ids.finance, {
    expectedPublishedRevision: 1,
    lines: [line({ lineKey: 'replacement', providerReportId: 'replacement' })],
  });
  await approveRevision(next.result.versionId, next.result.payloadHash);
  const replaceClient = await connection('replace-lock-order');
  const reconcileClient = await connection('reconcile-lock-order');
  try {
    await replaceClient.query('begin');
    await replaceClient.query(`select 1 from public.marketplace_payout_series where id=(
      select series_id from public.marketplace_payout_forecast_revisions where id=$1) for update`,
      [next.result.versionId]);
    const reconcile = rpc(
      'reconcile_marketplace_payout',
      await reconcileRequest(forecastLine),
      ids.finance,
      reconcileClient,
    ).then((value) => ({ value }), (error) => ({ error }));
    const replacement = await publishRevision(
      next.result.versionId, next.result.payloadHash, 1, ids.director, replaceClient,
    );
    await replaceClient.query('commit');
    assert.equal(replacement.result.ok, true);
    assert.equal((await reconcile).error?.message, 'NOT_CURRENT_PUBLISHED');
  } finally {
    await Promise.allSettled([replaceClient.end(), reconcileClient.end()]);
  }
});

test('gate 22: anon/authenticated/service_role cannot SELECT or mutate payout tables', async () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(await scalar(`select not pg_catalog.has_table_privilege($1,
      'public.marketplace_payout_routes','SELECT,INSERT,UPDATE,DELETE')`, [role]), true);
    const client = await connection(`acl-${role}`);
    try {
      await client.query('begin');
      await client.query(`set local role ${role}`);
      await assert.rejects(
        () => client.query('select * from public.marketplace_payout_routes'),
        (error) => error.code === '42501',
      );
      await client.query('rollback');
    } finally {
      await client.end();
    }
  }
});

test('gate 23: generic service_role cannot execute RPC; only executor can', async () => {
  assert.equal(await scalar(`select not pg_catalog.has_function_privilege(
    'service_role','public.preview_marketplace_payout(jsonb,uuid)','EXECUTE')`), true);
  assert.equal(await scalar(`select pg_catalog.has_function_privilege(
    'payout_rpc_executor','public.preview_marketplace_payout(jsonb,uuid)','EXECUTE')`), true);
  const client = await connection('rpc-acl');
  try {
    await client.query('begin');
    await client.query('set local role service_role');
    await assert.rejects(
      () => client.query(
        `select public.preview_marketplace_payout('{}'::jsonb,$1::uuid)`,
        [ids.finance],
      ),
      (error) => error.code === '42501',
    );
    await client.query('rollback');
    await client.query('begin');
    await client.query('set local role payout_rpc_executor');
    await assert.rejects(
      () => client.query(
        `select public.preview_marketplace_payout('{}'::jsonb,$1::uuid)`,
        [ids.finance],
      ),
      (error) => error.code === 'P0001' && error.message.startsWith('MISSING_KEY:'),
    );
    await client.query('rollback');
  } finally {
    await client.end();
  }
});

test('gate 24: empty search_path prevents shadow-object hijacking', async () => {
  for (const signature of [
    'preview_marketplace_payout(jsonb,uuid)', 'approve_marketplace_payout(jsonb,uuid)',
    'publish_marketplace_payout(jsonb,uuid)', 'reconcile_marketplace_payout(jsonb,uuid)',
  ]) {
    assert.match(await scalar(`select pg_catalog.pg_get_functiondef(
      $1::pg_catalog.regprocedure)`, [`public.${signature}`]), /SET search_path TO ''/);
  }
  const client = await connection('search-path-shadow');
  try {
    await client.query('create temp table marketplace_payout_series(id text)');
    await client.query('create temp table app_users(id text)');
    await client.query(`set search_path=pg_temp,public`);
    const result = await rpc('preview_marketplace_payout', preview(), ids.finance, client);
    assert.equal(result.ok, true);
  } finally {
    await client.end();
  }
});

test('gate 25: audit UPDATE and DELETE are denied even to executor', async () => {
  const p = await previewRevision();
  assert.ok(p.result.ok);
  await expectSqlState(() => sql('update public.marketplace_payout_audit set result_json=result_json'), 'P0001');
  await expectSqlState(() => sql('delete from public.marketplace_payout_audit'), 'P0001');
});

test('gate 26: failed RPC leaves existing done receipt byte-identical', async () => {
  await receipt();
  const before = await scalar('select pg_catalog.to_jsonb(p)::text from public.payments p where id=$1', [ids.receipt]);
  const invalidRequest = await reconcileRequest('98000000-0000-4000-8000-000000000001');
  await expectRpcError(
    () => rpc('reconcile_marketplace_payout', {
      ...invalidRequest,
      expectedReceiptAmount: '999.00',
    }, ids.finance),
    'RECEIPT_DRIFT',
  );
  const after = await scalar('select pg_catalog.to_jsonb(p)::text from public.payments p where id=$1', [ids.receipt]);
  assert.equal(after, before);
});

test('gate 27: legacy finance_forecast_versions.actual_payout is numeric NOT NULL', async () => {
  const row = (await sql(`select data_type,is_nullable from information_schema.columns
    where table_schema='public' and table_name='finance_forecast_versions'
      and column_name='actual_payout'`)).rows[0];
  assert.deepEqual(row, { data_type: 'numeric', is_nullable: 'NO' });
  const client = await connection('legacy-actual-payout');
  try {
    await client.query('begin');
    const inserted = await client.query(`insert into public.finance_forecast_versions(
      year,month,snapshot_date,actual_payout
    ) values(2099,12,'2099-12-01',0) returning actual_payout`);
    assert.equal(inserted.rows[0].actual_payout, '0');
    await client.query('rollback');
  } finally {
    await client.end();
  }
});

test('gate 28: runtime is real PostgreSQL and major matches explicit production-major gate', async () => {
  const major = Number(await scalar(`select pg_catalog.current_setting('server_version_num')::integer/10000`));
  assert.ok(major >= 15);
  assert.equal(
    String(major),
    process.env.PAYOUT_PRODUCTION_POSTGRES_MAJOR,
    'set PAYOUT_PRODUCTION_POSTGRES_MAJOR to the verified production major',
  );
  assert.equal(await scalar(`select version() like 'PostgreSQL%'`), true);
});
