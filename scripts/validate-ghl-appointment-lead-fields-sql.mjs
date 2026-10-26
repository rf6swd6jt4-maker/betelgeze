import assert from 'node:assert/strict'

export async function validateAppointmentLeadFields({db,rpc,profile,w,r,calendar,location}) {
 await db.exec('begin')
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0]
 const mapping=[{fieldId:'window_count',label:'How many windows?'},{fieldId:'project_timing',label:'When are you planning the project?'}]
 const mappingAt=async()=> (await one('select lead_field_mapping value from client_portal_secure.ghl_appointment_profiles where id=$1',[profile.id])).value
 try {
  assert.deepEqual(await mappingAt(),[],'Existing profiles default to no approved custom-field capture')
  const valid=async(value)=>(await one('select client_portal_secure.valid_ghl_lead_field_mapping($1::jsonb) valid',[JSON.stringify(value)])).valid
  assert.equal(await valid([]),true);assert.equal(await valid(mapping),true)
  assert.equal(await valid(Array.from({length:8},(_,i)=>({fieldId:`field_${i}`,label:'Question'}))),true)
  for(const value of [null,{},'invalid',[null],[{fieldId:'x',label:''}],[{fieldId:'x',label:' padded '}],[{fieldId:'x',label:'line\nbreak'}],[{fieldId:'bad.id',label:'Question'}],[{fieldId:'x'.repeat(161),label:'Question'}],[{fieldId:'x',label:'x'.repeat(201)}],[{fieldId:'x',label:'Question',extra:true}],[{fieldId:1,label:'Question'}],[{fieldId:'x',label:1}],[{fieldId:'x'}],[...mapping,mapping[0]],Array.from({length:9},(_,i)=>({fieldId:`field_${i}`,label:'Question'})),Array.from({length:8},(_,i)=>({fieldId:`field_${i}`,label:'界'.repeat(200)}))]) assert.equal(await valid(value),false,`Reject invalid mapping ${JSON.stringify(value).slice(0,90)}`)
  await db.exec('savepoint invalid_mapping')
  await assert.rejects(db.query('update client_portal_secure.ghl_appointment_profiles set lead_field_mapping=$1 where id=$2',[JSON.stringify([...mapping,mapping[0]]),profile.id]),/ghl_appointment_lead_field_mapping_valid/)
  await db.exec('rollback to invalid_mapping')
  assert.deepEqual(await mappingAt(),[])
  await db.query('update client_portal_secure.ghl_appointment_profiles set lead_field_mapping=$1,sending_enabled=true,sending_activated_at=now(),tested_at=now() where id=$2',[JSON.stringify(mapping),profile.id])
  await db.exec('savepoint mapping_assignment_only')
  await db.exec(`create or replace function client_portal_secure.valid_ghl_lead_field_mapping(value jsonb) returns boolean language plpgsql immutable set search_path='' as $$ begin raise exception 'mapping validation invoked';end $$`)
  await db.query("update client_portal_secure.ghl_appointment_profiles set reconcile_due_at=now()+interval '1 minute',reconcile_lease=gen_random_uuid(),reconcile_lease_until=now()+interval '2 minutes' where id=$1",[profile.id])
  await assert.rejects(db.query('update client_portal_secure.ghl_appointment_profiles set lead_field_mapping=$1::jsonb where id=$2',[JSON.stringify(mapping),profile.id]),/mapping validation invoked/)
  await db.exec('rollback to mapping_assignment_only')
  await db.exec('savepoint reviewed_mapping_scope')
  const configure=extra=>rpc('configure',{workspaceId:w,relationshipId:r,portalOrigin:'https://portal.example.com',detectionEnabled:true,...extra})
  assert.deepEqual((await configure()).profile.leadFieldMapping,mapping,'Reconfiguring the same profile preserves its reviewed mappings')
  await configure({detectionEnabled:false});assert.deepEqual((await configure()).profile.leadFieldMapping,mapping,'Reactivating the same profile preserves reviewed mappings')
  await db.query('update client_portal_secure.ghl_connections set calendar_revision=gen_random_uuid() where workspace_id=$1 and relationship_id=$2',[w,r])
  assert.deepEqual((await configure()).profile.leadFieldMapping,mapping,'Connection revision changes preserve mapping only on the same profile')
  const nextCalendar='new_reviewed_calendar'
  await db.query('update client_portal_secure.ghl_connections set selected_calendar_id=$1,selected_calendars=$2::jsonb where workspace_id=$3 and relationship_id=$4',[nextCalendar,JSON.stringify([{id:nextCalendar,name:'New calendar'}]),w,r])
  const nextCalendarProfile=(await configure()).profile
  assert.notEqual(nextCalendarProfile.id,profile.id);assert.deepEqual(nextCalendarProfile.leadFieldMapping,[],'A newly selected primary calendar requires its own reviewed mapping')
  await db.query('update client_portal_secure.ghl_connections set location_id=$1,selected_calendar_id=$2,selected_calendars=$3::jsonb where workspace_id=$4 and relationship_id=$5',['new_reviewed_location',calendar,JSON.stringify([{id:calendar,name:'Consultations'}]),w,r])
  const nextLocationProfile=(await configure()).profile
  assert.notEqual(nextLocationProfile.id,profile.id);assert.deepEqual(nextLocationProfile.leadFieldMapping,[],'A new location cannot inherit another location field IDs')
  await db.exec('rollback to reviewed_mapping_scope')
  const settings=async()=>(await one('select to_jsonb(p) value from client_portal_secure.ghl_appointment_profiles p where id=$1',[profile.id])).value
  const before=await settings()
  const projection=(await one('select client_portal_secure.ghl_appointment_profile_json(p) value from client_portal_secure.ghl_appointment_profiles p where id=$1',[profile.id])).value
  assert.deepEqual(projection.leadFieldMapping,mapping)
  const id='lead-fields-appointment',base={id,locationId:location,calendarId:calendar,calendarName:'Consultations',contactId:'lead_contact_1',contactName:'Alex',title:'Lead information',startTime:'2026-11-02T13:00:00.000Z',endTime:'2026-11-02T14:00:00.000Z',timezone:'America/Chicago',status:'confirmed',contactDetails:'alex@example.com',meetingDetails:'Office',bookingDetails:'Booking details are not configured.',sourceUpdatedAt:'2026-10-26T12:00:00.000Z',observedAt:'2026-10-26T12:00:00.000Z',deleted:false,details:{schemaVersion:1,contact:{phone:null},formSubmissionState:'unavailable'}}
  let sequence=0,version=0
  const apply=async(snapshot,kinds=[])=>{
   const accepted=await rpc('ingest',{locationId:location,calendarId:calendar,appointmentId:id,eventType:'AppointmentUpdate',eventKey:`lead-fields-${++sequence}`,payloadHash:'e'.repeat(64),payload:{baseline:true}})
   assert.equal(accepted.queued,1)
   const event=(await rpc('claim_events',{locationId:location,appointmentId:id,limit:1})).items[0]
   assert.deepEqual(event.profile.leadFieldMapping,mapping,'Event claim serializes the approved mapping')
   const context=await rpc('event_context',{id:event.id,leaseToken:event.leaseToken})
   assert.deepEqual(context.profile.leadFieldMapping,mapping,'Exact event context retains the approved mapping')
   const result=await rpc('apply_event',{id:event.id,leaseToken:event.leaseToken,expectedVersion:version,snapshot,sourceUpdatedAt:snapshot.sourceUpdatedAt,kinds})
   assert.equal(result.applied,true);version=result.version;return result
  }
  const retained=async()=>(await one('select snapshot,version from client_portal_secure.ghl_appointment_snapshots where profile_id=$1 and appointment_id=$2',[profile.id,id]))
  const history=async()=>({versions:(await db.query('select to_jsonb(v) value from client_portal_secure.ghl_appointment_versions v where profile_id=$1 and appointment_id=$2 order by version',[profile.id,id])).rows,outbox:(await db.query('select to_jsonb(o) value from client_portal_secure.ghl_appointment_outbox o where profile_id=$1 and appointment_id=$2 order by id',[profile.id,id])).rows})
  const initial=await apply(base,['added'])
  const capability=async(token=initial.summaryToken,slug='fixture',host='portal.example.com')=>(await one('select public.read_ghl_appointment_summary($1,$2,$3) value',[token,slug,host])).value
  const session=await one('select id,session_token from public.client_portal_sessions where workspace_id=$1 and relationship_id=$2',[w,r])
  const authorized=await capability()
  assert.equal(authorized.portalSessionToken,session.session_token,'Internal summary capability returns its own currently authorized portal session')
  assert.equal(authorized.relationshipId,r);assert.equal(authorized.workspaceId,w)
  assert.deepEqual(await capability(initial.summaryToken,'foreign-workspace'),{failure:'access'})
  assert.deepEqual(await capability(initial.summaryToken,'fixture','foreign.example.com'),{failure:'access'})
  assert.deepEqual(await capability('f'.repeat(64)),{failure:'access'})
  assert.deepEqual(await capability('invalid-token'),{failure:'access'})
  for(const [label,query,args] of [
   ['revoked summary link','update client_portal_secure.ghl_appointment_links set revoked_at=now() where token=$1',[initial.summaryToken]],
   ['revoked portal token','update public.client_portal_sessions set token_revoked_at=now() where id=$1',[session.id]],
   ['inactive portal session',"update public.client_portal_sessions set status='revoked' where id=$1",[session.id]],
   ['stale portal fingerprint','update public.client_portal_sessions set session_token=$1 where id=$2',['b'.repeat(64),session.id]],
   ['foreign relationship session','update public.client_portal_sessions set relationship_id=gen_random_uuid() where id=$1',[session.id]],
   ['foreign workspace session','update public.client_portal_sessions set workspace_id=gen_random_uuid() where id=$1',[session.id]],
   ['unverified portal host',"update public.workspaces set custom_client_portal_domain_status='pending' where id=$1",[w]],
   ['inactive workspace',"update public.workspaces set status='suspended' where id=$1",[w]],
   ['archived relationship',"update public.relationships set status='archived' where id=$1",[r]],
   ['foreign profile origin',"update client_portal_secure.ghl_appointment_profiles set portal_origin='https://foreign.example.com' where id=$1",[profile.id]],
  ]) {
   await db.exec('savepoint summary_authority')
   await db.query(query,args)
   assert.deepEqual(await capability(),{failure:'access'},`${label} denies all metadata, including portal-session tokens`)
   await db.exec('rollback to summary_authority')
  }
  for(const role of ['anon','authenticated']) {
   await db.exec('savepoint summary_role')
   await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role})])
   assert.deepEqual(await capability(),{failure:'access'},`${role} cannot obtain an internal portal token`)
   await db.exec('rollback to summary_role')
  }
  assert.equal((await capability()).portalSessionToken,session.session_token)
  const originalVersion=version,originalHistory=await history()
  assert.equal(originalHistory.versions.length,1);assert.equal(originalHistory.outbox.length,1)
  const lead={source:'Referral',type:'lead',capturedAt:'2026-10-26T12:01:00.000Z',fields:mapping.map((field,index)=>({...field,value:index?'Next month':'Six'}))}
  const enriched={...base,details:{...base.details,lead}}
  assert.equal((await apply(enriched)).unchanged,true)
  assert.equal(version,originalVersion);assert.deepEqual((await retained()).snapshot.details.lead,lead)
  assert.deepEqual(await history(),originalHistory,'Lead enrichment never edits versions or accepted/queued notice history')
  assert.deepEqual(await settings(),before,'Lead enrichment leaves configuration, flags, activation and recovery cursor untouched')
  await db.exec('savepoint ignored_appointment_metadata')
  const metadataOnly={...enriched,observedAt:'2026-10-26T12:03:00.000Z',sourceUpdatedAt:'2026-10-26T12:02:00.000Z',sourceCreatedAt:'2026-10-25T12:00:00.000Z'}
  assert.equal((await apply(metadataOnly)).unchanged,true,'One-pass comparison still ignores all observation/provider metadata')
  assert.equal(version,originalVersion);assert.deepEqual(await history(),originalHistory)
  await db.exec('rollback to ignored_appointment_metadata')
  for(const candidate of [base,enriched,metadataOnly,{...base,title:'Meaningful new title'},{...base,status:'cancelled'},{...base,contactId:'another-contact'},{...base,startTime:'2026-11-03T13:00:00.000Z'},{...base,addedCoreField:'meaningful'}]) {
   const result=await one(`select
    ($1::jsonb-'observedAt'-'sourceUpdatedAt'-'sourceCreatedAt'-'details'=$2::jsonb-'observedAt'-'sourceUpdatedAt'-'sourceCreatedAt'-'details') old_equal,
    ($1::jsonb-array['observedAt','sourceUpdatedAt','sourceCreatedAt','details']::text[]=$2::jsonb-array['observedAt','sourceUpdatedAt','sourceCreatedAt','details']::text[]) new_equal`,[JSON.stringify(base),JSON.stringify(candidate)])
   assert.equal(result.new_equal,result.old_equal,'One-pass key removal preserves existing meaningful object comparison')
  }
  const summary=async()=>(await one('select public.read_client_portal_ghl_appointment($1,$2,$3,$4) value',['a'.repeat(64),w,calendar,id])).value
  assert.deepEqual((await summary()).snapshot.details.lead,lead)
  // The deployed predecessor sends structured details but does not know lead.
  assert.equal((await apply(base)).unchanged,true)
  assert.deepEqual((await retained()).snapshot.details.lead,lead)
  const legacy={...base};delete legacy.details
  assert.equal((await apply(legacy)).unchanged,true)
  assert.deepEqual((await retained()).snapshot.details.lead,lead)
  const emptyLead={source:null,type:null,capturedAt:'2026-10-26T12:02:00.000Z',fields:[]}
  assert.equal((await apply({...base,details:{...base.details,lead:emptyLead}})).unchanged,true)
  assert.deepEqual((await retained()).snapshot.details.lead,emptyLead,'An explicit empty projection clears old answers')
  assert.equal((await apply({...base,details:{...base.details,lead:null}})).unchanged,true)
  assert.equal((await retained()).snapshot.details.lead,null,'An explicit null is not replaced by stale lead data')
  assert.deepEqual(await history(),originalHistory)
  await apply(enriched)
  const lease=async key=>{
   await rpc('ingest',{locationId:location,calendarId:calendar,appointmentId:id,eventType:'AppointmentUpdate',eventKey:key,payloadHash:'a'.repeat(64),payload:{baseline:true}})
   const job=(await rpc('claim_events',{locationId:location,appointmentId:id,limit:1})).items[0]
   const context=await rpc('event_context',{id:job.id,leaseToken:job.leaseToken})
   return {...job,expectedVersion:context.current.version}
  }
  // Two independently leased events read the same appointment version, then
  // the older provider request finishes after the newer one has been retained.
  const delayed=await lease('lead-delayed-provider-read'),fast=await lease('lead-fast-provider-read')
  assert.equal(delayed.expectedVersion,fast.expectedVersion)
  const latestLead={...lead,capturedAt:'2026-10-26T12:05:00.000Z',fields:[{...mapping[0],value:'Eight'}]}
  const complete=async(job,value)=>rpc('apply_event',{id:job.id,leaseToken:job.leaseToken,expectedVersion:job.expectedVersion,snapshot:{...base,details:{...base.details,lead:value}},sourceUpdatedAt:base.sourceUpdatedAt,kinds:[]})
  assert.equal((await complete(fast,latestLead)).unchanged,true)
  assert.equal((await complete(delayed,{...lead,capturedAt:'2026-10-26T12:03:00.000Z'})).unchanged,true)
  assert.deepEqual((await retained()).snapshot.details.lead,latestLead,'A delayed same-version provider result cannot roll back newer lead information')
  assert.equal(Number((await retained()).version),originalVersion);assert.deepEqual(await history(),originalHistory)
  await apply({...base,details:{...base.details,lead:{...lead,capturedAt:'2026-10-26T07:04:00.000-05:00'}}})
  assert.deepEqual((await retained()).snapshot.details.lead,latestLead,'Capture order compares actual instants, including offsets')
  await db.exec('savepoint older_lead_core_change')
  await apply({...base,title:'A real title correction',details:{...base.details,lead:{...lead,capturedAt:'2026-10-26T12:03:00.000Z'}}},['details_updated'])
  assert.equal((await retained()).snapshot.title,'A real title correction','Lead ordering must not suppress a core appointment change')
  assert.deepEqual((await retained()).snapshot.details.lead,latestLead)
  assert.equal(version,originalVersion+1)
  await db.exec('rollback to older_lead_core_change');version=originalVersion
  for(const capturedAt of ['2026-99-99T12:00:00Z','2026-99-99T12:00:00.000Z','2026-00-00T12:00:00.000Z','not-a-date','2026-10-26T12:00:00',null,123]) {
   const invalidLead={...lead,capturedAt}
   assert.equal((await apply({...base,details:{...base.details,lead:invalidLead}})).unchanged,true)
   assert.deepEqual((await retained()).snapshot.details.lead,invalidLead,'Invalid/absent timestamps are never cast or treated as dated ordering evidence')
   await apply({...base,details:{...base.details,lead:latestLead}})
  }
  const newerEmpty={...emptyLead,capturedAt:'2026-10-26T12:06:00.000Z'}
  await apply({...base,details:{...base.details,lead:newerEmpty}})
  assert.deepEqual((await retained()).snapshot.details.lead,newerEmpty,'A newer explicit empty projection clears older answers')
  await apply({...base,details:{...base.details,lead:null}})
  assert.equal((await retained()).snapshot.details.lead,null,'An explicit null clear remains authoritative')
  assert.deepEqual(await history(),originalHistory)
  await apply(enriched)
  for(const oldCaller of [base,legacy]) {
   await db.exec('savepoint previous_connection_lead')
   await db.query('update client_portal_secure.ghl_appointment_snapshots set connection_revision=gen_random_uuid() where profile_id=$1 and appointment_id=$2',[profile.id,id])
   await apply(oldCaller)
   assert.equal((await retained()).snapshot.details.lead,undefined,'The same contact ID on a new connection cannot inherit prior lead qualification')
   assert.deepEqual((await retained()).snapshot.details.contact,base.details.contact,'Existing non-lead detail compatibility remains intact')
   await db.exec('rollback to previous_connection_lead');version=originalVersion
  }
  await apply({...base,contactId:'lead_contact_2'})
  assert.equal((await retained()).snapshot.details.lead,undefined,'A pre-lead worker cannot carry qualification across a changed contact')
  await apply({...enriched,contactId:'lead_contact_2'})
  await apply({...legacy,contactId:'lead_contact_3'})
  assert.equal((await retained()).snapshot.details.lead,undefined,'A legacy worker without any details cannot carry qualification across a changed contact')
  await apply({...enriched,contactId:'lead_contact_3'})
  await apply({...legacy,contactId:''})
  assert.equal((await retained()).snapshot.details.lead,undefined,'An absent contact cannot inherit retained lead information')
  assert.deepEqual(await settings(),before)
  for(const role of ['anon','authenticated','service_role']) assert.equal((await one("select has_function_privilege($1,'client_portal_secure.valid_ghl_lead_field_mapping(jsonb)','EXECUTE') allowed",[role])).allowed,false)
  console.log('PASS approved lead fields: bounded/unique/strict configuration, shared worker serialization, same-version latest enrichment, immutable versions/outbox, unchanged flags/settings, omitted/explicit empty compatibility, delayed same-version capture ordering, contact/revision-swap clearing, authorized same-client internal portal token and revoked/stale/foreign scope denial')
 } finally {await db.exec('rollback')}
}
