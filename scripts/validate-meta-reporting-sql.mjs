// Isolated synthetic schema only. Never accepts a production database URL.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {createGhlFixture,repositoryRoot} from './ghl-sql-fixture.mjs'
const db=await createGhlFixture()
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const fingerprint=createHash('sha256').update('synthetic-integration').digest('hex')
let passed=0
const pass=name=>console.log(`PASS ${++passed}: ${name}`)
try {
 await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema extensions; create extension pgcrypto with schema extensions;
 create table workspaces(id uuid primary key,status text);
 create table workspace_memberships(workspace_id uuid,user_id uuid,role text);
 create table relationships(workspace_id uuid,id uuid,status text,primary key(workspace_id,id));
 create table workspace_integrations(workspace_id uuid,provider text,enabled boolean,mode text,connection_status text,config_encrypted text);
 create table relationship_onboarding_sessions(workspace_id uuid,id uuid,relationship_id uuid,session_token text,status text,token_revoked_at timestamptz,source_sale_id uuid,primary key(workspace_id,id));
 create table relationship_onboarding_session_steps(workspace_id uuid,id uuid,session_id uuid,superseded_at timestamptz,primary key(workspace_id,id));
 create table relationship_onboarding_session_blocks(workspace_id uuid,id uuid,session_id uuid,session_step_id uuid,kind text,definition jsonb,primary key(workspace_id,id));
 create table work_items(workspace_id uuid,native_kind text,metadata jsonb,status text);
 create table client_sales(workspace_id uuid,id uuid,consent_confirmed_at timestamptz);
 create table onboarding_block_requirements(workspace_id uuid,session_id uuid,session_step_id uuid,session_block_id uuid unique,requirement_kind text,response jsonb,satisfied_at timestamptz);
 create function service_assignee_can_setup_client(uuid,uuid,uuid) returns boolean language sql as 'select false';
 `)
 const old=await readFile(`${repositoryRoot}supabase/migrations/20260914120000_windsor_meta_ads_reporting.sql`,'utf8')
 await db.exec(old.slice(old.indexOf('create table if not exists public.relationship_windsor_meta_ads_connections'),old.indexOf('create or replace function public.install_onboarding_service_template')))
 await db.exec(await readFile(`${repositoryRoot}supabase/migrations/20260918000000_windsor_completion_attempt.sql`,'utf8'))
 await db.exec(await readFile(`${repositoryRoot}supabase/migrations/20261022013000_meta_reporting_readiness.sql`,'utf8'))
 await db.exec(`grant usage on schema public,extensions to service_role; grant all on all tables in schema public to service_role;
 insert into workspaces values('${id(1)}','active'),('${id(2)}','active');
 insert into workspace_memberships values('${id(1)}','${id(10)}','admin'),('${id(1)}','${id(11)}','member'),('${id(2)}','${id(12)}','admin');
 insert into relationships values('${id(1)}','${id(20)}','client'),('${id(1)}','${id(21)}','client'),('${id(1)}','${id(22)}','archived'),('${id(2)}','${id(23)}','client');
 insert into workspace_integrations values('${id(1)}','windsor',true,'connected','connected','synthetic-integration');
 insert into relationship_onboarding_sessions values('${id(1)}','${id(30)}','${id(20)}','synthetic-token','active',null,null);
 insert into relationship_onboarding_session_steps values('${id(1)}','${id(31)}','${id(30)}',null);
 insert into relationship_onboarding_session_blocks values('${id(1)}','${id(32)}','${id(30)}','${id(31)}','connection','{"provider":"meta_ads"}');
 insert into relationship_windsor_meta_ads_connections(id,workspace_id,relationship_id,onboarding_session_id,source_session_block_id,status,account_id,account_name,connected_at,integration_fingerprint)
 values('${id(40)}','${id(1)}','${id(20)}','${id(30)}','${id(32)}','connected','old-account','Previous account',now(),'${fingerprint}');
 insert into onboarding_block_requirements(workspace_id,session_id,session_step_id,session_block_id,requirement_kind,response,satisfied_at) values('${id(1)}','${id(30)}','${id(31)}','${id(32)}','meta_ads_connected','{"accountId":"old-account","accepted":true}',now());
 set role service_role;`)
 const query=async(sql,args=[])=>(await db.query(sql,args)).rows[0]
 const input={workspaceId:id(1),relationshipId:id(20),userId:id(10)}
 const cmd=async(action,extra={},identity=input)=> (await query('select manage_windsor_meta_reporting($1,$2::jsonb) result',[action,JSON.stringify({...identity,...extra})])).result
 const row=async()=>query('select *,coalesce(reporting_revision,id) revision from relationship_windsor_meta_ads_connections where workspace_id=$1 and relationship_id=$2',[id(1),id(20)])
 const report={accountId:'business',accountName:'Business account',period:'last_30d',fetchedAt:new Date().toISOString(),dateFrom:'2026-09-22',dateTo:'2026-10-21',currency:'USD',totals:{spend:0,impressions:0,clicks:0,leads:0,ctr:null,cpc:null,costPerLead:null},daily:Array.from({length:30},(_,n)=>({date:`2026-10-${String(n+1).padStart(2,'0')}`,spend:0,impressions:0,clicks:0,leads:0}))}
 let state=await cmd('read');assert.equal(state.connection.revision,id(40));assert.equal(state.connection.verifiedAt,null)
 await assert.rejects(cmd('read',{}, {...input,userId:id(11)}),/access/)
 await assert.rejects(cmd('read',{}, {...input,userId:id(12)}),/access/)
 await assert.rejects(cmd('read',{}, {...input,relationshipId:id(22)}),/access/)
 pass('existing bindings remain connected and unverified; unauthorized and archived access is denied')
 const begin={candidateId:id(50),expectedRevision:id(40),integrationFingerprint:fingerprint,authorizationEncrypted:'synthetic-grant',authorizationHash:'a'.repeat(64)}
 await cmd('begin',begin)
 assert.equal((await row()).account_id,'old-account');assert.equal((await row()).last_report,null)
 await assert.rejects(cmd('commit',{...begin,accountId:'business'}),/Preview/)
 await assert.rejects(cmd('preview',{...begin,candidateId:id(51),accountId:'business',accountName:'Business',datasource:'facebook',report}),/expired|replaced/)
 await assert.rejects(cmd('preview',{...begin,accountId:'business',accountName:'Business',datasource:'facebook',report},{...input,userId:id(11)}),/access/)
 pass('candidate preparation and failed verification preserve the live account and fence foreign attempts')
 await cmd('preview',{...begin,accountId:'business',accountName:'Business account',datasource:'facebook',report})
 const saved=await cmd('commit',{...begin,accountId:'business'})
 assert.equal(saved.saved,true);assert.notEqual(saved.revision,id(40))
 const committed=await row();assert.equal(committed.account_id,'business');assert.equal(committed.onboarding_session_id,id(30));assert.equal(committed.reporting_grant_encrypted,'synthetic-grant');assert.equal(committed.last_report.connectionRevision,saved.revision)
 assert.deepEqual(await cmd('commit',{...begin,accountId:'business'}),saved)
 assert.equal(Number((await query('select count(*) n from windsor_meta_reporting_history')).n),1)
 assert.equal((await cmd('read')).history[0].previous_account_id,'old-account')
 assert.deepEqual((await query('select response from onboarding_block_requirements')).response,{accountId:'old-account',accepted:true})
 pass('confirmed commit retains onboarding identity and credential-free audit; lost acknowledgement replay is idempotent')
 const saveReport=async(revision,body,started=new Date().toISOString(),fp=fingerprint)=>(await query('select save_windsor_meta_report($1,$2,$3,$4,$5::jsonb,$6,$7) result',[id(1),id(20),revision,fp,body?JSON.stringify(body):null,body?null:'unavailable',started])).result
 assert.equal(await saveReport(id(40),{...report,connectionRevision:id(40)}),false)
 assert.equal(await saveReport(saved.revision,{...report,connectionRevision:saved.revision},new Date().toISOString(),'b'.repeat(64)),false)
 assert.equal((await row()).last_report.accountId,'business')
 pass('reports from an old binding or integration cannot overwrite the new account')
 const fresh={...report,connectionRevision:saved.revision,fetchedAt:new Date(Date.now()+1000).toISOString()}
 assert.equal(await saveReport(saved.revision,fresh,fresh.fetchedAt),true)
 await saveReport(saved.revision,null,'2000-01-01T00:00:00Z');assert.equal((await row()).last_report_error,null)
 await saveReport(saved.revision,null,new Date(Date.now()+2000).toISOString());assert.equal((await row()).last_report_error,'unavailable');assert.equal((await row()).last_report.fetchedAt,fresh.fetchedAt)
 pass('failed reads retain successful figures and older failures cannot mark newer reports failed')
 const next={...begin,candidateId:id(52),expectedRevision:saved.revision}
 await cmd('begin',next);await cmd('preview',{...next,accountId:'another',accountName:'Another account',datasource:'facebook',report:{...report,accountId:'another'}})
 await db.exec(`update windsor_meta_reporting_candidates set verified_at=now()-interval '11 minutes' where id='${id(52)}';`)
 await assert.rejects(cmd('commit',{...next,accountId:'another'}),/Preview/)
 await db.exec(`update windsor_meta_reporting_candidates set verified_at=now(),expires_at=now()-interval '1 minute' where id='${id(52)}';`)
 await assert.rejects(cmd('commit',{...next,accountId:'another'}),/expired/)
 assert.equal((await row()).account_id,'business')
 pass('expired authorization and report previews cannot commit')
 await db.exec(`update windsor_meta_reporting_candidates set expires_at=now()+interval '30 minutes' where id='${id(52)}'; update relationship_windsor_meta_ads_connections set account_id='external-change' where id='${id(40)}';`)
 await assert.rejects(cmd('commit',{...next,accountId:'another'}),/changed/)
 assert.equal((await row()).last_report,null);assert.equal((await row()).reporting_verified_at,null)
 pass('legacy account changes invalidate retained reports and fence stale maintenance saves')
 const noExisting={...input,relationshipId:id(21)}
 const initial={...begin,candidateId:id(53),expectedRevision:null}
 await cmd('begin',initial,noExisting);await cmd('preview',{...initial,accountId:'new-business',accountName:'New business',datasource:'facebook',report:{...report,accountId:'new-business'}},noExisting)
 await cmd('commit',{...initial,accountId:'new-business'},noExisting)
 assert.equal((await cmd('read',{},noExisting)).connection.accountId,'new-business')
 pass('staff can verify a new client binding without fabricating or rewriting onboarding')
 await db.exec(`delete from windsor_meta_reporting_candidates where relationship_id='${id(20)}'; update relationship_windsor_meta_ads_connections set account_id='act_123' where relationship_id='${id(21)}';`)
 const duplicate={...begin,candidateId:id(56),expectedRevision:(await row()).revision}
 await cmd('begin',duplicate);await cmd('preview',{...duplicate,accountId:'123',accountName:'Alias account',datasource:'facebook',report:{...report,accountId:'123'}})
 await assert.rejects(cmd('commit',{...duplicate,accountId:'123'}),/already linked/)
 assert.equal((await row()).account_id,'external-change')
 pass('canonical account aliases cannot be assigned to a second client')
 await db.exec(`insert into relationships values('${id(1)}','${id(24)}','client');
 insert into relationship_onboarding_sessions values('${id(1)}','${id(33)}','${id(24)}','new-token','active',null,null);
 insert into relationship_onboarding_session_steps values('${id(1)}','${id(34)}','${id(33)}',null);
 insert into relationship_onboarding_session_blocks values('${id(1)}','${id(35)}','${id(33)}','${id(34)}','connection','{"provider":"meta_ads"}');`)
 await query('select begin_windsor_meta_ads_onboarding($1,$2,$3,$4,$5)',['new-token',id(35),'onboarding-grant','b'.repeat(64),fingerprint])
 const complete=await query('select complete_verified_windsor_meta_ads_onboarding($1,$2,$3,$4,$5,$6,$7,$8::jsonb) result',['new-token',id(35),'b'.repeat(64),'onboarded','Onboarded business','facebook',fingerprint,JSON.stringify({...report,accountId:'onboarded'})])
 assert.equal(complete.result.reportingVerified,true)
 const onboarded=await query('select * from relationship_windsor_meta_ads_connections where relationship_id=$1',[id(24)])
 assert.equal(onboarded.authorization_encrypted,null);assert.equal(onboarded.reporting_grant_encrypted,'onboarding-grant');assert.equal(onboarded.last_report.accountId,'onboarded');assert.ok(onboarded.reporting_verified_at)
 pass('new onboarding completes through the existing owner while retaining verified report and scoped grant')
 await db.exec(`insert into relationships(workspace_id,id,status)
   select '${id(1)}',('00000000-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,'client' from generate_series(1,5000) n;
 insert into relationship_windsor_meta_ads_connections(workspace_id,relationship_id,status,account_id,account_name,connected_at,integration_fingerprint)
   select '${id(1)}',('00000000-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,'connected','scale-'||n,'Synthetic account',now(),'${fingerprint}' from generate_series(1,5000) n;
 insert into windsor_meta_reporting_history(id,workspace_id,relationship_id,actor_user_id,account_id,account_name,connection_revision,created_at)
   select gen_random_uuid(),'${id(1)}','${id(20)}','${id(10)}','synthetic','Synthetic history','${id(40)}',now()-n*interval '1 day' from generate_series(1,10000) n;
 reset role; analyze relationship_windsor_meta_ads_connections; analyze windsor_meta_reporting_history; set role service_role;`)
 const historyPlan=await query(`explain(format json) select id,account_id from windsor_meta_reporting_history where workspace_id='${id(1)}' and relationship_id='${id(20)}' order by created_at desc,id desc limit 10`)
 const accountPlan=await query(`explain(format json) select id from relationship_windsor_meta_ads_connections where workspace_id='${id(1)}' and status='connected' and account_id in ('scale-4999','act_scale-4999')`)
 assert.match(JSON.stringify(historyPlan),/windsor_meta_reporting_history_relationship/)
 assert.match(JSON.stringify(accountPlan),/relationship_windsor_meta_ads_account_unique/)
 const bounded=await cmd('read');assert.equal(bounded.history.length,10);assert.ok(Buffer.byteLength(JSON.stringify(bounded))<8000)
 pass('5,000 accounts and 10,000 audit rows use the intended lookup indexes and keep maintenance response bounded')
 // Native mode additionally exercises real row/advisory-lock contention.
 if(db.connect){
  const a=await db.connect(),b=await db.connect();await a.query('set role service_role');await b.query('set role service_role')
  await db.exec(`delete from windsor_meta_reporting_candidates where relationship_id='${id(20)}';`)
  const rev=(await row()).revision,candidate={...begin,candidateId:id(54),expectedRevision:rev}
  await cmd('begin',candidate);await cmd('preview',{...candidate,accountId:'winning-account',accountName:'Winning account',datasource:'facebook',report:{...report,accountId:'winning-account'}})
  await a.query('begin')
  const commitInput=JSON.stringify({...input,...candidate,accountId:'winning-account'})
  const winner=(await a.query("select manage_windsor_meta_reporting('commit',$1::jsonb) result",[commitInput])).rows[0].result
  const repeat=b.query("select manage_windsor_meta_reporting('commit',$1::jsonb) result",[commitInput]);repeat.catch(()=>{})
  await db.waitLock(b);await a.query('commit');assert.deepEqual((await repeat).rows[0].result,winner)
  pass('concurrent commits reconcile one immutable receipt after a real lock wait')
 }
 await db.exec('reset role; set role authenticated;')
 await assert.rejects(db.query("select manage_windsor_meta_reporting('read','{}')"),/permission denied/)
 await assert.rejects(db.query('select * from windsor_meta_reporting_candidates'),/permission denied/)
 pass('candidate credentials and management RPCs are inaccessible to browser roles')
 console.log(JSON.stringify({passed,productionCalls:0,nativeConcurrency:Boolean(db.connect)}))
} finally {await db.close()}
