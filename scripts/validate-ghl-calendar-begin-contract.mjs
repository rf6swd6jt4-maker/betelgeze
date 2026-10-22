import assert from 'node:assert/strict'

// Exercise the actual installed legacy owner and wrapper, not a fabricated RPC
// response. Everything is synthetic and rolled back, including manual leases.
export async function validateGhlCalendarBeginContract({db,w,r,calendar,location,corrected}) {
 await db.exec('begin')
 try {
  await db.exec(`create function public.client_portal_ghl(p_session_token text,p_workspace_id uuid,p_action text default 'read') returns jsonb language plpgsql as $$ begin
   if not exists(select 1 from public.client_portal_sessions s join public.relationships r on r.id=s.relationship_id join public.workspaces w on w.id=s.workspace_id where s.session_token=p_session_token and s.workspace_id=p_workspace_id and s.status='active' and s.token_revoked_at is null and r.status<>'archived' and w.status='active') then return jsonb_build_object('failure','access');end if;
   return jsonb_build_object('connected',true);end $$;`)
  const token='a'.repeat(64),op='00000000-0000-4000-8000-000000000101'
  const call=async(owner,action,{operation=op,month='2026-10',id=calendar,snapshot=null,session=token,error=null}={})=>(await db.query(`select public.${owner}($1,$2,$3,$4,$5,$6,$7,$8) result`,[session,w,action,operation,month,id,snapshot,error])).rows[0].result
  const legacy=(action,input)=>call('client_portal_ghl_calendar',action,input)
  const portal=(action,input)=>call('client_portal_ghl_calendar_v2',action,input)
  await db.exec('savepoint legacy_contract')
  const expected=await legacy('begin')
  assert.deepEqual(Object.keys(expected).sort(),['binding','locationId','privateToken'])
  assert.equal(expected.locationId,location);assert.equal(expected.privateToken,'fixture-private-token')
  assert.equal(expected.binding.calendarId,calendar)
  assert.equal(expected.revision,undefined);assert.equal(expected.calendars,undefined)
  await db.exec('rollback to legacy_contract')
  if(!corrected) {
   assert.deepEqual(await portal('begin'),{failure:'changed'},'Baseline reproduces the production rejection for the real credential-only begin response')
   console.log('PASS calendar begin baseline: real legacy response reproduces false connection-changed rejection')
   return
  }
  assert.equal((await portal('begin',{session:'invalid'})).failure,'access')
  assert.equal((await portal('begin',{month:'invalid'})).failure,'response')
  assert.equal((await portal('begin',{id:'outsidecalendar123'})).failure,'access')
  await db.query('update client_portal_secure.ghl_appointment_profiles set sending_enabled=true,sending_activated_at=now(),tested_at=now(),include_notes=true where relationship_id=$1',[r])
  const settings=async()=>(await db.query('select detection_enabled,sending_enabled,sending_activated_at,tested_at,include_notes,reminder_minutes from client_portal_secure.ghl_appointment_profiles where relationship_id=$1',[r])).rows
  const before=await settings()
  assert.deepEqual(await portal('begin'),expected,'Wrapper accepts exactly the legacy credential-only payload')
  assert.equal((await portal('begin',{operation:'00000000-0000-4000-8000-000000000102'})).failure,'busy')
  const snapshot={source:'booking-calendar',calendarId:calendar,companyId:'company123456789',owner:{id:calendar,name:'Consultations'},month:'2026-10',timezone:'America/Chicago',events:[{id:'manualappointment123',title:'Manual provider result',kind:'appointment',start:'2026-10-22T13:00:00.000Z',end:'2026-10-22T14:00:00.000Z',allDay:false,status:'confirmed'}]}
  assert.equal((await portal('finish',{operation:'00000000-0000-4000-8000-000000000102',month:null,id:null,snapshot})).failure,'changed','Another operation cannot finish the lease')
  await db.exec('savepoint changed_connection')
  await db.query('update client_portal_secure.ghl_connections set calendar_revision=gen_random_uuid() where relationship_id=$1',[r])
  assert.equal((await portal('finish',{month:null,id:null,snapshot})).failure,'changed','A real connection change still rejects the stale provider response')
  assert.equal((await db.query('select count(*)::int n from client_portal_secure.ghl_calendar_ranges where relationship_id=$1',[r])).rows[0].n,0)
  await db.exec('rollback to changed_connection')
  const finished=await portal('finish',{month:null,id:null,snapshot})
  assert.equal(finished.failure,undefined);assert.deepEqual(finished.snapshot.events,snapshot.events)
  assert.equal(finished.detailsPending,true,'Manual refresh durably schedules rich details hydration')
  assert.equal(JSON.stringify(finished).includes('fixture-private-token'),false)
  assert.deepEqual(await settings(),before,'Manual refresh preserves existing sending, consent and notification settings')
  assert.equal((await portal('begin')).failure,'cooldown','Existing retry pacing remains intact')
  await db.query("update client_portal_secure.ghl_calendar_snapshots set attempted_at=now()-interval '1 minute' where relationship_id=$1",[r])
  assert.deepEqual(await portal('begin'),expected)
  const failed=await portal('fail',{month:null,id:null,error:'permissions'})
  assert.equal(failed.failure,undefined);assert.equal(failed.error,'permissions');assert.deepEqual(failed.snapshot.events,snapshot.events)
  const cache=(await db.query('select operation_id,lease_until from client_portal_secure.ghl_calendar_snapshots where relationship_id=$1',[r])).rows[0]
  assert.equal(cache.operation_id,null);assert.equal(cache.lease_until,null)
  assert.equal((await portal('read')).privateToken,undefined)
  for(const role of ['anon','authenticated','service_role']) assert.equal((await db.query("select has_function_privilege($1,'public.client_portal_ghl_calendar_v2(text,uuid,text,uuid,text,text,jsonb,text)','EXECUTE') allowed",[role])).rows[0].allowed,role==='service_role')
  console.log('PASS corrected manual calendar: real begin/finish/fail, saved range and hydration, unchanged sending/settings, access/calendar/input checks, cooldown, wrong operation and changed revision fences, credentials exclusion')
 } finally {await db.exec('rollback')}
}
