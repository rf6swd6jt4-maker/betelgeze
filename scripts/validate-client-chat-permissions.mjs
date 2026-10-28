import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {PGlite} from './pglite-fixture.mjs'
const db=process.argv.includes('--native')?await(await import('./client-chat-members-postgres.mjs')).createClientChatPostgresFixture():new PGlite()
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const [workspace,client,team,manager,seller,staff,shared,outsider,otherWorkspace,otherClient]=Array.from({length:10},(_,i)=>id(i+1))
const source=await readFile(new URL('../supabase/migrations/20261028120000_client_chat_view_edit.sql',import.meta.url),'utf8')
const oldSource=await readFile(new URL('../supabase/migrations/20260909100000_client_delivery_teams.sql',import.meta.url),'utf8')
const oldFunction=name=>oldSource.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\$\\$;`))[0]
const call=async(name,args)=>(await db.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) value`,args)).rows[0].value
const set=(views,edits,actor=manager,w=workspace,r=client)=>call('set_client_chat_permissions',[w,r,actor,views,Array.isArray(views)&&Array.isArray(edits)&&edits.every(id=>views.includes(id))?views.filter(id=>!edits.includes(id)):edits])
const can=(actor,kind='access')=>call(`client_conversation_can_${kind}`,[workspace,client,actor])
const stats=values=>{values.sort((a,b)=>a-b);return {samples:values.length,medianMs:+values[Math.floor(values.length/2)].toFixed(3),p95Ms:+values[Math.floor(values.length*.95)].toFixed(3)}}
const evidence={runtime:null,checks:[],measurements:[]}
try{
 const previousValidator=await readFile(new URL('./validate-client-chat-team-members.mjs',import.meta.url),'utf8')
 const fixture=previousValidator.match(/await db\.exec\(`([\s\S]*?)`\)/)[1].replace('select null::uuid',"select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid")
 await db.exec(fixture)
 await db.exec(oldFunction('client_conversation_can_access'))
 await db.exec(oldFunction('client_conversation_rosters'))
 await db.exec(oldFunction('set_client_chat_members'))
 await db.exec(await readFile(new URL('../supabase/migrations/20261027120000_client_chat_team_members.sql',import.meta.url),'utf8'))
 await db.exec(`create function auth.role() returns text language sql as $$select 'authenticated'::text$$;
 create function public.current_session_is_aal2() returns boolean language sql as $$select true$$;
 create table client_messages(id uuid primary key,workspace_id uuid,relationship_id uuid,body text);
 create table communication_reactions(id uuid primary key,workspace_id uuid,relationship_id uuid,emoji text);
 create table communication_message_deliveries(id uuid primary key,workspace_id uuid,relationship_id uuid,status text);`)
 await db.exec(oldSource.match(/create or replace function public\.communication_create_file_key\([\s\S]*?\$\$;/)[0].replaceAll('decrypted.secret','decrypted.decrypted_secret'))
 await db.exec(`create schema vault;create schema extensions;create schema communications_secure;
 create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text);
 create function vault.create_secret(value text,name text,description text) returns uuid language plpgsql as $$declare id uuid:=gen_random_uuid();begin insert into vault.decrypted_secrets values(id,value);return id;end$$;
 create function extensions.gen_random_bytes(n integer) returns bytea language sql as $$select decode(repeat('41',n),'hex')$$;
 create function extensions.gen_random_uuid() returns uuid language sql as $$select gen_random_uuid()$$;
 create table communications_secure.encrypted_files(storage_path text primary key,workspace_id uuid,scope_kind text,scope_id uuid,vault_secret_id uuid,created_by uuid);`)
 for(const [table,name]of[['client_messages','client conversation participants only'],['communication_reactions','client reaction participants only'],['communication_message_deliveries','client delivery participants only']]){
   await db.exec(`alter table ${table} enable row level security;grant select,insert,update,delete on ${table} to authenticated;
   create policy fixture_admin_access on ${table} for all to authenticated using(true) with check(true);
   create policy "${name}" on ${table} as restrictive for all to authenticated using(public.client_conversation_can_access(workspace_id,relationship_id)) with check(public.client_conversation_can_access(workspace_id,relationship_id));`)
 }
 for(const user of[manager,seller,staff,shared,outsider])await db.query('insert into workspace_memberships values($1,$2,$3)',[workspace,user,user===outsider?'owner':'staff'])
 await db.query('insert into workspace_memberships values($1,$2,$3)',[otherWorkspace,manager,'owner'])
 await db.query("insert into relationships values($1,$2,$3,$4,'active','Client','Person'),($5,$6,$3,$4,'active','Other','Person')",[client,workspace,seller,manager,otherClient,otherWorkspace])
 await db.query('insert into workspace_teams(id,workspace_id,relationship_id) values($1,$2,$3)',[team,workspace,client])
 for(const user of[manager,seller,staff,shared])await db.query('insert into workspace_team_members values($1,$2,$3)',[workspace,team,user])
 await db.query('insert into relationship_services values($1,$2,$3)',[workspace,client,staff])
 await call('set_client_chat_members',[workspace,client,manager,[staff]])
 const before=(await db.query('select *,ctid::text row_address from relationship_client_chat_members')).rows[0]
 await db.exec(source)
 const after=(await db.query('select *,ctid::text row_address from relationship_client_chat_members')).rows[0]
 assert.deepEqual(after,{...before,can_edit:true})
 assert.equal(await can(staff,'write'),true)
 evidence.checks.push('Migration preserves row identity, attribution and existing Edit grants')
 const roster=async(actor=manager)=>(await db.query('select * from client_conversation_permission_rosters($1,$2)',[workspace,actor])).rows
 let rows=await roster()
 assert.deepEqual(rows[0].eligible_ids.sort(),[staff,shared].sort())
 assert.ok(!rows[0].member_ids.includes(shared),'unselected Team member is listed without access')
 assert.equal((await roster(outsider)).length,0)
 await set([staff,shared],[staff])
 assert.equal(await can(shared),true)
 assert.equal(await can(shared,'write'),false)
 assert.equal(await can(staff,'write'),true)
 for(const user of[manager,seller])assert.equal(await can(user,'write'),true)
 rows=await roster(shared)
 assert.ok(rows[0].member_ids.includes(shared));assert.ok(rows[0].view_only_ids.includes(shared))
 evidence.checks.push('Full Team choices, View-only read access, Edit flags and fixed seller/manager rights')
 const auditBefore=Number((await db.query('select count(*) n from relationship_team_events')).rows[0].n)
 const attribution=(await db.query('select added_by,added_at from relationship_client_chat_members where user_id=$1',[shared])).rows[0]
 await set([staff,shared],[staff])
 assert.equal(Number((await db.query('select count(*) n from relationship_team_events')).rows[0].n),auditBefore)
 await set([staff,shared],[staff,shared]);assert.equal(await can(shared,'write'),true)
 await set([staff,shared],[staff]);assert.deepEqual((await db.query('select added_by,added_at from relationship_client_chat_members where user_id=$1',[shared])).rows[0],attribution)
 await call('set_client_chat_members',[workspace,client,manager,[staff,shared]])
 await call('add_team_client_chat_members',[workspace,team,manager,[shared]])
 assert.equal(await can(shared,'write'),false,'old editors and additive retries cannot promote retained View-only members')
 for(const actor of[seller,staff,shared,outsider])await assert.rejects(set([staff],[staff],actor),/assigned manager/)
 for(const pair of[[[],[staff]],[[staff],[outsider]],[[null],[]],[null,[]],[[],null],[Array(1001).fill(staff),[]]])await assert.rejects(set(...pair),/View-only members require|team members/)
 await assert.rejects(set([outsider],[]),/team members/)
 await assert.rejects(set([staff],[],manager,otherWorkspace,client),/assigned manager/)
 await assert.rejects(set([staff],[],manager,workspace,otherClient),/assigned manager/)
 await db.exec('set role authenticated');await assert.rejects(set([],[]),/permission denied/);await db.exec('reset role')
 evidence.checks.push('Manager-only and workspace scope, bounded input, Edit requires View, safe retry and legacy compatibility')
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[shared])
 await db.query("update workspace_memberships set role='owner' where workspace_id=$1 and user_id=$2",[workspace,shared])
 for(const [i,table]of['client_messages','communication_reactions','communication_message_deliveries'].entries()){
   await db.query(`insert into ${table} values($1,$2,$3,$4)`,[id(100+i),workspace,client,'fixture'])
   await db.exec('set role authenticated')
   assert.equal((await db.query(`select * from ${table}`)).rows.length,1)
   await assert.rejects(db.query(`insert into ${table} values($1,$2,$3,$4)`,[id(110+i),workspace,client,'blocked']),/row-level security/)
   assert.equal((await db.query(`delete from ${table} returning id`)).rows.length,0)
   const field=['body','emoji','status'][i]
   assert.equal((await db.query(`update ${table} set ${field}='blocked' returning id`)).rows.length,0)
   await db.exec('reset role')
 }
 await db.exec('set role authenticated')
 await assert.rejects(call('communication_create_file_key',[workspace,'client',client,'fixture']),/file_scope_forbidden/)
 await db.exec('reset role')
 await set([staff,shared],[staff,shared])
 await db.exec('set role authenticated')
 assert.equal((await db.query("update client_messages set body='edited' returning id")).rows.length,1)
 assert.equal(await call('communication_create_file_key',[workspace,'client',client,`${workspace}/fixture.bin`]),Buffer.alloc(32,65).toString('base64'))
 await db.exec('reset role')
 evidence.checks.push('Direct writes/upload keys denied for View-only owners; edited uploads retain the corrected Vault lookup')
 await db.query('delete from workspace_team_members where team_id=$1 and user_id=$2',[team,shared])
 await set([staff,shared],[staff]);assert.equal(await can(shared),true)
 await set([staff],[staff]);assert.equal(await can(shared),false)
 await assert.rejects(set([staff,shared],[]),/team members/)
 await set([],[])
 assert.equal(await can(manager,'write'),true);assert.equal(await can(seller,'write'),true)
 await db.query("update relationships set status='archived' where id=$1",[client])
 assert.equal(await can(manager,'write'),false);await assert.rejects(set([],[]),/assigned manager/)
 await db.query("update relationships set status='active',fulfilment_manager_user_id=$2 where id=$1",[client,seller])
 await assert.rejects(set([],[]),/assigned manager/)
 await db.query('update relationships set fulfilment_manager_user_id=$2 where id=$1',[client,manager])
 evidence.checks.push('Retained grants remain removable after Team changes; revocation, archiving and reassignment fail closed')

 if(db.connect){
   const other=await db.connect()
   await set([staff],[staff])
   await db.exec('begin')
   await set([staff],[])
   const waiting=other.query('select set_client_chat_permissions($1,$2,$3,$4,$5)',[workspace,client,manager,[staff],[]])
   let blocked=false
   for(let n=0;n<30;n++){
     blocked=(await db.query("select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and wait_event_type='Lock') waiting")).rows[0].waiting
     if(blocked)break
     await new Promise(resolve=>setTimeout(resolve,10))
   }
   assert.equal(blocked,true,'concurrent editor waits for the relationship mutation owner')
   await db.exec('commit');await waiting
   assert.equal(await can(staff,'write'),true)
   await other.end()
   evidence.checks.push('Concurrent permission saves serialize on the relationship lock')
 }

 // Match old/new complete roster reads with growing unrelated client data.
 await db.exec(`insert into relationships(id,workspace_id,seller_user_id,fulfilment_manager_user_id,status) select gen_random_uuid(),'${workspace}',null,'${manager}','active' from generate_series(1,200);
 insert into relationships(id,workspace_id,status) select gen_random_uuid(),'${otherWorkspace}','active' from generate_series(1,20000);
 insert into workspace_teams(id,workspace_id,relationship_id) select gen_random_uuid(),workspace_id,id from relationships where id<>'${client}';
 insert into workspace_team_members select workspace_id,id,case when workspace_id='${workspace}' then '${staff}'::uuid else '${manager}'::uuid end from workspace_teams where id<>'${team}';
 insert into relationship_services select workspace_id,id,case when workspace_id='${workspace}' then '${staff}'::uuid else '${manager}'::uuid end from relationships where id<>'${client}';
 insert into relationship_client_chat_members(workspace_id,relationship_id,user_id,added_by)
 select workspace_id,id,'${staff}','${manager}' from relationships where workspace_id='${workspace}' and id<>'${client}' limit 60;
 create index relationships_workspace_fixture on relationships(workspace_id);
 analyze;`)
 const extra=Array.from({length:20},(_,n)=>id(500+n))
 for(const user of extra){
   await db.query('insert into workspace_memberships values($1,$2,$3)',[workspace,user,'staff'])
   await db.query('insert into relationship_services values($1,$2,$3)',[workspace,client,user])
 }
 await set([staff],[staff])
 await db.exec('analyze')
 for(const actor of[manager,seller,staff,outsider]){
   const old=(await db.query('select relationship_id from client_conversation_rosters($1,$2)',[workspace,actor])).rows.map(row=>row.relationship_id).sort()
   const current=(await roster(actor)).map(row=>row.relationship_id).sort()
   assert.deepEqual(current,old,'optimized roster preserves existing visibility')
 }
 if(process.env.CLIENT_CHAT_PERMISSIONS_PLAN){
   const body=source.match(/create function public\.client_conversation_permission_rosters[\s\S]*?as \$\$([\s\S]*?)\$\$/)[1].replaceAll('p_workspace_id',`'${workspace}'::uuid`).replaceAll('p_user_id',`'${manager}'::uuid`)
   const plan=await db.query(`explain(analyze,buffers,format text) ${body}`)
   await writeFile(process.env.CLIENT_CHAT_PERMISSIONS_PLAN,plan.rows.map(row=>row['QUERY PLAN']).join('\n'))
 }
 for(const actor of[manager,staff]){
   const samples=[[],[]]
   for(let n=0;n<90;n++)for(const arm of n%2?[1,0]:[0,1]){
     const start=performance.now();await db.query(`select * from ${arm?'client_conversation_permission_rosters':'client_conversation_rosters'}($1,$2)`,[workspace,actor]);if(n>=10)samples[arm].push(performance.now()-start)
   }
   evidence.measurements.push({action:'existing roster read',actor:actor===manager?'manager':'staff',baseline:stats(samples[0]),candidate:stats(samples[1])})
 }
 for(const scenario of['unchanged','add','remove','first-add','twenty']){
   const samples=[[],[]]
   for(let n=0;n<90;n++)for(const arm of n%2?[1,0]:[0,1]){
     await db.exec('begin')
     await set(scenario==='first-add'?[]:[staff],scenario==='first-add'?[]:[staff])
     // Same original service choices for both setters, matched local transport.
     const next=scenario==='remove'?[]:scenario==='add'?[staff,extra[0]]:scenario==='twenty'?[staff,...extra]:[staff]
     const start=performance.now()
     await call(arm?'set_client_chat_permissions':'set_client_chat_members',[workspace,client,manager,next])
     if(n>=10)samples[arm].push(performance.now()-start)
     await db.exec('rollback')
   }
   evidence.measurements.push({action:'existing participant save',scenario,baseline:stats(samples[0]),candidate:stats(samples[1])})
 }
 for(const actor of[manager,staff,outsider]){
   const samples=[[],[]]
   for(let n=0;n<90;n++)for(const arm of n%2?[1,0]:[0,1]){
     const start=performance.now()
     await db.query(`select client_conversation_can_${arm?'write':'access'}($1,$2,$3)`,[workspace,client,actor])
     if(n>=10)samples[arm].push(performance.now()-start)
   }
   evidence.measurements.push({action:'existing send authorization',actor:actor===manager?'manager':actor===staff?'member':'denied',baseline:stats(samples[0]),candidate:stats(samples[1])})
 }
 evidence.runtime=(await db.query('select version() value')).rows[0].value
 console.log(JSON.stringify(evidence,null,2))
 if(process.env.CLIENT_CHAT_PERMISSIONS_SQL_EVIDENCE)await writeFile(process.env.CLIENT_CHAT_PERMISSIONS_SQL_EVIDENCE,JSON.stringify(evidence,null,2))
}finally{await db.close()}
