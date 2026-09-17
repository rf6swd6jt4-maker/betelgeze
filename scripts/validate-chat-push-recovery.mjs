import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite, repositoryRoot } from './pglite-fixture.mjs'
const db = new PGlite()
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const w=id(1), sender=id(2), recipient=id(3), outsider=id(4), removed=id(5), direct=id(10), team=id(11), teamId=id(12), client=id(13), tab=id(30)
const query=async(sql,args=[]) => (await db.query(sql,args)).rows
const migration=async(name) => db.exec(await readFile(`${repositoryRoot}/supabase/migrations/${name}.sql`,'utf8'))
let messageNumber=100
const addMessage=async(kind='native',conversation=direct,who=sender,request=null) => {
 const message=id(messageNumber++)
 await query(kind==='native' ? 'insert into workspace_native_messages(id,workspace_id,conversation_id,sender_user_id,client_request_id) values($1,$2,$3,$4,$5)' : 'insert into client_messages(id,workspace_id,relationship_id,direction) values($1,$2,$3,\'inbound\')',kind==='native'?[message,w,conversation,who,request]:[message,w,conversation])
 return message
}
const claim=async(message=null,user=null) => query('select * from claim_chat_push_deliveries($1,$2,100)',[message,user])
const prepare=async(job) => (await query('select prepare_chat_push_delivery($1,$2) as result',[job.id,job.lease_token]))[0].result
const finish=async(job,outcome='accepted') => (await query('select finish_chat_push_delivery($1,$2,$3) as applied',[job.id,job.lease_token,outcome]))[0].applied
const activity=async(revision,active,conversation=direct) => (await query('select record_chat_reading_activity($1,$2,$3,$4,$5,$6,$7) applied',[recipient,tab,revision,active,w,'native',conversation]))[0].applied
const reset=async() => db.exec('truncate chat_push_deliveries; truncate communications_active_sessions; truncate workspace_native_read_cursors; truncate communication_read_cursors;')
try {
 await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create table workspaces(id uuid primary key);
 create table workspace_memberships(workspace_id uuid,user_id uuid,primary key(workspace_id,user_id));
 create table workspace_native_conversations(id uuid primary key,workspace_id uuid,kind text,team_id uuid,direct_user_one uuid,direct_user_two uuid,archived_at timestamptz);
 create table workspace_native_conversation_participants(workspace_id uuid,conversation_id uuid,user_id uuid,primary key(conversation_id,user_id));
 create table workspace_teams(id uuid primary key,workspace_id uuid,archived_at timestamptz);
 create table workspace_team_members(workspace_id uuid,team_id uuid,user_id uuid,primary key(team_id,user_id));
 create table workspace_native_messages(id uuid primary key,workspace_id uuid,conversation_id uuid,sender_user_id uuid,client_request_id uuid,created_at timestamptz default clock_timestamp());
 create table client_messages(id uuid primary key,workspace_id uuid,relationship_id uuid,direction text,created_at timestamptz default clock_timestamp());
 create table work_queue_disputes(id uuid primary key,workspace_id uuid,resolver_id uuid);
 create table workspace_native_read_cursors(workspace_id uuid,conversation_id uuid,user_id uuid,last_read_at timestamptz,last_read_message_id uuid,primary key(workspace_id,conversation_id,user_id));
 create table communication_read_cursors(workspace_id uuid,relationship_id uuid,user_id uuid,last_read_message_id uuid,last_read_at timestamptz,primary key(workspace_id,relationship_id,user_id));
 create table relationships(id uuid primary key,workspace_id uuid,status text,seller_user_id uuid,fulfilment_manager_user_id uuid);
 create table relationship_client_chat_members(workspace_id uuid,relationship_id uuid,user_id uuid);
 `)
 const clientMigration=await readFile(`${repositoryRoot}/supabase/migrations/20260909100000_client_delivery_teams.sql`,'utf8')
 await db.exec(clientMigration.match(/create function public\.client_conversation_can_access[\s\S]*?\$\$;/)[0])
 await migration('20260816170000_chat_web_push')
 await migration('20260817160000_reliable_communications_sessions')
 await migration('20260917090000_chat_push_delivery_recovery')
 await migration('20260917090500_chat_subscription_integrity')
 await migration('20260917180000_app_alerts_reading_contract')
 await query('insert into workspaces values($1)',[w])
 for(const user of [sender,recipient,outsider,removed]) {
  await query('insert into auth.users values($1)',[user]);await query('insert into workspace_memberships values($1,$2)',[w,user])
 }
 for(const [sub,user] of [[20,sender],[21,recipient],[22,recipient],[23,outsider],[24,removed]]) await query('insert into web_push_subscriptions(id,user_id,device_id,endpoint,p256dh,auth) values($1,$2,$1,$3,\'key\',\'auth\')',[id(sub),user,`https://push.test/${sub}`])
 await query('insert into workspace_native_conversations values($1,$2,\'direct\',null,$3,$4,null)',[direct,w,sender,recipient])
 for(const user of [sender,recipient]) await query('insert into workspace_native_conversation_participants values($1,$2,$3)',[w,direct,user])
 await query('insert into workspace_teams values($1,$2,null)',[teamId,w])
 await query('insert into workspace_native_conversations values($1,$2,\'team\',$3,null,null,null)',[team,w,teamId])
 for(const user of [sender,recipient,removed]) await query('insert into workspace_team_members values($1,$2,$3)',[w,teamId,user])
 await query('delete from workspace_memberships where user_id=$1',[removed])
 await query('insert into relationships values($1,$2,\'active\',$3,$4)',[client,w,sender,recipient])
 await assert.rejects(query('insert into workspace_native_conversation_participants values($1,$2,$3)',[w,direct,outsider]),/declared direct-chat/)
 await assert.rejects(query('update workspace_native_conversations set direct_user_two=$1 where id=$2',[outsider,direct]),/reassigned/)
 assert.equal((await query('select * from chat_push_recipients($1,\'native\',$2)',[w,team])).length,2)
 assert.deepEqual((await query('select * from chat_push_recipients($1,\'client\',$2)',[w,client])).map(x=>x.user_id).sort(),[sender,recipient].sort())
 console.log('PASS recipient sets: direct pair, team members, client roster; outsiders and removed workspace members excluded')

 let message=await addMessage(), jobs=await claim(message)
 assert.equal(jobs.length,2);assert.ok(jobs.every(x=>x.user_id===recipient))
 assert.deepEqual(await prepare(jobs[0]),{state:'send',unreadCount:1})
 assert.equal(await finish(jobs[0]),true);assert.equal(await finish(jobs[0]),false)
 assert.equal((await claim(message)).length,0)
 await finish(jobs[1])
 console.log('PASS atomic enqueue fans out to all recipient devices; claims and completions are fenced')

 await reset();await activity(2,false);assert.equal(await activity(1,true),false)
 message=await addMessage();jobs=await claim(message);assert.equal((await prepare(jobs[0])).state,'send')
 await reset();await activity(1,true);message=await addMessage();jobs=await claim(message)
 for(const job of jobs)assert.equal((await prepare(job)).state,'deferred')
 assert.equal((await claim(message)).length,0)
 await activity(2,false);await query('select wake_chat_push_for_user($1)',[recipient]);jobs=await claim(message)
 assert.equal(jobs.length,2);for(const job of jobs)assert.equal((await prepare(job)).state,'send')
 await reset();await activity(1,true,team);message=await addMessage();jobs=await claim(message)
 assert.equal((await prepare(jobs[0])).state,'send')
 await reset();await activity(1,true);message=await addMessage();jobs=await claim(message)
 for(const job of jobs)await prepare(job)
 await query("update communications_active_sessions set last_seen_at=now()-interval '46 seconds'")
 await query("update chat_push_deliveries set available_at=now()-interval '1 second'")
 jobs=await claim(message);assert.equal(jobs.length,2);assert.equal((await prepare(jobs[0])).state,'send')
 await reset();await activity(1,true);
 await query('select record_chat_reading_activity($1,$2,1,true,$3,\'native\',$4)',[recipient,id(31),w,direct]);await activity(2,false)
 message=await addMessage();jobs=await claim(message);assert.equal((await prepare(jobs[0])).state,'deferred')
 await reset();await query("insert into communications_active_sessions(user_id,tab_id,workspace_id,conversation_kind,conversation_id,connection_live,last_seen_at) values($1,$2,$3,'native',$4,true,now())",[recipient,tab,w,direct])
 message=await addMessage();jobs=await claim(message);assert.equal((await prepare(jobs[0])).state,'send')
 await reset();await query("select record_chat_reading_activity($1,$2,1,true,$3,'native',$4,now()-interval '46 seconds')",[recipient,tab,w,direct])
 message=await addMessage();jobs=await claim(message);assert.equal((await prepare(jobs[0])).state,'send')
 console.log('PASS delayed heartbeat cannot undo departure; other chat does not suppress; close without beacon recovers after lease')

 await reset();message=await addMessage();jobs=await claim(message)
 await query("update chat_push_deliveries set lease_until=now()-interval '1 second'")
 const recovered=await claim(message);assert.equal(recovered.length,2)
 assert.equal((await prepare(jobs[0])).state,'stale');assert.equal(await finish(jobs[0]),false)
 assert.equal((await prepare(recovered[0])).state,'send');await finish(recovered[0],'retry')
 assert.equal((await query('select status from chat_push_deliveries where id=$1',[recovered[0].id]))[0].status,'pending')
 await query('delete from workspace_memberships where user_id=$1',[recipient]);assert.equal((await prepare(recovered[1])).state,'revoked')
 await query('insert into workspace_memberships values($1,$2)',[w,recipient])
 console.log('PASS crashed workers and provider retries recover; revoked membership blocks a queued send')

 await reset();message=await addMessage();jobs=await claim(message)
 const nextMessage=await addMessage();assert.equal((await claim(nextMessage)).length,0)
 for(const job of jobs)assert.equal((await prepare(job)).state,'superseded')
 const newerJobs=await claim(nextMessage);assert.equal(newerJobs.length,2)
 for(const job of newerJobs){assert.equal((await prepare(job)).state,'send');await finish(job)}
 console.log('PASS newer messages replace older jobs without simultaneous sends on the same device/chat')

 await reset();message=await addMessage('client',client);const newer=await addMessage('client',client)
 await query("insert into communication_read_cursors values($1,$2,$3,$4,now()+interval '1 hour')",[w,client,recipient,message])
 jobs=(await claim(newer)).filter(j=>j.user_id===recipient);assert.equal(jobs.length,2);assert.equal((await prepare(jobs[0])).state,'send')
 await query('update communication_read_cursors set last_read_message_id=$1 where user_id=$2',[newer,recipient]);assert.equal((await prepare(jobs[1])).state,'read')
 console.log('PASS delayed client read timestamp cannot swallow a newer unseen message')

 // Equal timestamps must retain the same ordering as inbox counts and reads.
 for (const kind of ['native','client']) {
  await reset()
  const conversation=kind==='native'?direct:client
  const first=await addMessage(kind,conversation),second=await addMessage(kind,conversation)
  const table=kind==='native'?'workspace_native_messages':'client_messages'
  await query(`update ${table} set created_at=now() where id in($1,$2)`,[first,second])
  const at=(await query(`select created_at from ${table} where id=$1`,[first]))[0].created_at
  await query('update chat_push_deliveries set message_created_at=$1 where message_id in($2,$3)',[at,first,second])
  if(kind==='native')await query('insert into workspace_native_read_cursors(workspace_id,conversation_id,user_id,last_read_message_id,last_read_at) values($1,$2,$3,$4,$5)',[w,conversation,recipient,first,at])
  else await query('insert into communication_read_cursors values($1,$2,$3,$4,$5)',[w,conversation,recipient,first,at])
  const sameTimeJobs=(await claim(second)).filter(j=>j.user_id===recipient)
  assert.equal(sameTimeJobs.length,2)
  assert.deepEqual(await prepare(sameTimeJobs[0]),{state:'send',unreadCount:1})
  const cursors=kind==='native'?'workspace_native_read_cursors':'communication_read_cursors'
  await query(`update ${cursors} set last_read_message_id=$1 where user_id=$2`,[second,recipient])
  assert.equal((await prepare(sameTimeJobs[1])).state,'read')
 }
 await reset();await activity(1,true)
 await query("select record_chat_activity($1,$2,2,true,$3,'native',$4)",[recipient,tab,w,direct])
 message=await addMessage();jobs=await claim(message)
 assert.equal((await prepare(jobs[0])).state,'send')
 console.log('PASS timestamp ties use message IDs; old selection-only leases cannot suppress alerts')
 await reset();await activity(1,true);message=await addMessage()
 await query("update chat_push_deliveries set created_at=now()-interval '46 seconds' where message_id=$1",[message])
 jobs=await claim(message);assert.equal((await prepare(jobs[0])).state,'send')
 console.log('PASS an unacknowledged read cannot defer its job indefinitely through fresh heartbeats')


 await reset();const dispute=id(90);await query('insert into work_queue_disputes values($1,$2,$3)',[dispute,w,recipient]);message=await addMessage('native',team,sender,dispute);jobs=await claim(message);assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.user_id===recipient))
 await query('select record_chat_push_receipt($1,$2,\'shown\')',[jobs[0].id,id(99)]);assert.equal((await query('select display_reported_at from chat_push_deliveries where id=$1',[jobs[0].id]))[0].display_reported_at,null)
 await query('select record_chat_push_receipt($1,$2,\'shown\')',[jobs[0].id,jobs[0].receipt_token]);assert.ok((await query('select display_reported_at from chat_push_deliveries where id=$1',[jobs[0].id]))[0].display_reported_at)
 const originalSub=id(21);assert.equal((await query('select register_chat_push_subscription($1,$2,$3,\'key\',\'auth\',null,true) saved',[recipient,originalSub,'https://push.test/21']))[0].saved,originalSub)
 assert.equal((await query('select subscription_id from chat_push_deliveries where id=$1',[jobs.find(j=>j.subscription_id===originalSub).id]))[0].subscription_id,originalSub)
 await assert.rejects(query('select register_chat_push_subscription($1,$2,$3,\'key\',\'auth\',null,true)',[outsider,id(23),'https://push.test/21']),/another account/)
 console.log('PASS targeted dispute, scoped receipt capabilities, stable subscription IDs, no automatic account transfer')

 await reset();await db.exec('begin');await addMessage();await db.exec('rollback');assert.equal((await query('select count(*)::int count from chat_push_deliveries'))[0].count,0)
 await db.exec('set role authenticated');await assert.rejects(claim(),/permission denied/);await db.exec('reset role')
 console.log('PASS rollback leaves no orphan notifications; browser roles cannot claim delivery jobs')

 // Apply the latency migration against the real eligibility/recipient rules.
 // Decoder security is covered with real encrypted data by native-inbox SQL.
 await db.exec(`
 alter table workspaces add column slug text default 'fixture';
 alter table workspace_teams add column name text default 'Fixture team';
 alter table workspace_native_messages add column edited_at timestamptz;
 alter table relationships add column primary_person_name text default 'Fixture client';
 alter table relationships add column business_name text default 'Fixture business';
 create table user_profiles(user_id uuid primary key,display_name text,username text);
 insert into user_profiles values('${sender}','Fixture sender','fixture');
 create table communication_message_deliveries(client_message_id uuid,workspace_id uuid,provider text,provider_message_id text,status text,error text,sent_at timestamptz,delivered_at timestamptz,read_at timestamptz,failed_at timestamptz,created_at timestamptz);
 create function communication_native_message(uuid,uuid) returns table(id uuid) language sql as $$select null::uuid where false$$;
 create function communication_client_message(uuid,uuid) returns table(id uuid) language sql as $$select null::uuid where false$$;
 `)
 await migration('20260917210000_chat_latency')
 await reset();message=await addMessage();jobs=await claim(message)
 const context=(await query("select chat_push_context($1,'native',$2,$3) result",[w,direct,message]))[0].result
 assert.equal(context.senderName,'Fixture sender');assert.equal(context.workspaceSlug,'fixture')
 assert.ok(context.recipients.includes(recipient));assert.ok(!context.recipients.includes(outsider))
 assert.equal((await query("select chat_push_context($1,'native',$2,$3) result",[w,team,message]))[0].result,null,'wrong conversation cannot reveal metadata')
 const sub=async(job,lease=job.lease_token)=>(await query('select prepare_chat_push_subscription($1,$2) result',[job.id,lease]))[0].result
 assert.equal((await sub(jobs[0])).state,'send');assert.ok((await sub(jobs[0])).subscription.endpoint)
 assert.equal((await sub(jobs[0],id(999))).subscription,undefined,'wrong lease cannot expose capability')
 await activity(1,true);assert.equal((await sub(jobs[0])).subscription,undefined,'active reading does not expose subscription')
 await activity(2,false);await query('select wake_chat_push_for_user($1)',[recipient]);jobs=await claim(message)
 await query('delete from workspace_native_conversation_participants where conversation_id=$1 and user_id=$2',[direct,recipient])
 assert.equal((await sub(jobs[0])).subscription,undefined,'revocation still prevents delivery')
 await query('insert into workspace_native_conversation_participants values($1,$2,$3)',[w,direct,recipient])
 for(const role of ['anon','authenticated']) {
  await db.exec(`set role ${role}`)
  await assert.rejects(query("select chat_push_context($1,'native',$2,$3)",[w,direct,message]),/permission denied/)
  await assert.rejects(sub(jobs[0]),/permission denied/)
  await db.exec('reset role')
 }
 await reset();message=await addMessage('client',client)
 const clientContext=(await query("select chat_push_context($1,'client',$2,$3) result",[w,client,message]))[0].result
 assert.equal(clientContext.primaryName,'Fixture client');assert.equal(clientContext.businessName,'Fixture business')
 await reset()
 console.log('PASS consolidated context/subscription: exact message scope, recipients, lease, active reading, revocation and service-role-only capabilities')

 // Exercise the real enqueue/claim/final eligibility bodies with binding
 // epochs, including a delayed old enqueue after the logout cleanup snapshot.
 const installationSql=await readFile(`${repositoryRoot}/supabase/migrations/20260917230000_installation_push_consent.sql`,'utf8')
 await db.exec('alter table web_push_subscriptions add column binding_version bigint not null default 0; alter table chat_push_deliveries add column binding_version bigint not null default 0;')
 for(const name of ['enqueue_message_chat_push','claim_chat_push_deliveries','prepare_chat_push_delivery']) {
  await db.exec(installationSql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))[0])
 }
 await reset();message=await addMessage();jobs=await claim(message)
 await query('update web_push_subscriptions set binding_version=binding_version+1 where user_id=$1',[recipient])
 assert.equal((await prepare(jobs[0])).state,'revoked','old captured jobs cannot cross a binding interval')
 await reset();message=await addMessage();jobs=await claim(message)
 assert.equal((await prepare(jobs[0])).state,'send','new messages capture the current interval')
 await query('update chat_push_deliveries set binding_version=binding_version-1 where id=$1',[jobs[1].id])
 assert.equal((await prepare(jobs[1])).state,'revoked','a delayed old enqueue cannot survive A-B-A routing')
 console.log('PASS binding epochs: current capture, stale queued jobs and delayed old enqueue rejected at final authorization')

 // Scheduler contracts run against local network/cron substitutes. No real
 // provider, business message, database credential or HTTP request is used.
 await db.exec(`
 create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);
 insert into vault.decrypted_secrets values('sop_work_cron_secret','fixture-only');
 create schema net;create table net.requests(id bigint generated always as identity primary key,url text,headers jsonb);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$declare saved bigint;begin insert into net.requests(url,headers) values(url,headers) returning id into saved;return saved;end$$;
 create schema cron;create table cron.jobs(name text primary key,schedule text,command text);
 create function cron.schedule(name text,schedule text,command text) returns bigint language sql as $$insert into cron.jobs values(name,schedule,command) returning 1::bigint$$;
 `)
 await migration('20260917091000_chat_push_scheduler')
 const dispatch=async()=>(await query('select dispatch_pending_chat_push() id'))[0].id
 assert.equal(await dispatch(),null)
 await addMessage();assert.equal(await dispatch(),null)
 await query('update chat_push_scheduler set enabled=true')
 assert.ok(await dispatch());assert.equal(await dispatch(),null)
 assert.equal((await query('select count(*)::int n from net.requests'))[0].n,1)
 assert.equal((await query('select url from net.requests'))[0].url,'https://app.betelgeze.com/api/cron/chat-push')
 assert.equal((await query('select schedule from cron.jobs where name=$1',['chat-push-recovery']))[0].schedule,'* * * * *')
 const retention=(await query('select command from cron.jobs where name=$1',['chat-push-retention']))[0].command
 await db.exec(retention)
 console.log('PASS recovery scheduler stays gated until rollout, dispatches due jobs, throttles duplicate calls, and validates retention SQL')
} finally {await db.close()}
