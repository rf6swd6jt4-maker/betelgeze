import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { repositoryRoot } from './pglite-fixture.mjs'

/** Install the real scheduler against network/cron stubs in the isolated DB. */
export async function installGhlSchedulerFixture(db) {
 await db.exec(`create schema net;create schema cron;
  alter table vault.decrypted_secrets add column name text;
  create table net.fixture_requests(id bigint generated always as identity,url text,headers jsonb);
  create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$declare result bigint;begin
   if url not in('https://app.betelgeze.com/api/cron/ghl-appointments','https://app.betelgeze.com/api/cron/ghl-oauth') then raise exception 'Unexpected synthetic scheduler request';end if;
   insert into net.fixture_requests(url,headers)values(url,headers)returning id into result;return result;end$$;
  create table cron.fixture_jobs(name text,schedule text,command text);
  create function cron.schedule(name text,schedule text,command text)returns bigint language sql as $$insert into cron.fixture_jobs values(name,schedule,command);select 1::bigint$$;`)
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20261020160000_ghl_scheduler.sql`,'utf8'))
}

export async function validateGhlSchedulerCompatibility({db,rpc,profile,r,calendar,location}) {
 const one=async(sql,params=[])=>(await db.query(sql,params)).rows[0]
 const dispatch=async()=>{await db.exec("update client_portal_secure.ghl_scheduler set last_dispatched_at=null where kind='appointments'");return(await one("select public.dispatch_ghl_work('appointments') id")).id}
 await db.exec('begin')
 try {
  assert.equal((await one("select bool_or(enabled) enabled from client_portal_secure.ghl_scheduler")).enabled,false,'Migrations never enable the scheduler')
  await db.exec("insert into vault.decrypted_secrets(id,decrypted_secret,name)values(gen_random_uuid(),'fixture-scheduler-secret','sop_work_cron_secret')")
  await db.query("update client_portal_secure.ghl_appointment_profiles set detection_enabled=false,portal_sync_enabled=false,reconcile_due_at=now()+interval '1 day' where id=$1",[profile.id])
  await db.query("insert into client_portal_secure.ghl_calendar_ranges(relationship_id,calendar_id,month,revision)values($1,$2,'2040-01',$3)",[r,calendar,profile.connectionRevision])
  assert.equal(await dispatch(),null,'Disabled scheduling stays disabled even with pending portal work')
  await db.exec("update client_portal_secure.ghl_scheduler set enabled=true where kind='appointments'")
  assert(await dispatch(),'Pending range wakes a quiet installation without notification detection')
  assert.equal((await one("select public.dispatch_ghl_work('appointments') id")).id,null,'Existing 45-second dispatch coalescing remains')
  await db.query("update client_portal_secure.ghl_calendar_ranges set checked_at=now(),requested_at=now(),hydration_pending=false where relationship_id=$1",[r])
  assert.equal(await dispatch(),null,'Completed optional queues do not create idle polling')
  await db.query('update client_portal_secure.ghl_calendar_ranges set hydration_pending=true where relationship_id=$1',[r])
  assert(await dispatch(),'Admitted hydration wakes after the provider range completes')
  await db.query("update client_portal_secure.ghl_calendar_ranges set available_at=now()+interval '1 day' where relationship_id=$1",[r])
  assert.equal(await dispatch(),null,'Backoff is not bypassed by optional scheduling')
  await db.query('update client_portal_secure.ghl_calendar_ranges set available_at=now(),revision=gen_random_uuid() where relationship_id=$1',[r])
  assert.equal(await dispatch(),null,'Old-revision ranges cannot keep waking the worker')
  await db.query('delete from client_portal_secure.ghl_calendar_ranges where relationship_id=$1',[r])
  await db.query("update client_portal_secure.ghl_appointment_profiles set portal_sync_enabled=true,include_notes=true where id=$1",[profile.id])
  const appointment='scheduler-note-appointment'
  await db.query("insert into client_portal_secure.ghl_appointment_snapshots(profile_id,appointment_id,version,connection_revision,snapshot)values($1,$2,1,$3,'{}')",[profile.id,appointment,profile.connectionRevision])
  await db.query('select client_portal_secure.queue_ghl_appointment_notes($1,$2,now())',[profile.id,appointment])
  assert(await dispatch(),'Optional notes wake independently after notifications are idle')
  await db.query('update client_portal_secure.ghl_appointment_snapshots set removed_at=now() where profile_id=$1',[profile.id])
  assert.equal(await dispatch(),null,'Removed appointments cannot keep optional notes awake')
  await db.query('update client_portal_secure.ghl_appointment_snapshots set removed_at=null where profile_id=$1',[profile.id])
  await db.query('update client_portal_secure.ghl_appointment_profiles set include_notes=false where id=$1',[profile.id])
  assert.equal(await dispatch(),null,'Disabling notes prevents their scheduler wake')
  await db.query("update client_portal_secure.ghl_appointment_profiles set include_notes=true,reconcile_due_at=now() where id=$1",[profile.id])
  await db.query("update client_portal_secure.ghl_appointment_note_jobs set status='ready' where profile_id=$1",[profile.id])
  assert(await dispatch(),'Portal-only reconciliation also wakes without detection')
  const old=async(action,input={})=>(await one('select public.ghl_appointment_automation($1,$2::jsonb) value',[action,JSON.stringify({processorVersion:2,...input})])).value
  assert.equal((await old('claim_reconciliations')).items.length,0,'Old workers cannot lease portal-only reconciliation')
  assert.equal((await rpc('claim_reconciliations',{limit:1})).items.length,1,'Capable workers retain portal-only recovery')
  await rpc('ingest',{locationId:location,calendarId:calendar,appointmentId:'scheduler-event',eventType:'Reconcile',eventKey:'scheduler-event',payloadHash:'e'.repeat(64),payload:{baseline:true}})
  assert.equal((await old('claim_events')).items.length,0,'Old global claims leave portal-only events untouched')
  assert.equal((await old('claim_events',{locationId:location,appointmentId:'scheduler-event'})).items.length,0,'Old scoped webhook claims also leave portal-only events untouched')
  const pending=await one("select status,attempts from client_portal_secure.ghl_appointment_inbox where appointment_id='scheduler-event'")
  assert.equal(pending.status,'pending');assert.equal(pending.attempts,0)
  await db.exec('savepoint old_detection_profile')
  await db.query('update client_portal_secure.ghl_appointment_profiles set detection_enabled=true where id=$1',[profile.id])
  assert.equal((await old('claim_events')).items.length,1,'Existing detection-enabled profiles remain compatible with old workers')
  await db.exec('rollback to old_detection_profile')
  assert.equal((await rpc('claim_events',{limit:1})).items.length,1,'Capable workers claim the preserved portal-only event')
  assert.equal((await one('select sending_enabled from client_portal_secure.ghl_appointment_profiles where id=$1',[profile.id])).sending_enabled,false)

  // Due-index growth: only future work is added, never production/provider rows.
  await db.query("insert into client_portal_secure.ghl_calendar_ranges(relationship_id,calendar_id,month,revision,available_at) select $1,'future-'||n,'2040-01',$2,now()+interval '1 day' from generate_series(1,25000)n",[r,profile.connectionRevision])
  await db.query("insert into client_portal_secure.ghl_appointment_snapshots(profile_id,appointment_id,version,connection_revision,snapshot) select $1,'scheduler-history-'||n,1,$2,'{}' from generate_series(1,25000)n",[profile.id,profile.connectionRevision])
  await db.query("insert into client_portal_secure.ghl_appointment_note_jobs(profile_id,appointment_id,connection_revision,due_at) select $1,'scheduler-history-'||n,$2,now()+interval '1 day' from generate_series(1,25000)n",[profile.id,profile.connectionRevision])
  await db.query("insert into client_portal_secure.ghl_appointment_profiles(workspace_id,relationship_id,connection_revision,location_id,calendar_id,calendar_name,portal_origin,portal_sync_enabled,reconcile_due_at) select p.workspace_id,p.relationship_id,p.connection_revision,'future-'||n,p.calendar_id,p.calendar_name,p.portal_origin,true,now()+interval '1 day' from client_portal_secure.ghl_appointment_profiles p cross join generate_series(1,25000)n where p.id=$1",[profile.id])
  await db.query('update client_portal_secure.ghl_appointment_profiles set reconcile_due_at=now(),reconcile_lease_until=null where id=$1',[profile.id])
  await db.query("insert into client_portal_secure.ghl_calendar_ranges(relationship_id,calendar_id,month,revision)values($1,$2,'2040-02',$3)",[r,calendar,profile.connectionRevision])
  await db.query("update client_portal_secure.ghl_appointment_note_jobs set status='pending',due_at=now() where profile_id=$1 and appointment_id=$2",[profile.id,appointment])
  await db.exec('analyze client_portal_secure.ghl_calendar_ranges;analyze client_portal_secure.ghl_appointment_note_jobs;analyze client_portal_secure.ghl_appointment_snapshots;analyze client_portal_secure.ghl_appointment_profiles')
  const source=(await one("select pg_get_functiondef('public.dispatch_ghl_work(text)'::regprocedure) value")).value
  for(const [table,index,alias] of [['ghl_calendar_ranges','ghl_calendar_ranges_due','q'],['ghl_appointment_note_jobs','ghl_appointment_note_jobs_due','j'],['ghl_appointment_profiles','ghl_appointment_portal_due','p']]) {
   const match=source.match(new RegExp(`and not exists\\((select 1 from client_portal_secure\\.${table} ${alias}\\n[\\s\\S]*?)\\)\\n\\s+and not exists`))
   assert(match,`Actual scheduler ${table} predicate must be measurable`)
   const plan=await one(`explain(analyze,buffers,format json) select exists(${match[1]})`)
   assert(JSON.stringify(plan).includes(index),`Scheduler uses ${index} as future queues grow`)
   const nodes=[];const visit=node=>{nodes.push(node);for(const child of node.Plans??[])visit(child)};visit(plan['QUERY PLAN'][0].Plan)
   assert(!nodes.some(node=>node['Relation Name']==='ghl_appointment_snapshots'&&node['Node Type'].includes('Seq Scan')),'Scheduler never scans retained appointment history')
   assert(!nodes.some(node=>node['Relation Name']==='ghl_appointment_profiles'&&node['Node Type'].includes('Seq Scan')),'Scheduler never scans the full profile history')
   console.log(JSON.stringify({growth:'optional scheduler',table,futureRows:25000,index,executionMs:plan['QUERY PLAN'][0]['Execution Time']}))
  }
  console.log('PASS actual scheduler: disabled/coalesced/quiet behavior, range/hydration/notes/portal-only wakes, revision/backoff/privacy guards and old-worker non-destructive claims')
 }finally{await db.exec('rollback')}
}
