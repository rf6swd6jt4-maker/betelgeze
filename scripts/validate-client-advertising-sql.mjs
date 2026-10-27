import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from './pglite-fixture.mjs'
const db=new PGlite(),uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,ws=uuid(1),other=uuid(2),owner=uuid(3),staff=uuid(4)
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table workspaces(id uuid primary key,status text);
 create table workspace_memberships(workspace_id uuid,user_id uuid,role text,primary key(workspace_id,user_id));
 create table relationships(workspace_id uuid,id uuid,primary_person_name text,business_name text,status text,primary key(workspace_id,id));
 create table fixture_permissions(workspace_id uuid,user_id uuid,relationship_id uuid,primary key(workspace_id,user_id,relationship_id));
 create function manage_client_ghl_connection_v2(p_workspace_id uuid,p_user_id uuid,p_action text,p_relationship_id uuid default null,p_operation_id uuid default null,p_account_type text default null,p_location_id text default null,p_private_token text default null,p_location_name text default null,p_metrics jsonb default null,p_error text default null,p_expected_revision uuid default null,p_calendar_id text default null,p_calendar_name text default null) returns jsonb language sql as $$select coalesce(jsonb_agg(jsonb_build_object('relationshipId',p.relationship_id)),'[]') from public.fixture_permissions p join public.relationships r on r.workspace_id=p.workspace_id and r.id=p.relationship_id and r.status<>'archived' where p.workspace_id=p_workspace_id and p.user_id=p_user_id and (p_relationship_id is null or p.relationship_id=p_relationship_id)$$;
 create table relationship_google_ads_connections(workspace_id uuid,relationship_id uuid,status text,customer_id text,account_name text,connected_at timestamptz,last_verified_at timestamptz,primary key(workspace_id,relationship_id));
 create table relationship_meta_ads_connections(workspace_id uuid,relationship_id uuid,status text,facebook_user_id text,facebook_user_name text,connected_at timestamptz,last_verified_at timestamptz,access_token_expires_at timestamptz,credential_encrypted text,primary key(workspace_id,relationship_id));
 create table relationship_windsor_meta_ads_connections(workspace_id uuid,relationship_id uuid,status text,account_id text,account_name text,connected_at timestamptz,last_verified_at timestamptz,reporting_verified_at timestamptz,last_report_error text,authorization_encrypted text,primary key(workspace_id,relationship_id));
 create function fixture_uuid(n integer) returns uuid language sql immutable as $$select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
 insert into workspaces values('${ws}','active'),('${other}','active');
 insert into workspace_memberships values('${ws}','${owner}','owner'),('${ws}','${staff}','staff');
 insert into relationships select '${ws}',fixture_uuid(n),'Client '||n,'Business '||n,case when n=100 then 'archived' else 'active' end from generate_series(100,20099) n;
 insert into relationships values('${other}',fixture_uuid(100),'Other workspace',null,'active');
 insert into fixture_permissions values('${ws}','${staff}',fixture_uuid(100)),('${ws}','${staff}',fixture_uuid(101)),('${ws}','${staff}',fixture_uuid(20099));
 insert into relationship_google_ads_connections select workspace_id,id,'connected','customer-'||id,'Google',now(),now() from relationships;
 insert into relationship_meta_ads_connections select workspace_id,id,'connected','user-'||id,'Meta',now(),now(),now()-interval '1 day','SECRET' from relationships;
 insert into relationship_windsor_meta_ads_connections select workspace_id,id,'connected','account-'||id,'Windsor',now(),now(),null,null,'SECRET' from relationships;
 analyze;`)
 await db.exec(await readFile('supabase/migrations/20261027160000_client_advertising_connections.sql','utf8'))
 const read=async(user=owner,rel=null,after=null,provider=null)=>(await db.query('select read_client_advertising_connections($1,$2,$3,$4,$5) result',[ws,user,rel,after,provider])).rows[0].result
 const first=await read();assert.equal(first.accounts.length,50);assert.ok(first.nextCursor);assert.equal(first.accounts[0].archived,true)
 assert.equal(first.accounts[1].status,'needs_attention');assert.equal(first.accounts[2].status,'needs_attention')
 assert.ok(!JSON.stringify(first).includes('SECRET'));assert.ok(!JSON.stringify(first).includes('Other workspace'))
 const second=await read(owner,null,first.nextCursor.relationshipId,first.nextCursor.provider)
 assert.equal(second.accounts.length,50)
 assert.equal(second.accounts[0].relationshipId,first.accounts.at(-1).relationshipId,'A page split between providers keeps the same relationship')
 assert.equal(new Set([...first.accounts,...second.accounts].map(r=>r.relationshipId+':'+r.provider)).size,100)
 const scoped=await read(owner,uuid(101));assert.equal(scoped.accounts.length,3);assert.equal(scoped.nextCursor,null)
 const limited=await read(staff);assert.equal(limited.accounts.length,6);assert.ok(limited.accounts.every(r=>[uuid(101),uuid(20099)].includes(r.relationshipId)))
 assert.deepEqual((await read(staff,uuid(102))).accounts,[])
 assert.equal((await read(uuid(999))).failure,'access');assert.equal((await read(owner,null,uuid(101),null)).failure,'cursor')
 await db.exec(`delete from fixture_permissions where user_id='${staff}';`);assert.deepEqual((await read(staff)).accounts,[])
 const privileges=(await db.query("select has_function_privilege('anon','read_client_advertising_connections(uuid,uuid,uuid,uuid,text)','execute') anon,has_function_privilege('authenticated','read_client_advertising_connections(uuid,uuid,uuid,uuid,text)','execute') authenticated,has_function_privilege('service_role','read_client_advertising_connections(uuid,uuid,uuid,uuid,text)','execute') service")).rows[0]
 assert.deepEqual(privileges,{anon:false,authenticated:false,service:true})
 const timing=[];for(let i=0;i<35;i++){const start=performance.now();await read();if(i>=5)timing.push(performance.now()-start)}timing.sort((a,b)=>a-b)
 console.log(JSON.stringify({passed:true,providerRows:60003,pageRows:50,serializedBytes:JSON.stringify(first).length,samples:timing.length,medianMs:timing[15],p95Ms:timing[28],scope:'isolated database round trip; new independent read, not production page latency'}))
 const plan=await db.query(`explain (analyze,buffers,format json) select relationship_id from relationship_google_ads_connections where workspace_id=$1 and relationship_id>$2 order by relationship_id limit 51`,[ws,uuid(10000)])
 assert.match(JSON.stringify(plan.rows),/Index Only Scan|Index Scan/)
 console.log('Pagination, same-relationship boundary, provider states, workspace/staff isolation, revocation, grants and indexed keyset access passed.')
}finally{await db.close()}
