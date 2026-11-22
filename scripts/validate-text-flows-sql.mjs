// Text flows against the REAL combined schema (every committed migration replayed in memory, docs/text-flows.md):
// which flows a lead starts, the stop rules, one run per lead per flow, the worker's claim and the setter default.
// No credentials, no Supabase connection, nothing sent.
import assert from 'node:assert/strict'
import { replayFullSchema } from './assignment-full-schema/replay.mjs'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ws = id(1), owner = id(2), admin = id(3), camp = id(10), other = id(11)
const paying = id(20), free = id(21), elsewhere = id(22)
const { db } = await replayFullSchema()
const q = async (sql, args = []) => (await db.query(sql, args)).rows
let checks = 0, leadNo = 100
const pass = label => { checks++; console.log(`PASS ${checks}: ${label}`) }
const lead = async (source, campaign = camp, extra = {}) => {
    const n = ++leadNo
    const [row] = await q(`insert into campaign_leads(workspace_id,first_campaign_id,latest_campaign_id,first_source_id,latest_source_id,reference,first_name,phone_e164,sms_consent,sms_consent_at,assigned_to)
        values($1,$2,$2,$3,$3,$4,'Lead',$5,$6,now(),$7) returning id,assigned_to`, [ws, campaign, source, String(n).padStart(64, 'a'), `+1512555${String(n).padStart(4, '0')}`, extra.consent ?? 'opted_in', extra.setter ?? null])
    return row
}
const runs = async leadId => (await q('select f.name,r.status,r.end_reason,r.booking_id from campaign_flow_runs r join campaign_text_flows f on f.id=r.flow_id where r.lead_id=$1 order by r.started_at,f.name', [leadId])).map(r => `${r.name}:${r.status}${r.end_reason ? ':' + r.end_reason : ''}`)
const flow = async (name, kind, opts = {}) => (await q(`insert into campaign_text_flows(workspace_id,campaign_id,name,enabled,trigger_kind,trigger_stage,source_ids,stop_on_reply,stop_on_book,stop_on_pay,steps)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'[{"id":"s1","kind":"text","body":"Hi {first_name}"}]') returning id`, [ws, opts.campaign ?? camp, name, opts.enabled ?? true, kind, opts.stage ?? null, opts.sources ?? null, opts.reply ?? true, opts.book ?? true, opts.pay ?? false]))[0].id
const book = async (leadId, source, status, paid = false) => (await q(`insert into campaign_bookings(workspace_id,campaign_id,source_id,lead_id,starts_at,ends_at,status,held_until,paid_at)
    values($1,$2,$3,$4,now()+interval '2 days',now()+interval '2 days 30 minutes',$5,case when $5='held' then now()+interval '20 minutes' end,case when $6 then now() end) returning id`, [ws, camp, source, leadId, status, paid]))[0].id

