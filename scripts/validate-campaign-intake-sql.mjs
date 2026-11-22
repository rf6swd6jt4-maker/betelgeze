// Campaign lead intake against the REAL combined schema (every committed migration replayed in memory).
// No credentials, no Supabase connection, nothing sent. Contract: docs/campaign-intake.md.
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
    assert.deepEqual(await target(key), { status: 'draft', allowed_origins: ['https://go.scaylup.com'] }); assert.equal(await target('x'.repeat(32)), null)
    pass('the route can read a campaign by key and nothing for an unknown key')

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
    assert.equal(lead.stage, 'new'); assert.equal(lead.sms_consent, 'opted_in'); assert.equal(lead.submission_count, 1); assert.equal(lead.phone_e164, '+15125550142')
    assert.equal(await count('campaign_lead_submissions'), 1); assert.equal(await count('campaign_lead_events'), 1)
    pass('a first submission creates one new lead, one receipt and one submitted event')

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

    for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`)
        for (const table of ['campaigns', 'campaign_leads', 'campaign_lead_submissions', 'campaign_lead_events']) await assert.rejects(db.query(`select * from ${table}`), /permission denied/)
        await assert.rejects(db.query("select campaign_intake('x','{}'::jsonb)"), /permission denied/)
        await assert.rejects(db.query("select campaign_admin('create','{}'::jsonb)"), /permission denied/)
        await db.exec('reset role')
    }
    pass('browser roles cannot read the tables or call the functions')

    console.log(`Campaign intake SQL: ${checks} checks passed.`)
} finally {
    await db.close()
}
