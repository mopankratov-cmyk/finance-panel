import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const migration = readFileSync("supabase/migrations/20260629_factory_m6_ugc_distribution.sql", "utf8");

ok(/create table if not exists factory_personas/.test(migration), "M6 migration creates persona registry");
ok(/consent_status in \('unknown','consented','revoked','stock','not_required'\)/.test(migration), "personas carry explicit consent status");
ok(/persona_ref_id uuid references factory_personas/.test(migration), "brand_kits gets non-breaking persona FK");
ok(!/alter table brand_kits[\s\S]*alter column persona_id/.test(migration), "existing brand_kits.persona_id provider override is not rewritten");

ok(/create table if not exists factory_ugc_jobs/.test(migration), "M6 migration creates UGC job table");
ok(/unique \(idempotency_key\)/.test(migration), "UGC jobs have idempotency guard");
ok(/dlq_category[\s\S]*'lipsync'[\s\S]*'face_drift'[\s\S]*'budget'/.test(migration), "UGC jobs classify DLQ reasons");

ok(/create table if not exists factory_distribution_targets/.test(migration), "M6 migration creates distribution targets");
ok(/create table if not exists factory_publications/.test(migration), "M6 migration creates publication rows");
ok(/factory_publications_paid_token_chk/.test(migration), "paid publication requires ad token marker");
ok(/published_url/.test(migration) && /external_post_id/.test(migration), "publications store public URL and external id");

ok(/alter table post_metrics[\s\S]*add column if not exists publication_id uuid/.test(migration), "post_metrics links to publications");
ok(/add column if not exists hook_rate numeric/.test(migration), "post_metrics tracks hook rate");
ok(/add column if not exists hold_rate numeric/.test(migration), "post_metrics tracks hold rate");
ok(/add column if not exists completion_rate numeric/.test(migration), "post_metrics tracks completion");
ok(/recipe_id\s+bigint references node_recipes/.test(readFileSync("supabase/migrations/20260620_factory_v3_node_studio.sql", "utf8")), "legacy post_metrics recipe_id remains available");

console.log("m6MigrationContract: passed");