try {
    await db.exec('set session_replication_role = replica')
    for (const [user, name] of [[owner, 'owner'], [admin, 'admin']]) await q("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,jsonb_build_object('username',$3::text))", [user, `${name}@example.invalid`, name])
    await q("insert into workspaces(id,name,slug) values($1,'Synthetic','synthetic')", [ws])
    await q("insert into workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'admin')", [ws, owner, admin])
    await q("insert into campaigns(id,workspace_id,name,status,intake_key) values($1,$3,'Garage Door Clients','live',$4),($2,$3,'Other','live',$5)", [camp, other, ws, 'k'.repeat(32), 'j'.repeat(32)])
    await q(`insert into campaign_sources(id,workspace_id,campaign_id,name,tag,intake_key,books,booking_slug,pay_amount_cents,setter_user_id) values
        ($1,$4,$5,'Teardown','Teardown',$6,true,'teardown',29700,$7),($2,$4,$5,'Bookings','Bookings',$8,true,'bookings',null,null),($3,$4,$9,'Elsewhere','Elsewhere',$10,false,null,null,null)`,
        [paying, free, elsewhere, ws, camp, 'a'.repeat(32), admin, 'b'.repeat(32), other, 'c'.repeat(32)])
    await db.exec('set session_replication_role = origin')

    const instant = await flow('Instant reply', 'new')
    const teardownOnly = await flow('Teardown only', 'new', { sources: [paying] })
    await flow('Switched off', 'new', { enabled: false })
    const hold = await flow('Hold reminder', 'hold', { book: false, pay: true })
    const booked = await flow('Booking reminders', 'booked', { reply: false, book: false })
    await flow('No-show follow-up', 'noshow')
    await flow('Showed thanks', 'stage', { stage: 'showed' })
    await flow('Other campaign', 'new', { campaign: other })

    const a = await lead(paying)
    assert.deepEqual(await runs(a.id), ['Instant reply:active', 'Teardown only:active'])
    const b = await lead(free)
    assert.deepEqual(await runs(b.id), ['Instant reply:active'])
    pass('a new lead starts the campaign\'s switched-on "comes in" flows for its source only')

    assert.equal(a.assigned_to, admin, 'the Teardown source names a default setter')
    assert.equal(b.assigned_to, null)
    assert.equal((await lead(paying, camp, { setter: owner })).assigned_to, owner, 'an explicit setter is kept')
    pass('a new lead takes their source\'s default setter unless one is given')

    const optedOut = await lead(paying, camp, { consent: 'opted_out' })
    assert.deepEqual(await runs(optedOut.id), [])
    pass('a lead who cannot be texted starts no flow')

    // A hold starts the hold flow only on a paying source; paying it stops the hold flow (stop on pay) and books.
    const heldId = await book(a.id, paying, 'held')
    assert.deepEqual(await runs(a.id), ['Instant reply:active', 'Teardown only:active', 'Hold reminder:active'])
    const freeHold = await book(b.id, free, 'held')
    assert.deepEqual(await runs(b.id), ['Instant reply:active'], 'a source that takes no payment has no hold flows')
    await q("update campaign_bookings set paid_at=now(),status='booked',held_until=null where id=$1", [heldId])
    assert.deepEqual(await runs(a.id), ['Instant reply:stopped:booked', 'Teardown only:stopped:booked', 'Hold reminder:stopped:paid', 'Booking reminders:active'])
    assert.equal((await q("select booking_id from campaign_flow_runs where lead_id=$1 and status='active'", [a.id]))[0].booking_id, heldId)
    pass('holding starts the hold flow; paying stops it and the "comes in" flows, and starts the booking flow with its booking')

    await q("update campaign_bookings set status='released' where id=$1", [freeHold])
    const direct = await book(b.id, free, 'booked')
    assert.deepEqual(await runs(b.id), ['Instant reply:stopped:booked', 'Booking reminders:active'])
    pass('booking directly stops flows that stop on booking and starts the booking flow')

    // Each lead is in a flow once at a time: a second booking does not start a second booking run.
    await q("update campaign_bookings set status='cancelled' where id=$1", [direct])
    await book(b.id, free, 'booked')
    assert.equal(Number((await q("select count(*) n from campaign_flow_runs r join campaign_text_flows f on f.id=r.flow_id where r.lead_id=$1 and f.name='Booking reminders'", [b.id]))[0].n), 1)
    pass('a lead is in a flow once at a time')

    // No-show and stage flows; Sold stops everything.
    await q("update campaign_bookings set status='no_show' where lead_id=$1 and status='booked'", [a.id])
    assert.ok((await runs(a.id)).includes('No-show follow-up:active'))
    await q("update campaign_leads set stage='showed' where id=$1", [b.id])
    assert.ok((await runs(b.id)).includes('Showed thanks:active'))
    await q("update campaign_leads set stage='sold' where id=$1", [b.id])
    assert.deepEqual((await runs(b.id)).filter(r => r.includes(':active')), [])
    assert.ok((await runs(b.id)).includes('Showed thanks:stopped:closed'))
    pass('a no-show and a stage start their flows; Sold or Lost stops every flow')

    // STOP stops every flow; a repeat form starts the "comes in" flows again.
    const c = await lead(free)
    await q("update campaign_leads set sms_consent='opted_out' where id=$1", [c.id])
    assert.deepEqual(await runs(c.id), ['Instant reply:stopped:opted_out'])
    const d = await lead(free)
    await q("update campaign_flow_runs set status='done',ended_at=now(),end_reason='finished' where lead_id=$1", [d.id])
    await q('update campaign_leads set submission_count=submission_count+1 where id=$1', [d.id])
    assert.deepEqual(await runs(d.id), ['Instant reply:done:finished', 'Instant reply:active'])
    pass('opting out stops every flow, and a repeat form starts the "comes in" flows again')

    // The events record each start and stop for the lead page.
    const events = await q("select kind,detail->>'flow' flow,detail->>'reason' reason from campaign_lead_events where lead_id=$1 and kind like 'flow_%' order by created_at", [c.id])
    assert.deepEqual(events.map(e => [e.kind, e.flow, e.reason]), [['flow_started', 'Instant reply', null], ['flow_stopped', 'Instant reply', 'opted_out']])
    pass('starts and stops are recorded as lead events')

    // Claim: due runs only, leased, never twice while leased; one lead's runs for the after-intake kick.
    await q("update campaign_flow_runs set next_at=now()+interval '1 hour' where status='active' and lead_id<>$1", [d.id])
    await db.exec("set role service_role")
    const first = await q('select id,lead_id,lease_token from campaign_flow_claim(50,null)')
    assert.deepEqual(first.map(r => r.lead_id), [d.id]); assert.ok(first[0].lease_token)
    assert.equal((await q('select count(*) n from campaign_flow_claim(50,null)'))[0].n, 0, 'a leased run is not claimed again')
    await db.exec('reset role')
    await q("update campaign_flow_runs set lease_until=now()-interval '1 second',next_at=now() where lead_id=$1 and status='active'", [a.id])
    await db.exec("set role service_role")
    // Lead A has two active runs (booking reminders, which end themselves once the appointment is off, and the no-show follow-up).
    assert.deepEqual((await q('select lead_id from campaign_flow_claim(50,$1)', [a.id])).map(r => r.lead_id), [a.id, a.id])
    await db.exec('reset role')
    pass('the worker claims due runs with a lease, never twice, and can claim one lead\'s runs')

    // The scheduler is registered, and only the server may use these functions.
    assert.equal((await q("select count(*) n from cron.jobs where jobname='campaign-text-flows'"))[0].n, 1)
    for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`)
        await assert.rejects(db.query('select * from campaign_flow_claim(1,null)'), /permission/)
        await assert.rejects(db.query('select * from campaign_text_flows'), /permission/)
        await assert.rejects(db.query("select campaign_flow_enroll($1,'new')", [a.id]), /permission/)
        await db.exec('reset role')
    }
    pass('the minute scheduler is registered, and browsers cannot read flows or claim, start or stop runs')

    // A flow picture's file key: only for a lead conversation's own path, made by the server, read by its participants.
    await db.exec("set role service_role")
    const [conv] = await q("insert into workspace_native_conversations(workspace_id,kind,lead_id) values($1,'lead',$2) returning id", [ws, a.id])
    await q('insert into workspace_native_conversation_participants(workspace_id,conversation_id,user_id) values($1,$2,$3)', [ws, conv.id, owner])
    const path = `${ws}/communications/native/${conv.id}/${id(90)}.enc`
    const key = (await q('select campaign_lead_file_key($1,$2,$3,$4) k', [ws, conv.id, path, owner]))[0].k
    assert.ok(key)
    await assert.rejects(q('select campaign_lead_file_key($1,$2,$3,$4)', [ws, conv.id, path, owner]), /already_exists/)
    await assert.rejects(q('select campaign_lead_file_key($1,$2,$3,$4)', [ws, conv.id, `${ws}/communications/native/${conv.id}/x/y.enc`, owner]), /invalid_storage_path/)
    await assert.rejects(q('select campaign_lead_file_key($1,$2,$3,$4)', [ws, conv.id, `${ws}/communications/native/${id(91)}/z.enc`, owner]), /invalid_storage_path/)
    await db.exec('reset role')
    await q("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, role: 'authenticated', aal: 'aal2' })])
    await db.exec('set role authenticated')
    assert.equal((await q('select communication_file_key_for_user($1) k', [path]))[0].k, key)
    await assert.rejects(db.query('select campaign_lead_file_key($1,$2,$3,$4)', [ws, conv.id, `${ws}/communications/native/${conv.id}/w.enc`, owner]), /permission/)
    await db.exec('reset role')
    await q("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: admin, role: 'authenticated', aal: 'aal2' })])
    await db.exec('set role authenticated')
    assert.equal((await q('select communication_file_key_for_user($1) k', [path]))[0].k, null, 'a non-participant cannot read it')
    await db.exec('reset role')
    pass('a flow picture\'s file key is made by the server for a lead conversation only and read by its participants')

    void instant; void teardownOnly; void hold; void booked
    console.log(`Text flows SQL: ${checks} checks passed.`)
} finally {
    await db.close()
}
