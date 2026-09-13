import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { repositoryRoot } from './pglite-fixture.mjs'

export async function validateRelationshipCards({ db, q, one, w, owner, seller, staff, relationship, service, revision, add, uuid, pass }) {
    await db.exec(`
        alter table relationships add column location_value text;
        alter table client_sales add column deleted_at timestamptz;
        create table workspace_integrations(workspace_id uuid,provider text,enabled boolean,connection_status text,unique(workspace_id,provider));
        create table client_communication_channels(workspace_id uuid,relationship_id uuid,provider text);
        create table client_messages(id uuid primary key default gen_random_uuid(),workspace_id uuid,relationship_id uuid,provider text,direction text,created_at timestamptz default now(),provider_message_id text,whatsapp_message_id text,from_address text,to_address text,body text,status text,sender_kind text,automation_kind text,automation_label text,raw_payload jsonb,unique(provider,provider_message_id));
        create table communication_message_deliveries(workspace_id uuid,relationship_id uuid,provider text,created_at timestamptz);
        create table workspace_sms_opt_ins(id uuid default gen_random_uuid(),workspace_id uuid,phone_e164 text,status text,unique(workspace_id,phone_e164));
        create table relationship_sms_consents(workspace_id uuid,relationship_id uuid,phone_e164 text,confirmed_at timestamptz,status text);
        create table onboarding_delivery_outbox(id uuid primary key default gen_random_uuid(),workspace_id uuid,relationship_id uuid,session_id uuid,correlation_id uuid,kind text,destination text,payload jsonb,idempotency_key text,unique(workspace_id,idempotency_key));
    `)
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260913120000_relationship_card_workspace.sql`, 'utf8'))
    pass('relationship card migration applies with function checking enabled')
    await q("insert into workspace_integrations values($1,'meta_whatsapp',true,'connected'),($1,'twilio_sms',true,'connected')",[w])
    const choices = async () => (await one('select relationship_messaging_choices($1,$2) choices',[w,relationship])).choices
    assert((await choices()).every(c=>c.state==='inactive'))
    await q("update relationships set whatsapp_phone='+353850000001',primary_phone='+353850000002' where id=$1",[relationship])
    const prepare = async (provider='meta_whatsapp') => (await one('select prepare_relationship_contact_confirmation($1,$2,$3,$4,$5,$6) result',[w,relationship,seller,provider,uuid(provider==='meta_whatsapp'?910:911),'Please reply YES'])).result
    await assert.rejects(prepare('twilio_sms'),/opt in/)
    const wa = await prepare()
    assert.equal(wa.send,true);assert.equal((await prepare()).send,false)
    await q("update relationship_contact_confirmations set status='awaiting_confirmation' where id=$1",[wa.id])
    const confirmed = (await one("select confirm_relationship_contact($1,'meta_whatsapp','whatsapp:+353850000001','reply-1') result",[w])).result
    assert.equal(confirmed.ok,true);assert.equal((await one("select count(*) n from client_messages where provider_message_id='reply-1'")).n,1);assert.equal((await choices()).find(c=>c.provider==='meta_whatsapp').state,'active')
    await q("update relationships set whatsapp_phone='+353850000003' where id=$1",[relationship])
    assert.equal((await choices()).find(c=>c.provider==='meta_whatsapp').state,'inactive')
    await q("update relationships set whatsapp_phone='+353850000001' where id=$1",[relationship])
    await q("update workspace_integrations set connection_status='needs_attention' where workspace_id=$1 and provider='meta_whatsapp'",[w])
    assert.equal((await choices()).find(c=>c.provider==='meta_whatsapp').state,'broken')
    await q("update workspace_integrations set connection_status='connected' where workspace_id=$1",[w])
    assert.equal((await choices()).find(c=>c.provider==='meta_whatsapp').canSend,true)
    await q("update relationship_contact_confirmations set confirmed_at=now()-interval '2 days' where id=$1",[wa.id])
    await q("update client_messages set created_at=now()-interval '2 days' where provider_message_id='reply-1'")
    assert.equal((await choices()).find(c=>c.provider==='meta_whatsapp').canSend,false)
    const renewal=(await one("select prepare_relationship_contact_confirmation($1,$2,$3,'meta_whatsapp',$4,'Reply CONFIRM') result",[w,relationship,seller,uuid(912)])).result
    assert.equal(renewal.send,true);assert.notEqual(renewal.messageId,wa.messageId)
    await one("select confirm_relationship_contact($1,'meta_whatsapp','+353850000001','reply-1') result",[w])
    assert.equal((await choices()).find(c=>c.provider==='meta_whatsapp').canSend,false)
    await one("select confirm_relationship_contact($1,'meta_whatsapp','+353850000001','reply-2','CONFIRM') result",[w])
    assert.equal((await choices()).find(c=>c.provider==='meta_whatsapp').canSend,true)
    assert.equal((await one("select count(*) n from client_messages where provider_message_id='reply-1'")).n,1)
    assert.equal((await one("select body from client_messages where provider_message_id='reply-2'")).body,'CONFIRM')
    pass('channel confirmation is replay-safe, address-specific, and respects provider health and SMS opt-in')
    const a=await add(service,revision,uuid(920)),b=await add(service,revision,uuid(921))
    const input={uiVersion:2,relationshipVersion:(await one('select updated_at::text version from relationships where id=$1',[relationship])).version,managerId:owner,billingInterval:'month',billingIntervalCount:1,offered:[a,b].map(id=>({id,version:1})),delivery:[{provider:'meta_whatsapp',address:'+353850000001'}],lines:[{id:a,version:1,assigneeId:staff,upfrontCents:1100,recurringCents:2000}]}
    const preview=async (i=input)=>(await one('select preview_relationship_service_sale($1,$2,$3,$4) result',[w,relationship,seller,i])).result
    const quote=await preview()
    assert.equal((await one('select stage from relationship_service_instances where id=$1',[b])).stage,'negotiating')
    const commit=async (i=input, hash=quote.hash, request=uuid(922))=>(await one('select commit_relationship_service_sale($1,$2,$3,$4,$5,$6,$7,null) result',[w,relationship,seller,request,i,hash,'+353850000001'])).result
    await assert.rejects(commit({...input,delivery:[]}),/confirmed contact/)
    await assert.rejects(commit({...input,delivery:[{provider:'meta_whatsapp',address:'+353850000009'}]}),/no longer confirmed/)
    const sold=await commit();assert.equal((await commit()).saleId,sold.saleId)
    assert.equal((await one('select stage from relationship_service_instances where id=$1',[b])).stage,'declined')
    assert.equal((await one('select count(*) n from onboarding_delivery_outbox where session_id=$1',[sold.sessionId])).n,1)
    assert.deepEqual((await one('select payload from onboarding_delivery_outbox where session_id=$1',[sold.sessionId])).payload.delivery_choices,input.delivery)
    assert((await one('select consent_confirmed_at from client_sales where id=$1',[sold.saleId])).consent_confirmed_at)
    const resale={...input,relationshipVersion:(await one('select updated_at::text version from relationships where id=$1',[relationship])).version,offered:[{id:b,version:2}],lines:[{...input.lines[0],id:b,version:2}]}
    await commit(resale,(await preview(resale)).hash,uuid(923))
    pass('review does not decline; commit atomically declines unselected services, queues exact delivery, and allows declined resale')
    const cards=(await one('select read_relationship_service_cards($1,$2,$3,0,$4) result',[w,relationship,seller,a])).result
    assert.equal(cards.items[0].sold_recurring_cents,2000)
    const stale=await add(service,revision,uuid(924)),selected=await add(service,revision,uuid(925))
    const i2={...input,relationshipVersion:(await one('select updated_at::text version from relationships where id=$1',[relationship])).version,offered:[stale,selected].map(id=>({id,version:1})),lines:[{...input.lines[0],id:selected,version:1}]}
    const q2=await preview(i2)
    await q("update relationship_service_instances set stage='declined',version=version+1,change_request_id=$1,changed_by=$2,change_reason='Concurrent edit' where id=$3",[uuid(926),seller,stale])
    await assert.rejects(commit(i2,q2.hash,uuid(927)),/offered service changed/)
    assert.equal((await one('select stage from relationship_service_instances where id=$1',[selected])).stage,'negotiating')
    pass('stale unchecked service prevents partial sale; service cards use frozen sold pricing')
    for(const name of ['prepare_relationship_contact_confirmation(uuid,uuid,uuid,text,uuid,text)','relationship_messaging_choices(uuid,uuid)','confirm_relationship_contact(uuid,text,text,text,text,jsonb)']) {
        for(const role of ['anon','authenticated']) assert.equal((await one('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,name])).allowed,false)
    }
    pass('contact writes and private metadata remain trusted-server-only')
    await q("insert into client_messages(workspace_id,relationship_id,provider,direction,created_at,from_address,body,status) select $1,$2,'meta_whatsapp','inbound',now()-interval '3 days'-n*interval '1 second','+353850000001','fixture','received' from generate_series(1,50000) n",[w,relationship])
    await db.exec('analyze client_messages')
    const plan=await q("explain (analyze,format json) select created_at from client_messages where workspace_id=$1 and relationship_id=$2 and provider='meta_whatsapp' and direction='inbound' and created_at>now()-interval '24 hours' and relationship_contact_phone(from_address)='+353850000001' order by created_at desc limit 1",[w,relationship])
    const execution=plan[0]['QUERY PLAN'][0]
    assert(JSON.stringify(execution.Plan).includes('relationship_contact_recent_inbound'))
    assert.equal(execution.Plan['Actual Rows'],1)
    const valueSummary=(await one('select read_relationship_services($1,$2,$3,0) result',[w,relationship,seller])).result
    assert(Array.isArray(valueSummary.values))
    assert.equal((await one("select relationship_contact_phone('whatsapp:+44 (0) 7700 900123') phone")).phone,'+447700900123')
    pass(`contact lookup at 50,000 historical messages uses the time-bounded inbound index (${execution['Execution Time']} ms in isolated PGlite)`)

}
