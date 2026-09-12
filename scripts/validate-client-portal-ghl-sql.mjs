// Isolated PostgreSQL behavior test. Vault is a synthetic adapter here;
// production verification must separately prove real Vault encryption/round-trip.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite, repositoryRoot } from './pglite-fixture.mjs'
const db = new PGlite()
const w = '00000000-0000-4000-8000-000000000001', r = '00000000-0000-4000-8000-000000000002'
const a = '00000000-0000-4000-8000-000000000003', b = '00000000-0000-4000-8000-000000000004'
const token = 'a'.repeat(64), secret = 'synthetic-ghl-private-token', location = 'syntheticlocation123'
const metrics = { contacts: 100, opportunities: 8, open: 4, won: 3, lost: 1 }
try {
 await db.exec(`
 create role anon; create role authenticated; create role service_role;
 create schema auth; create schema vault;
 create function auth.role() returns text language sql as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
 create table workspaces(id uuid primary key,status text);
 create table relationships(id uuid primary key,workspace_id uuid,status text,source_metadata jsonb);
 create table client_portal_sessions(session_token text unique,workspace_id uuid,relationship_id uuid,status text,token_revoked_at timestamptz);
 create table vault.secrets(id uuid primary key default gen_random_uuid(), secret text, name text);
 create view vault.decrypted_secrets as select id,secret as decrypted_secret from vault.secrets;
 create function vault.create_secret(new_secret text,new_name text) returns uuid language sql as $$ insert into vault.secrets(secret,name) values(new_secret,new_name) returning id $$;
 create function vault.update_secret(secret_id uuid,new_secret text) returns void language sql as $$ update vault.secrets set secret=new_secret where id=secret_id $$;
 insert into workspaces values('${w}','active');
 insert into relationships values('${r}','${w}','active','{"is_test":true}');
 insert into client_portal_sessions values('${token}','${w}','${r}','active',null);
 select set_config('request.jwt.claims','{"role":"service_role"}',false);
 `)
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260912030000_client_portal_ghl.sql`,'utf8'))
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260912040000_release_client_portal_ghl.sql`,'utf8'))
 const call = async (action, op = null, saveToken = null, data = null, ws = w, session = token) => (await db.query('select client_portal_ghl($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[session,ws,action,op,location,saveToken,'Synthetic',data,'permissions'])).rows[0].result
 const expire = () => db.exec("update client_portal_secure.ghl_connections set attempted_at = now()-interval '2 minutes',lease_until = now()-interval '1 minute'")
 assert.equal((await call('read')).connected,false)
 for (const role of ['anon','authenticated','service_role']) {
  const result=(await db.query("select has_schema_privilege($1,'client_portal_secure','USAGE') schema_access,has_table_privilege($1,'client_portal_secure.ghl_connections','SELECT') table_access,has_function_privilege($1,'public.client_portal_ghl(text,uuid,text,uuid,text,text,text,jsonb,text)','EXECUTE') rpc_access",[role])).rows[0]
  assert.deepEqual(result,{schema_access:false,table_access:false,rpc_access:role==='service_role'})
 }
 assert.equal((await call('begin_connect',a)).accepted,true)
 assert.equal((await call('begin_connect',b)).failure,'busy')
 assert.equal((await call('finish',b,secret,metrics)).failure,'changed')
 assert.equal((await call('finish',a,secret,metrics)).connected,true)
 assert.deepEqual((await call('read')).metrics,metrics)
 assert.equal((await call('begin_refresh',b)).failure,'cooldown')
 await expire()
 assert.equal((await call('begin_refresh',b)).privateToken,secret)
 assert.equal((await call('fail',a)).failure,'changed')
 await call('fail',b)
 assert.equal((await call('read')).error,'permissions')
 assert.deepEqual((await call('read')).metrics,metrics)
 await expire()
 await call('begin_connect',b)
 assert.equal((await call('finish',b,'replacement-synthetic-token',metrics)).connected,true)
 await expire()
 assert.equal((await call('begin_refresh',a)).privateToken,'replacement-synthetic-token')
 assert.equal((await call('disconnect')).connected,false)
 assert.equal((await call('finish',a,null,metrics)).failure,'changed')
 assert.equal((await db.query('select count(*)::int n from vault.secrets')).rows[0].n,0)
 await expire()
 await call('begin_connect',a)
 await expire()
 assert.equal((await call('finish',a,secret,metrics)).failure,'changed')
 for (const change of ["source_metadata='{}'","source_metadata='{\"is_test\":\"true\"}'"]) {
  await db.exec(`update relationships set ${change}`)
  assert.equal((await call('read')).connected,false)
 }
 await db.exec("update relationships set status='archived'")
 assert.equal((await call('read')).failure,'access')
 await db.exec(`update relationships set source_metadata='{"is_test":true}',status='active'`)
 assert.equal((await call('read',null,null,null,b)).failure,'access')
 assert.equal((await call('read',null,null,null,w,'b'.repeat(64))).failure,'access')
 await db.exec("update client_portal_sessions set token_revoked_at=now()")
 assert.equal((await call('read')).failure,'access')
 console.log('PASS: service-only permissions; TEST and ordinary relationship access; workspace and session isolation; lease contention; token replacement; error preservation; cooldown; expired lease; disconnect vs late refresh; secret cleanup. Vault adapter is synthetic.')
} finally { await db.close() }
