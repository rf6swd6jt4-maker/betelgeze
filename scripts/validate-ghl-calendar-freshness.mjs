import assert from 'node:assert/strict'

export async function validateGhlCalendarFreshness({db,w,r,calendar,location,rpc}) {
 await db.exec('begin')
 try {
  // The fixture supplies the existing authorization adapter; the separate portal
  // SQL suite exercises the real session authorization implementation.
  await db.exec(`create function public.client_portal_ghl(p_session_token text,p_workspace_id uuid,p_action text default 'read') returns jsonb language plpgsql as $$ begin
   if not exists(select 1 from public.client_portal_sessions s join public.relationships r on r.id=s.relationship_id join public.workspaces w on w.id=s.workspace_id where s.session_token=p_session_token and s.workspace_id=p_workspace_id and s.status='active' and s.token_revoked_at is null and r.status<>'archived' and w.status='active') then return jsonb_build_object('failure','access');end if;
   return jsonb_build_object('connected',true);end $$;`)
  const read=async(action,month='2026-10',id=calendar,op=null,snapshot=null,token='a'.repeat(64))=>(await db.query('select public.client_portal_ghl_calendar_v2($1,$2,$3,$4,$5,$6,$7,$8) r',[token,w,action,op,month,id,snapshot,null])).rows[0].r
  const queue=async(action,input={})=>(await db.query('select public.ghl_portal_calendar_refresh($1,$2::jsonb) r',[action,JSON.stringify(input)])).rows[0].r
  const detail=async(id)=>(await db.query('select public.read_client_portal_ghl_appointment($1,$2,$3,$4) r',['a'.repeat(64),w,calendar,id])).rows[0].r
  const provider={source:'booking-calendar',calendarId:calendar,companyId:'company123456789',owner:{id:calendar,name:'Consultations'},month:'2026-10',timezone:'America/Chicago',events:[{id:'portalappointment123',title:'Provider title',kind:'appointment',start:'2026-10-22T13:00:00.000Z',end:'2026-10-22T14:00:00.000Z',allDay:false,status:'confirmed'}]}
  assert.equal((await read('read')).snapshot,null)
  assert.equal((await read('request')).queued,true)
  const flags=(await db.query('select detection_enabled,sending_enabled,portal_sync_enabled from client_portal_secure.ghl_appointment_profiles where relationship_id=$1',[r])).rows[0]
  assert.equal(flags.sending_enabled,false);assert.equal(flags.portal_sync_enabled,true)
  const job=(await queue('claim')).job
  assert.equal(job.mode,'refresh');assert.equal((await queue('claim')).job,null,'One lease owns the range')
  assert.equal((await queue('finish',{...job,snapshot:provider})).accepted,true)
  assert.equal((await read('read')).snapshot.events[0].title,'Provider title')
  assert.equal((await read('read','2026-11')).snapshot,null,'Last saved October is not November coverage')
  assert.equal(JSON.stringify(await read('read')).includes('fixture-private-token'),false)
  const hydration=(await queue('claim')).job
  assert.equal(hydration.mode,'hydrate');assert.equal((await queue('hydrate',hydration)).queued,1)
  const event=(await rpc('claim_events',{appointmentId:'portalappointment123',locationId:location,limit:1})).items[0]
  assert.equal(event.payload.baseline,true,'Portal hydration is always a silent baseline')
  assert.equal(event.payload.baselineBefore,undefined,'An old profile creation/activation date cannot turn portal hydration into a new-booking notice')
  const context=await rpc('event_context',{id:event.id,leaseToken:event.leaseToken})
  const snapshot={id:'portalappointment123',locationId:location,calendarId:calendar,calendarName:'Consultations',contactId:'contact123',contactName:'Alex',title:'Canonical title',startTime:provider.events[0].start,endTime:provider.events[0].end,timezone:'America/Chicago',status:'confirmed',contactDetails:'private contact',meetingDetails:'Office',bookingDetails:'Booking',sourceUpdatedAt:'2026-10-21T22:00:00Z',observedAt:'2026-10-21T22:00:00Z',deleted:false,details:{private:'Must not appear in calendar'}}
  const applied=await rpc('apply_event',{id:event.id,leaseToken:event.leaseToken,expectedVersion:context.current?.version??0,snapshot,sourceUpdatedAt:snapshot.sourceUpdatedAt,kinds:[]})
  assert.equal(applied.applied,true)
  const view=await read('read');assert.deepEqual(view.snapshot.events,provider.events,'Calendar rows retain the provider check boundary without per-row detail reads')
  assert.equal((await detail(snapshot.id)).snapshot.title,'Canonical title');assert.equal((await detail(snapshot.id)).version,applied.version)
  assert.equal(JSON.stringify(view).includes('private'),false,'Calendar rows exclude all enriched and contact content')
  assert.equal((await db.query('select count(*)::int n from client_portal_secure.ghl_appointment_outbox where appointment_id=$1',[snapshot.id])).rows[0].n,0,'Baseline hydration creates no notifications')
  await db.exec('savepoint unchanged_all_day')
  await db.query("update client_portal_secure.ghl_calendar_ranges set snapshot=jsonb_set(snapshot,'{events,0,allDay}','true') where relationship_id=$1 and month='2026-10'",[r])
  assert.equal((await read('read')).snapshot.events[0].allDay,true,'An unchanged appointment preserves the provider all-day flag')
  await db.exec('rollback to unchanged_all_day;savepoint unavailable_details')
  await db.query('update client_portal_secure.ghl_appointment_profiles set connection_revision=gen_random_uuid() where relationship_id=$1',[r])
  await db.query("update workspaces set custom_client_portal_domain_status='pending' where id=$1",[w])
  await db.query('select client_portal_secure.save_ghl_calendar_range(c,$2::jsonb,now()) from client_portal_secure.ghl_connections c where relationship_id=$1',[r,JSON.stringify(provider)])
  assert.equal((await read('read')).snapshot.detailsUnavailable,true,'Refresh saves an explicit unavailable-details state when setup is unavailable')
  assert.equal((await read('read')).error,'portal_setup')
  assert.equal((await db.query("select hydration_pending from client_portal_secure.ghl_calendar_ranges where relationship_id=$1 and month='2026-10'",[r])).rows[0].hydration_pending,false,'Unavailable portal setup cannot strand a hydration job')
  await db.exec('rollback to unavailable_details')
  await rpc('ingest',{locationId:location,calendarId:calendar,appointmentId:snapshot.id,eventType:'AppointmentUpdate',eventKey:'portal-move',payloadHash:'c'.repeat(64),payload:{}})
  const update=(await rpc('claim_events',{appointmentId:snapshot.id,locationId:location,limit:1})).items[0]
  await rpc('apply_event',{id:update.id,leaseToken:update.leaseToken,expectedVersion:applied.version,snapshot:{...snapshot,startTime:'2026-11-22T13:00:00.000Z',endTime:'2026-11-22T14:00:00.000Z',sourceUpdatedAt:'2026-10-21T22:01:00Z'},sourceUpdatedAt:'2026-10-21T22:01:00Z',kinds:[]})
  assert.deepEqual((await read('read')).snapshot.events,provider.events,'Moved appointments remain at the last checked calendar position until provider refresh')
  assert.equal((await detail(snapshot.id)).snapshot.startTime,'2026-11-22T13:00:00.000Z','Opening a cached row loads the most recent saved appointment details immediately')
  const summary=(await db.query('select public.read_ghl_appointment_summary($1,$2,$3) r',[applied.summaryToken,'fixture','portal.example.com'])).rows[0].r
  assert.deepEqual(summary.snapshot,(await detail(snapshot.id)).snapshot,'The calendar detail and notification link use the same latest retained record')
  await read('request','2026-11');const november=(await queue('claim')).job
  await queue('finish',{...november,snapshot:{...provider,month:'2026-11',events:[]}})
  assert.equal((await read('read','2026-11')).snapshot.events.length,0,'A moved-in appointment waits for the bounded provider range refresh')
  await queue('hydrate',(await queue('claim')).job)
  await db.query("update client_portal_secure.ghl_calendar_ranges set checked_at=now()-interval '10 minutes' where relationship_id=$1 and month='2026-11'",[r])
  await read('request','2026-11');const refreshedNovember=(await queue('claim')).job
  assert.equal(refreshedNovember.mode,'refresh')
  await queue('finish',{...refreshedNovember,snapshot:{...provider,month:'2026-11',events:[{...provider.events[0],start:'2026-11-22T13:00:00.000Z',end:'2026-11-22T14:00:00.000Z'}]}})
  assert.equal((await read('read','2026-11')).snapshot.events[0].title,'Provider title','Refreshed calendar membership retains provider values; details stay on demand')
  assert.equal((await detail(snapshot.id)).snapshot.title,'Canonical title')
  for(let month=1;month<=9;month++) await read('request',`2027-${String(month).padStart(2,'0')}`)
  assert.equal((await db.query('select count(*)::int n from client_portal_secure.ghl_calendar_ranges where relationship_id=$1',[r])).rows[0].n,6,'Transient cache is bounded')
  assert.equal((await read('read','2026-10',calendar,null,null,'invalid')).failure,'access')
  assert.equal((await read('request','2026-10','outsidecalendar123')).failure,'access')
  await db.exec("update client_portal_sessions set token_revoked_at=now()")
  assert.equal((await read('read')).failure,'access')
  for(const role of ['anon','authenticated','service_role']) {
   const permissions=(await db.query("select has_table_privilege($1,'client_portal_secure.ghl_calendar_ranges','SELECT') direct,has_function_privilege($1,'public.ghl_portal_calendar_refresh(text,jsonb)','EXECUTE') execute",[role])).rows[0]
   assert.equal(permissions.direct,false);assert.equal(permissions.execute,role==='service_role')
  }
  console.log('PASS calendar freshness: scoped month coverage, durable leases, portal-only sync, silent bounded hydration/cache, cached provider rows, latest shared details on demand, setup warning, cross-month moves, revocation and no private fields')
 } finally {await db.exec('rollback')}
}
