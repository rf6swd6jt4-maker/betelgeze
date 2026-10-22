// Isolated PostgreSQL fixture; no network, live credentials, migration or sends.
// Vault and existing message encryption are adapters here, not encryption proof.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createGhlFixture, repositoryRoot } from './ghl-sql-fixture.mjs'
const db = await createGhlFixture()
const w='00000000-0000-4000-8000-000000000001',r='00000000-0000-4000-8000-000000000002',ps='00000000-0000-4000-8000-000000000003',rev='00000000-0000-4000-8000-000000000004',secret='00000000-0000-4000-8000-000000000005'
const location='location123456789',calendar='calendar123456789',appt='appointment123456789',phone='+12025550123'
let key=0
const rpc=async(action,input={})=>(await db.query('select public.ghl_appointment_automation($1,$2::jsonb) result',[action,JSON.stringify({processorVersion:2,portalSyncVersion:1,...input})])).rows[0].result
const sql=async(text,params=[])=>(await db.query(text,params)).rows
const scalar=async(text,params=[])=>(await sql(text,params))[0]
const summary=async(token,slug='fixture',host='portal.example.com')=>(await sql('select public.read_ghl_appointment_summary($1,$2,$3) result',[token,slug,host]))[0].result
const ingest=async(extra={})=>rpc('ingest',{locationId:location,calendarId:calendar,appointmentId:appt,eventType:'AppointmentCreate',eventKey:`event-${++key}`,payloadHash:key.toString(16).padStart(64,'0'),payload:{type:'AppointmentCreate'},...extra})
const claim=async()=> (await rpc('claim_events',{limit:1})).items[0]
const sample=(extra={})=>({id:appt,locationId:location,calendarId:calendar,calendarName:'Consultations',contactId:'contact123',contactName:'Alex Morgan',title:'Window consultation',startTime:new Date(Date.now()+3600000).toISOString(),endTime:new Date(Date.now()+5400000).toISOString(),timezone:'America/New_York',status:'confirmed',contactDetails:'+1 202 555 0123',meetingDetails:'Phone consultation',bookingDetails:'Six windows',sourceUpdatedAt:new Date().toISOString(),observedAt:new Date().toISOString(),deleted:false,...extra})
const apply=async(e,snapshot,version,kinds=['added'])=>rpc('apply_event',{id:e.id,leaseToken:e.leaseToken,expectedVersion:version,snapshot,sourceUpdatedAt:snapshot.sourceUpdatedAt,kinds,reminderAt:new Date(Date.now()-1000).toISOString()})
const dispatchInput=o=>({id:o.id,leaseToken:o.leaseToken,body:'Appointment update',destination:phone,templateName:`be_appointment_${o.kind}`,templateLanguage:'en_US',templateStatus:'APPROVED',templateCategory:'UTILITY',templateVerifiedAt:new Date().toISOString()})
try {
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth; create schema vault; create schema client_portal_secure; create schema extensions; create extension pgcrypto with schema extensions;
 create table auth.users(id uuid primary key);
 create function auth.role() returns text language sql as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'$$;
 create table public.workspaces(id uuid primary key,slug text,name text,agency_display_name text,status text,custom_client_portal_domain text,custom_client_portal_domain_status text);
 create table public.relationships(id uuid primary key,workspace_id uuid,status text,client_id uuid,whatsapp_phone text,whatsapp_opted_out_at timestamptz);
 create table public.client_portal_sessions(id uuid primary key,workspace_id uuid,relationship_id uuid,session_token text,status text,token_revoked_at timestamptz);
 create table client_portal_secure.ghl_connections(workspace_id uuid,relationship_id uuid primary key,vault_secret_id uuid,location_id text,calendar_revision uuid,selected_calendar_id text,selected_calendar_name text,lease_until timestamptz);
 create table client_portal_secure.ghl_calendar_snapshots(relationship_id uuid primary key,operation_id uuid,lease_until timestamptz,attempted_at timestamptz,revision uuid,requested_month text,requested_calendar text,snapshot jsonb,refreshed_at timestamptz,last_error text);
 create table vault.decrypted_secrets(id uuid,decrypted_secret text);
 create table public.client_messages(id uuid primary key default gen_random_uuid(),workspace_id uuid,relationship_id uuid,client_id uuid,communication_channel_id uuid,direction text,provider text,to_address text,body text,status text,sender_kind text,automation_kind text,automation_label text,client_request_id uuid,raw_payload jsonb,provider_message_id text,whatsapp_message_id text,sent_at timestamptz,failed_at timestamptz,error text);
 create table public.communication_message_deliveries(id uuid primary key default gen_random_uuid(),workspace_id uuid,relationship_id uuid,client_message_id uuid,communication_channel_id uuid,provider text,destination text,status text,raw_payload jsonb,provider_message_id text,sent_at timestamptz,failed_at timestamptz,error text,updated_at timestamptz);
 create function public.relationship_contact_phone(v text) returns text language sql as $$select v$$;
 create table fixture_consent(active boolean); insert into fixture_consent values(true);
 create function public.relationship_messaging_choices(w uuid,r uuid) returns jsonb language sql as $$select jsonb_build_array(jsonb_build_object('provider','meta_whatsapp','address','${phone}','confirmedAt',case when active then now()-interval '30 days' end,'canSend',false,'state',case when active then 'active' else 'inactive' end)) from public.fixture_consent$$;
 insert into workspaces values('${w}','fixture','Fixture','Fixture Agency','active','portal.example.com','verified');
 insert into relationships values('${r}','${w}','active',null,'${phone}',null);
 insert into client_portal_sessions values('${ps}','${w}','${r}','${'a'.repeat(64)}','active',null);
 insert into client_portal_secure.ghl_connections values('${w}','${r}','${secret}','${location}','${rev}','${calendar}','Consultations',null);
 insert into vault.decrypted_secrets values('${secret}','fixture-private-token');
 select set_config('request.jwt.claims','{"role":"service_role"}',false);`)
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20261011180000_ghl_appointment_automation.sql`,'utf8'))
 for(const file of ['20261020120000_ghl_oauth_connections.sql','20261020130000_ghl_event_processing.sql','20261020140000_ghl_app_events.sql','20261020150000_ghl_notification_setup.sql','20261021100000_ghl_multiple_calendars.sql']) await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/${file}`,'utf8'))
 await (await import('./validate-ghl-scheduler-compatibility-sql.mjs')).installGhlSchedulerFixture(db)
 await db.exec(`create table public.client_sales(id uuid primary key,workspace_id uuid,relationship_id uuid,client_phone text,consent_confirmed_at timestamptz,deleted_at timestamptz,raw_payload jsonb);
 create index relationship_sale_confirmation_lookup on public.client_sales(workspace_id,relationship_id,consent_confirmed_at desc) where consent_confirmed_at is not null;
 create table public.workspace_integrations(workspace_id uuid,provider text,enabled boolean,connection_status text,primary key(workspace_id,provider));`)
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20261021190000_ghl_template_consent.sql`,'utf8'))
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20261021220000_ghl_prompt_reconciliation.sql`,'utf8'))
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20261022010000_ghl_portal_calendar_freshness.sql`,'utf8'))
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20261022011000_ghl_appointment_details.sql`,'utf8'))
 await (await import('./validate-whatsapp-template-evidence-sql.mjs')).installTemplateEvidenceFixture(db)


 // Legacy permission is scoped to the same relationship and current number.
 await db.exec('begin')
 await db.exec(`update fixture_consent set active=false;
 insert into workspace_integrations values('${w}','meta_whatsapp',true,'connected');
 insert into client_sales values('${ps}','${w}','${r}','${phone}',now()-interval '60 days',null,'{"confirmation_source":"relationship_channels","delivery_choices":[{"provider":"meta_whatsapp","address":"${phone}"}]}');`)
 const choice=async(workspace=w,relationship=r)=>(await scalar('select public.relationship_template_messaging_choices($1,$2)->0 c',[workspace,relationship])).c
 assert.equal((await choice()).state,'active');assert((await choice()).confirmedAt);assert.equal((await choice()).canSend,false)
 assert.equal((await scalar('select public.relationship_messaging_choices($1,$2)->0 c',[w,r])).c.confirmedAt,null,'Free-form owner remains unchanged')
 assert.equal((await choice(ps,r)).confirmedAt,null);assert.equal((await choice(w,ps)).confirmedAt,null)
 for(const [change,restore] of [
  ["update relationships set whatsapp_opted_out_at=now()","update relationships set whatsapp_opted_out_at=null"],
  ["update relationships set status='archived'","update relationships set status='active'"],
  ["update relationships set whatsapp_phone='+12025550999'",`update relationships set whatsapp_phone='${phone}'`],
  ["update client_sales set deleted_at=now()","update client_sales set deleted_at=null"],
  ["update client_sales set client_phone='+12025550999'",`update client_sales set client_phone='${phone}'`],
  ["update client_sales set raw_payload=jsonb_set(raw_payload,'{confirmation_source}','\"unknown\"')","update client_sales set raw_payload=jsonb_set(raw_payload,'{confirmation_source}','\"relationship_channels\"')"],
  ["update client_sales set raw_payload=jsonb_set(raw_payload,'{delivery_choices}','[]')",`update client_sales set raw_payload=jsonb_set(raw_payload,'{delivery_choices}','[{"provider":"meta_whatsapp","address":"${phone}"}]')`]
 ]) {await db.exec(change);assert.equal((await choice()).confirmedAt,null,change);await db.exec(restore)}
 await db.exec(`insert into client_sales select gen_random_uuid(),'${ps}','${ps}','${phone}',now(),null,'{}' from generate_series(1,25000); analyze client_sales;`)
 const consentPlan=await scalar(`explain (analyze,format json) select id,deleted_at,raw_payload,client_phone,consent_confirmed_at from client_sales where workspace_id='${w}' and relationship_id='${r}' and consent_confirmed_at is not null order by consent_confirmed_at desc limit 1`)
 assert(JSON.stringify(consentPlan).includes('relationship_sale_confirmation_lookup'),'Consent lookup must retain its scoped index as unrelated history grows')
 console.log('PASS consent growth: latest confirmed sale uses existing scoped index with 25,000 unrelated rows')
 await db.exec("update workspace_integrations set connection_status='degraded'");assert.equal((await choice()).state,'broken')
 await db.exec("update workspace_integrations set connection_status='connected',enabled=false");assert.equal((await choice()).state,'broken')
 await db.exec(`create or replace function public.relationship_messaging_choices(w uuid,r uuid) returns jsonb language sql as $$select jsonb_build_array(jsonb_build_object('provider','meta_whatsapp','address','${phone}','confirmedAt',null,'confirmationStatus','revoked','state','inactive'))$$`)
 assert.equal((await choice()).confirmedAt,null,'Revocation cannot reuse older permission')
 assert.equal((await scalar("select has_function_privilege('authenticated','public.relationship_template_messaging_choices(uuid,uuid)','execute') allowed")).allowed,false)
 await db.exec('rollback')
 console.log('PASS legacy template consent: expired window, exact identity, STOP, revoked/deleted evidence, disabled integration and free-form isolation')

 let configured=await rpc('configure',{workspaceId:w,relationshipId:r,portalOrigin:'https://portal.example.com'})
 assert.equal(configured.profile.detectionEnabled,false);assert.equal(configured.profile.sendingEnabled,false);assert.equal(configured.profile.includeNotes,false)
 assert.equal((await ingest()).queued,0)
 configured=await rpc('configure',{workspaceId:w,relationshipId:r,portalOrigin:'https://portal.example.com',detectionEnabled:true})
 await db.exec('begin')
 const calendars=[{id:calendar,name:'Consultations'},{id:'secondcalendar123',name:'Estimates'}]
 await db.query('update client_portal_secure.ghl_connections set selected_calendars=$1::jsonb',[JSON.stringify(calendars)])
 const multiple=await rpc('configure',{workspaceId:w,relationshipId:r,portalOrigin:'https://portal.example.com',detectionEnabled:true})
 assert.equal(multiple.profile.calendars.length,2)
 assert.equal((await ingest({calendarId:'unselectedcalendar'})).queued,0)
 assert.equal((await ingest({calendarId:'secondcalendar123'})).queued,1)
 const multiEvent=await claim(),multiSnapshot=sample({calendarId:'secondcalendar123',calendarName:'Estimates'})
 assert.equal((await rpc('event_context',{id:multiEvent.id,leaseToken:multiEvent.leaseToken,processorVersion:1})).failure,'processor_version')
 assert.equal((await rpc('apply_event',{id:multiEvent.id,leaseToken:multiEvent.leaseToken,expectedVersion:0,snapshot:multiSnapshot,processorVersion:1})).failure,'processor_version')
 assert.equal((await apply(multiEvent,multiSnapshot,0)).version,1)
 assert.equal((await ingest({calendarId:calendar,eventType:'AppointmentUpdate'})).queued,1,'Move queues once for the client, not once per calendar')
 const moveEvent=await claim(),moved=sample({...multiSnapshot,calendarId:calendar,calendarName:'Consultations'})
 assert.equal((await apply(moveEvent,moved,1,['details_updated'])).version,2)
 assert.equal((await scalar('select count(*)::int n from client_portal_secure.ghl_appointment_snapshots')).n,1)
 assert.equal((await scalar("select count(*)::int n from client_portal_secure.ghl_appointment_outbox where kind='removed'")).n,0)
 assert.equal((await rpc('enqueue_reminders')).queued,1);assert.equal((await rpc('enqueue_reminders')).queued,0)
 await ingest({calendarId:calendar,eventType:'AppointmentUpdate'});const wrongEvent=await claim()
 assert.equal((await apply(wrongEvent,{...moved,calendarId:'unselectedcalendar'},2)).failure,'snapshot')
 // Removing a calendar from the selection preserves its history silently.
 await db.query('update client_portal_secure.ghl_connections set selected_calendars=$1::jsonb',[JSON.stringify([{id:calendar,name:'Consultations'}])])
 await rpc('configure',{workspaceId:w,relationshipId:r,portalOrigin:'https://portal.example.com',detectionEnabled:true})
 await db.query("update client_portal_secure.ghl_appointment_snapshots set snapshot=jsonb_set(snapshot,'{calendarId}','\"secondcalendar123\"'::jsonb)")
 assert.equal((await ingest({calendarId:'secondcalendar123',eventType:'AppointmentUpdate'})).queued,0)
 await db.exec('rollback')
 console.log('Multiple-calendar SQL: selected intake, one history, moves, reminder deduplication and outside-calendar fencing passed')
 const profile=configured.profile
 const {validateGhlCalendarBeginContract}=await import('./validate-ghl-calendar-begin-contract.mjs')
 await validateGhlCalendarBeginContract({db,w,r,calendar,location,corrected:false})
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20261022014000_ghl_portal_calendar_begin_contract.sql`,'utf8'))
 await validateGhlCalendarBeginContract({db,w,r,calendar,location,corrected:true})
 await (await import('./validate-ghl-scheduler-compatibility-sql.mjs')).validateGhlSchedulerCompatibility({db,rpc,profile,r,calendar,location})
 await (await import('./validate-ghl-calendar-freshness.mjs')).validateGhlCalendarFreshness({db,w,r,calendar,location,rpc})
 await (await import('./validate-ghl-appointment-details-sql.mjs')).validateAppointmentDetails({db,rpc,profile,w,r,calendar,location})
 await (await import('./validate-ghl-recovery-flow.mjs')).validateGhlRecoveryFlow({db,rpc,profile,w,r,calendar,location})
 assert.equal((await rpc('configure',{workspaceId:w,relationshipId:r,portalOrigin:'https://portal.example.com',detectionEnabled:true,includeNotes:'true'})).profile.includeNotes,false)
 assert.equal((await rpc('configure',{workspaceId:w,relationshipId:r,portalOrigin:'https://portal.example.com',detectionEnabled:true,includeNotes:true})).profile.includeNotes,true)
 await rpc('configure',{workspaceId:w,relationshipId:r,portalOrigin:'https://portal.example.com',detectionEnabled:true})
 assert.equal((await rpc('claim_notifications')).items.length,0)
 // Disabled workspace/relationship scope rejects new intake and reconciliation credential claims.
 await db.exec("update relationships set status='archived'")
 assert.equal((await ingest()).queued,0);assert.equal((await rpc('claim_reconciliations')).items.length,0)
 await db.exec("update relationships set status='active'; update workspaces set status='suspended'")
 assert.equal((await ingest()).queued,0);assert.equal((await rpc('claim_reconciliations')).items.length,0)
 await db.exec("update workspaces set status='active'")
 assert.equal((await ingest({eventKey:'dedup',payloadHash:'a'.repeat(64)})).queued,1)
 assert.equal((await ingest({eventKey:'dedup',payloadHash:'a'.repeat(64)})).queued,0)
 assert.equal((await ingest({eventKey:'dedup',payloadHash:'b'.repeat(64)})).failure,'event_key_collision')
 if(db.connect) {
  const a=await db.connect(),b=await db.connect()
  const claimOn=c=>c.query('select public.ghl_appointment_automation($1,$2::jsonb) result',['claim_events',JSON.stringify({limit:1})])
  await a.query('begin');assert.equal((await claimOn(a)).rows[0].result.items.length,1)
  assert.equal((await claimOn(b)).rows[0].result.items.length,0)
  await a.query('rollback')
  console.log('PASS native PostgreSQL: competing workers cannot claim the same appointment event')
 }
 await (await import('./validate-ghl-portal-concurrency.mjs')).validateGhlPortalConcurrency({db,profile,w,r,calendar,location})
 let e=await claim();assert(e?.leaseToken)
 await db.exec("update relationships set status='archived'")
 assert.equal((await rpc('event_context',{id:e.id,leaseToken:e.leaseToken})).failure,'access')
 await db.exec("update relationships set status='active'")
 await ingest();e=await claim()
 await db.exec("update workspaces set status='suspended'")
 assert.equal((await rpc('event_context',{id:e.id,leaseToken:e.leaseToken})).failure,'access')
 await db.exec("update workspaces set status='active'")
 await ingest();e=await claim()

 assert.equal((await rpc('claim_events')).items.length,0)
 assert.equal((await rpc('event_context',{id:e.id,leaseToken:rev})).failure,'lease')
 assert.equal((await rpc('event_context',{id:e.id,leaseToken:e.leaseToken})).privateToken,'fixture-private-token')
 let snap=sample(),a=await apply(e,snap,0)
 assert.equal(a.version,1);assert.match(a.summaryToken,/^[a-f0-9]{64}$/)
 let token=a.summaryToken
 assert.equal((await apply(e,snap,0)).failure,'lease')
 assert.equal((await summary(token)).snapshot.id,appt)
 await db.exec("update relationships set status='archived'"); assert.equal((await summary(token)).failure,'access'); await db.exec("update relationships set status='active'")
 await db.exec("update workspaces set status='inactive'"); assert.equal((await summary(token)).failure,'access'); await db.exec("update workspaces set status='active'")
 await db.exec("update workspaces set custom_client_portal_domain_status='pending_dns'"); assert.equal((await summary(token)).failure,'access'); await db.exec("update workspaces set custom_client_portal_domain_status='verified'")
 assert.equal((await summary(token,'other')).failure,'access')
 assert.equal((await summary(token,'fixture','evil.example.com')).failure,'access')
 await db.exec(`update client_portal_sessions set token_revoked_at=now(),status='revoked'`)
 assert.equal((await summary(token)).failure,'access')
 await db.exec(`update client_portal_sessions set token_revoked_at=null,status='active',session_token='${'b'.repeat(64)}'`)
 assert.equal((await summary(token)).failure,'access')
 await db.exec(`update client_portal_sessions set session_token='${'a'.repeat(64)}'`)
 await ingest({eventType:'AppointmentUpdate'}); e=await claim()
 assert.equal((await apply(e,snap,0)).failure,'version')
 let second=sample({...snap,startTime:new Date(Date.now()+7200000).toISOString(),sourceUpdatedAt:new Date(Date.now()+1000).toISOString()})
 a=await apply(e,second,1,['rescheduled']);assert.equal(a.version,2)
 assert.equal((await scalar("select count(*)::int n from client_portal_secure.ghl_appointment_versions")).n,2)
 assert.equal((await scalar("select status from client_portal_secure.ghl_appointment_outbox where version=1")).status,'superseded')
 assert.equal((await summary(token)).snapshot.startTime,second.startTime)
 await ingest({eventType:'AppointmentUpdate'}); e=await claim()
 assert.equal((await apply(e,snap,2,['details_updated'])).ignored,true)
 assert.equal((await summary(token)).version,2)
 // An unchanged refresh updates freshness without invalidating the queued intent.
 await ingest({eventType:'AppointmentUpdate'});e=await claim()
 assert.equal((await apply(e,{...second,observedAt:new Date().toISOString()},2,[])).unchanged,true)
 assert.equal((await summary(token)).version,2)
 assert.equal((await rpc('enqueue_reminders')).queued,1)
 assert.equal((await rpc('enqueue_reminders')).queued,0)
 assert.equal((await rpc('claim_notifications')).items.length,0)
 // Fixture-only activation: no runtime/config action enables sending.
 await db.exec("update client_portal_secure.ghl_appointment_profiles set sending_enabled=true,tested_at=now(),sending_activated_at=now()-interval '1 hour'")
 let jobs=(await rpc('claim_notifications')).items
 assert.equal(jobs.length,2)
 let job=jobs.find(j=>j.kind==='rescheduled')
 assert.equal((await rpc('notification_context',{id:job.id,leaseToken:job.leaseToken})).destination,phone)
 await db.exec("update relationships set status='archived'"); assert.equal((await rpc('notification_context',{id:job.id,leaseToken:job.leaseToken})).failure,'access'); await db.exec("update relationships set status='active'")
 assert.equal((await rpc('begin_dispatch',{...dispatchInput(job),templateCategory:'MARKETING'})).failure,'template')
 await db.exec("update fixture_consent set active=false")
 assert.equal((await rpc('begin_dispatch',dispatchInput(job))).failure,'consent')
 await db.exec("update fixture_consent set active=true")
 await ingest({eventType:'AppointmentUpdate'});
 assert.equal((await rpc('begin_dispatch',dispatchInput(job))).failure,'pending_events')
 e=await claim(); await apply(e,second,2,[])
 await db.exec(`update fixture_consent set active=false;
 insert into workspace_integrations values('${w}','meta_whatsapp',true,'connected');
 insert into client_sales values('${ps}','${w}','${r}','${phone}',now()-interval '60 days',null,'{"confirmation_source":"relationship_channels","delivery_choices":[{"provider":"meta_whatsapp","address":"${phone}"}]}');`)
 const start=await rpc('begin_dispatch',dispatchInput(job));assert(start.messageId&&start.deliveryId,'Legacy permission passes actual atomic dispatch outside reply window')
 await db.exec('update fixture_consent set active=true; delete from client_sales; delete from workspace_integrations')
 assert.equal((await rpc('begin_dispatch',dispatchInput(job))).failure,'lease')
 await db.exec("update client_portal_secure.ghl_appointment_outbox set lease_until=now()-interval '1 second' where status='sending'")
 await rpc('claim_notifications')
 assert.equal((await scalar('select status from client_portal_secure.ghl_appointment_outbox where id=$1',[job.id])).status,'uncertain')
 assert.equal((await scalar('select count(*)::int n from client_messages')).n,1)
 assert.equal((await scalar('select to_address from client_messages')).to_address,`whatsapp:${phone}`)
 // A webhook may be ahead of the worker receipt; never regress delivered/read.
 await db.exec("update client_messages set status='whatsapp_read'; update communication_message_deliveries set status='read'")
 await rpc('finish_dispatch',{id:job.id,leaseToken:job.leaseToken,outcome:'accepted',providerMessageId:'wamid.fixture'})
 assert.equal((await scalar('select status from client_messages')).status,'whatsapp_read')
 assert.equal((await scalar('select status from communication_message_deliveries')).status,'read')
 // A provider failure callback racing the HTTP receipt also remains authoritative.
 await sql("update client_portal_secure.ghl_appointment_outbox set status='sending' where id=$1",[job.id])
 await db.exec("update client_messages set status='delivery_failed',error='provider failure'; update communication_message_deliveries set status='delivery_failed',error='provider failure'")
 await rpc('finish_dispatch',{id:job.id,leaseToken:job.leaseToken,outcome:'accepted',providerMessageId:'wamid.fixture'})
 assert.equal((await scalar('select status from client_messages')).status,'delivery_failed')
 assert.equal((await scalar('select status from communication_message_deliveries')).status,'delivery_failed')
 assert.equal((await scalar('select error from client_messages')).error,'provider failure')

 const recon=(await rpc('claim_reconciliations')).items[0];assert(recon.privateToken)
 assert.equal((await rpc('reconciliation_candidates',{profileId:profile.id,leaseToken:recon.leaseToken})).items.length,1)
 assert.equal((await rpc('finish_reconciliation',{profileId:profile.id,leaseToken:rev,cursor:{}})).failure,'lease')
 await rpc('finish_reconciliation',{profileId:profile.id,leaseToken:recon.leaseToken,cursor:{phase:'known'}})
 assert.equal((await rpc('claim_reconciliations')).items.length,0)
 // Cancellation and removal each retain details and atomically supersede reminders.
 await ingest({eventType:'AppointmentUpdate',calendarId:'moved-calendar-987'}); e=await claim(); assert(e,'Known appointment move reaches previous calendar profile')
 const cancelled={...second,status:'cancelled',sourceUpdatedAt:new Date(Date.now()+2000).toISOString()}
 await apply(e,cancelled,2,['cancelled'])
 assert.equal((await scalar("select count(*)::int n from client_portal_secure.ghl_appointment_outbox where kind='reminder' and status='superseded'")).n,1)
 await ingest({eventType:'AppointmentDelete'}); e=await claim()
 await apply(e,{...cancelled,deleted:true,sourceUpdatedAt:new Date(Date.now()+3000).toISOString()},3,['removed'])
 assert.equal((await scalar("select count(*)::int n from client_portal_secure.ghl_appointment_outbox where version=4 and kind='removed'")).n,1)
 assert.equal((await summary(token)).snapshot.deleted,true)
 assert.equal((await summary(token)).snapshot.contactName,'Alex Morgan')
 // Portal rotation preserves old-link denial while a newly queued notice gets a fresh capability.
 await db.exec(`update client_portal_sessions set session_token='${'c'.repeat(64)}'`)
 await ingest({eventType:'AppointmentUpdate'});e=await claim()
 const restored={...second,sourceUpdatedAt:new Date(Date.now()+4000).toISOString()}
 const restoredResult=await apply(e,restored,4,['status_updated'])
 assert.notEqual(restoredResult.summaryToken,token)
 assert.equal((await summary(token)).failure,'access')
 token=restoredResult.summaryToken
 assert.equal((await summary(token)).snapshot.deleted,false)
 // An expired lease can be reclaimed; the previous lease cannot commit.
 await ingest({eventType:'AppointmentUpdate'}); const oldLease=await claim()
 await sql("update client_portal_secure.ghl_appointment_inbox set lease_until=now()-interval '1 second' where id=$1",[oldLease.id])
 e=await claim(); assert.equal(e.id,oldLease.id); assert.notEqual(e.leaseToken,oldLease.leaseToken)
 assert.equal((await apply(oldLease,restored,5,[])).failure,'lease')
 await apply(e,restored,5,[])
 // One scheduled occurrence does not receive another reminder after a details-only version.
 await rpc('enqueue_reminders')
 let reminderJob=(await rpc('claim_notifications')).items.find(item=>item.kind==='reminder')
 assert(reminderJob)
 assert((await rpc('begin_dispatch',dispatchInput(reminderJob))).messageId)
 await rpc('finish_dispatch',{id:reminderJob.id,leaseToken:reminderJob.leaseToken,outcome:'accepted',providerMessageId:'wamid.reminder'})
 await ingest({eventType:'AppointmentUpdate'});e=await claim()
 const details={...restored,title:'Updated consultation title',sourceUpdatedAt:new Date(Date.now()+4500).toISOString()}
 await apply(e,details,5,['details_updated']); await rpc('enqueue_reminders')
 reminderJob=(await rpc('claim_notifications')).items.find(item=>item.kind==='reminder')
 assert(reminderJob)
 assert.equal((await rpc('begin_dispatch',dispatchInput(reminderJob))).failure,'superseded')
 // An already dispatched cancellation suppresses the redundant later removal notice.
 await ingest({eventType:'AppointmentUpdate'});e=await claim()
 await apply(e,{...restored,status:'cancelled',sourceUpdatedAt:new Date(Date.now()+5000).toISOString()},6,['cancelled'])
 await db.exec("update client_portal_secure.ghl_appointment_outbox set status='accepted' where version=7 and kind='cancelled'")
 await ingest({eventType:'AppointmentDelete'});e=await claim()
 await apply(e,{...restored,status:'cancelled',deleted:true,sourceUpdatedAt:new Date(Date.now()+6000).toISOString()},7,['removed'])
 assert.equal((await scalar("select count(*)::int n from client_portal_secure.ghl_appointment_outbox where version=8 and kind='removed'")).n,0)
 // Quarantine remains a dispatch fence and stale connection work cannot apply.
 await ingest({eventType:'AppointmentUpdate'}); e=await claim()
 await rpc('fail_event',{id:e.id,leaseToken:e.leaseToken,error:'fixture_failure',retryable:false})
 assert.equal((await scalar("select status from client_portal_secure.ghl_appointment_inbox where id=$1",[e.id])).status,'quarantined')
 await ingest({eventType:'AppointmentUpdate'});e=await claim()
 await db.exec("update client_portal_secure.ghl_connections set calendar_revision=gen_random_uuid()")
 assert.equal((await apply(e,cancelled,8)).failure,'connection_changed')
 // Selecting a different calendar creates a new scope; it never overwrites old summaries.
 await db.exec("update client_portal_secure.ghl_connections set selected_calendar_id='new-calendar-987',selected_calendar_name='New calendar'")
 const newProfile=(await rpc('configure',{workspaceId:w,relationshipId:r,portalOrigin:'https://portal.example.com',detectionEnabled:true})).profile
 assert.notEqual(newProfile.id,profile.id)
 assert.equal((await scalar('select count(*)::int n from client_portal_secure.ghl_appointment_profiles where detection_enabled')).n,1)
 await ingest({calendarId:'new-calendar-987'});e=await claim()
 const other={...restored,calendarId:'new-calendar-987',calendarName:'New calendar',contactName:'Different contact',sourceUpdatedAt:new Date(Date.now()+5000).toISOString()}
 const fresh=await apply(e,other,0,['added'])
 assert.equal((await summary(token)).snapshot.contactName,'Alex Morgan')
 assert.equal((await summary(fresh.summaryToken)).snapshot.contactName,'Different contact')
 assert.notEqual(fresh.summaryToken,token)
 // Expired/dry-run history must not consume the eligible claim LIMIT after activation.
 await sql("update client_portal_secure.ghl_appointment_profiles set sending_enabled=true,tested_at=now(),sending_activated_at=now()-interval '1 minute' where id=$1",[newProfile.id])
 await sql(`insert into client_portal_secure.ghl_appointment_outbox(profile_id,appointment_id,version,kind,connection_revision,snapshot,summary_token,available_at,expires_at,created_at)
 select profile_id,appointment_id,version,'details_updated',connection_revision,snapshot,summary_token,now()-interval '2 hours',now()-interval '1 hour',now()-interval '2 hours'
 from client_portal_secure.ghl_appointment_outbox where profile_id=$1 and kind='added'`,[newProfile.id])
 await sql(`insert into client_portal_secure.ghl_appointment_outbox(profile_id,appointment_id,version,kind,connection_revision,snapshot,summary_token,available_at,expires_at,created_at)
 select profile_id,appointment_id,version,'status_updated',connection_revision,snapshot,summary_token,now()-interval '2 minutes',now()+interval '1 hour',now()-interval '2 minutes'
 from client_portal_secure.ghl_appointment_outbox where profile_id=$1 and kind='added'`,[newProfile.id])
 const timely=(await rpc('claim_notifications',{limit:1})).items
 assert.equal(timely.length,1);assert.equal(timely[0].kind,'added');assert.equal(timely[0].profile.id,newProfile.id)
 assert.equal((await scalar("select count(*)::int n from client_portal_secure.ghl_appointment_outbox where profile_id=$1 and kind in('details_updated','status_updated') and status='pending'",[newProfile.id])).n,2,'Ineligible history is retained without draining it during a claim')
 assert.equal((await rpc('claim_notifications',{limit:1})).items.length,0)
 // Contact-only changes fan out through bounded keyset pages, with exact dedup.
 const appRpc=async(action,input={})=>(await scalar('select public.ghl_app_event($1,$2::jsonb) result',[action,JSON.stringify({processorVersion:2,...input})])).result
 await sql(`insert into client_portal_secure.ghl_appointment_snapshots(profile_id,appointment_id,version,connection_revision,snapshot)
 select $1,'fanout-'||lpad(i::text,3,'0'),1,$2,jsonb_set($3::jsonb,'{contactId}','"fanout-contact"') from generate_series(1,21) i`,[newProfile.id,newProfile.connectionRevision,JSON.stringify(other)])
 const contactEvent={eventType:'ContactUpdate',eventKey:'contact-fanout',payloadHash:'e'.repeat(64),appId:'fixture-app',locationId:location,contactId:'fanout-contact'}
 assert.equal((await appRpc('ingest',contactEvent)).accepted,true)
 assert.equal((await appRpc('ingest',contactEvent)).accepted,true)
 assert.equal((await appRpc('ingest',{...contactEvent,payloadHash:'f'.repeat(64)})).failure,'event_key_collision')
 assert.equal((await appRpc('drain')).processed,20)
 assert.equal((await appRpc('drain')).processed,1)
 assert.equal((await appRpc('drain')).processed,0)
 assert.equal((await scalar("select count(*)::int n from client_portal_secure.ghl_appointment_inbox where appointment_id like 'fanout-%'")).n,21)
 assert.equal((await rpc('claim_events',{locationId:'foreign-location',limit:5})).items.length,0)
 const targeted=(await rpc('claim_events',{locationId:location,appointmentId:'fanout-021',limit:5})).items
 assert.equal(targeted.length,1);assert.equal(targeted[0].appointmentId,'fanout-021')
 // Setup requires canonical client access, the exact current connection, OAuth,
 // an active portal, current consent and a freshly verified seven-template set.
 await db.exec(`create function public.read_client_ghl_connections(w uuid,u uuid,r uuid) returns jsonb language sql as $$ select case when u='${ps}'::uuid then jsonb_build_object('accounts',jsonb_build_array(jsonb_build_object('relationshipId',r))) else '{}'::jsonb end $$;
 update workspaces set custom_client_portal_domain='portal.scaylup.com';
 insert into client_portal_secure.ghl_oauth_credentials(relationship_id,workspace_id,location_id,app_id,company_id,credential_encrypted,access_hash,expires_at)
 values('${r}','${w}','${location}','fixture-app','fixture-company','synthetic-encrypted',encode(extensions.digest('fixture-private-token','sha256'),'hex'),now()+interval '1 day');`)
 const setupRpc=async(action,input={})=>(await scalar('select public.ghl_appointment_setup($1,$2::jsonb) result',[action,JSON.stringify({workspaceId:w,userId:ps,relationshipId:r,expectedRevision:newProfile.connectionRevision,appId:'fixture-app',...input})])).result
 assert.equal((await setupRpc('ensure',{userId:rev})).failure,'access')
 assert.equal((await setupRpc('ensure',{expectedRevision:rev})).failure,'changed')
 assert.equal((await setupRpc('ensure')).profile.sendingEnabled,false)
 assert.equal((await setupRpc('enable')).failure,'preflight')
 const preflight={verifiedAt:new Date().toISOString(),verifiedTemplates:['added','rescheduled','cancelled','removed','details_updated','status_updated','reminder']}
 await db.exec('update fixture_consent set active=false')
 assert.equal((await setupRpc('enable',preflight)).failure,'consent')
 await db.exec('update fixture_consent set active=true')
 const enabled=await setupRpc('enable',preflight)
 assert.equal(enabled.profile.sendingEnabled,true)
 assert.equal((await setupRpc('ensure')).profile.sendingActivatedAt,enabled.profile.sendingActivatedAt,'Connection acknowledgement retries preserve activation')
 assert.equal((await setupRpc('enable',preflight)).profile.sendingActivatedAt,enabled.profile.sendingActivatedAt)
 assert.equal((await setupRpc('disable')).sendingEnabled,false)
 // Wrong-app uninstall is isolated; the matching uninstall disables both lanes.
 await appRpc('ingest',{eventType:'UNINSTALL',eventKey:'wrong-app-uninstall',payloadHash:'a'.repeat(64),appId:'another-app',locationId:location})
 assert.equal((await appRpc('drain')).processed,0)
 assert.equal((await scalar('select status from client_portal_secure.ghl_oauth_credentials')).status,'active')
 await appRpc('ingest',{eventType:'UNINSTALL',eventKey:'uninstall',payloadHash:'b'.repeat(64),appId:'fixture-app',companyId:'fixture-company'})
 assert.equal((await appRpc('drain')).processed,1)
 assert.equal((await scalar('select status from client_portal_secure.ghl_oauth_credentials')).status,'revoked')
 assert.equal((await scalar('select count(*)::int n from client_portal_secure.ghl_appointment_profiles where detection_enabled or sending_enabled')).n,0)
 assert.equal((await setupRpc('enable',preflight)).failure,'oauth')
 // Scheduler installed above remains inert; its outbound adapter is synthetic.
 const dispatch=async(kind)=>(await scalar('select public.dispatch_ghl_work($1) id',[kind])).id
 assert.equal(await dispatch('appointments'),null)
 await assert.rejects(db.query('select public.set_ghl_scheduler(true)'),/credential/)
 await sql("insert into vault.decrypted_secrets(id,decrypted_secret,name) values(gen_random_uuid(),'synthetic-scheduler-only','sop_work_cron_secret')")
 await db.query('select public.set_ghl_scheduler(true)')
 assert.ok(await dispatch('appointments'))
 assert.equal(await dispatch('appointments'),null,'Prevent overlapping ticks inside the dispatch cooldown')
 assert.equal(await dispatch('oauth'),null,'No request for revoked or non-due credentials')
 await db.exec("update client_portal_secure.ghl_oauth_credentials set status='active',expires_at=now()+interval '1 hour'")
 assert.ok(await dispatch('oauth'))
 assert.equal((await scalar('select count(*)::int n from cron.fixture_jobs')).n,2)
 assert.equal((await scalar('select count(*)::int n from net.fixture_requests')).n,2)
 await db.query('select public.set_ghl_scheduler(false)')
 assert.equal(await dispatch('appointments'),null)
 for(const role of ['anon','authenticated','service_role']){
  assert.equal((await scalar("select has_function_privilege($1,'public.ghl_appointment_automation(text,jsonb)','EXECUTE') allowed",[role])).allowed,role==='service_role')
  assert.equal((await scalar("select has_function_privilege($1,'public.read_ghl_appointment_summary(text,text,text)','EXECUTE') allowed",[role])).allowed,role==='service_role')
  for(const table of ['profiles','inbox','snapshots','versions','links','outbox'])assert.equal((await scalar(`select has_table_privilege($1,'client_portal_secure.ghl_appointment_${table}','SELECT') allowed`,[role])).allowed,false)
 }
 await (await import('./ghl-sql-growth.mjs')).checkGhlGrowth(db)
 await (await import('./validate-whatsapp-template-evidence-sql.mjs')).validateTemplateEvidenceFixture(db,w,r)
 await db.exec("select set_config('request.jwt.claims','{\"role\":\"authenticated\"}',false)")
 assert.equal((await rpc('claim_events')).failure,'access')
 assert.equal((await summary(token)).failure,'access')
 console.log('PASS: disabled defaults, service-only access, durable dedup, leases, CAS, stale events, retained versions, scoped/revoked links, reminders, supersession, consent/approval/pending-event dispatch gates, lost-ack non-retry, receipt monotonicity, reconciliation and connection fencing.')
} catch(error) { console.error(error.message, error.where ?? '', error.stack?.split('\n').filter(line=>line.includes('scripts/')).join('\n') ?? ''); process.exitCode=1 } finally {await db.close()}
