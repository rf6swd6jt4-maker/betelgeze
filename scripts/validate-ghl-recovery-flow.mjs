// Exercised by the native PostgreSQL automation fixture. No external network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { generateKeyPairSync, sign } from 'node:crypto'
const require=createRequire(import.meta.url), cache=new Map()
const ts=require(require.resolve('typescript',{paths:[process.cwd(),process.env.BE_PGLITE_ROOT||process.cwd()]}))
function load(path){
 if(cache.has(path))return cache.get(path)
 const compiled={exports:{}}
 const code=ts.transpileModule(readFileSync(new URL(`../lib/${path}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 new Function('require','module','exports',code)(id=>id.startsWith('../client-portal/')?load(`client-portal/${id.split('/').pop()}`):id.startsWith('./')?load(`ghl-appointments/${id.slice(2)}`):require(id),compiled,compiled.exports)
 cache.set(path,compiled.exports);return compiled.exports
}
export async function validateGhlRecoveryFlow({db,rpc,profile,w,r,calendar,location}){
 await db.exec('begin')
 try{
 const provider=load('ghl-appointments/provider'),worker=load('ghl-appointments/worker'),webhook=load('ghl-appointments/webhook'),templates=load('ghl-appointments/templates')
 const clock=new Date(),id='e2e_appointment', contact='e2e_contact'
 let appointment={id,locationId:location,calendarId:calendar,contactId:contact,title:'Isolated notification demo',startTime:new Date(+clock+86400000).toISOString(),endTime:new Date(+clock+90000000).toISOString(),dateAdded:clock.toISOString(),dateUpdated:clock.toISOString(),appointmentStatus:'confirmed',deleted:false}
 const fetcher=async input=>{
  const url=new URL(String(input)),p=url.pathname
  const body=p.startsWith('/locations/')?{location:{id:location,timezone:'America/Chicago'}}:p.includes('/appointments/')?{appointment}:p==='/calendars/events'?{events:[appointment]}:p.startsWith('/contacts/')?{contact:{id:contact,locationId:location,firstName:'Test',lastName:'Contact'}}:{calendar:{id:calendar,locationId:location,name:'Consultations'}}
  return Response.json(body)
 }
 const sends=[]
 const checkedRpc=async(action,input)=>{const result=await rpc(action,input);if(result.failure)throw new Error(`${action}:${result.failure}`);return result}
 const delivery={rpc:checkedRpc,now:()=>new Date(),sendingEnabled:()=>true,fetchAppointment:(p,id)=>provider.fetchAppointment(p,id,fetcher),liveTemplate:async(_w,kind)=>{
  const c=templates.appointmentTemplateContracts[kind];return{id:c.id,name:c.name,language:c.language,status:'APPROVED',category:'UTILITY',parameter_format:'POSITIONAL',message_send_ttl_seconds:c.ttlSeconds,components:[{type:'BODY',text:c.body},{type:'BUTTONS',buttons:[{type:'URL',text:'View appointment',url:'https://portal.scaylup.com/appointment/{{1}}'}]}]}
 },sendTemplate:async input=>{sends.push(input);return{messages:[{id:`wamid.fixture.${sends.length}`}]} }}
 const deps={rpc:checkedRpc,now:()=>new Date(),detectionEnabled:()=>true,delivery,fetchAppointment:delivery.fetchAppointment,fetchCalendarWindow:(p,v)=>provider.fetchCalendarWindow(p,v,fetcher),fetchCalendarChanges:(p,v)=>provider.fetchCalendarChanges(p,v,fetcher)}
 await db.query("update workspaces set custom_client_portal_domain='portal.scaylup.com' where id=$1",[w])
 await db.query("update client_portal_secure.ghl_appointment_profiles set portal_origin='https://portal.scaylup.com',detection_enabled=true,sending_enabled=true,tested_at=now(),created_at=now()-interval '1 day',sending_activated_at=now()-interval '1 minute',reconcile_due_at=now(),reconcile_cursor=$1::jsonb where id=$2",[JSON.stringify({version:1,phase:'window',windowStart:'2026-12-08T00:00:00Z',horizonEnd:'2027-01-19T00:00:00Z',baseline:true,cycleId:clock.toISOString(),knownCycleId:clock.toISOString()}),profile.id])
 const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString()
 const accept=async(type,key)=>{
  const raw=JSON.stringify({type,locationId:location,webhookId:key,appointment})
  return webhook.handleGhlAppointmentWebhook(new Request('https://fixture/api/integrations/calendar/events',{method:'POST',headers:{'x-ghl-signature':sign(null,Buffer.from(raw),keys.privateKey).toString('base64')},body:raw}),{enabled:true,publicKey,ingest:event=>checkedRpc('ingest',event)})
 }
 assert.equal((await accept('AppointmentCreate','fixture-created')).status,202)
 assert.equal((await worker.runGhlAppointmentAutomation(deps,{locationId:location,appointmentId:id})).accepted,1)
 assert.equal(sends.length,1)
 assert.equal((await accept('AppointmentCreate','fixture-created')).status,202)
 await worker.runGhlAppointmentAutomation(deps,{locationId:location,appointmentId:id});assert.equal(sends.length,1)
 // Adding creation metadata to a retained pre-release snapshot must not create
 // a new version and supersede an already queued business notification.
 await db.query("update client_portal_secure.ghl_appointment_snapshots set snapshot=snapshot-'sourceCreatedAt' where appointment_id=$1",[id])
 const priorVersion=(await db.query('select version from client_portal_secure.ghl_appointment_snapshots where appointment_id=$1',[id])).rows[0].version
 await accept('AppointmentUpdate','creation-metadata');await worker.runGhlAppointmentAutomation(deps,{locationId:location,appointmentId:id})
 assert.equal((await db.query('select version from client_portal_secure.ghl_appointment_snapshots where appointment_id=$1',[id])).rows[0].version,priorVersion)
 appointment={...appointment,appointmentStatus:'cancelled',dateUpdated:new Date(+clock+1000).toISOString()}
 await accept('AppointmentUpdate','fixture-cancelled');assert.equal((await worker.runGhlAppointmentAutomation(deps,{locationId:location,appointmentId:id})).accepted,1)
 assert.equal(sends.length,2)
 const messages=(await db.query("select automation_kind,status from client_messages where relationship_id=$1 order by automation_kind",[r])).rows
 assert.deepEqual(messages,[{automation_kind:'ghl_appointment_added',status:'sent'},{automation_kind:'ghl_appointment_cancelled',status:'sent'}])
 // No webhook: a fresh booking tomorrow is found despite the December sweep cursor.
 appointment={...appointment,id:'fallback_new',appointmentStatus:'confirmed'}
 const fallback=await worker.runGhlAppointmentAutomation(deps)
 assert.equal(fallback.accepted,1);assert.equal(sends.length,3)
 // A later webhook for the same booking cannot produce a duplicate message.
 await accept('AppointmentCreate','late-webhook');await worker.runGhlAppointmentAutomation(deps,{locationId:location,appointmentId:appointment.id});assert.equal(sends.length,3)
 // The comparison is lease-bound, calendar-scoped and bounded to five changes.
 await db.query("update client_portal_secure.ghl_appointment_profiles set reconcile_due_at=now() where id=$1",[profile.id])
 const lease=(await checkedRpc('claim_reconciliations',{limit:1})).items[0]
 const observations=await provider.fetchCalendarChanges({...profile,privateToken:'fixture-private-token'},{start:new Date(+clock-86400000).toISOString(),end:new Date(+clock+2*86400000).toISOString()},fetcher)
 assert.equal((await checkedRpc('reconciliation_changes',{profileId:profile.id,leaseToken:lease.leaseToken,calendarId:calendar,observations})).items.length,0,'Unchanged bookings cause no detail fetch')
 assert.equal((await rpc('reconciliation_changes',{profileId:profile.id,leaseToken:lease.leaseToken,calendarId:'foreign',observations})).failure,'input')
 assert.equal((await rpc('reconciliation_changes',{profileId:profile.id,leaseToken:'00000000-0000-4000-8000-000000000999',calendarId:calendar,observations})).failure,'lease')
 const large=Array.from({length:999},(_,i)=>({...observations[0],id:`growth_${i}`}))
 assert.equal((await checkedRpc('reconciliation_changes',{profileId:profile.id,leaseToken:lease.leaseToken,calendarId:calendar,observations:large,limit:100})).items.length,5)
 await checkedRpc('finish_reconciliation',{profileId:profile.id,leaseToken:lease.leaseToken,cursor:lease.cursor})
 // No historical booking announcement during discovery and no held-client sends.
 await db.query("update client_portal_secure.ghl_appointment_profiles set reconcile_due_at=now(),sending_enabled=false,sending_activated_at=null where id=$1",[profile.id])
 appointment={...appointment,id:'held_new'};await worker.runGhlAppointmentAutomation(deps);assert.equal(sends.length,3)
 await db.query("update client_portal_secure.ghl_appointment_profiles set reconcile_due_at=now() where id=$1",[profile.id])
 appointment={...appointment,id:'historical',dateAdded:'2020-01-01T00:00:00Z'};await worker.runGhlAppointmentAutomation(deps)
 assert.equal((await db.query("select count(*)::int n from client_portal_secure.ghl_appointment_outbox where appointment_id='historical' and kind='added'")).rows[0].n,0)
 console.log('PASS actual webhook verifier -> PostgreSQL inbox -> live-shaped provider parser -> worker -> outbox -> message/delivery records -> isolated Meta sink; creation, cancellation, duplicate and delayed webhook, missed-webhook same-run discovery, historical import and held recipient')
 }finally{await db.exec('rollback')}
}
