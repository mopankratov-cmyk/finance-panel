import assert from 'node:assert/strict';
import pg from 'pg';

const productionRef = 'jwjobmdihddytqfgymus';
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error('TEST_DATABASE_URL is required; payout contract tests only run on a disposable PostgreSQL database');
}
if (connectionString.toLowerCase().includes(productionRef)) {
  throw new Error(`Refusing known production Supabase ref ${productionRef}`);
}
const parsed = new URL(connectionString);
if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
  throw new Error('TEST_DATABASE_URL must use postgres:// or postgresql://');
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
export async function barrier(key, clients) {
  await sql('select test_support.reset_barrier($1, $2)', [key, clients]);
}
export async function waitAtBarrier(client, key) {
  await client.query('select test_support.wait_barrier($1)', [key]);
}
export async function close() {
  await pool.end();
}
