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
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260912050000_client_portal_ghl_calendar.sql`,'utf8'))
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260912060000_client_portal_ghl_owner_calendar.sql`,'utf8'))
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260912070000_client_portal_ghl_contact_titles.sql`,'utf8'))
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260912080000_client_portal_ghl_title_snapshot_identity.sql`,'utf8'))
 const call = async (action, op = null, saveToken = null, data = null, ws = w, session = token) => (await db.query('select client_portal_ghl($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[session,ws,action,op,location,saveToken,'Synthetic',data,'permissions'])).rows[0].result
 const expire = () => db.exec("update client_portal_secure.ghl_connections set attempted_at = now()-interval '2 minutes',lease_until = now()-interval '1 minute'")

 const calendar=async(action,op=null,snapshot=null,month='2026-09',cal=null,ws=w,session=token)=>(await db.query('select client_portal_ghl_calendar($1,$2,$3,$4,$5,$6,$7,$8) result',[session,ws,action,op,month,cal,snapshot,'permissions'])).rows[0].result
 const data={source:'owner-user',companyId:'company123456789',owner:{id:'owner1234567890',name:'Client owner'},timezone:'America/Chicago',month:'2026-09',events:[]}
 assert.equal((await calendar('read')).failure,'credentials_missing')
 await call('begin_connect',a);await call('finish',a,secret,metrics)
 assert.equal((await calendar('read')).snapshot,null)
 assert.equal((await calendar('begin',a,null,'2026-09','calendar123456789')).failure,'response')
 assert.equal((await calendar('begin',a)).privateToken,secret)
 assert.equal((await calendar('begin',b)).failure,'busy')
 assert.equal((await calendar('finish',b,data)).failure,'changed')
 assert.equal((await calendar('finish',a,{...data,month:'2026-10'})).failure,'response')
 assert.deepEqual((await calendar('finish',a,data)).snapshot,{...data,snapshotId:a})
 assert.equal((await calendar('begin',b)).failure,'cooldown')
 assert.equal(JSON.stringify(await calendar('read')).includes(secret),false)
 await db.exec("update client_portal_secure.ghl_calendar_snapshots set attempted_at=now()-interval '1 minute'")
 assert.equal((await calendar('begin',a)).binding.owner.id,data.owner.id)
 await calendar('fail',a)
 assert.deepEqual((await calendar('read')).snapshot,{...data,snapshotId:a})
 assert.equal((await calendar('read')).error,'permissions')
 for(const role of ['anon','authenticated','service_role']){
  const permission=(await db.query("select has_table_privilege($1,'client_portal_secure.ghl_calendar_snapshots','SELECT') t,has_function_privilege($1,'public.client_portal_ghl_calendar(text,uuid,text,uuid,text,text,jsonb,text)','EXECUTE') f",[role])).rows[0]
  assert.deepEqual(permission,{t:false,f:role==='service_role'})
 }
 assert.equal((await calendar('read',null,null,'2026-09',null,b)).failure,'access')
 assert.equal((await calendar('read',null,null,'2026-09',null,w,'invalid')).failure,'access')
 await db.exec("update relationships set status='archived'");assert.equal((await calendar('read')).failure,'access');await db.exec("update relationships set status='active'")
 await db.exec("update client_portal_sessions set token_revoked_at=now()");assert.equal((await calendar('read')).failure,'access');await db.exec("update client_portal_sessions set token_revoked_at=null")
 // Title leases are independently fenced by the exact calendar snapshot.
 const names=async(action,stamp,op=a,labels=null,ws=w,session=token)=>(await db.query('select client_portal_ghl_calendar_names($1,$2,$3,$4,$5,$6) result',[session,ws,action,stamp,op,labels])).rows[0].result
 const titleData={...data,namesStatus:'pending',eventContacts:{appointment123456:'contact123456789'},events:[{id:'appointment123456',kind:'appointment',title:'Original appointment'}]}
 await db.exec("update client_portal_secure.ghl_calendar_snapshots set attempted_at=now()-interval '1 minute'")
 await calendar('begin',a);const base=await calendar('finish',a,titleData),stamp=base.snapshot.snapshotId
 assert.equal((await names('begin',stamp,a,null,b)).failure,'access')
 assert.equal((await names('begin',stamp,a,null,w,'invalid')).failure,'access')
 assert.equal((await names('begin',stamp)).privateToken,secret)
 assert.equal((await names('begin',stamp,b)).failure,'busy')
 assert.equal((await names('finish',stamp,b,{})).failure,'changed')
 assert.equal((await names('finish',stamp,a,{unrelatedcontact123:{name:'Wrong contact'}})).failure,'response')
 assert.equal((await names('finish',stamp,a,{contact123456789:{name:'Manuel',budget:100}})).failure,'response')
 const titled=await names('finish',stamp,a,{contact123456789:{name:'Manuel Rodriguez',city:'Fort Worth'}})
 assert.equal(titled.snapshot.events[0].title,'Original appointment')
 assert.equal(titled.snapshot.contactLabels.contact123456789.city,'Fort Worth')
 assert.equal(titled.refreshedAt,base.refreshedAt)
 assert.equal((await names('begin',stamp)).skipped,true)
 await db.exec("update client_portal_secure.ghl_calendar_snapshots set attempted_at=now()-interval '1 minute'")
 const boundedBinding=await calendar('begin',a)
 assert.deepEqual(Object.keys(boundedBinding.binding).sort(),['companyId','owner','timezone'])
 const nextBase=await calendar('finish',a,titleData)
 await names('begin',nextBase.snapshot.snapshotId,a)
 await db.exec("update client_portal_secure.ghl_calendar_snapshots set attempted_at=now()-interval '1 minute'")
 // A pending title lookup does not block a month refresh.
 assert.equal((await calendar('begin',b)).privateToken,secret)
 const newer=await calendar('finish',b,titleData)
 assert.equal((await names('finish',nextBase.snapshot.snapshotId,a,{})).failure,'changed')
 await names('begin',newer.snapshot.snapshotId,b)
 const failedNames=await names('fail',newer.snapshot.snapshotId,b)
 assert.equal(failedNames.snapshot.namesStatus,'unavailable')
 assert.equal(failedNames.snapshot.events[0].title,'Original appointment')
 for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_function_privilege($1,'public.client_portal_ghl_calendar_names(text,uuid,text,uuid,uuid,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,role==='service_role')
 // Credential replacement atomically invalidates both cached events and in-flight calendar work.
 await db.exec("update client_portal_secure.ghl_calendar_snapshots set attempted_at=now()-interval '1 minute'")
 await calendar('begin',b);await expire();await call('begin_connect',a);await call('finish',a,'new-synthetic-private-token',metrics)
 assert.equal((await calendar('read')).snapshot,null)
 assert.equal((await calendar('finish',b,data)).failure,'changed')
 assert.equal((await names('finish',newer.snapshot.snapshotId,b,{})).failure,'changed')
 await calendar('begin',b)
 await call('disconnect')
 assert.equal((await calendar('finish',b,data)).failure,'credentials_missing')
 assert.equal((await names('finish',newer.snapshot.snapshotId,b,{})).failure,'credentials_missing')
 assert.equal((await db.query('select count(*)::int n from client_portal_secure.ghl_calendar_snapshots')).rows[0].n,0)
 console.log('PASS: calendar and title access isolation, bounded data, independent leases, snapshot races, contact association validation, failed refresh preservation, credential replacement and disconnect invalidation. Synthetic Vault adapter.')
} finally {await db.close()}
