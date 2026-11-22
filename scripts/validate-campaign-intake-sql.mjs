// Campaign lead intake, sources and booking against the REAL combined schema (every committed migration replayed in memory).
// No credentials, no Supabase connection, nothing sent. Contracts: docs/campaign-intake.md, docs/campaign-booking.md.
import assert from 'node:assert/strict'
import { replayFullSchema } from './assignment-full-schema/replay.mjs'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ws = id(1), owner = id(2), staff = id(3), other = id(4)
const { db } = await replayFullSchema()
const q = async (sql, args = []) => (await db.query(sql, args)).rows
let checks = 0
const pass = label => { checks++; console.log(`PASS ${checks}: ${label}`) }
const hex = c => c.repeat(64)

try {
    await db.exec('set session_replication_role = replica')
    for (const [user, name] of [[owner, 'owner'], [staff, 'staff']]) await q("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,jsonb_build_object('username',$3::text))", [user, `${name}@example.invalid`, name])
    await q("insert into workspaces(id,name,slug) values($1,'Synthetic','synthetic'),($2,'Other','other')", [ws, other])
    await q("insert into workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'staff')", [ws, owner, staff])
    await db.exec('set session_replication_role = origin')

    const admin = async input => (await q("select campaign_admin('create',$1::jsonb) r", [JSON.stringify(input)]))[0].r
    await assert.rejects(admin({ workspace_id: ws, actor_id: staff, name: 'Nope', allowed_origins: [] }), /Owner or admin required/); pass('staff cannot create campaigns')
    await assert.rejects(admin({ workspace_id: other, actor_id: owner, name: 'Nope', allowed_origins: [] }), /Owner or admin required/); pass('owners cannot create campaigns in another workspace')
    await assert.rejects(admin({ workspace_id: ws, actor_id: owner, name: 'Bad', allowed_origins: ['https://go.scaylup.com/teardown'] }), /https:\/\/host/); pass('origins with a path are refused')
    const created = await admin({ workspace_id: ws, actor_id: owner, name: 'Funnel teardown', allowed_origins: ['https://GO.scaylup.com'] })
    assert.match(created.intake_key, /^[A-Za-z0-9_-]{32}$/); assert.equal(created.status, 'draft'); assert.deepEqual(created.allowed_origins, ['https://go.scaylup.com'])
    pass('owners create a draft campaign with a 32-character key and lowercased origins')
    const second = await admin({ workspace_id: ws, actor_id: owner, name: 'Bookings', allowed_origins: ['https://go.scaylup.com'] })
    const key = created.intake_key

    const target = async k => (await q('select campaign_intake_target($1) r', [k]))[0].r
    assert.deepEqual(await target(key), { status: 'testing', allowed_origins: ['https://go.scaylup.com'] }); assert.equal(await target('x'.repeat(32)), null)
    assert.equal(Number((await q('select count(*) n from campaign_sources'))[0].n), 2)
    pass('each new campaign gets a first source carrying its key; the route reads it by key and nothing for an unknown key')

    let serial = 100
    const input = (over = {}) => ({ submission_id: id(serial++), offer: 'teardown', answers: [{ id: 'trade', question: 'What kind of work do you do?', answer: 'Roofing' }],
        first_name: 'Marcus', last_name: 'Hale', company: 'Hale Roofing', phone_e164: '+15125550142', email: 'marcus@example.invalid',
        consent_text: 'By submitting, you agree to receive texts from Scaylup.', consent_sha256: hex('a'), attribution: { utm_source: 'facebook' }, ip_hmac: hex('1'), user_agent: 'Test', ...over })
    const intake = async (k, value) => (await q('select campaign_intake($1,$2::jsonb) r', [k, JSON.stringify(value)]))[0].r
    const count = async table => Number((await q(`select count(*) n from ${table}`))[0].n)

    const first = input()
    const a = await intake(key, first)
    assert.equal(a.accepted, true); assert.equal(a.created, true); assert.match(a.reference, /^[a-f0-9]{64}$/)
    const lead = (await q('select * from campaign_leads'))[0]
    assert.equal(lead.stage, 'not_booked'); assert.equal(lead.is_test, true); assert.equal(lead.sms_consent, 'opted_in'); assert.equal(lead.submission_count, 1); assert.equal(lead.phone_e164, '+15125550142')
    assert.equal(await count('campaign_lead_submissions'), 1); assert.equal(await count('campaign_lead_events'), 1)
    pass('a first submission creates one Not booked lead (Test, from a Testing source), one receipt and one submitted event')

    const again = await intake(key, first)
    assert.deepEqual([again.accepted, again.duplicate, again.reference], [true, true, a.reference])
    assert.equal(await count('campaign_lead_submissions'), 1); assert.equal((await q('select submission_count n from campaign_leads'))[0].n, 1)
    pass('resending the same submission_id returns the first result and changes nothing')

    await q("update campaign_leads set stage='booked' where id=$1", [lead.id])
    const b = await intake(second.intake_key, input({ company: null, email: null, first_name: 'Marc', answers: [{ id: 'trade', question: 'Trade?', answer: 'Garage doors' }], attribution: { utm_source: 'instagram' }, ip_hmac: hex('2') }))
    assert.equal(b.created, false); assert.equal(b.reference, a.reference)
    const merged = (await q('select * from campaign_leads'))[0]
    assert.equal(await count('campaign_leads'), 1); assert.equal(merged.submission_count, 2); assert.equal(merged.stage, 'booked')
    assert.equal(merged.first_campaign_id, created.id); assert.equal(merged.latest_campaign_id, second.id)
    assert.equal(merged.first_name, 'Marc'); assert.equal(merged.company, 'Hale Roofing'); assert.equal(merged.email, 'marcus@example.invalid')
    assert.equal(merged.answers[0].answer, 'Garage doors'); assert.equal(merged.first_attribution.utm_source, 'facebook')
    pass('the same phone from another funnel stays one lead: first campaign and attribution kept, latest answers taken, stage never moved back, missing details not erased')

    await q("update campaign_leads set sms_consent='opted_out' where id=$1", [lead.id])
    await q("update campaign_lead_submissions set received_at=now()-interval '11 minutes'")
    await intake(key, input({ ip_hmac: hex('3') }))
    assert.equal((await q('select sms_consent from campaign_leads'))[0].sms_consent, 'opted_in')
    pass('a new submission with consent opts a lead back in')

    await q("update campaign_lead_submissions set received_at=now()-interval '11 minutes'")
    for (let n = 0; n < 8; n++) assert.equal((await intake(key, input({ phone_e164: `+1512555${String(1000 + n)}`, ip_hmac: hex('4') }))).accepted, true)
    assert.equal((await intake(key, input({ phone_e164: '+15125559999', ip_hmac: hex('4') }))).failure, 'rate_limited')
    pass('a ninth submission from one address within 10 minutes is refused')

    for (let n = 0; n < 3; n++) assert.equal((await intake(key, input({ phone_e164: '+15125558888', ip_hmac: hex(String(5 + n)) }))).accepted, true)
    assert.equal((await intake(key, input({ phone_e164: '+15125558888', ip_hmac: hex('9') }))).failure, 'rate_limited')
    pass('a fourth submission for one phone within 10 minutes is refused')

    assert.equal((await intake(key, input({ phone_e164: '5125550142' }))).failure, 'invalid')
    assert.equal((await intake(key, input({ answers: [] }))).failure, 'invalid')
    assert.equal((await intake(key, input({ ip_hmac: '203.0.113.7' }))).failure, 'invalid')
    pass('the database refuses unnormalized phones, empty answers and raw IP values on its own')

    await q("update campaigns set status='paused' where id=$1", [created.id])
    assert.equal((await intake(key, input({ phone_e164: '+12145550100', ip_hmac: hex('b') }))).accepted, true)
    await q("update campaigns set status='archived' where id=$1", [created.id])
    assert.equal((await intake(key, input({ phone_e164: '+12145550101', ip_hmac: hex('b') }))).failure, 'campaign')
    pass('paused campaigns keep accepting; archived campaigns stop')

    // Sources and booking (docs/campaign-booking.md)
    const adm = async (action, input) => (await q('select campaign_admin($1,$2::jsonb) r', [action, JSON.stringify({ workspace_id: ws, actor_id: owner, ...input })]))[0].r
    const src = (await q('select * from campaign_sources where campaign_id=$1', [second.id]))[0]
    await assert.rejects(q("select campaign_admin('update_source',$1::jsonb)", [JSON.stringify({ workspace_id: ws, actor_id: staff, source_id: src.id, fields: { name: 'x' } })]), /Owner or admin required/)
    await assert.rejects(adm('update_source', { source_id: src.id, fields: { books: true } }), /not valid/)
    await adm('update_source', { source_id: src.id, fields: { status: 'live', tag: 'Teardown', tag_tone: 'emerald', books: true, booking_slug: 'teardown', meeting_title: 'Funnel teardown', meeting_minutes: 60, meeting_place: 'zoom',
        booking_days: [0, 1, 2, 3, 4, 5, 6], day_start_minute: 0, day_end_minute: 1440, notice_hours: 0, horizon_days: 30, pay_amount_cents: 100, hold_minutes: 20 } })
    const other2 = await adm('create_source', { campaign_id: second.id })
    await assert.rejects(adm('update_source', { source_id: other2.id, fields: { books: true, booking_slug: 'teardown' } }), /already uses that booking address/)
    pass('owners set a source to book with payment; staff cannot; a booking address is unique and required to book')

    const lead2sub = input({ phone_e164: '+14695550101', first_name: 'Dana', ip_hmac: hex('c') })
    await intake(src.intake_key, lead2sub)
    const dana = (await q("select * from campaign_leads where phone_e164='+14695550101'"))[0]
    assert.equal(dana.is_test, false); assert.equal(dana.latest_source_id, src.id)
    const page = async (sub, ref = null) => (await q('select campaign_booking_page($1,$2,$3) r', ['teardown', sub, ref]))[0].r
    const p1 = await page(lead2sub.submission_id)
    assert.equal(p1.lead.first_name, 'Dana'); assert.equal(p1.pay_amount_cents, 100); assert.equal(p1.open, null); assert.deepEqual(p1.taken, [])
    assert.equal((await page(id(9999))).lead, null); assert.equal((await q("select campaign_booking_page('nope',null,null) r"))[0].r, null)
    pass('the booking page finds the lead by submission ID, and no one for an unknown one')

    const at = async hours => (await q(`select ((date_trunc('hour', now() at time zone 'America/Chicago') + interval '${hours} hours') at time zone 'America/Chicago') t`))[0].t
    const t1 = await at(3), t2 = await at(5)
    const hold = async (sub, startsAt) => (await q("select campaign_booking_hold('teardown',$1::jsonb) r", [JSON.stringify({ submission: sub, starts_at: startsAt })]))[0].r
    assert.equal((await hold(lead2sub.submission_id, new Date(new Date(t1).getTime() + 30 * 60000).toISOString())).failure, 'time')
    assert.equal((await hold(id(9999), t1)).failure, 'lead')
    const h1 = await hold(lead2sub.submission_id, t1)
    assert.equal(h1.status, 'held'); assert.equal(h1.amount_cents, 100); assert.ok(h1.held_until)
    assert.equal((await q('select stage from campaign_leads where id=$1', [dana.id]))[0].stage, 'not_booked')
    pass('a time on the hour is held for 20 minutes at the source price; the lead stays Not booked; an off-grid time or unknown lead is refused')

    const lead3sub = input({ phone_e164: '+14695550102', first_name: 'Ben', ip_hmac: hex('d') })
    await intake(src.intake_key, lead3sub)
    assert.equal((await hold(lead3sub.submission_id, t1)).failure, 'taken')
    assert.equal((await page(lead3sub.submission_id)).taken.length, 1)
    pass('a held time is taken for everyone else')

    assert.equal((await q("select campaign_booking_checkout($1,'cs_test_a1','https://checkout.stripe.com/c/pay/cs_test_a1') r", [h1.booking_id]))[0].r, true)
    assert.equal((await page(lead2sub.submission_id)).open.checkout_url, 'https://checkout.stripe.com/c/pay/cs_test_a1')
    const paid = async (bid, ev, session = 'cs_test_a1') => (await q('select campaign_booking_paid($1::jsonb) r', [JSON.stringify({ booking_id: bid, workspace_id: ws, amount_cents: 100, event_id: ev, session_id: session })]))[0].r
    assert.equal((await q('select campaign_booking_paid($1::jsonb) r', [JSON.stringify({ booking_id: h1.booking_id, workspace_id: other })]))[0].r.failure, 'booking')
    assert.equal((await paid(h1.booking_id, 'evt_1')).status, 'booked')
    assert.equal((await q('select stage from campaign_leads where id=$1', [dana.id]))[0].stage, 'booked')
    assert.equal((await paid(h1.booking_id, 'evt_1')).duplicate, true)
    assert.deepEqual((await q("select kind from campaign_lead_events where lead_id=$1 order by created_at, kind", [dana.id])).map(r => r.kind).sort(), ['booked', 'paid', 'stage_changed', 'submitted', 'time_held'])
    assert.equal((await hold(lead2sub.submission_id, t2)).failure, 'already_booked')
    pass('Stripe payment books the held time and moves the lead to Booked once; a repeat event changes nothing; another workspace cannot claim it')

    const h3 = await hold(lead3sub.submission_id, t2)
    await q("update campaign_bookings set held_until=now()-interval '1 minute' where id=$1", [h3.booking_id])
    const lead4sub = input({ phone_e164: '+14695550103', first_name: 'Luis', ip_hmac: hex('e') })
    await intake(src.intake_key, lead4sub)
    assert.equal((await hold(lead4sub.submission_id, t2)).status, 'held')
    assert.equal((await paid(h3.booking_id, 'evt_2', 'cs_test_b2')).status, 'paid_not_booked')
    const ben = (await q("select * from campaign_leads where phone_e164='+14695550102'"))[0]
    assert.equal(ben.stage, 'paid_not_booked')
    assert.equal((await page(lead3sub.submission_id)).lead.paid_credit, true)
    const rebook = await hold(lead3sub.submission_id, await at(7))
    assert.equal(rebook.status, 'booked'); assert.equal(rebook.amount_cents, null)
    assert.equal((await q('select stage from campaign_leads where id=$1', [ben.id]))[0].stage, 'booked')
    pass('a lapsed hold frees its time; paying after someone took it leaves the lead Paid, not booked, and they book again without paying')

    await assert.rejects(adm('set_stage', { lead_id: (await q("select id from campaign_leads where phone_e164='+14695550103'"))[0].id, stage: 'paid_not_booked' }), /Only a Stripe payment/)
    await assert.rejects(adm('set_stage', { lead_id: (await q("select id from campaign_leads where phone_e164='+14695550103'"))[0].id, stage: 'booked' }), /Book a time/)
    const dBooking = (await q("select id from campaign_bookings where lead_id=$1 and status='booked'", [dana.id]))[0].id
    await adm('booking_status', { booking_id: dBooking, status: 'cancelled' })
    assert.equal((await q('select stage from campaign_leads where id=$1', [dana.id]))[0].stage, 'paid_not_booked')
    const takenNow = (await page(lead3sub.submission_id)).taken.map(t => new Date(t).getTime())
    assert.ok(!takenNow.includes(new Date(t1).getTime())); assert.ok(takenNow.includes(new Date(t2).getTime()))
    const bBooking = (await q("select id from campaign_bookings where lead_id=$1 and status='booked'", [ben.id]))[0].id
    await adm('booking_status', { booking_id: bBooking, status: 'showed' })
    assert.equal((await q('select stage from campaign_leads where id=$1', [ben.id]))[0].stage, 'showed')
    await adm('set_stage', { lead_id: ben.id, stage: 'sold' })
    assert.equal((await hold(lead3sub.submission_id, await at(9))).failure, 'closed')
    pass('Payment is the only way into Paid, not booked; cancelling a paid booking moves the lead back there and frees its time; Showed and Sold follow, and a closed lead cannot book')

    await adm('update_source', { source_id: src.id, fields: { status: 'off' } })
    assert.equal((await target(src.intake_key)).status, 'archived')
    assert.equal((await intake(src.intake_key, input({ phone_e164: '+14695550104', ip_hmac: hex('f') }))).failure, 'campaign')
    assert.equal(await page(lead2sub.submission_id), null)
    pass('a source switched off stops intake and its booking page')

    for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`)
        for (const table of ['campaigns', 'campaign_sources', 'campaign_leads', 'campaign_lead_submissions', 'campaign_lead_events', 'campaign_bookings']) await assert.rejects(db.query(`select * from ${table}`), /permission denied/)
        await assert.rejects(db.query("select campaign_intake('x','{}'::jsonb)"), /permission denied/)
        await assert.rejects(db.query("select campaign_admin('create','{}'::jsonb)"), /permission denied/)
        await assert.rejects(db.query("select campaign_booking_hold('x','{}'::jsonb)"), /permission denied/)
        await assert.rejects(db.query("select campaign_booking_paid('{}'::jsonb)"), /permission denied/)
        await assert.rejects(db.query("select campaign_booking_page('x',null,null)"), /permission denied/)
        await db.exec('reset role')
    }
    pass('browser roles cannot read the tables or call the functions')

    console.log(`Campaign intake SQL: ${checks} checks passed.`)
} finally {
    await db.close()
}
