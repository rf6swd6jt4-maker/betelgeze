import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { generateKeyPairSync, sign } from "node:crypto"
import ts from "typescript"
const require = createRequire(import.meta.url)
const cache = new Map<string, unknown>()
function load(path: string): Record<string, unknown> {
    if (cache.has(path)) return cache.get(path) as Record<string, unknown>
    const compiled = { exports: {} }
    const code = ts.transpileModule(readFileSync(`lib/${path}.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function("require", "module", "exports", code)((id: string) => id.startsWith("../client-portal/") ? load(`client-portal/${id.split('/').pop()}`) : id.startsWith('./') ? load(`ghl-appointments/${id.slice(2)}`) : require(id), compiled, compiled.exports)
    cache.set(path, compiled.exports); return compiled.exports
}
const { classifyAppointmentChange, appointmentSnapshotsEqual, reminderDueAt } = load('ghl-appointments/lifecycle') as typeof import('../lib/ghl-appointments/lifecycle')
const { fetchAppointment, fetchCalendarWindow } = load('ghl-appointments/provider') as typeof import('../lib/ghl-appointments/provider')
const { handleGhlAppointmentWebhook } = load('ghl-appointments/webhook') as typeof import('../lib/ghl-appointments/webhook')
const snapshot = { id:'event_instance_123', locationId:'location123456789', calendarId:'calendar123456789', calendarName:'Visits', contactId:'contact123456789', contactName:'Alex Smith', title:'Consultation', startTime:'2026-10-14T14:00:00.000Z', endTime:'2026-10-14T15:00:00.000Z', timezone:'America/Chicago', status:'confirmed', contactDetails:'alex@example.com', meetingDetails:'By phone', bookingDetails:'Not configured', sourceUpdatedAt:'2026-10-11T09:00:00.000Z', observedAt:'2026-10-11T09:01:00.000Z', deleted:false }
test('full lifecycle uses retained details and suppresses initial import and unchanged events', () => {
    assert.deepEqual(classifyAppointmentChange(null,snapshot).kinds,['added'])
    assert.deepEqual(classifyAppointmentChange(null,snapshot,{baseline:true}).kinds,[])
    assert.deepEqual(classifyAppointmentChange(snapshot,{...snapshot,status:'cancelled'},{baseline:true}).kinds,['cancelled'])
    assert.deepEqual(classifyAppointmentChange(snapshot,{...snapshot,startTime:'2026-10-15T14:00:00.000Z'},{baseline:true}).kinds,['rescheduled'])
    assert.deepEqual(classifyAppointmentChange(snapshot,{...snapshot,observedAt:'later'}).kinds,[])
    assert.equal(appointmentSnapshotsEqual(snapshot,{...snapshot,sourceUpdatedAt:'later'}),true)
    assert.deepEqual(classifyAppointmentChange(snapshot,{...snapshot,deleted:true}).kinds,['removed'])
    assert.deepEqual(classifyAppointmentChange(null,{...snapshot,deleted:true}).kinds,[])
    assert.deepEqual(classifyAppointmentChange({...snapshot,deleted:true},snapshot).kinds,['added'])
    assert.deepEqual(classifyAppointmentChange(snapshot,{...snapshot,calendarId:'other'}, {calendarId:snapshot.calendarId}).kinds,['removed'])
    assert.deepEqual(classifyAppointmentChange(snapshot,{...snapshot,status:'cancelled',startTime:'2026-10-15T14:00:00.000Z'}).kinds,['cancelled'])
    assert.deepEqual(classifyAppointmentChange(snapshot,{...snapshot,startTime:'2026-10-15T14:00:00.000Z'}).kinds,['rescheduled'])
    assert.deepEqual(classifyAppointmentChange(snapshot,{...snapshot,status:'showed'}).kinds,['status_updated'])
    assert.deepEqual(classifyAppointmentChange(snapshot,{...snapshot,status:'invalid'}).kinds,['status_updated'])
    const cancelledEdit = classifyAppointmentChange({...snapshot,status:'cancelled'},{...snapshot,status:'cancelled',startTime:'2026-10-15T14:00:00.000Z'})
    assert.deepEqual(cancelledEdit.kinds,['details_updated']); assert.match(cancelledEdit.changedDetails,/Status remains cancelled/)
    assert.match(classifyAppointmentChange(snapshot,{...snapshot,meetingDetails:'Office'}).changedDetails,/Meeting details: Office/)
    assert.deepEqual(classifyAppointmentChange(snapshot,{...snapshot,meetingDetails:'Office'}).kinds,['details_updated'])
})
test('reminders cover late discovery but never past, cancelled, deleted or completed appointments', () => {
    assert.equal(reminderDueAt(snapshot,60,'2026-10-14T12:00:00Z'),'2026-10-14T13:00:00.000Z')
    assert.equal(reminderDueAt(snapshot,60,'2026-10-14T13:30:00Z'),'2026-10-14T13:30:00.000Z')
    for(const status of ['cancelled','invalid','showed','noshow','unknown']) assert.equal(reminderDueAt({...snapshot,status},60,'2026-10-14T12:00:00Z'),null)
    assert.equal(reminderDueAt(snapshot,60,'2026-10-14T14:00:00Z'),null)
    assert.equal(reminderDueAt({...snapshot,deleted:true},60,'2026-10-14T12:00:00Z'),null)
})
const profile = {locationId:snapshot.locationId,calendarId:snapshot.calendarId,calendarName:'Visits',privateToken:'synthetic-test-token-123456789'}
function providerFixture(change?: (path:string,value:Record<string,unknown>)=>Record<string,unknown>|Response) {
    const calls:string[]=[]
    const fetcher:typeof fetch=async(input,options)=>{
        const url=new URL(String(input));calls.push(url.pathname)
        assert.equal(url.origin,'https://services.leadconnectorhq.com');assert.equal(options?.redirect,'error');assert.equal((options?.headers as Record<string,string>).Version,'v3')
        const value=url.pathname.startsWith('/locations/')?{location:{id:profile.locationId,timezone:snapshot.timezone}}:url.pathname.startsWith('/contacts/')?{contact:{id:snapshot.contactId,locationId:profile.locationId,firstName:'Alex',lastName:'Smith',email:'alex@example.com',customFields:[{value:'Do not substitute'}]}}:url.pathname.startsWith('/calendars/events/appointments/')?{event:{...snapshot,appointmentStatus:'confirmed',dateUpdated:snapshot.sourceUpdatedAt,groupId:'masterseries',notes:'Internal notes',address:'By phone'}}:url.pathname==='/calendars/events'?{events:[snapshot]}:{calendar:{id:profile.calendarId,locationId:profile.locationId,name:'Visits'}}
        const result=change?.(url.pathname,value)??value;return result instanceof Response?result:Response.json(result)
    };return {fetcher,calls}
}
test('provider verifies account and occurrence and maps contact without substituting custom fields',async()=>{
    const f=providerFixture();const value=await fetchAppointment(profile,snapshot.id,f.fetcher)
    assert.equal(value?.id,snapshot.id);assert.equal(value?.contactName,'Alex Smith');assert.equal(value?.bookingDetails,'Booking details are not configured.')
    assert.equal(value?.meetingDetails,'By phone');assert.equal(f.calls.length,4)
    assert.equal(JSON.stringify(value).includes('masterseries'),false)
})
test('richer provider fields use existing reads and preserve legacy short notification values',async()=>{
    const f=providerFixture((path,value)=>path.startsWith('/contacts/')?{contact:{...(value.contact as object),phone:'+1 202 555 0123',companyName:'Example',address1:'1 Street',city:'Dallas',state:'TX',postalCode:'75000'}}:path.includes('/appointments/')?{event:{...(value.event as object),address:'https://meet.example.com/consultation',assignedUserId:'staff123',notes:'Six windows'}}:value)
    const value=await fetchAppointment({...profile,includeNotes:true},snapshot.id,f.fetcher)
    assert.equal(f.calls.length,4,'No extra provider request enters primary appointment verification')
    assert.equal(value?.details?.contact.phone,'+1 202 555 0123')
    assert.equal(value?.details?.contact.address,'1 Street, Dallas, TX, 75000')
    assert.equal(value?.details?.meeting.joinUrl,'https://meet.example.com/consultation')
    assert.equal(value?.details?.assignedUserId,'staff123')
    assert.equal(value?.bookingDetails,'Six windows')
    assert.equal(value?.details?.formSubmissionState,'unavailable')
})
test('long meeting details are retained separately while expanded internal notes require visibility review',async()=>{
    const meeting='Meeting instructions '.repeat(100),notes='Internal content '.repeat(100)
    const f=providerFixture((path,value)=>path.includes('/appointments/')?{event:{...(value.event as object),address:meeting,notes}}:value)
    const value=await fetchAppointment({...profile,includeNotes:true},snapshot.id,f.fetcher)
    assert.equal(value?.details?.meeting.location,meeting.trim())
    assert.ok((value?.meetingDetails.length??0)<=500)
    assert.equal(value?.details?.booking.state,'too_large')
    assert.equal(value?.details?.booking.text,null)
    assert.equal(JSON.stringify(value).includes('Internal content'),false)
    assert.ok(Buffer.byteLength(JSON.stringify(value))<65536)
})
test('provider absence is only a verified-account appointment 404, never authorization or contact failure',async()=>{
    const f=providerFixture(p=>p.includes('/appointments/')?new Response('',{status:404}):undefined as never)
    assert.equal(await fetchAppointment(profile,snapshot.id,f.fetcher),null)
    const removed=providerFixture((p,v)=>p.includes('/appointments/')?{event:{id:snapshot.id,locationId:profile.locationId,deleted:true}}:v)
    assert.equal(await fetchAppointment(profile,snapshot.id,removed.fetcher),null)
    assert.equal(removed.calls.length,2)
    for(const status of [401,403,429,500]) await assert.rejects(fetchAppointment(profile,snapshot.id,providerFixture(p=>p.includes('/appointments/')?new Response('',{status}):undefined as never).fetcher))
    await assert.rejects(fetchAppointment(profile,snapshot.id,providerFixture(p=>p.startsWith('/contacts/')?new Response('',{status:404}):undefined as never).fetcher))
    await assert.rejects(fetchAppointment(profile,snapshot.id,providerFixture((p,v)=>p.startsWith('/locations/')?{location:{id:'wrong'}}:v).fetcher),/location/)
})
test('provider rejects cross-account contact and incomplete dates, keeps cancelled records',async()=>{
    await assert.rejects(fetchAppointment(profile,snapshot.id,providerFixture((p,v)=>p.startsWith('/contacts/')?{contact:{id:snapshot.contactId,locationId:'wrong'}}:v).fetcher),/location/)
    await assert.rejects(fetchAppointment(profile,snapshot.id,providerFixture((p,v)=>p.includes('/appointments/')?{event:{...(v.event as object),startTime:'2026-10-14T14:00:00'}}:v).fetcher),/response/)
    const value=await fetchAppointment(profile,snapshot.id,providerFixture((p,v)=>p.includes('/appointments/')?{event:{...(v.event as object),appointmentStatus:'cancelled'}}:v).fetcher)
    assert.equal(value?.status,'cancelled')
})
test('reconciliation is daily bounded and refuses capped or cross-calendar responses',async()=>{
    const window={start:'2026-10-14T00:00:00Z',end:'2026-10-15T00:00:00Z'}
    assert.deepEqual(await fetchCalendarWindow(profile,window,providerFixture().fetcher),{appointmentIds:[snapshot.id],complete:true})
    await assert.rejects(fetchCalendarWindow(profile,{...window,end:'2026-10-16T00:00:00Z'},providerFixture().fetcher),/window/)
    for(const events of [Array(1000).fill(snapshot),[{...snapshot,calendarId:'other'}]]) await assert.rejects(fetchCalendarWindow(profile,window,providerFixture((p,v)=>p==='/calendars/events'?{events}:v).fetcher))
})
const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString()
const payload={type:'AppointmentCreate',locationId:snapshot.locationId,webhookId:'webhook-test-1',appointment:{id:snapshot.id,calendarId:snapshot.calendarId,dateUpdated:snapshot.sourceUpdatedAt}}
function signed(value:unknown=payload,mutate=false){const raw=JSON.stringify(value);return new Request('https://example.com/api/webhooks/ghl/appointments',{method:'POST',headers:{'x-ghl-signature':sign(null,Buffer.from(raw),keys.privateKey).toString('base64')},body:mutate?raw+' ':raw})}
test('webhook verifies exact raw Ed25519 bytes and only acknowledges durable intake',async()=>{
    const events:unknown[]=[];const deps={enabled:true,publicKey,ingest:async(event:unknown)=>{events.push(event);return{accepted:true}}}
    assert.equal((await handleGhlAppointmentWebhook(signed(),deps)).status,202)
    assert.equal(events.length,1);assert.match((events[0] as {payloadHash:string}).payloadHash,/^[a-f0-9]{64}$/)
    assert.equal((await handleGhlAppointmentWebhook(signed(payload,true),deps)).status,401);assert.equal(events.length,1)
    assert.equal((await handleGhlAppointmentWebhook(signed(),{...deps,ingest:async()=>{throw Error('secret database error')}})).status,503)
    assert.equal((await handleGhlAppointmentWebhook(signed(),{...deps,ingest:async()=>({failure:'input'})})).status,503)
})
test('disabled intake performs no writes; malformed or foreign-account events cannot enter the inbox',async()=>{
    const deps={enabled:true,publicKey,ingest:async()=>{throw Error('must not run')}}
    assert.equal((await handleGhlAppointmentWebhook(signed(),{...deps,enabled:false})).status,200)
    assert.equal((await handleGhlAppointmentWebhook(signed({...payload,appointment:{...payload.appointment,locationId:'other'}}),deps)).status,400)
    assert.equal((await handleGhlAppointmentWebhook(signed({...payload,type:'ContactCreate'}),deps)).status,200)
    assert.equal((await handleGhlAppointmentWebhook(signed({...payload,appointment:{}}),deps)).status,400)
    assert.equal((await handleGhlAppointmentWebhook(new Request('https://example.com',{method:'POST',body:'unsigned'}),deps)).status,401)
})
test('signed contact and uninstall events retain routing only and reject a different app',async()=>{
    const events:unknown[]=[]
    const deps={enabled:true,publicKey,appId:'fixture-app',ingest:async()=>{throw Error('wrong lane')},ingestAppEvent:async(event:unknown)=>{events.push(event);return{accepted:true}}}
    const contact={type:'ContactUpdate',locationId:'location123',id:'contact123',dateOfBirth:'2000-01-01',customFields:[{value:'not-needed'}]}
    assert.equal((await handleGhlAppointmentWebhook(signed(contact),deps)).status,202)
    assert.equal(JSON.stringify(events).includes('2000-01-01'),false)
    assert.equal(JSON.stringify(events).includes('customFields'),false)
    assert.equal((events[0] as {contactId:string}).contactId,'contact123')
    assert.equal((await handleGhlAppointmentWebhook(signed({...contact,appId:'other-app'}),deps)).status,400)
    assert.equal((await handleGhlAppointmentWebhook(signed({type:'UNINSTALL',appId:'fixture-app',companyId:'company123'}),deps)).status,202)
    assert.equal((await handleGhlAppointmentWebhook(signed({type:'UNINSTALL',companyId:'company123'}),deps)).status,400)
    assert.equal((await handleGhlAppointmentWebhook(signed(contact),{...deps,ingestAppEvent:async()=>({failure:'not_committed'})})).status,503)
    assert.equal((await handleGhlAppointmentWebhook(signed(contact,true),deps)).status,401)
})

test('live v3 appointment envelope works; documented legacy event remains supported without ambiguous fallback',async()=>{
 const live=providerFixture((p,v)=>p.includes('/appointments/')?{appointment:{...(v.event as object),dateAdded:'2026-10-11T08:00:00Z'}}:v)
 const parsed=await fetchAppointment(profile,snapshot.id,live.fetcher)
 assert.equal(parsed?.id,snapshot.id);assert.equal(parsed?.sourceCreatedAt,'2026-10-11T08:00:00.000Z')
 for(const replacement of [{appointment:null,event:snapshot},{appointment:{...snapshot,id:'wrong'}},{appointment:snapshot,event:snapshot}]) {
  await assert.rejects(fetchAppointment(profile,snapshot.id,providerFixture((p,v)=>p.includes('/appointments/')?replacement:v).fetcher))
 }
})

test('approved qualification fields reuse the contact read and never change notification text', async () => {
    const leadFieldMapping = [{ fieldId: 'owner_field', label: 'Do you own the property?' }, { fieldId: 'interest_field', label: 'What are you interested in?' }]
    const f = providerFixture((path, value) => path.startsWith('/contacts/') ? { contact: { ...(value.contact as object), source: 'Facebook', type: 'lead', customFields: [
        { id: 'owner_field', value: "Yes, I'm the homeowner" }, { id: 'interest_field', value: 'Motorized Roller Shades' }, { id: 'internal_field', value: 'PRIVATE CRM VALUE' },
    ] } } : value)
    const baseline = await fetchAppointment(profile, snapshot.id, providerFixture().fetcher)
    const current = await fetchAppointment({ ...profile, leadFieldMapping }, snapshot.id, f.fetcher)
    assert.equal(f.calls.length, 4, 'No metadata/contact/provider fanout is added')
    assert.deepEqual(current?.details?.lead?.fields, leadFieldMapping.map((field, i) => ({ ...field, value: i ? 'Motorized Roller Shades' : "Yes, I'm the homeowner" })))
    assert.equal(current?.details?.lead?.source, 'Facebook'); assert.equal(current?.details?.lead?.type, 'lead')
    assert.ok(Date.parse(current!.details!.lead!.capturedAt!) <= Date.parse(current!.observedAt))
    assert.equal(JSON.stringify(current).includes('PRIVATE CRM VALUE'), false)
    assert.equal(current?.bookingDetails, baseline?.bookingDetails)
    assert.equal(current?.contactDetails, baseline?.contactDetails)
    assert.equal(appointmentSnapshotsEqual(baseline!, current!), true)
    assert.deepEqual(classifyAppointmentChange(baseline!, current!).kinds, [])
})

test('lead mapping is explicit and bounded; unknown, duplicate and malformed values cannot escape', async () => {
    const fields = [{ id: 'one', value: false }, { id: 'two', fieldValue: ['Shutters', 'Shades'] }, { id: 'three', value: 0 }, { id: 'private', value: { secret: 'PRIVATE OBJECT' } }]
    const fixture = (raw: unknown) => providerFixture((path, value) => path.startsWith('/contacts/') ? { contact: { ...(value.contact as object), customFields: raw } } : value)
    const mapping = ['one', 'two', 'three', 'private'].map(fieldId => ({ fieldId, label: fieldId }))
    const result = await fetchAppointment({ ...profile, leadFieldMapping: mapping }, snapshot.id, fixture(fields).fetcher)
    assert.deepEqual(result?.details?.lead?.fields.map(x => x.value), ['No', 'Shutters, Shades', '0'])
    assert.equal(JSON.stringify(result).includes('PRIVATE OBJECT'), false)
    for (const leadFieldMapping of [undefined, [], Array.from({ length: 9 }, (_, i) => ({ fieldId: String(i), label: 'Question' })), [{ fieldId: 'one', label: 'Question' }, { fieldId: 'one', label: 'Other' }], [{ fieldId: 'one', label: ' Private ' }]]) {
        assert.deepEqual((await fetchAppointment({ ...profile, leadFieldMapping }, snapshot.id, fixture(fields).fetcher))?.details?.lead?.fields, [])
    }
    for (const raw of [null, {}, [{ id: 'one', value: 'x'.repeat(1001) }], [{ id: 'one', value: 'First' }, { id: 'one', value: 'Conflicting' }], [{ id: 'one', value: Array(21).fill('choice') }], Array(257).fill({ id: 'one', value: 'Too many' })]) {
        assert.deepEqual((await fetchAppointment({ ...profile, leadFieldMapping: mapping }, snapshot.id, fixture(raw).fetcher))?.details?.lead?.fields, [])
    }
})


test('maximum UTF-8 lead fields and encoded meeting URLs stay within the retained snapshot budget', async () => {
    const leadFieldMapping = Array.from({ length: 8 }, (_, i) => ({ fieldId: `field_${i}` + 'x'.repeat(150), label: '界'.repeat(100) }))
    assert.ok(Buffer.byteLength(JSON.stringify(leadFieldMapping)) <= 4096)
    const meeting = 'https://example.test/' + '界'.repeat(2000)
    const fixture = providerFixture((path, value) => path.startsWith('/contacts/') ? { contact: {
        ...(value.contact as object), firstName: '界'.repeat(99), lastName: '界'.repeat(100), phone: '界'.repeat(80), email: '界'.repeat(254),
        companyName: '界'.repeat(200), address1: '界'.repeat(250), city: '界'.repeat(250), state: '界'.repeat(250), postalCode: '界'.repeat(250), country: '界'.repeat(250),
        source: '界'.repeat(200), type: '界'.repeat(60), customFields: leadFieldMapping.map(field => ({ id: field.fieldId, value: '界'.repeat(1000) })),
    } } : path.includes('/appointments/') ? { event: { ...(value.event as object), address: meeting, notes: '界'.repeat(500), title: '界'.repeat(200) } } : value)
    const result = await fetchAppointment({ ...profile, includeNotes: true, leadFieldMapping }, snapshot.id, fixture.fetcher)
    assert.equal(fixture.calls.length, 4)
    assert.equal(result?.details?.lead?.fields.length, 8)
    assert.equal(result?.details?.meeting.joinUrl, null, 'Encoded link is bounded too')
    assert.equal(result?.details?.meeting.location, meeting, 'Full plain meeting text remains retained')
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 65536)
})
