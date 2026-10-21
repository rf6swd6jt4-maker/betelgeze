import assert from 'node:assert/strict'

/** Native PostgreSQL only: committed synthetic rows and independent sessions.
 * The fixture owns its socket-only disposable cluster; never accepts a DB URL. */
export async function validateGhlPortalConcurrency({db,profile,r,calendar,location}) {
 if(!db.connect) return
 const a=await db.connect(),b=await db.connect(),month='2039-12',appointment='native-notes-concurrency'
 const one=async(sql,params=[])=>(await db.query(sql,params)).rows[0]
 const original=(await one('select include_notes,portal_sync_enabled from client_portal_secure.ghl_appointment_profiles where id=$1',[profile.id]))
 const connection=(await one('select calendar_revision from client_portal_secure.ghl_connections where relationship_id=$1',[r])).calendar_revision
 const range=(client,action,input={})=>client.query('select public.ghl_portal_calendar_refresh($1,$2::jsonb) result',[action,JSON.stringify(input)]).then(result=>result.rows[0].result)
 const notes=(client,action,input={})=>client.query('select public.ghl_appointment_note_enrichment($1,$2::jsonb) result',[action,JSON.stringify(input)]).then(result=>result.rows[0].result)
 try {
  await db.query('insert into client_portal_secure.ghl_calendar_ranges(relationship_id,calendar_id,month,revision) values($1,$2,$3,$4)',[r,calendar,month,connection])
  await a.query('begin')
  const first=(await range(a,'claim')).job
  assert.equal(first.month,month)
  assert.equal((await range(b,'claim')).job,null,'SKIP LOCKED must not claim a range held by another transaction')
  await a.query('commit')
  await b.query('begin')
  await b.query("select pg_advisory_xact_lock(hashtextextended('portal-ghl:'||$1::text,0))",[r])
  await b.query('update client_portal_secure.ghl_connections set calendar_revision=gen_random_uuid() where relationship_id=$1',[r])
  const oldRange=range(a,'fail',{...first,error:'unavailable'})
  await db.waitLock(a)
  await b.query('commit')
  assert.equal((await oldRange).failure,'lease','An old worker cannot modify the range after connection rotation wins the lock')
  await db.query('update client_portal_secure.ghl_connections set calendar_revision=$1 where relationship_id=$2',[connection,r])
  await db.query('update client_portal_secure.ghl_appointment_profiles set include_notes=true,portal_sync_enabled=true where id=$1',[profile.id])
  const snapshot={id:appointment,locationId:location,calendarId:calendar,title:'Synthetic notes fixture',startTime:'2039-12-01T09:00:00.000Z',endTime:'2039-12-01T10:00:00.000Z',deleted:false}
  await db.query('insert into client_portal_secure.ghl_appointment_snapshots(profile_id,appointment_id,version,connection_revision,snapshot) values($1,$2,1,$3,$4::jsonb)',[profile.id,appointment,connection,JSON.stringify(snapshot)])
  await db.query('select client_portal_secure.queue_ghl_appointment_notes($1,$2,now())',[profile.id,appointment])
  await a.query('begin')
  const firstNote=(await notes(a,'claim')).job
  assert.equal(firstNote.appointmentId,appointment)
  assert.equal((await notes(b,'claim')).job,null,'Two sessions cannot own the same note page')
  await a.query('commit')
  await b.query('begin')
  await b.query('update client_portal_secure.ghl_connections set calendar_revision=gen_random_uuid() where relationship_id=$1',[r])
  const oldNotes=notes(a,'finish',{...firstNote,notes:[{id:'note-native',body:'Synthetic staff-only note',userId:null,createdAt:null,updatedAt:null}],hasMore:false,nextOffset:1})
  await db.waitLock(a)
  await b.query('commit')
  assert.equal((await oldNotes).failure,'changed','A pending note response must recheck the newly committed connection revision')
  assert.equal((await one('select count(*)::int count from client_portal_secure.ghl_appointment_notes where appointment_id=$1',[appointment])).count,0)
  console.log('PASS native PostgreSQL: independent competing range and notes claims, observed lock waits, connection rotation fences stale range and note responses')
 } finally {
  await Promise.allSettled([a.query('rollback'),b.query('rollback')])
  await db.query('update client_portal_secure.ghl_connections set calendar_revision=$1 where relationship_id=$2',[connection,r])
  await db.query('update client_portal_secure.ghl_appointment_profiles set include_notes=$1,portal_sync_enabled=$2 where id=$3',[original.include_notes,original.portal_sync_enabled,profile.id])
  await db.query('delete from client_portal_secure.ghl_appointment_note_jobs where profile_id=$1 and appointment_id=$2',[profile.id,appointment])
  await db.query('delete from client_portal_secure.ghl_appointment_snapshots where profile_id=$1 and appointment_id=$2',[profile.id,appointment])
  await db.query('delete from client_portal_secure.ghl_calendar_ranges where relationship_id=$1 and calendar_id=$2 and month=$3',[r,calendar,month])
 }
}
