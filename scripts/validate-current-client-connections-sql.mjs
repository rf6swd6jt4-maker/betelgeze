// Synthetic metadata-only fixture. No network, provider, credential, or history reads.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { createGhlFixture } from './ghl-sql-fixture.mjs'
const db = await createGhlFixture(), uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const ws=uuid(1), other=uuid(2), owner=uuid(3), staff=uuid(4)
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0]
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema client_portal_secure;
 create table workspaces(id uuid primary key,status text);
 create table workspace_memberships(workspace_id uuid,user_id uuid,role text,primary key(workspace_id,user_id));
 create table relationships(workspace_id uuid,id uuid primary key,primary_person_name text,business_name text,status text,lifecycle_phase text,unique(workspace_id,id));
 create index comms_reference_relationship_name_idx on public.relationships(workspace_id,(left(lower(primary_person_name collate pg_catalog."und-x-icu"),240) collate "C"),id) where status<>'archived';
 create index comms_reference_relationship_business_idx on public.relationships(workspace_id,(left(lower(business_name collate pg_catalog."und-x-icu"),240) collate "C"),id) where status<>'archived';
 create table fixture_permissions(workspace_id uuid,user_id uuid,relationship_id uuid,meta boolean,primary key(workspace_id,user_id,relationship_id));
 create function manage_client_ghl_connection_v2(p_workspace_id uuid,p_user_id uuid,p_action text,p_relationship_id uuid default null,p_operation_id uuid default null,p_account_type text default null,p_location_id text default null,p_private_token text default null,p_location_name text default null,p_metrics jsonb default null,p_error text default null,p_expected_revision uuid default null,p_calendar_id text default null,p_calendar_name text default null) returns jsonb language sql as $$select coalesce(jsonb_agg(jsonb_build_object('relationshipId',p.relationship_id)),'[]') from public.fixture_permissions p join public.relationships r on r.workspace_id=p.workspace_id and r.id=p.relationship_id and r.status<>'archived' where p.workspace_id=p_workspace_id and p.user_id=p_user_id and (p_relationship_id is null or p.relationship_id=p_relationship_id)$$;
 create function service_assignee_can_setup_client(p_workspace uuid,p_user uuid,p_relationship uuid default null) returns boolean language sql as $$select exists(select 1 from public.fixture_permissions where workspace_id=p_workspace and user_id=p_user and relationship_id=p_relationship and meta)$$;
 create table client_portal_secure.ghl_connections(workspace_id uuid,relationship_id uuid primary key,vault_secret_id uuid,account_type text,location_id text,location_name text,selected_calendar_id text,selected_calendar_name text,calendar_revision uuid,ready_at timestamptz,refreshed_at timestamptz,last_error text,lease_until timestamptz);
 create table client_portal_secure.ghl_connection_history(workspace_id uuid,relationship_id uuid,id uuid,retired_at timestamptz,retired_by uuid,snapshot jsonb);
 create table onboarding_service_revisions(workspace_id uuid,id uuid,definition jsonb,primary key(workspace_id,id));
 create table relationship_service_instances(workspace_id uuid,relationship_id uuid,service_revision_id uuid,import_id uuid,disposition text,stage text);
 create index fixture_instances_relationship on relationship_service_instances(workspace_id,relationship_id);
 create table relationship_services(workspace_id uuid,relationship_id uuid,service_revision_id uuid);
 create table relationship_google_ads_connections(workspace_id uuid,relationship_id uuid,status text,customer_id text,account_name text,connected_at timestamptz,last_verified_at timestamptz,primary key(workspace_id,relationship_id));
 create table relationship_meta_ads_connections(workspace_id uuid,relationship_id uuid,status text,facebook_user_id text,facebook_user_name text,connected_at timestamptz,last_verified_at timestamptz,access_token_expires_at timestamptz,credential_encrypted text,primary key(workspace_id,relationship_id));
 create table relationship_windsor_meta_ads_connections(workspace_id uuid,relationship_id uuid,status text,account_id text,account_name text,connected_at timestamptz,last_verified_at timestamptz,reporting_verified_at timestamptz,last_report_error text,authorization_encrypted text,primary key(workspace_id,relationship_id));
 create function fixture_uuid(n integer) returns uuid language sql immutable as $$select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
 insert into workspaces values('${ws}','active'),('${other}','active');
 insert into workspace_memberships values('${ws}','${owner}','owner'),('${ws}','${staff}','staff');
 insert into relationships select '${ws}',fixture_uuid(n),'Archived '||n,'Old business '||n,'archived','retention' from generate_series(100,199) n;
 insert into relationships select '${ws}',fixture_uuid(n),'Client '||n,'Business '||n,case n when 206 then 'waiting' when 207 then 'blocked' when 208 then 'completed' when 209 then 'lost' else 'active' end,case when n=200 then 'onboarding' else 'potential_client' end from generate_series(200,299) n;
 insert into relationships values('${other}',fixture_uuid(90),'Other workspace',null,'active','retention');
 insert into fixture_permissions values('${ws}','${staff}',fixture_uuid(199),true),('${ws}','${staff}',fixture_uuid(201),true),('${ws}','${staff}',fixture_uuid(205),false);
 insert into client_portal_secure.ghl_connections(workspace_id,relationship_id,vault_secret_id,calendar_revision,location_id,selected_calendar_id) values('${ws}',fixture_uuid(199),fixture_uuid(500),fixture_uuid(600),'archived-location','archived-calendar'),('${ws}',fixture_uuid(201),fixture_uuid(501),fixture_uuid(601),'current-location','current-calendar'),('${ws}',fixture_uuid(202),null,fixture_uuid(602),null,null);
 insert into onboarding_service_revisions values('${ws}',fixture_uuid(20),'{"templateId":"appointment-setting"}'),('${ws}',fixture_uuid(21),'{"templateId":"other"}');
 insert into relationship_service_instances values('${ws}',fixture_uuid(202),fixture_uuid(21),null,'active','setup'),('${ws}',fixture_uuid(204),fixture_uuid(20),null,'completed','completed');
 insert into relationship_services values('${ws}',fixture_uuid(203),fixture_uuid(20));
 insert into relationship_google_ads_connections select workspace_id,id,'connected','customer-'||id,'Google',now(),now() from relationships;
 insert into relationship_meta_ads_connections select workspace_id,id,'connected','user-'||id,'Meta',now(),now(),now()-interval '1 day','SECRET' from relationships;
 insert into relationship_windsor_meta_ads_connections select workspace_id,id,'connected','account-'||id,'Windsor',now(),now(),null,null,'SECRET' from relationships;
 analyze;`)
 await db.exec(await readFile('supabase/migrations/20261027160000_client_advertising_connections.sql','utf8'))
 const legacyAdvertising=async(actor=owner,rel=null,after=null,provider=null)=>(await one('select read_client_advertising_connections($1,$2,$3,$4,$5) result',[ws,actor,rel,after,provider])).result
 const baseline=await legacyAdvertising();assert.equal(baseline.accounts[0].archived,true)
 const adDefinition=(await one("select pg_get_functiondef('public.read_client_advertising_connections(uuid,uuid,uuid,uuid,text)'::regprocedure) definition")).definition
 await db.exec(adDefinition.replace('FUNCTION public.read_client_advertising_connections(', 'FUNCTION public.baseline_read_client_advertising_connections('))
 const historySource=await readFile('supabase/migrations/20261013010000_client_connection_retirement.sql','utf8')
 await db.exec(historySource.slice(historySource.indexOf('create function public.read_client_ghl_connections('),historySource.indexOf('revoke all on function public.read_client_ghl_connections(')).replace('function public.read_client_ghl_connections(', 'function public.baseline_read_client_ghl_connections('))
 const baselineCurrent=async()=>(await one('select baseline_read_client_ghl_connections($1,$2) result',[ws,owner])).result
 const baselineAdvertising=async()=>(await one('select baseline_read_client_advertising_connections($1,$2) result',[ws,owner])).result
 const measure=async(runs)=>{
  const values=Object.fromEntries(Object.keys(runs).map(key=>[key,[]]))
  for(let i=0;i<25;i++)for(const [key,run] of Object.entries(runs)){const start=performance.now();await run();if(i>=5)values[key].push(performance.now()-start)}
  return Object.fromEntries(Object.entries(values).map(([key,samples])=>{samples.sort((a,b)=>a-b);return [key,{medianMs:samples[10],p95Ms:samples[18],samples:20}]}))
 }
 const sourceFingerprint=async()=>{
  const tables=['relationships','relationship_google_ads_connections','relationship_meta_ads_connections','relationship_windsor_meta_ads_connections','client_portal_secure.ghl_connections','client_portal_secure.ghl_connection_history']
  const fingerprints=[]
  for(const table of tables)fingerprints.push(await one(`select md5(coalesce(string_agg(row_to_json(source)::text,'' order by row_to_json(source)::text),'')) fingerprint from ${table} source`))
  return fingerprints
 }
 const beforeMigration=await sourceFingerprint()
 await db.exec(await readFile('supabase/migrations/20261027170000_current_client_connections.sql','utf8'))
 assert.deepEqual(await sourceFingerprint(),beforeMigration,'Installing metadata readers preserves source data and history')
 assert.equal((await one("select pg_get_functiondef('public.read_client_advertising_connections(uuid,uuid,uuid,uuid,text)'::regprocedure) definition")).definition,adDefinition,'The earlier RPC remains identical for rollback callers')
 assert.deepEqual(await legacyAdvertising(),baseline)
 const advertisingRaw=async(actor=owner,rel=null,after=null,provider=null)=>(await one('select read_current_client_advertising_connections($1,$2,$3,$4,$5) result',[ws,actor,rel,after,provider])).result
 // Exercise the actual server decoder against the exact installed migration.
 const compiledServer={exports:{}}
 new Function('require','module','exports',ts.transpileModule(await readFile('lib/client-advertising-connections.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{
  if(name==='server-only')return {}
  assert.equal(name,'@/lib/supabase/admin')
  return {supabaseAdmin:{rpc:async(name,args)=>{
   assert.equal(name,'read_current_client_advertising_connections')
   return {data:(await one('select read_current_client_advertising_connections($1,$2,$3,$4,$5) result',[args.p_workspace_id,args.p_user_id,args.p_relationship_id,args.p_after_relationship,args.p_after_provider])).result,error:null}
  }}}
 },compiledServer,compiledServer.exports)
 const advertising=async(actor=owner,rel=null,after=null,provider=null,workspace=ws)=>compiledServer.exports.readClientAdvertisingConnections(workspace,actor,rel??undefined,after?{relationshipId:after,provider}:undefined)

 const choices=async({actor=owner,provider='ghl',query='',after=null,relationship=null}={})=>(await one('select read_client_connection_relationships($1,$2,$3,$4,$5,$6) result',[ws,actor,provider,query,after,relationship])).result
 const current=async(actor=owner,relationship=null)=>(await one('select read_current_client_ghl_connections($1,$2,$3) result',[ws,actor,relationship])).result
 const list=await current();assert.deepEqual(list.accounts.map(r=>r.relationshipId),[uuid(201)])
 assert.equal(list.accounts[0].revision,uuid(601));assert.equal(list.accounts[0].calendarId,'current-calendar');assert.equal(list.accounts[0].connected,true)
 assert.deepEqual((await current(owner,uuid(199))).accounts,[]);assert.deepEqual((await current(staff)).accounts,list.accounts)
 assert.equal((await current(uuid(999))).failure,'access')
 const ghl=await choices();assert.deepEqual(ghl.accounts.map(r=>r.relationshipId),[200,201,202,203,204].map(uuid));assert.equal(ghl.nextCursor,null)
 assert.equal(ghl.accounts.find(r=>r.relationshipId===uuid(201)).connected,true);assert.equal(ghl.accounts.find(r=>r.relationshipId===uuid(200)).connected,false)
 for(const provider of ['google_ads','meta_ads']) {
  const first=await choices({provider});assert.equal(first.accounts.find(r=>r.relationshipId===uuid(201)).locationId,null);assert.equal(first.accounts.find(r=>r.relationshipId===uuid(201)).revision,null);assert.ok(first.accounts.every(r=>!r.connected));assert.equal(first.accounts.length,50);assert.equal(first.nextCursor,uuid(249));assert.ok(first.accounts.every(r=>!r.archived))
  const second=await choices({provider,after:first.nextCursor});assert.equal(second.accounts.length,50);assert.equal(second.nextCursor,null)
  assert.equal(new Set([...first.accounts,...second.accounts].map(r=>r.relationshipId)).size,100)
  assert.ok(first.accounts.some(r=>r.relationshipId===uuid(209)),'Current matches Relationships UI, including non-archived lifecycle statuses')
 }
 assert.deepEqual((await choices({actor:staff})).accounts.map(r=>r.relationshipId),[201,205].map(uuid))
 assert.deepEqual((await choices({actor:staff,provider:'meta_ads'})).accounts.map(r=>r.relationshipId),[uuid(201)])
 assert.deepEqual((await choices({actor:staff,provider:'google_ads',relationship:uuid(200)})).accounts,[])
 assert.equal((await choices({relationship:uuid(200)})).accounts[0].connected,false,'Callback recovery can hydrate a not-yet-connected exact eligible client')
 assert.deepEqual((await choices({relationship:uuid(205)})).accounts,[],'Exact callback lookup preserves GHL eligibility')
 assert.deepEqual((await choices({relationship:uuid(199)})).accounts,[])
 assert.deepEqual((await choices({relationship:uuid(90),provider:'google_ads'})).accounts,[])
 assert.equal((await choices({provider:'invalid'})).failure,'response');assert.equal((await choices({query:'x'.repeat(101)})).failure,'response')
 assert.deepEqual((await choices({query:' CLIENT 20 ',provider:'google_ads'})).accounts.map(r=>r.relationshipId),Array.from({length:10},(_,i)=>uuid(200+i)))
 assert.equal((await choices({query:'Business 201',provider:'google_ads'})).accounts[0].relationshipId,uuid(201))
 await db.exec(`update relationships set primary_person_name='İstanbul',business_name='%literal' where id='${uuid(299)}'`)
 assert.equal((await choices({query:'İs',provider:'google_ads'})).accounts[0].relationshipId,uuid(299))
 assert.equal((await choices({query:'%lit',provider:'google_ads'})).accounts[0].relationshipId,uuid(299))
 const raw=await advertisingRaw();assert.equal(raw.length,51);assert.ok(raw.every(row=>Array.isArray(row)&&row.length===9));
 const ad=await advertising();assert.equal(ad.accounts.length,50);assert.equal(ad.accounts[0].relationshipId,uuid(200));assert.ok(ad.accounts.every(r=>!r.archived));assert.ok(!JSON.stringify(ad).includes('SECRET'))
 const next=await advertising(owner,null,ad.nextCursor.relationshipId,ad.nextCursor.provider);assert.equal(next.accounts.length,50);assert.equal(new Set([...ad.accounts,...next.accounts].map(r=>r.relationshipId+':'+r.provider)).size,100)
 assert.deepEqual((await advertising(owner,uuid(199))).accounts,[])
 assert.deepEqual((await advertising(owner,uuid(90))).accounts,[])
 assert.deepEqual([...new Set((await advertising(staff)).accounts.map(r=>r.relationshipId))],[uuid(201),uuid(205)])
 assert.deepEqual((await advertising(staff,uuid(200))).accounts,[])
 assert.equal((await advertisingRaw(uuid(999))).failure,'access')
 assert.equal((await advertisingRaw(owner,null,uuid(200),null)).failure,'cursor')
 assert.equal((await advertisingRaw(owner,null,uuid(200),'unknown')).failure,'cursor')
 const google=ad.accounts.find(r=>r.provider==='google_ads'),meta=ad.accounts.find(r=>r.provider==='meta_ads'),windsor=ad.accounts.find(r=>r.provider==='windsor')
 assert.equal(google.status,'connected');assert.equal(meta.status,'needs_attention');assert.equal(windsor.status,'needs_attention')
 const permissionDefinition=(await one("select pg_get_functiondef('public.manage_client_ghl_connection_v2(uuid,uuid,text,uuid,uuid,text,text,text,text,jsonb,text,uuid,text,text)'::regprocedure) definition")).definition
 for(const malformed of ["'[{\"relationshipId\":null}]'::jsonb",'null::jsonb',"'{}'::jsonb"]){
  await db.exec(permissionDefinition.replace(/AS \$function\$[\s\S]*?\$function\$/,`AS $function$select ${malformed}$function$`))
  if(malformed.includes('relationshipId'))assert.deepEqual(await advertising(staff,uuid(200)),{accounts:[],nextCursor:null})
  else assert.equal((await advertisingRaw(staff)).failure,'access')
 }
 await db.exec(permissionDefinition)

 await db.exec(`delete from fixture_permissions where user_id='${staff}'`)
 assert.deepEqual((await choices({actor:staff})).accounts,[]);assert.deepEqual((await current(staff)).accounts,[]);assert.deepEqual((await advertising(staff)).accounts,[])
 for(const name of ['read_current_client_ghl_connections(uuid,uuid,uuid)','read_client_connection_relationships(uuid,uuid,text,text,uuid,uuid)','read_current_client_advertising_connections(uuid,uuid,uuid,uuid,text)']) {
  const grants=await one(`select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service`,[name]);assert.deepEqual(grants,{anon:false,authenticated:false,service:true})
 }
 await db.exec(`create or replace function manage_client_ghl_connection_v2(p_workspace_id uuid,p_user_id uuid,p_action text,p_relationship_id uuid default null,p_operation_id uuid default null,p_account_type text default null,p_location_id text default null,p_private_token text default null,p_location_name text default null,p_metrics jsonb default null,p_error text default null,p_expected_revision uuid default null,p_calendar_id text default null,p_calendar_name text default null) returns jsonb language sql as $$select null::jsonb$$`)
 assert.equal((await choices({actor:staff})).failure,'access');assert.equal((await current(staff)).failure,'access');assert.equal((await advertisingRaw(staff)).failure,'access')
 const matchedBeforeGrowth=await measure({ghlBaseline:baselineCurrent,ghlCurrent:()=>current(),advertisingBaseline:baselineAdvertising,advertisingCurrent:()=>advertising()})
 await db.exec(permissionDefinition)
 const beforeGrowth=await current()
 await db.exec(`insert into relationships select '${ws}',fixture_uuid(n),'Growth '||n,'Growing business '||n,'active','retention' from generate_series(1000,20999) n;
 insert into relationship_google_ads_connections select workspace_id,id,'connected','customer-'||id,'Google',now(),now() from relationships where id>=fixture_uuid(1000);
 insert into relationship_meta_ads_connections select workspace_id,id,'connected','user-'||id,'Meta',now(),now(),now()-interval '1 day','SECRET' from relationships where id>=fixture_uuid(1000);
 insert into relationship_windsor_meta_ads_connections select workspace_id,id,'connected','account-'||id,'Windsor',now(),now(),null,null,'SECRET' from relationships where id>=fixture_uuid(1000);analyze;`)
 assert.deepEqual(await current(),beforeGrowth,'Adding eligible relationships does not create placeholder GHL list rows')
 const observations=await measure({chooser:()=>choices({provider:'google_ads'}),rareSearch:()=>choices({provider:'google_ads',query:'Growth 20999'}),broadSearch:()=>choices({provider:'google_ads',query:'Growth'}),ghlBaseline:baselineCurrent,ghlCurrent:()=>current(),advertisingBaseline:baselineAdvertising,advertisingCurrent:()=>advertising()})
 const plan=await db.query(`explain (analyze,buffers,format json) select id from relationships where workspace_id=$1 and status<>'archived' and id>$2 order by id limit 51`,[ws,uuid(10000)])
 assert.match(JSON.stringify(plan.rows),/relationships_workspace_id_id_key|relationships_pkey/)
 const searchPlan=await db.query(`explain (analyze,buffers,format json) select id from relationships where workspace_id=$1 and status<>'archived' and ((left(lower(primary_person_name collate pg_catalog."und-x-icu"),240) collate "C">='growth 20999' and left(lower(primary_person_name collate pg_catalog."und-x-icu"),240) collate "C"<'growth 2099:') or (left(lower(business_name collate pg_catalog."und-x-icu"),240) collate "C">='growth 20999' and left(lower(business_name collate pg_catalog."und-x-icu"),240) collate "C"<'growth 2099:')) order by id limit 51`,[ws])
 assert.match(JSON.stringify(searchPlan.rows),/comms_reference_relationship_name_idx/);assert.match(JSON.stringify(searchPlan.rows),/comms_reference_relationship_business_idx/)
 const compactPlan=rows=>{const walk=p=>[{node:p['Node Type'],index:p['Index Name'],rows:p['Actual Rows'],loops:p['Actual Loops'],removed:p['Rows Removed by Filter']??0,hitBlocks:p['Shared Hit Blocks']},...(p.Plans??[]).flatMap(walk)];return walk(rows[0]['QUERY PLAN'][0].Plan)}
 await db.exec(`insert into client_portal_secure.ghl_connections(workspace_id,relationship_id,vault_secret_id) select '${ws}',fixture_uuid(n),fixture_uuid(n+30000) from generate_series(1000,2000) n`)
 assert.equal((await current()).failure,'list_limit','Current list never silently truncates saved connections')
 // Growth and sparse membership exercise the selected query without adding schema.
 await db.exec(`update relationships set status='archived';analyze;`)
 assert.deepEqual(await advertising(),{accounts:[],nextCursor:null})
 await db.exec(`insert into relationships select '${ws}',fixture_uuid(n),'Unconnected current',null,'active','retention' from generate_series(40000,59999) n;analyze;`)
 const firstDisjointStart=performance.now();assert.deepEqual(await advertising(),{accounts:[],nextCursor:null});const firstDisjointMs=performance.now()-firstDisjointStart
 const advertisingGrowth={firstDisjointMs,disjoint:await measure({baseline:baselineAdvertising,current:()=>advertising()})}
 await db.exec(`delete from relationships where id>=fixture_uuid(40000);
  update relationships set status=case when right(id::text,4)::int%7=0 then 'archived' else 'active' end;
  delete from relationship_google_ads_connections where right(relationship_id::text,4)::int%2<>0;
  delete from relationship_meta_ads_connections where right(relationship_id::text,4)::int%3<>0;
  delete from relationship_windsor_meta_ads_connections where right(relationship_id::text,4)::int%5<>0;analyze;`)
 const tricky='O\'Brien "North" \\ escape\nİstanbul 😀'
 await db.query('update relationships set primary_person_name=$1,business_name=null where id=$2',[tricky,uuid(200)])
 await db.query('update relationship_google_ads_connections set account_name=$1 where relationship_id=$2',[tricky,uuid(200)])
 const scoped=await advertising(owner,uuid(200));assert.equal(scoped.accounts[0].clientName,tricky);assert.equal(scoped.accounts[0].accountName,tricky);assert.equal(scoped.accounts[0].businessName,null)
 const expectedKeys=(await db.query(`select c.relationship_id,c.provider from (
  select workspace_id,relationship_id,'google_ads' provider from relationship_google_ads_connections
  union all select workspace_id,relationship_id,'meta_ads' from relationship_meta_ads_connections
  union all select workspace_id,relationship_id,'windsor' from relationship_windsor_meta_ads_connections
 ) c join relationships r on r.workspace_id=c.workspace_id and r.id=c.relationship_id where c.workspace_id=$1 and r.status<>'archived' order by c.relationship_id,c.provider`,[ws])).rows.map(r=>r.relationship_id+':'+r.provider)
 const found=[];let cursor=null,pages=0
 do {
  const page=await advertising(owner,null,cursor?.relationshipId??null,cursor?.provider??null)
  assert.ok(page.accounts.length<=50);assert.ok(!JSON.stringify(page).includes('SECRET'))
  found.push(...page.accounts.map(r=>r.relationshipId+':'+r.provider));cursor=page.nextCursor;pages++
  assert.ok(pages<1000,'Pagination terminates')
 }while(cursor)
 assert.deepEqual(found,expectedKeys);assert.equal(new Set(found).size,found.length)
 for(const rel of [uuid(199),uuid(200),uuid(201),uuid(10001)])for(const [after,provider]of [[null,null],[uuid(100),'windsor'],[rel,'google_ads'],[rel,'meta_ads'],[rel,'windsor'],[uuid(29000),'windsor']]){
  const actual=await advertising(owner,rel,after,provider)
  const expected=expectedKeys.filter(key=>key.startsWith(rel+':')&&(!after||key>after+':'+provider))
  assert.deepEqual(actual.accounts.map(row=>row.relationshipId+':'+row.provider),expected)
 }
 advertisingGrowth.sparse=await measure({baseline:baselineAdvertising,current:()=>advertising()})
 await db.exec(`insert into workspace_memberships values('${other}','${owner}','owner');
  delete from relationship_google_ads_connections where workspace_id='${other}';delete from relationship_meta_ads_connections where workspace_id='${other}';delete from relationship_windsor_meta_ads_connections where workspace_id='${other}';
  insert into relationships select '${other}',fixture_uuid(n),'Page boundary',null,'active','retention' from generate_series(30000,30050) n;
  insert into relationship_google_ads_connections select workspace_id,id,'connected','customer','Boundary',now(),now() from relationships where workspace_id='${other}' and id>=fixture_uuid(30000) and id<fixture_uuid(30050);`)
 const exactly50=await advertising(owner,null,null,null,other);assert.equal(exactly50.accounts.length,50);assert.equal(exactly50.nextCursor,null)
 await db.exec(`insert into relationship_google_ads_connections values('${other}',fixture_uuid(30050),'connected','customer','Boundary',now(),now())`)
 const first51=await advertising(owner,null,null,null,other);assert.equal(first51.accounts.length,50);assert.deepEqual(first51.nextCursor,{relationshipId:uuid(30049),provider:'google_ads'})
 await db.exec(`delete from relationship_google_ads_connections where workspace_id='${other}' and relationship_id=fixture_uuid(30049);delete from relationships where workspace_id='${other}' and id=fixture_uuid(30049)`)
 assert.equal((await advertising(owner,null,first51.nextCursor.relationshipId,first51.nextCursor.provider,other)).accounts[0].relationshipId,uuid(30050),'Cursor row need not still exist')
 await db.exec(`delete from workspace_memberships where user_id='${staff}'`);assert.equal((await advertisingRaw(staff)).failure,'access')
 await db.exec(`update workspaces set status='suspended' where id='${ws}'`);assert.equal((await advertisingRaw()).failure,'access')
 console.log(JSON.stringify({passed:true,engine:(await one('select version() version')).version,relationshipRows:20201,providerRows:60603,choicesPerPage:50,matchedBeforeGrowth,observations,advertisingGrowth,correctness:{sparsePages:pages,sparseRows:found.length,exact50and51:true,deletedCursor:true,nullAndMalformedPolicy:true,legacyRpcUnchanged:true,sourceDataPreserved:true},plans:{page:compactPlan(plan.rows),rareSearch:compactPlan(searchPlan.rows)},scope:'Synthetic database round trips only; no provider, production, or end-to-end latency claim'}))
} catch (error) { console.error(error.message); process.exitCode=1 } finally { await db.close() }
