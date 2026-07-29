import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const productionRef = 'jwjobmdihddytqfgymus';
const connectionString = process.env.TEST_DATABASE_URL;
const expectedRef = process.env.EXPECTED_TEST_DATABASE_REF;
if (!connectionString) {
  throw new Error('TEST_DATABASE_URL is required; payout contract tests only run on a disposable PostgreSQL database');
}
if (!expectedRef) {
  throw new Error('EXPECTED_TEST_DATABASE_REF is required');
}
if (connectionString.toLowerCase().includes(productionRef)) {
  throw new Error(`Refusing known production Supabase ref ${productionRef}`);
}
const parsed = new URL(connectionString);
if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
  throw new Error('TEST_DATABASE_URL must use postgres:// or postgresql://');
}
const directRef = parsed.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1];
const poolerRef = decodeURIComponent(parsed.username).match(/^[^.]+\.([a-z0-9]+)$/i)?.[1];
const actualRef = directRef ?? poolerRef;
if (!actualRef || actualRef !== expectedRef || expectedRef === productionRef) {
  throw new Error(
    `TEST_DATABASE_URL ref mismatch: expected exact disposable ref ${expectedRef}`,
  );
}
if (process.env.PAYOUT_CONTRACT_RUNNER_VALIDATED !== '1' && process.argv[2] !== '--run') {
  throw new Error('Run payout contract tests only through npm run test:payout-contract');
}

const { Pool, Client } = pg;
export const pool = new Pool({
  connectionString,
  max: 12,
  application_name: 'payout-contract-test',
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
  lock_timeout: 3_000,
});

export async function sql(text, params = []) {
  return pool.query(text, params);
}
export async function scalar(text, params = []) {
  const result = await sql(text, params);
  return Object.values(result.rows[0])[0];
}
export async function expectSqlState(fn, code) {
  await assert.rejects(fn, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}
export async function expectRpcError(fn, code) {
  await assert.rejects(fn, (error) => {
    assert.equal(error.code, 'P0001');
    assert.equal(error.message, code);
    return true;
  });
}
export async function connection(applicationName) {
  const client = new Client({
    connectionString,
    application_name: applicationName,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    lock_timeout: 3_000,
  });
  await client.connect();
  return client;
}
export async function withTx(client, fn) {
  await client.query('begin');
  try {
    const value = await fn(client);
    await client.query('commit');
    return value;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}
export async function rpc(name, request, actor, client = pool) {
  const result = await client.query(
    `select public.${name}($1::jsonb, $2::uuid) result`,
    [JSON.stringify(request), actor],
  );
  return result.rows[0].result;
}
export async function close() {
  await pool.end();
}

async function run() {
  const guard = new Client({
    connectionString,
    application_name: 'payout-contract-readonly-guard',
    options: '-c default_transaction_read_only=on',
    connectionTimeoutMillis: 5_000,
  });
  await guard.connect();
  try {
    const result = await guard.query(
      `select pg_catalog.current_setting('server_version_num')::integer/10000 major`,
    );
    assert.equal(result.rows[0].major, 17, 'payout contract requires PostgreSQL major 17');
  } finally {
    await guard.end();
  }

  const setup = new Client({
    connectionString,
    application_name: 'payout-contract-safe-runner',
    connectionTimeoutMillis: 5_000,
  });
  await setup.connect();
  try {
    const migration = await readFile(
      new URL('../../supabase/migrations/202607290001_marketplace_payout_contract_v2.sql', import.meta.url),
      'utf8',
    );
    const support = await readFile(new URL('./support.sql', import.meta.url), 'utf8');
    await setup.query(migration);
    await setup.query(support);
  } finally {
    await setup.end();
  }

  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--test', '--test-concurrency=1', `${fileURLToPath(new URL('.', import.meta.url))}contract.test.mjs`],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          PAYOUT_CONTRACT_RUNNER_VALIDATED: '1',
          PAYOUT_PRODUCTION_POSTGRES_MAJOR: '17',
        },
      },
    );
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`contract tests failed (${signal ?? code})`));
    });
  });
}

if (process.argv[2] === '--run') {
  await run();
}
