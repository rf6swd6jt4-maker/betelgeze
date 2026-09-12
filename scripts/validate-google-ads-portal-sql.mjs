import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite, repositoryRoot } from './pglite-fixture.mjs'
const db = new PGlite(), id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const w=id(1),r=id(2),other=id(3),session=id(4),block=id(5),step=id(6),a=id(7),b=id(8),manager='1234567890',customer='2345678901',token='a'.repeat(64)
const query=async(sql,params=[]) => (await db.query(sql,params)).rows
const one=async(sql,params=[]) => (await query(sql,params))[0].v
try {
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create table workspaces(id uuid primary key,status text);
 create table relationships(workspace_id uuid,id uuid primary key,status text,unique(workspace_id,id));
 create table client_portal_sessions(session_token text,workspace_id uuid,relationship_id uuid,status text,token_revoked_at timestamptz);
 create table relationship_onboarding_sessions(workspace_id uuid,id uuid primary key,relationship_id uuid,session_token text,status text,token_revoked_at timestamptz,source_sale_id uuid,unique(workspace_id,id));
 create table relationship_onboarding_session_steps(workspace_id uuid,id uuid,session_id uuid,superseded_at timestamptz);
 create table relationship_onboarding_session_blocks(workspace_id uuid,id uuid primary key,session_id uuid,session_step_id uuid,kind text,definition jsonb,unique(workspace_id,id));
 create table client_sales(workspace_id uuid,id uuid,consent_confirmed_at timestamptz);
 create table work_items(workspace_id uuid,native_kind text,metadata jsonb,status text);
 create table workspace_integrations(workspace_id uuid,provider text,enabled boolean,mode text,connected_account_id text,config_encrypted text,config_hint jsonb);
 create table onboarding_block_requirements(workspace_id uuid,session_id uuid,session_step_id uuid,session_block_id uuid unique,requirement_kind text,response jsonb,satisfied_at timestamptz);
 insert into workspaces values('${w}','active');
 insert into relationships values('${w}','${r}','active'),('${w}','${other}','active');
 insert into client_portal_sessions values('${token}','${w}','${r}','active',null),('other','${w}','${other}','active',null);
 insert into workspace_integrations values('${w}','google_ads',true,'connected','${manager}','encrypted-fixture','{"manager_name":"Agency"}');
 insert into relationship_onboarding_sessions values('${w}','${session}','${r}','onboard','active',null,null);
 insert into relationship_onboarding_session_steps values('${w}','${step}','${session}',null);
 insert into relationship_onboarding_session_blocks values('${w}','${block}','${session}','${step}','connection','{"provider":"google_ads"}');
 `)
 const previous=await readFile(`${repositoryRoot}/supabase/migrations/20260907010000_onboarding_google_ads_connections.sql`,'utf8')
 await db.exec(previous.slice(previous.indexOf('create table public.relationship_google_ads_connections')))
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260912090000_client_portal_google_ads.sql`,'utf8'))
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260912100000_google_ads_oauth.sql`,'utf8'))
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260912110000_google_ads_portal_disconnect.sql`,'utf8'))
 for(const role of ['anon','authenticated']) {
  assert.equal((await query("select has_function_privilege($1,'public.disconnect_google_ads_portal(text,uuid)','EXECUTE') allowed",[role]))[0].allowed,false)
  assert.equal((await query('select has_table_privilege($1,\'public.relationship_google_ads_reports\',\'SELECT\') allowed',[role]))[0].allowed,false)
  assert.equal((await query('select has_function_privilege($1,\'public.begin_google_ads_portal(text,uuid,text,text,uuid)\',\'EXECUTE\') allowed',[role]))[0].allowed,false)
 }
 await db.exec('grant usage on schema public to service_role; grant all on all tables in schema public to service_role; set role service_role;')
 const begin=(t=token,acct=customer,attempt=a)=>one('select begin_google_ads_portal($1,$2,$3,$4,$5) v',[t,w,acct,manager,attempt])
 const finish=(attempt=a,config='encrypted-fixture',status='connected')=>one('select finish_google_ads_portal($1,$2,$3,$4,$5,$6,$7,$8,$9) v',[token,w,attempt,config,status,'Account','USD','America/Chicago',null])
 const report=(action='read',attempt=null,config=null,data=null,t=token)=>one('select client_portal_google_ads_report($1,$2,$3,$4,$5,$6,$7,$8) v',[t,w,'last30',action,attempt,config,data,null])
 assert.equal((await report()).snapshot,null)
 await assert.rejects(begin('invalid'),/unavailable/)
 await begin(); await assert.rejects(begin(),/already running/)
 await assert.rejects(finish(b),/newer connection/)
 await assert.rejects(finish(a,'changed'),/changed/)
 assert.equal((await finish()).status,'connected')
 await assert.rejects(begin('other'),/another relationship/)
 assert.equal((await query('select onboarding_session_id from relationship_google_ads_connections'))[0].onboarding_session_id,null)
 const started=await report('begin',a);assert.equal(started.customerId,customer);assert.equal(started.configEncrypted,'encrypted-fixture')
 await assert.rejects(report('begin',b),/already refreshing/)
 await assert.rejects(report('finish',b,'encrypted-fixture',{customerId:customer}),/changed/)
 await assert.rejects(report('finish',a,'encrypted-fixture',{customerId:'9999999999'}),/Invalid account/)
 const saved=await report('finish',a,'encrypted-fixture',{customerId:customer,spend:5});assert.equal(saved.snapshot.report.spend,5)
 assert.equal('configEncrypted' in await report(),false)
 assert.equal((await report('read',null,null,null,'other')).snapshot,null)
 await assert.rejects(report('begin',b),/wait a minute/)
 await db.exec("update relationship_google_ads_reports set attempted_at=now()-interval '2 minutes';")
 await report('begin',b)
 await db.exec("update workspace_integrations set config_encrypted='rotated';")
 assert.equal((await report()).snapshot,null)
 await assert.rejects(report('finish',b,'encrypted-fixture',{customerId:customer}),/changed/)
 await db.exec("update workspace_integrations set config_encrypted='encrypted-fixture'; update relationship_google_ads_connections set updated_at=now()-interval '10 seconds';")
 await one('select begin_google_ads_onboarding($1,$2,$3,$4,$5) v',['onboard',block,customer,manager,b])
 await one('select finish_google_ads_onboarding($1,$2,$3,$4,$5,$6,$7,$8,$9) v',['onboard',block,b,'encrypted-fixture','connected','Account','USD','America/Chicago',null])
 assert.equal((await query('select count(*)::int n from onboarding_block_requirements'))[0].n,1)
 const disconnect=(t=token)=>one('select disconnect_google_ads_portal($1,$2) v',[t,w])
 await assert.rejects(disconnect('invalid'),/unavailable/)
 await db.exec("update relationship_google_ads_connections set attempt_id='"+a+"',attempt_started_at=now()")
 await assert.rejects(disconnect(),/still running/)
 await db.exec("update relationship_google_ads_connections set attempt_id=null")
 await query('select prepare_google_ads_oauth($1,$2,$3,$4)',[w,r,'a'.repeat(64),'encrypted'])
 await db.exec("update google_ads_oauth_attempts set phase='connecting'")
 await assert.rejects(disconnect(),/still running/)
 await db.exec("update google_ads_oauth_attempts set phase='ready'")
 await disconnect()
 assert.equal((await query('select count(*)::int n from relationship_google_ads_connections'))[0].n,0)
 assert.equal((await query('select count(*)::int n from relationship_google_ads_reports'))[0].n,0)
 assert.equal((await query('select count(*)::int n from google_ads_oauth_attempts'))[0].n,0)
 assert.equal((await query('select count(*)::int n from onboarding_block_requirements'))[0].n,0)
 await disconnect() // Retry after a lost response is harmless.
 await assert.rejects(finish(),/newer connection/)
 await begin(token,'3456789012',a)
 assert.equal((await finish()).customerId,'3456789012')
 await db.exec("update client_portal_sessions set token_revoked_at=now() where session_token='"+token+"';")
 await assert.rejects(report(),/unavailable/);await assert.rejects(finish(),/unavailable/)
 console.log('PASS: portal/onboarding share one account; permissions, revocation, duplicates, leases, cooldowns, config rotation, stale writes, report isolation and safe portal disconnection')
} catch(error) { console.error(error.message, error.where ?? ""); process.exitCode=1 } finally { await db.close() }
