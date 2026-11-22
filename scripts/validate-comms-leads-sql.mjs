// Leads in Comms against the REAL combined schema (every committed migration replayed in memory): a lead conversation
// follows the same read, unread and alert rules as the rest of Comms (docs/comms-leads.md, app-alerts.md 22 Nov 2026).
// No credentials, no Supabase connection, nothing sent.
import assert from 'node:assert/strict'
import { replayFullSchema } from './assignment-full-schema/replay.mjs'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ws = id(1), owner = id(2), admin = id(3), staff = id(4), team = id(5)
const { db } = await replayFullSchema()
const q = async (sql, args = []) => (await db.query(sql, args)).rows
let checks = 0
const pass = label => { checks++; console.log(`PASS ${checks}: ${label}`) }
const as = async user => db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2' })])
const asService = async () => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: 'service_role' })]); await db.exec('set role service_role') }
const asUser = async user => { await db.exec('reset role'); await as(user); await db.exec('set role authenticated') }

try {
    await db.exec('set session_replication_role = replica')
    for (const [user, name] of [[owner, 'owner'], [admin, 'admin'], [staff, 'staff']]) await q("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,jsonb_build_object('username',$3::text))", [user, `${name}@example.invalid`, name])
    for (const [user, name] of [[owner, 'owner'], [admin, 'admin'], [staff, 'staff']]) await q('insert into account_user_attributions(user_id,username) values($1,$2) on conflict do nothing', [user, name])
    await q("insert into workspaces(id,name,slug) values($1,'Synthetic','synthetic')", [ws])
    await q("insert into workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'admin'),($1,$4,'staff')", [ws, owner, admin, staff])
    await q("insert into campaigns(id,workspace_id,name,status,intake_key) values($1,$2,'Garage Door Clients','live',$3)", [id(10), ws, 'k'.repeat(32)])
    await q(`insert into campaign_leads(id,workspace_id,first_campaign_id,latest_campaign_id,reference,first_name,last_name,phone_e164,stage,sms_consent_at,first_submitted_at,last_submitted_at)
        values($1,$2,$3,$3,$4,'Marcus','Hale','+15125550142','not_booked',now(),now(),now())`, [id(20), ws, id(10), 'a'.repeat(64)])
    await q("insert into web_push_subscriptions(id,user_id,device_id,endpoint,p256dh,auth) values($1,$2,$3,'https://push.example.invalid/owner','p','a'),($4,$5,$6,'https://push.example.invalid/staff','p','a'),($7,$8,$9,'https://push.example.invalid/admin','p','a')", [id(60), owner, id(61), id(62), staff, id(63), id(64), admin, id(65)])
    await db.exec('set session_replication_role = origin')

    // The server makes a lead conversation with its participants (owners and admins with Campaigns).
    await asService()
    const [conv] = await q("insert into workspace_native_conversations(workspace_id,kind,lead_id,created_by) values($1,'lead',$2,$3) returning id", [ws, id(20), owner])
    await q('insert into workspace_native_conversation_participants(workspace_id,conversation_id,user_id) values($1,$2,$3),($1,$2,$4)', [ws, conv.id, owner, admin])
    await assert.rejects(q("insert into workspace_native_conversations(workspace_id,kind,lead_id) values($1,'lead',$2)", [ws, id(20)]), /duplicate key/)
    await assert.rejects(q("insert into workspace_native_conversations(workspace_id,kind) values($1,'lead')", [ws]), /check constraint/)
    pass('one lead conversation per lead, and a lead conversation needs its lead')

    // A lead's inbound text: no staff sender, stored by the server, encrypted like any message.
    const [inbound] = await q("insert into workspace_native_messages(workspace_id,conversation_id,body,sms_direction,sms_provider_message_id) values($1,$2,'Is the 4,500 including ad spend?','inbound','sh-1') returning id,body,body_ciphertext is not null encrypted", [ws, conv.id])
    assert.equal(inbound.body, null); assert.equal(inbound.encrypted, true)
    await assert.rejects(q("insert into workspace_native_messages(workspace_id,conversation_id,sender_user_id,body,sms_direction) values($1,$2,$3,'x','inbound')", [ws, conv.id, owner]), /sender|check constraint/)
    await assert.rejects(q("insert into workspace_native_messages(workspace_id,conversation_id,body) values($1,$2,'x')", [ws, conv.id]), /sender/)
    await assert.rejects(q("insert into workspace_native_messages(workspace_id,conversation_id,body,sms_direction,sms_provider_message_id) values($1,$2,'again','inbound','sh-1')", [ws, conv.id]), /duplicate key/)
    pass('a lead text is stored once by its SignalHouse id, encrypted, with no staff sender; a staff message must not claim to be inbound')

    // Alerts: the inbound text is queued for subscribed participants only (owner has a subscription; staff is not a participant).
    const jobs = await q('select user_id,conversation_kind from chat_push_deliveries where message_id=$1', [inbound.id])
    assert.deepEqual(jobs.map(job => [job.user_id, job.conversation_kind]).sort(), [[owner, 'native'], [admin, 'native']].sort())
    pass('a lead\'s text queues an alert for each subscribed participant (not other staff), like a client\'s inbound message')

    // Reading and unread: participants see it in the summary, marked as a lead; others cannot read it.
    await asUser(owner)
    let summary = (await q('select communication_unread_summary($1) v', [ws]))[0].v
    assert.deepEqual(summary.map(item => [item.kind, item.conversationId, item.count, item.lead]), [['native', conv.id, 1, true]])
    const inbox = (await q('select communication_native_inbox($1) v', [ws]))[0].v
    assert.equal(inbox.unread.some(item => item.conversation_id === conv.id), false)
    pass('the unread summary counts the lead text for a participant, marked lead, and the Team inbox leaves it out')
    await asUser(staff)
    assert.deepEqual((await q('select communication_unread_summary($1) v', [ws]))[0].v, [])
    assert.equal((await q('select native_conversation_can_read($1) ok', [conv.id]))[0].ok, false)
    await assert.rejects(q('select advance_communication_read($1,$2,$3,$4)', [ws, 'native', conv.id, inbound.id]), /privilege|permission/)
    pass('someone who is not a participant cannot read it, mark it read or count it')

    // Staff cannot post through the native path; the server stores the outbound text with its sender.
    await asUser(owner)
    assert.equal((await q('select native_conversation_can_write($1) ok', [conv.id]))[0].ok, false)
    await assert.rejects(q("insert into workspace_native_messages(workspace_id,conversation_id,sender_user_id,body) values($1,$2,$3,'hi')", [ws, conv.id, owner]), /permission|policy|server/)
    await asService()
    const [outbound] = await q("insert into workspace_native_messages(workspace_id,conversation_id,sender_user_id,body,sms_direction,sms_status) values($1,$2,$3,'Yes, it includes it.','outbound','queued') returning id", [ws, conv.id, owner])
    assert.equal(Number((await q('select count(*) n from chat_push_deliveries where message_id=$1', [outbound.id]))[0].n), 0)
    pass('texts are stored by the server only; a text sent to the lead alerts nobody, like an outbound client message')

    // The same newest-visible read path clears it; the other participant still has it unread.
    await asUser(owner)
    await q('select advance_communication_read($1,$2,$3,$4)', [ws, 'native', conv.id, outbound.id])
    assert.deepEqual((await q('select communication_unread_summary($1) v', [ws]))[0].v, [])
    await asUser(admin)
    summary = (await q('select communication_unread_summary($1) v', [ws]))[0].v
    assert.equal(summary[0].count, 1, 'a teammate\'s outbound text is not unread; the lead\'s text still is')
    pass('a read through the shared read RPC clears it for that participant only, and outbound texts are never unread')

    // Push preparation counts the lead's inbound text and revokes a job once the participant read it.
    await asService()
    await db.exec('reset role')
    const [job] = await q('select id from chat_push_deliveries where message_id=$1 and user_id=$2', [inbound.id, owner])
    await q("update chat_push_deliveries set status='processing',lease_token=$2,lease_until=now()+interval '1 minute' where id=$1", [job.id, id(70)])
    assert.equal((await q('select prepare_chat_push_delivery($1,$2) v', [job.id, id(70)]))[0].v.state, 'read')
    const [second] = await q("insert into workspace_native_messages(workspace_id,conversation_id,body,sms_direction,sms_provider_message_id) values($1,$2,'And the setup fee?','inbound','sh-2') returning id", [ws, conv.id])
    const [job2] = await q('select id from chat_push_deliveries where message_id=$1 and user_id=$2', [second.id, owner])
    await q("update chat_push_deliveries set status='processing',lease_token=$2,lease_until=now()+interval '1 minute' where id=$1", [job2.id, id(71)])
    const prepared = (await q('select prepare_chat_push_delivery($1,$2) v', [job2.id, id(71)]))[0].v
    assert.deepEqual(prepared, { state: 'send', unreadCount: 1 })
    pass('alert preparation counts the lead text and skips one the participant has already read')

    // Team chats are unchanged: a staff Team message still alerts members and is not marked lead.
    await db.exec('set session_replication_role = replica')
    await q("insert into workspace_teams(id,workspace_id,name,kind) values($1,$2,'Team','custom')", [team, ws])
    await q("insert into workspace_team_members(workspace_id,team_id,user_id) values($1,$2,$3),($1,$2,$4)", [ws, team, owner, staff])
    await db.exec('set session_replication_role = origin')
    const [teamConv] = await q("insert into workspace_native_conversations(workspace_id,kind,team_id) values($1,'team',$2) returning id", [ws, team])
    const [teamMessage] = await q("insert into workspace_native_messages(workspace_id,conversation_id,sender_user_id,body) values($1,$2,$3,'Team note') returning id", [ws, teamConv.id, staff])
    assert.deepEqual((await q('select user_id from chat_push_deliveries where message_id=$1', [teamMessage.id])).map(row => row.user_id), [owner])
    await asUser(owner)
    summary = (await q('select communication_unread_summary($1) v', [ws]))[0].v
    assert.deepEqual(summary.map(item => [item.conversationId, item.lead ?? false]).sort(), [[conv.id, true], [teamConv.id, false]].sort())
    pass('Team chats keep their alerts and are not marked lead')

    await db.exec('reset role')
    for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`)
        await assert.rejects(db.query("insert into workspace_native_conversations(workspace_id,kind,lead_id) values($1,'lead',$2)", [ws, id(20)]), /permission|policy/)
        await db.exec('reset role')
    }
    pass('browser roles cannot create lead conversations')

    console.log(`Comms leads SQL: ${checks} checks passed.`)
} finally {
    await db.close()
}
