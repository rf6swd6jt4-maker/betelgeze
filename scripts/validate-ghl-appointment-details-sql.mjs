import assert from 'node:assert/strict'

export async function validateAppointmentDetails({db,rpc,profile,w,r,calendar,location}) {
 const id='shared-detail-appointment',token='a'.repeat(64)
 const one=async(sql,params=[])=>(await db.query(sql,params)).rows[0]
 const read=async(appointment=id,cal=calendar,session=token,workspace=w)=>(await one('select public.read_client_portal_ghl_appointment($1,$2,$3,$4) value',[session,workspace,cal,appointment])).value
 const notes=async(action,input={})=>(await one('select public.ghl_appointment_note_enrichment($1,$2::jsonb) value',[action,JSON.stringify(input)])).value
 await db.exec('begin')
 try {
  await db.query('update client_portal_secure.ghl_appointment_profiles set detection_enabled=false,portal_sync_enabled=true,include_notes=true where id=$1',[profile.id])
  const snapshot={id,locationId:location,calendarId:calendar,calendarName:'Consultations',contactId:'contact123',contactName:'Alex',title:'Shared detail',startTime:'2026-10-22T13:00:00.000Z',endTime:'2026-10-22T14:00:00.000Z',timezone:'America/Chicago',status:'confirmed',contactDetails:'contact@example.com',meetingDetails:'Office',bookingDetails:'Allowed legacy booking text',sourceUpdatedAt:'2026-10-21T22:00:00.000Z',observedAt:'2026-10-21T22:00:00.000Z',deleted:false,details:{schemaVersion:1,contact:{phone:'+12025550123'},booking:{text:'Allowed legacy booking text',state:'available'}}}
  assert.equal((await read()).failure,'not_retained')
  await rpc('ingest',{locationId:location,calendarId:calendar,appointmentId:id,eventType:'AppointmentCreate',eventKey:'shared-details-baseline',payloadHash:'d'.repeat(64),payload:{baseline:true}})
  const event=(await rpc('claim_events',{appointmentId:id,locationId:location,limit:1})).items[0]
  assert(event,'Portal synchronization can hydrate without notification detection')
  const outcome=await rpc('apply_event',{id:event.id,leaseToken:event.leaseToken,expectedVersion:0,snapshot,sourceUpdatedAt:snapshot.sourceUpdatedAt,kinds:[]})
  assert.equal(outcome.applied,true)
  const retained=await read()
  assert.equal(retained.snapshot.title,'Shared detail');assert.equal(retained.snapshot.details.contact.phone,'+12025550123')
  assert.equal(retained.snapshot.bookingDetails,'Allowed legacy booking text')
  const enrich=async(next,key)=>{
   await rpc('ingest',{locationId:location,calendarId:calendar,appointmentId:id,eventType:'AppointmentUpdate',eventKey:key,payloadHash:'f'.repeat(64),payload:{baseline:true}})
   const job=(await rpc('claim_events',{appointmentId:id,locationId:location,limit:1})).items[0]
   return rpc('apply_event',{id:job.id,leaseToken:job.leaseToken,expectedVersion:outcome.version,snapshot:next,sourceUpdatedAt:next.sourceUpdatedAt,kinds:[]})
  }
  const legacySnapshot={...snapshot};delete legacySnapshot.details
  assert.equal((await enrich(legacySnapshot,'legacy-detail-caller')).version,outcome.version)
  assert.deepEqual((await read()).snapshot.details,snapshot.details,'An old caller without details cannot erase retained enrichment')
  const updatedDetails={...snapshot.details,contact:{phone:null,email:'new@example.com'}}
  assert.equal((await enrich({...snapshot,details:updatedDetails},'new-detail-caller')).version,outcome.version)
  assert.deepEqual((await read()).snapshot.details,updatedDetails,'An explicit new details object remains authoritative, including nulls')
  assert.equal((await one('select count(*)::int count from client_portal_secure.ghl_appointment_outbox where profile_id=$1 and appointment_id=$2',[profile.id,id])).count,0,'Baseline detail hydration never sends')
  for(const params of [[id,'other-calendar'],['other-appointment',calendar],[id,calendar,'b'.repeat(64)],[id,calendar,token,r]]) assert((await read(...params)).failure)
  await db.exec('update client_portal_sessions set token_revoked_at=now()')
  assert.equal((await read()).failure,'access')
  await db.exec('update client_portal_sessions set token_revoked_at=null')
  const job=(await notes('claim')).job
  assert.equal(job.appointmentId,id);assert.equal(job.offset,0)
  assert.equal((await notes('claim')).job,null,'Only one lease owns the optional note page')
  const identity={profileId:job.profileId,appointmentId:job.appointmentId,connectionRevision:job.connectionRevision,leaseToken:job.leaseToken}
  const page=Array.from({length:5},(_,index)=>({id:`note-${index}`,body:`Internal-only note ${index}\n`+'x'.repeat(64000),userId:'staff123',createdAt:null,updatedAt:null}))
  assert.equal((await notes('finish',{...identity,notes:page,hasMore:true,nextOffset:5})).applied,true)
  assert.equal((await notes('finish',{...identity,notes:page,hasMore:true,nextOffset:5})).failure,'changed','Completed lease cannot be reused')
  const next=(await notes('claim')).job;assert.equal(next.offset,5)
  assert.equal((await notes('finish',{...next,notes:[],hasMore:false,nextOffset:5})).applied,true)
  assert.equal((await one('select count(*)::int count from client_portal_secure.ghl_appointment_notes where profile_id=$1',[profile.id])).count,5)
  assert.equal(JSON.stringify(await read()).includes('Internal-only'),false,'No client detail read joins the staff notes table')
  assert.equal(JSON.stringify((await one('select public.read_ghl_appointment_summary($1,$2,$3) value',[outcome.summaryToken,'fixture','portal.example.com'])).value).includes('Internal-only'),false,'Summary capability never includes staff notes')
  await db.query("update client_portal_secure.ghl_appointment_note_jobs set due_at=now()-interval '2 days' where profile_id=$1",[profile.id])
  await db.query('select client_portal_secure.queue_ghl_appointment_notes($1,$2,$3)',[profile.id,id,snapshot.sourceUpdatedAt])
  const revised=(await notes('claim')).job
  assert.equal((await notes('finish',{...revised,notes:[{...page[0],body:'Revised internal content'}],hasMore:false,nextOffset:1})).applied,true)
  assert.equal((await one('select count(*)::int count from client_portal_secure.ghl_appointment_note_versions where profile_id=$1 and note_id=$2',[profile.id,'note-0'])).count,2,'Earlier note content is retained')
  assert.equal((await one('select count(*)::int count from client_portal_secure.ghl_appointment_notes where profile_id=$1',[profile.id])).count,5,'List omission is never interpreted as deletion')
  await db.query('update client_portal_secure.ghl_appointment_profiles set include_notes=false where id=$1',[profile.id])
  assert.equal((await read()).snapshot.details.booking.text,null)
  const hidden=(await one('select public.read_ghl_appointment_summary($1,$2,$3) value',[outcome.summaryToken,'fixture','portal.example.com'])).value
  assert.equal(hidden.snapshot.details.booking.text,null,'Current sharing preference applies to old links')
  assert.equal((await notes('claim')).job,null)
  for(const role of ['anon','authenticated','service_role']) {
   const grants=await one("select has_table_privilege($1,'client_portal_secure.ghl_appointment_notes','SELECT') direct,has_function_privilege($1,'public.ghl_appointment_note_enrichment(text,jsonb)','EXECUTE') execute,has_function_privilege($1,'public.read_client_portal_ghl_appointment(text,uuid,text,text)','EXECUTE') portal",[role])
   assert.equal(grants.direct,false);assert.equal(grants.execute,role==='service_role');assert.equal(grants.portal,role==='service_role')
  }
  await db.query('update client_portal_secure.ghl_connections set calendar_revision=gen_random_uuid() where relationship_id=$1',[r])
  assert((await read()).failure,'Reconnection cannot read a previous connection as current')
  console.log('PASS shared appointment details: sending-independent hydration, session/calendar/revision/revocation scope, same summary, private note isolation, bounded leases, note history and no inferred deletion')
 } finally {await db.exec('rollback')}
}
